"""
Docent — FastAPI Q&A backend.

Retrieves the most relevant document chunks from Supabase and asks
gpt-4o-mini to answer using only that context. Also accepts document
uploads through POST /upload, which reuses pipeline.py.

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
SIMILARITY_THRESHOLD = 0.75
FRONTEND_ORIGIN = "http://localhost:3000"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB

NO_CONTEXT_ANSWER = (
    "I don't have information about that in the documents I've been given."
)

SYSTEM_PROMPT = """You are Docent, a document Q&A assistant.

Answer the user's question using ONLY the provided context excerpts.
If the context does not contain enough information to answer, say you
don't know. Do not use outside knowledge and do not make anything up.
Keep answers clear and concise."""


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1)


class AskResponse(BaseModel):
    answer: str
    sources: list[str]


class HealthResponse(BaseModel):
    status: str


class UploadResponse(BaseModel):
    filename: str
    chunks_stored: int


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


def match_documents(embedding: list[float], match_count: int = MATCH_COUNT) -> list[dict]:
    """Ask Supabase for the closest stored chunks to this embedding."""
    response = supabase.rpc(
        "match_documents",
        {
            "query_embedding": embedding,
            "match_count": match_count,
        },
    ).execute()
    return response.data or []


def log_raw_match_scores(chunks: list[dict]) -> None:
    """Print similarity scores for the top raw matches so the threshold can be tuned."""
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


@app.post("/ask", response_model=AskResponse)
def ask(request: AskRequest) -> AskResponse:
    """Retrieve relevant chunks and generate a grounded answer."""
    # 1. Embed the question so we can search in vector space.
    embedding = embed_question(request.question)

    # 2. Fetch the top matching chunks from Supabase.
    chunks = match_documents(embedding)

    # Log raw scores before filtering so 0.75 can be tuned later.
    log_raw_match_scores(chunks)

    # Keep only chunks similar enough to the question to be useful context.
    chunks = [
        chunk
        for chunk in chunks
        if (chunk.get("similarity") or 0) >= SIMILARITY_THRESHOLD
    ]

    # 3. If nothing relevant remains, skip the OpenAI call to save cost.
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

    # 6–7. Return the answer plus the unique source filenames that were used.
    return AskResponse(answer=answer, sources=unique_sources(chunks))


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
