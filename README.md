# Docent AI

Docent is an AI-powered document Q&A assistant. Upload a PDF or text file, then ask questions about it in plain English. Answers are generated strictly from the uploaded document, with source citations, and the assistant clearly says when it doesn't know something instead of guessing.

## Features

- **Document upload** - drag and drop a PDF or TXT file (up to 10MB), automatically chunked, embedded, and indexed
- **Grounded answers** - responses are generated only from the retrieved document content, with no hallucinated information
- **Source citations** - every answer shows which document it came from
- **Per-document conversations** - each indexed document has its own isolated chat thread and search scope, so answers never mix content across files
- **Document management** - view all indexed documents with chunk counts and upload dates, delete any document (and its data) at any time
- **Clean, responsive UI** - light/dark mode, works on desktop and mobile



## How it works

1. **Ingestion** — uploaded files are parsed, split into overlapping ~500-token chunks, and embedded using OpenAI's `text-embedding-3-small`
2. **Storage** — chunks and embeddings are stored in Postgres via [pgvector](https://github.com/pgvector/pgvector), hosted on Supabase
3. **Retrieval** — a question is embedded and matched against the relevant document's chunks using cosine similarity
4. **Generation** — the top matches are passed to `gpt-4o-mini` as context, with instructions to answer only from that context and say so clearly if the answer isn't there



## Tech stack

**Backend:** Python, FastAPI, OpenAI API, Supabase (Postgres + pgvector)
**Frontend:** Next.js, TypeScript, Tailwind CSS, Framer Motion

## Project structure

```
docent-ai/
├── main.py            # FastAPI app: /ask, /upload, /documents, DELETE /documents/{source}
├── pipeline.py         # Shared ingestion logic: extract, chunk, embed, store
├── ingest.py           # CLI ingestion script (uses pipeline.py)
├── schema.sql          # Supabase schema: pgvector setup, documents table, match_documents()
├── requirements.txt
├── web/                # Next.js frontend
│   └── src/app/page.tsx
└── README.md
```



## Setup



### 1. Database

Create a [Supabase](https://supabase.com) project, then run `schema.sql` in the SQL Editor. This enables the `pgvector` extension and creates the `documents` table and `match_documents` search function.

### 2. Backend

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY
uvicorn main:app --reload --port 8000
```



### 3. Frontend

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

## API endpoints


| Method | Endpoint              | Description                                       |
| ------ | --------------------- | ------------------------------------------------- |
| GET    | `/`                   | Health check                                      |
| POST   | `/upload`             | Upload and index a PDF/TXT document               |
| GET    | `/documents`          | List all indexed documents                        |
| DELETE | `/documents/{source}` | Delete a document and its indexed data            |
| POST   | `/ask`                | Ask a question, optionally scoped to one document |




## Notes

This project uses a fixed similarity search (top-k retrieval) rather than a similarity threshold, since raw cosine similarity scores from `text-embedding-3-small` don't have a stable cutoff across queries. Instead, the language model itself judges whether the retrieved context actually answers the question, and reports when it doesn't.