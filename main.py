"""
Docent — FastAPI Q&A backend.

Retrieves the most relevant document chunks from Supabase and asks
gpt-4o-mini to answer using only that context. Also accepts document
uploads through POST /upload, lists indexed files at GET /documents,
and permanently removes a file with DELETE /documents/{source}.

Run:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field
from supabase import Client, create_client

from pipeline import (
    EMBEDDING_MODEL,
    SUPPORTED_EXTENSIONS,
    extract_text,
    load_config,
    split_into_chunks,
    store_chunks,
)

CHAT_MODEL = "gpt-4o-mini"
MATCH_COUNT = 5
FRONTEND_ORIGIN = "http://localhost:3000"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB

NO_CONTEXT_ANSWER = (
    "I don't have information about that in the documents I've been given."
)

SYSTEM_PROMPT = """You are Docent, a document Q&A assistant.

Answer the user's question using ONLY the provided context excerpts.
Do not use outside knowledge and do not make anything up.
Keep answers clear and concise.

If the context does not contain the answer, you MUST reply with EXACTLY
this string, character for character, and nothing else (no rephrasing,
no extra words, no punctuation changes):
I don't have information about that in the documents I've been given."""


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    source: str | None = None


class AskResponse(BaseModel):
    answer: str
    sources: list[str]


class HealthResponse(BaseModel):
    status: str


class UploadResponse(BaseModel):
    filename: str
    chunks_stored: int


class DocumentSummary(BaseModel):
    source: str
    chunk_count: int
    uploaded_at: str


class DeleteDocumentResponse(BaseModel):
    source: str
    chunks_deleted: int


app = FastAPI(title="Docent", description="Document Q&A chatbot API")

# Next.js frontend (localhost:3000) needs permission to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase_url, supabase_key, openai_api_key = load_config()
supabase: Client = create_client(supabase_url, supabase_key)
openai_client = OpenAI(api_key=openai_api_key)


def embed_question(question: str) -> list[float]:
    """Turn the user's question into a vector using the same model as ingest.py."""
    response = openai_client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=question,
    )
    return response.data[0].embedding


def match_documents(
    embedding: list[float],
    match_count: int = MATCH_COUNT,
    filter_source: str | None = None,
) -> list[dict]:
    """Ask Supabase for the closest stored chunks to this embedding."""
    response = supabase.rpc(
        "match_documents",
        {
            "query_embedding": embedding,
            "match_count": match_count,
            "filter_source": filter_source,
        },
    ).execute()
    return response.data or []


def log_raw_match_scores(chunks: list[dict]) -> None:
    """Print similarity scores for the top raw matches for reference."""
    top = chunks[:MATCH_COUNT]
    print(f"Raw match similarity scores ({len(top)} of {len(chunks)} returned):")
    if not top:
        print("  (no matches)")
        return
    for index, chunk in enumerate(top, start=1):
        print(f"  {index}. {chunk.get('similarity')}")


def unique_sources(chunks: list[dict]) -> list[str]:
    """Collect unique source filenames from chunk metadata, preserving order."""
    sources: list[str] = []
    seen: set[str] = set()

    for chunk in chunks:
        metadata = chunk.get("metadata") or {}
        source = metadata.get("source")
        if source and source not in seen:
            seen.add(source)
            sources.append(source)

    return sources


def summarize_documents(rows: list[dict]) -> list[DocumentSummary]:
    """Group chunk rows by source filename and pick the earliest created_at."""
    chunk_counts: dict[str, int] = {}
    earliest_upload: dict[str, str] = {}

    for row in rows:
        metadata = row.get("metadata") or {}
        source = metadata.get("source")
        if not source:
            continue

        created_at = row.get("created_at") or ""
        chunk_counts[source] = chunk_counts.get(source, 0) + 1
        previous = earliest_upload.get(source, "")
        # Keep the earliest timestamp so uploaded_at reflects when ingest started.
        if source not in earliest_upload or not previous or (
            created_at and created_at < previous
        ):
            earliest_upload[source] = created_at

    summaries = [
        DocumentSummary(
            source=source,
            chunk_count=count,
            uploaded_at=earliest_upload.get(source, ""),
        )
        for source, count in chunk_counts.items()
    ]
    # Most recently uploaded files first.
    summaries.sort(key=lambda item: item.uploaded_at, reverse=True)
    return summaries


def generate_answer(question: str, context: str) -> str:
    """Ask gpt-4o-mini to answer using only the retrieved context."""
    user_message = (
        f"Context:\n{context}\n\n"
        f"Question: {question}"
    )
    response = openai_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    return (response.choices[0].message.content or "").strip()


@app.get("/", response_model=HealthResponse)
def health() -> HealthResponse:
    """Simple liveness check for the frontend or a load balancer."""
    return HealthResponse(status="ok")


@app.get("/documents", response_model=list[DocumentSummary])
def list_documents() -> list[DocumentSummary]:
    """Return every indexed file, grouped by source, with chunk counts."""
    # Demo-scale: load metadata for all rows; no auth or pagination.
    response = supabase.table("documents").select("metadata, created_at").execute()
    rows = response.data or []
    return summarize_documents(rows)


@app.delete("/documents/{source}", response_model=DeleteDocumentResponse)
def delete_document(source: str) -> DeleteDocumentResponse:
    """
    Permanently remove a document and all of its chunks/embeddings.

    This cannot be undone. Every row whose metadata.source matches the
    given filename is deleted from the vector store.
    """
    # Count matching chunks first so we can 404 instead of silently
    # reporting a successful delete of nothing.
    matched = (
        supabase.table("documents")
        .select("id", count="exact")
        .filter("metadata->>source", "eq", source)
        .execute()
    )
    chunks_deleted = matched.count if matched.count is not None else len(matched.data or [])
    if chunks_deleted == 0:
        raise HTTPException(status_code=404, detail="Document not found")

    supabase.table("documents").delete().filter(
        "metadata->>source", "eq", source
    ).execute()

    return DeleteDocumentResponse(source=source, chunks_deleted=chunks_deleted)


@app.post("/ask", response_model=AskResponse)
def ask(request: AskRequest) -> AskResponse:
    """Retrieve relevant chunks and generate a grounded answer."""
    # 1. Embed the question so we can search in vector space.
    embedding = embed_question(request.question)

    # 2. Fetch the top matching chunks from Supabase (up to MATCH_COUNT).
    # When the frontend has a document selected, filter_source limits retrieval
    # to that file; None searches every indexed document.
    chunks = match_documents(embedding, filter_source=request.source)

    # Log raw scores for reference; do not filter on them.
    log_raw_match_scores(chunks)

    # 3. If nothing was retrieved, skip the OpenAI call.
    if not chunks:
        return AskResponse(answer=NO_CONTEXT_ANSWER, sources=[])

    # 4. Join chunk text into a single context block for the LLM.
    context = "\n\n".join(
        chunk.get("content") or "" for chunk in chunks if chunk.get("content")
    )
    if not context.strip():
        return AskResponse(answer=NO_CONTEXT_ANSWER, sources=[])

    # 5. Generate an answer that is constrained to that context.
    answer = generate_answer(request.question, context)

    # 6–7. Trust the model's judgment: if it used the exact fallback phrase,
    # the context was not relevant, so omit sources.
    sources = (
        []
        if answer.strip() == NO_CONTEXT_ANSWER
        else unique_sources(chunks)
    )
    return AskResponse(answer=answer, sources=sources)


@app.post("/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    """Accept a PDF or TXT upload, ingest it, and report how many chunks were stored."""
    original_name = Path(file.filename or "").name
    suffix = Path(original_name).suffix.lower()

    # Reject anything that is not a PDF or plain-text file.
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{suffix or 'unknown'}'. "
                "Only .pdf and .txt files are accepted."
            ),
        )

    tmp_path: Path | None = None
    try:
        # Write the upload to a temp file so extract_text can use a real path.
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            size = 0
            while True:
                block = await file.read(1024 * 1024)
                if not block:
                    break
                size += len(block)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=400,
                        detail="File exceeds the 10MB size limit.",
                    )
                tmp.write(block)

        # extract_text → split_into_chunks → store_chunks (same path as the CLI).
        text = extract_text(tmp_path)
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail=(
                    "No usable text could be extracted from this file. "
                    "Scanned PDFs without a text layer are not supported."
                ),
            )

        chunks = split_into_chunks(text)
        if not chunks:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No usable text could be extracted from this file. "
                    "Scanned PDFs without a text layer are not supported."
                ),
            )

        stored = store_chunks(chunks, original_name)
        return UploadResponse(filename=original_name, chunks_stored=stored)
    finally:
        # Always remove the temp file, including on validation or ingest errors.
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink()
        await file.close()
