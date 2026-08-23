"""
Docent — document ingestion CLI.

Takes a PDF or plain-text file, splits it into overlapping token chunks,
embeds each chunk with OpenAI, and stores the results in Supabase so they
can be retrieved later by the Q&A chatbot.

The extract / chunk / embed / store steps live in pipeline.py so the
FastAPI `/upload` endpoint can reuse the same logic.

Usage:
    python ingest.py path/to/file.pdf
    python ingest.py path/to/notes.txt
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import tiktoken

from pipeline import (
    ENCODING_NAME,
    SUPPORTED_EXTENSIONS,
    extract_text,
    load_config,
    split_into_chunks,
    store_chunks,
)


def ingest(file_path: Path) -> int:
    """Run the full extract → chunk → embed → store pipeline."""
    if not file_path.exists():
        raise SystemExit(f"File not found: {file_path}")

    if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise SystemExit(
            f"Unsupported file type '{file_path.suffix}'. Expected one of: "
            f"{', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    try:
        load_config()
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc

    print(f"Reading {file_path.name}...")
    text = extract_text(file_path)

    # Temporary debug: inspect extracted text before chunking.
    encoding = tiktoken.get_encoding(ENCODING_NAME)
    print(f"[debug] character count: {len(text)}")
    print(f"[debug] token count: {len(encoding.encode(text))}")
    print(f"[debug] first 500 characters:\n{text[:500]}")

    if not text.strip():
        raise SystemExit(f"No text could be extracted from {file_path.name}.")

    chunks = split_into_chunks(text)
    total = len(chunks)
    if total == 0:
        raise SystemExit(f"No chunks produced from {file_path.name}.")

    print(f"Split into {total} chunk(s). Embedding and storing...")

    stored = store_chunks(chunks, file_path.name)

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
