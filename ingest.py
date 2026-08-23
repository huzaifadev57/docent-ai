"""
Docent — document ingestion pipeline.

Takes a PDF or plain-text file, splits it into overlapping token chunks,
embeds each chunk with OpenAI, and stores the results in Supabase so they
can be retrieved later by the Q&A chatbot.

Usage:
    python ingest.py path/to/file.pdf
    python ingest.py path/to/notes.txt
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import tiktoken
from dotenv import load_dotenv
from openai import OpenAI
from pypdf import PdfReader
from supabase import Client, create_client

# Chunking knobs. 500 tokens is large enough for useful context, small
# enough that several chunks fit in a typical RAG prompt. 75-token overlap
# keeps sentences that straddle a boundary from being lost.
CHUNK_SIZE = 500
CHUNK_OVERLAP = 75
EMBEDDING_MODEL = "text-embedding-3-small"
ENCODING_NAME = "cl100k_base"
SUPPORTED_EXTENSIONS = {".pdf", ".txt"}


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
        raise SystemExit(
            f"Missing required environment variable(s): {', '.join(missing)}. "
            "Add them to a .env file in the project root."
        )

    return supabase_url, supabase_key, openai_api_key


def extract_text(file_path: Path) -> str:
    """Pull raw text out of a PDF or .txt file."""
    suffix = file_path.suffix.lower()

    if suffix == ".pdf":
        reader = PdfReader(str(file_path))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages)

    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8")

    raise SystemExit(
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


def embed_chunk(client: OpenAI, chunk: str) -> list[float]:
    """Generate a vector embedding for a single chunk of text."""
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=chunk,
    )
    return response.data[0].embedding


def store_chunk(
    supabase: Client,
    content: str,
    embedding: list[float],
    source: str,
    chunk_index: int,
) -> None:
    """Insert one chunk (text + embedding + metadata) into Supabase."""
    supabase.table("documents").insert(
        {
            "content": content,
            "embedding": embedding,
            "metadata": {
                "source": source,
                "chunk_index": chunk_index,
            },
        }
    ).execute()


def ingest(file_path: Path) -> int:
    """Run the full extract → chunk → embed → store pipeline."""
    if not file_path.exists():
        raise SystemExit(f"File not found: {file_path}")

    if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise SystemExit(
            f"Unsupported file type '{file_path.suffix}'. Expected one of: "
            f"{', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    supabase_url, supabase_key, openai_api_key = load_config()
    supabase = create_client(supabase_url, supabase_key)
    openai_client = OpenAI(api_key=openai_api_key)

    print(f"Reading {file_path.name}...")
    text = extract_text(file_path)
    if not text.strip():
        raise SystemExit(f"No text could be extracted from {file_path.name}.")

    chunks = split_into_chunks(text)
    total = len(chunks)
    if total == 0:
        raise SystemExit(f"No chunks produced from {file_path.name}.")

    print(f"Split into {total} chunk(s). Embedding and storing...")

    stored = 0
    for index, chunk in enumerate(chunks):
        embedding = embed_chunk(openai_client, chunk)
        store_chunk(
            supabase=supabase,
            content=chunk,
            embedding=embedding,
            source=file_path.name,
            chunk_index=index,
        )
        stored += 1
        print(f"embedded chunk {index + 1}/{total}")

    print(f"\nDone. Stored {stored} chunk(s) from {file_path.name}.")
    return stored


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest a PDF or text file into Docent's vector store."
    )
    parser.add_argument(
        "file_path",
        type=Path,
        help="Path to a .pdf or .txt file to ingest",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ingest(args.file_path.resolve())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nIngestion cancelled.", file=sys.stderr)
        sys.exit(130)
