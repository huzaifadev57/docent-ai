"""
Docent — shared document ingestion pipeline.

Used by both the CLI (`ingest.py`) and the FastAPI `/upload` endpoint
so chunking, embeddings, and Supabase writes stay consistent.

Steps:
    extract_text → split_into_chunks → store_chunks (which calls embed)
"""

from __future__ import annotations

import os
from pathlib import Path

import tiktoken
from dotenv import load_dotenv
from openai import OpenAI
from pypdf import PdfReader
from supabase import Client, create_client

# 500 tokens is large enough for useful context, small enough that several
# chunks fit in a typical RAG prompt. 75-token overlap keeps sentences that
# straddle a boundary from being lost.
CHUNK_SIZE = 500
CHUNK_OVERLAP = 75
EMBEDDING_MODEL = "text-embedding-3-small"
ENCODING_NAME = "cl100k_base"
SUPPORTED_EXTENSIONS = {".pdf", ".txt"}

_openai_client: OpenAI | None = None
_supabase_client: Client | None = None


def load_config() -> tuple[str, str, str]:
    """Load required credentials from .env (or the process environment)."""
    load_dotenv()

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    openai_api_key = os.getenv("OPENAI_API_KEY")

    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_KEY", supabase_key),
            ("OPENAI_API_KEY", openai_api_key),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variable(s): {', '.join(missing)}. "
            "Add them to a .env file in the project root."
        )

    return supabase_url, supabase_key, openai_api_key


def _clients() -> tuple[Client, OpenAI]:
    """Create OpenAI and Supabase clients once, then reuse them."""
    global _openai_client, _supabase_client
    if _openai_client is None or _supabase_client is None:
        supabase_url, supabase_key, openai_api_key = load_config()
        _supabase_client = create_client(supabase_url, supabase_key)
        _openai_client = OpenAI(api_key=openai_api_key)
    return _supabase_client, _openai_client


def extract_text(file_path: Path | str) -> str:
    """Pull raw text out of a PDF or .txt file."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        reader = PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages)

    if suffix == ".txt":
        return path.read_text(encoding="utf-8")

    raise ValueError(
        f"Unsupported file type '{suffix}'. Expected one of: "
        f"{', '.join(sorted(SUPPORTED_EXTENSIONS))}"
    )


def split_into_chunks(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    """
    Split text into overlapping windows using tiktoken.

    We encode first, then slice the token list. That keeps every chunk
    close to `chunk_size` tokens regardless of how long individual
    words or punctuation sequences are.
    """
    encoding = tiktoken.get_encoding(ENCODING_NAME)
    tokens = encoding.encode(text)

    if not tokens:
        return []

    chunks: list[str] = []
    start = 0
    step = chunk_size - overlap

    while start < len(tokens):
        window = tokens[start : start + chunk_size]
        chunk = encoding.decode(window).strip()
        if chunk:
            chunks.append(chunk)
        if start + chunk_size >= len(tokens):
            break
        start += step

    return chunks


def embed(text: str) -> list[float]:
    """Generate a vector embedding for a piece of text."""
    _, openai_client = _clients()
    response = openai_client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
    )
    return response.data[0].embedding


def store_chunks(chunks: list[str], source_name: str) -> int:
    """
    Embed each chunk and insert it into the Supabase `documents` table.

    Returns the number of rows stored. Prints progress so the CLI and
    the API server log stay easy to follow.
    """
    supabase, _ = _clients()
    total = len(chunks)
    stored = 0

    for index, chunk in enumerate(chunks):
        embedding = embed(chunk)
        supabase.table("documents").insert(
            {
                "content": chunk,
                "embedding": embedding,
                "metadata": {
                    "source": source_name,
                    "chunk_index": index,
                },
            }
        ).execute()
        stored += 1
        print(f"embedded chunk {index + 1}/{total}")

    return stored
