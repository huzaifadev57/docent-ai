# Docent

Docent is a document Q&A chatbot backend. You ingest a PDF or text file, store overlapping chunks with OpenAI embeddings in Supabase, and ask questions that are answered only from those documents.

It is built as a retrieval-augmented generation (RAG) pipeline: retrieve the closest chunks, then ask `gpt-4o-mini` to answer using that context and nothing else.

## How it works

1. **Extract** text from a `.pdf` (via pypdf) or `.txt` file.
2. **Chunk** with tiktoken (`cl100k_base`), ~500 tokens per chunk and ~75 tokens of overlap.
3. **Embed** each chunk with OpenAI `text-embedding-3-small`.
4. **Store** rows in a Supabase `documents` table (`content`, `embedding`, `metadata`).
5. **Ask** by embedding the question, calling the `match_documents` RPC, dropping matches below a 0.75 similarity score, and generating an answer from the remaining chunks.

If nothing relevant is retrieved, the API returns a fallback instead of inventing an answer:

> I don't have information about that in the documents I've been given.

## Project layout

| File | Role |
| --- | --- |
| `pipeline.py` | Shared extract → chunk → embed → store logic |
| `ingest.py` | CLI wrapper around the pipeline |
| `main.py` | FastAPI app (`GET /`, `POST /ask`, `POST /upload`) |
| `requirements.txt` | Python dependencies |

## Setup

### 1. Create a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

If conda `base` is also active, prefer the venv interpreter so packages resolve correctly:

```bash
./venv/bin/python -m pip install -r requirements.txt
```

### 2. Environment variables

Create a `.env` file in the project root (it is gitignored):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-service-role-key
OPENAI_API_KEY=sk-...
```

### 3. Supabase

Enable the [pgvector](https://supabase.com/docs/guides/database/extensions/pgvector) extension, then create a `documents` table and a `match_documents` RPC. Embeddings from `text-embedding-3-small` are 1536 dimensions.

```sql
create extension if not exists vector;

create table if not exists documents (
  id bigserial primary key,
  content text not null,
  embedding vector(1536) not null,
  metadata jsonb
);

create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;
```

The parameter names `query_embedding` and `match_count` must match what `main.py` sends.

## Ingest a document (CLI)

```bash
python ingest.py path/to/file.pdf
python ingest.py path/to/notes.txt
```

Example:

```bash
python ingest.py Cirrus_Cloud_Storage_FAQ.pdf
```

## Run the API

```bash
./venv/bin/python -m uvicorn main:app --reload --port 8000
```

The server listens on [http://127.0.0.1:8000](http://127.0.0.1:8000). CORS allows a Next.js frontend at `http://localhost:3000`. Interactive docs are at `/docs`.

### `GET /`

Health check.

```json
{ "status": "ok" }
```

### `POST /ask`

Ask a question against the ingested documents.

```bash
curl -X POST http://127.0.0.1:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What is included in the Starter plan?"}'
```

Response:

```json
{
  "answer": "...",
  "sources": ["Cirrus_Cloud_Storage_FAQ.pdf"]
}
```

### `POST /upload`

Upload a `.pdf` or `.txt` file (max 10MB). Other types and empty/scanned PDFs with no text layer return `400`.

```bash
curl -X POST http://127.0.0.1:8000/upload \
  -F "file=@Cirrus_Cloud_Storage_FAQ.pdf"
```

Response:

```json
{
  "filename": "Cirrus_Cloud_Storage_FAQ.pdf",
  "chunks_stored": 2
}
```

## Stack

- **Python** — FastAPI, Uvicorn
- **OpenAI** — `text-embedding-3-small`, `gpt-4o-mini`
- **Supabase** — Postgres + pgvector
- **tiktoken** / **pypdf** — chunking and PDF text extraction

## License

MIT. See [LICENSE](LICENSE).
