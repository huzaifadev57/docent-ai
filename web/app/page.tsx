"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  FileText,
  Moon,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const API_BASE = "http://localhost:8000";

const SUGGESTIONS = [
  "Summarize this document",
  "What are the key points?",
  "Explain it simply",
];

const THEME_KEY = "docent-theme";

type Theme = "light" | "dark";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
};

type UploadStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; filename: string; chunksStored: number }
  | { kind: "error"; message: string };

type PickedFile = {
  name: string;
  kind: "pdf" | "txt";
};

type IndexedDocument = {
  source: string;
  chunk_count: number;
  uploaded_at: string;
};

function newId(): string {
  return crypto.randomUUID();
}

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".txt") ||
    file.type === "application/pdf" ||
    file.type === "text/plain"
  );
}

function kindFromFilename(name: string): "pdf" | "txt" {
  return name.toLowerCase().endsWith(".pdf") ? "pdf" : "txt";
}

function fileKind(file: File): "pdf" | "txt" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  return "txt";
}

function formatShortDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatChunkCount(count: number): string {
  return count === 1 ? "1 chunk" : `${count} chunks`;
}

function uniqueSources(sources: string[] | undefined): string[] {
  if (!sources?.length) return [];
  return [...new Set(sources)];
}

async function readApiError(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      if (typeof detail === "string" && detail.trim()) {
        return detail;
      }
      if (Array.isArray(detail) && detail.length > 0) {
        const first = detail[0];
        if (typeof first === "string") return first;
        if (
          first &&
          typeof first === "object" &&
          "msg" in first &&
          typeof (first as { msg: unknown }).msg === "string"
        ) {
          return (first as { msg: string }).msg;
        }
      }
    }
  } catch {
    // Fall through to a generic status message.
  }
  return `Request failed (${response.status})`;
}

function FileKindBadge({
  kind,
  compact = false,
}: {
  kind: "pdf" | "txt";
  compact?: boolean;
}) {
  return (
    <span
      className={`flex shrink-0 flex-col items-center justify-center border border-line bg-inset text-fg-muted ${
        compact ? "size-9 rounded-lg" : "size-11 rounded-xl"
      }`}
    >
      <FileText
        aria-hidden="true"
        className={compact ? "size-3.5" : "size-4"}
        strokeWidth={1.75}
      />
      <span
        className={`font-medium tracking-wide ${
          compact ? "mt-px text-[7px]" : "mt-0.5 text-[8px]"
        }`}
      >
        {kind === "pdf" ? "PDF" : "TXT"}
      </span>
    </span>
  );
}

function statusChipLabel(
  status: UploadStatus,
  pickedFile: PickedFile | null,
  documents: IndexedDocument[],
): string {
  if (status.kind === "loading" && pickedFile) {
    return pickedFile.name;
  }
  if (documents.length > 1) {
    return `${documents.length} documents`;
  }
  if (documents.length === 1) {
    return documents[0].source;
  }
  return "No document";
}

function StatusChip({
  status,
  pickedFile,
  documents,
}: {
  status: UploadStatus;
  pickedFile: PickedFile | null;
  documents: IndexedDocument[];
}) {
  const label = statusChipLabel(status, pickedFile, documents);

  return (
    <span className="inline-flex max-w-36 items-center gap-2 rounded-full border border-line bg-inset px-3 py-1.5 text-[11px] font-medium text-fg-muted sm:max-w-64">
      <span className="relative flex size-1.5 shrink-0">
        {(status.kind === "success" || status.kind === "loading") && (
          <span className="live-dot absolute inset-0 rounded-full bg-accent" />
        )}
        <span
          className={`size-1.5 rounded-full ${
            status.kind === "success" || status.kind === "loading"
              ? "bg-accent"
              : status.kind === "error"
                ? "bg-error"
                : "bg-muted"
          }`}
        />
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

function IndexedDocumentRow({
  doc,
  selected,
  onSelect,
  onDelete,
  reduceMotion,
}: {
  doc: IndexedDocument;
  selected: boolean;
  onSelect: () => void;
  onDelete: (source: string) => Promise<void>;
  reduceMotion: boolean | null;
}) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "deleting" | "error">(
    "idle",
  );
  const date = formatShortDate(doc.uploaded_at);

  useEffect(() => {
    if (phase !== "error") return;
    const id = window.setTimeout(() => setPhase("idle"), 2800);
    return () => window.clearTimeout(id);
  }, [phase]);

  async function confirmDelete(): Promise<void> {
    setPhase("deleting");
    try {
      await onDelete(doc.source);
    } catch {
      setPhase("error");
    }
  }

  const rowTone = selected
    ? "border-accent bg-accent-soft"
    : "border-transparent hover:bg-inset";

  return (
    <motion.li
      initial={false}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      {phase === "confirm" || phase === "deleting" || phase === "error" ? (
        <div
          className={`flex min-h-13 items-center gap-2 border-l-2 px-3 py-2 ${rowTone}`}
        >
          {phase === "deleting" ? (
            <p className="min-w-0 flex-1 text-[12px] text-muted">Deleting…</p>
          ) : phase === "error" ? (
            <p className="min-w-0 flex-1 text-[12px] text-error">
              Couldn&apos;t delete, try again
            </p>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-[12px] font-medium text-fg">
                Delete this document?
              </p>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="shrink-0 rounded-md bg-error-bg px-2.5 py-1 text-[11px] font-semibold text-error hover:opacity-90"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setPhase("idle")}
                className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-muted hover:bg-inset hover:text-fg"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={`group flex items-center border-l-2 ${rowTone}`}>
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
          >
            <FileKindBadge kind={kindFromFilename(doc.source)} compact />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">
                {doc.source}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted">
                {formatChunkCount(doc.chunk_count)}
                {date ? ` · ${date}` : ""}
              </p>
            </div>
          </button>
          <button
            type="button"
            aria-label={`Delete ${doc.source}`}
            title="Delete document"
            onClick={() => setPhase("confirm")}
            className="mr-1.5 shrink-0 rounded-md p-1.5 text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-error-bg hover:text-error focus-visible:opacity-100 max-sm:opacity-100"
          >
            <Trash2 aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}
    </motion.li>
  );
}

function IndexedDocumentList({
  documents,
  selectedSource,
  onSelect,
  onDelete,
  reduceMotion,
}: {
  documents: IndexedDocument[];
  selectedSource: string | null;
  onSelect: (source: string) => void;
  onDelete: (source: string) => Promise<void>;
  reduceMotion: boolean | null;
}) {
  return (
    <AnimatePresence>
      {documents.length > 0 && (
        <motion.div
          key="indexed-list"
          initial={false}
          exit={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, height: 0, marginTop: 0 }
          }
          transition={{ duration: 0.2 }}
          className="mt-4 min-h-0 overflow-hidden lg:mt-5"
        >
          <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-inset lg:max-h-none">
            <AnimatePresence initial={false}>
              {documents.map((doc) => (
                <IndexedDocumentRow
                  key={doc.source}
                  doc={doc}
                  selected={selectedSource === doc.source}
                  onSelect={() => onSelect(doc.source)}
                  onDelete={onDelete}
                  reduceMotion={reduceMotion}
                />
              ))}
            </AnimatePresence>
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      className="theme-toggle relative flex size-9 shrink-0 items-center justify-center rounded-full"
    >
      {isDark ? (
        <Sun aria-hidden="true" className="size-4" strokeWidth={1.75} />
      ) : (
        <Moon aria-hidden="true" className="size-4" strokeWidth={1.75} />
      )}
    </button>
  );
}

export default function Home() {
  const reduceMotion = useReducedMotion();
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    kind: "idle",
  });
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [documents, setDocuments] = useState<IndexedDocument[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [pendingSource, setPendingSource] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSuccessRef = useRef<{
    filename: string;
    chunksStored: number;
  } | null>(null);

  const isUploading = uploadStatus.kind === "loading";
  const messages = selectedSource
    ? (conversations[selectedSource] ?? [])
    : [];
  const isChatReady = selectedSource !== null;
  const showTyping = isAsking && pendingSource === selectedSource;
  const canSend = isChatReady && !isAsking && question.trim().length > 0;

  const refreshDocuments = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/documents`);
      if (!response.ok) {
        console.error(`Failed to fetch documents (${response.status})`);
        return;
      }
      const data: IndexedDocument[] = await response.json();
      setDocuments(data);
    } catch (error) {
      console.error("Failed to fetch documents", error);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showTyping]);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    const next: Theme = stored === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);

  function toggleTheme(): void {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  async function uploadFile(file: File): Promise<void> {
    if (!isSupportedFile(file)) {
      setUploadStatus({
        kind: "error",
        message: "Only .pdf and .txt files are accepted.",
      });
      return;
    }

    setPickedFile({ name: file.name, kind: fileKind(file) });
    setUploadStatus({ kind: "loading" });

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        setUploadStatus({
          kind: "error",
          message: await readApiError(response),
        });
        return;
      }

      const data: { filename: string; chunks_stored: number } =
        await response.json();
      const success = {
        filename: data.filename,
        chunksStored: data.chunks_stored,
      };
      lastSuccessRef.current = success;
      setUploadStatus({ kind: "success", ...success });
      setSelectedSource(success.filename);
      await refreshDocuments();
    } catch {
      setUploadStatus({
        kind: "error",
        message: "Something went wrong, please try again",
      });
    }
  }

  async function deleteDocument(source: string): Promise<void> {
    const response = await fetch(
      `${API_BASE}/documents/${encodeURIComponent(source)}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      throw new Error("Couldn't delete");
    }

    setDocuments((prev) => prev.filter((doc) => doc.source !== source));
    setConversations((prev) => {
      const next = { ...prev };
      delete next[source];
      return next;
    });
    setSelectedSource((current) => (current === source ? null : current));
    if (pendingSource === source) {
      setPendingSource(null);
      setIsAsking(false);
    }
    if (lastSuccessRef.current?.filename === source) {
      lastSuccessRef.current = null;
    }
    setUploadStatus((prev) =>
      prev.kind === "success" && prev.filename === source
        ? { kind: "idle" }
        : prev,
    );
  }

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await uploadFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (!isUploading) setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>): Promise<void> {
    event.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  }

  function dismissError(): void {
    const previous = lastSuccessRef.current;
    if (previous) {
      setUploadStatus({ kind: "success", ...previous });
      return;
    }
    setUploadStatus({ kind: "idle" });
  }

  function appendMessage(source: string, message: ChatMessage): void {
    setConversations((prev) => ({
      ...prev,
      [source]: [...(prev[source] ?? []), message],
    }));
  }

  async function sendQuestion(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || isAsking || !selectedSource) return;

    const source = selectedSource;
    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: trimmed,
    };

    appendMessage(source, userMessage);
    setQuestion("");
    setIsAsking(true);
    setPendingSource(source);

    try {
      const response = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, source }),
      });

      if (!response.ok) {
        appendMessage(source, {
          id: newId(),
          role: "assistant",
          content: "Something went wrong, please try again",
        });
        return;
      }

      const data: { answer: string; sources: string[] } = await response.json();
      appendMessage(source, {
        id: newId(),
        role: "assistant",
        content: data.answer,
        sources: data.sources ?? [],
      });
    } catch {
      appendMessage(source, {
        id: newId(),
        role: "assistant",
        content: "Something went wrong, please try again",
      });
    } finally {
      setIsAsking(false);
      setPendingSource(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendQuestion(question);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendQuestion(question);
    }
  }

  const fade = reduceMotion
    ? undefined
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.22 },
      };

  return (
    <div
      className="app-shell flex h-dvh flex-col overflow-hidden text-fg"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-scrim"
          >
            <div className="rounded-2xl border border-accent bg-drop-card px-10 py-8 text-center">
              <p className="text-xl font-medium text-fg">Drop to upload</p>
              <p className="mt-2 text-sm text-fg-muted">PDF or TXT, up to 10MB</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="relative z-10 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="panel mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-2xl px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg">
              <BookOpen aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
            </span>
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-lg leading-none font-semibold tracking-tight text-fg sm:text-xl">
                  Docent
                </h1>
                <span className="text-[11px] font-medium text-muted">AI</span>
              </div>
              <p className="mt-1 text-[12px] text-muted">
                Ask questions about your documents
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <StatusChip
              status={uploadStatus}
              pickedFile={pickedFile}
              documents={documents}
            />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 px-4 py-3 sm:gap-5 sm:px-8 sm:py-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-1">
        <aside
          className={`panel flex min-h-0 flex-col overflow-hidden rounded-2xl p-4 sm:p-6 ${
            isDragging ? "border-accent" : ""
          }`}
        >
          <p className="text-lg font-semibold text-fg">Add a document</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            PDF or TXT, up to 10MB
          </p>

          <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto lg:mt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
              <div className="flex min-w-0 items-start gap-3.5">
                {pickedFile ? (
                  <FileKindBadge kind={pickedFile.kind} />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-inset text-muted">
                    <Upload aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {isDragging
                      ? "Drop to upload"
                      : pickedFile
                        ? pickedFile.name
                        : "No document uploaded yet"}
                  </p>
                  <p className="mt-1 text-[12px] text-muted">
                    Drag in anywhere, or browse a file
                  </p>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                className="sr-only"
                disabled={isUploading}
                onChange={handleFileChange}
              />

              <button
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="accent-btn inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-opacity disabled:cursor-not-allowed sm:w-auto sm:px-4 lg:mt-2 lg:w-full"
              >
                {isUploading ? "Uploading…" : "Upload document"}
              </button>
            </div>

            <AnimatePresence mode="wait" initial={false}>
            {uploadStatus.kind === "loading" && (
              <motion.div
                key="loading"
                initial={fade?.initial}
                animate={fade?.animate ?? { opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade?.transition}
                className="mt-4 lg:mt-6"
              >
                <div className="mb-2 flex items-center justify-between text-[12px] text-fg-muted">
                  <span>Uploading…</span>
                </div>
                <div className="progress-bar h-1 rounded-full bg-inset">
                  <div className="progress-bar-fill" />
                </div>
              </motion.div>
            )}

            {uploadStatus.kind === "success" && (
              <motion.div
                key="success"
                role="status"
                initial={fade?.initial}
                animate={fade?.animate ?? { opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade?.transition}
                className="mt-4 rounded-xl border border-success-line bg-success-bg px-3.5 py-3 lg:mt-6"
              >
                <div className="flex items-start gap-2.5 text-[13px] text-success">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
                    <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                  </span>
                  <span>
                    <span className="font-medium">{uploadStatus.filename}</span>{" "}
                    uploaded
                  </span>
                </div>
                <p className="mt-2 text-[12px] text-fg-muted">
                  {uploadStatus.chunksStored}{" "}
                  {uploadStatus.chunksStored === 1 ? "chunk" : "chunks"} indexed
                </p>
              </motion.div>
            )}

            {uploadStatus.kind === "error" && (
              <motion.div
                key="error"
                role="alert"
                initial={fade?.initial}
                animate={fade?.animate ?? { opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade?.transition}
                className="mt-4 flex items-start gap-2.5 rounded-xl border border-error-line bg-error-bg px-3.5 py-3 text-[13px] text-error lg:mt-6"
              >
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                  strokeWidth={2}
                />
                <p className="min-w-0 flex-1 leading-relaxed">
                  {uploadStatus.message}
                </p>
                <button
                  type="button"
                  onClick={dismissError}
                  aria-label="Dismiss error"
                  className="rounded-md p-0.5 text-error/70 hover:bg-inset hover:text-error"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </motion.div>
            )}
            </AnimatePresence>

            <IndexedDocumentList
              documents={documents}
              selectedSource={selectedSource}
              onSelect={setSelectedSource}
              onDelete={deleteDocument}
              reduceMotion={reduceMotion}
            />
          </div>
        </aside>

        <section
          aria-label="Chat"
          className="panel flex min-h-0 flex-col overflow-hidden rounded-2xl"
        >
          {showTyping && <div className="ask-bar w-full" />}

          {selectedSource && (
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 sm:px-6">
              <FileText
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted"
                strokeWidth={2}
              />
              <p className="truncate text-[12px] font-medium text-fg-muted">
                {selectedSource}
              </p>
            </div>
          )}

          <div className="messages-scroll flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            {messages.length === 0 && !showTyping && (
              <div className="flex h-full min-h-52 flex-col items-center justify-center px-4 text-center sm:min-h-64 sm:px-6">
                <span className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-inset text-muted sm:mb-5 sm:size-14">
                  <BookOpen aria-hidden="true" className="size-6" strokeWidth={1.5} />
                </span>
                <p className="text-xl font-semibold text-balance text-fg sm:text-2xl">
                  Ask a question
                </p>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-pretty text-muted sm:text-[14px]">
                  {isChatReady
                    ? "Ask a question about this document."
                    : "Select a document, then ask a question about it."}
                </p>

                {isChatReady && (
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void sendQuestion(suggestion)}
                        className="rounded-full border border-line bg-inset px-3.5 py-1.5 text-[12px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((message) => {
              const sources = uniqueSources(message.sources);
              const isUser = message.role === "user";

              return (
                <motion.div
                  key={message.id}
                  initial={fade?.initial}
                  animate={fade?.animate ?? { opacity: 1 }}
                  transition={fade?.transition}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed sm:max-w-[78%] ${
                      isUser
                        ? "rounded-br-md bg-accent text-accent-fg"
                        : "rounded-bl-md border border-line bg-inset text-fg"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {!isUser && sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {sources.map((source) => (
                          <span
                            key={source}
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-chip px-2 py-0.5 text-[11px] text-fg-muted"
                          >
                            <FileText
                              aria-hidden="true"
                              className="size-3 text-muted"
                              strokeWidth={2}
                            />
                            {source}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {showTyping && (
              <motion.div
                initial={fade?.initial}
                animate={fade?.animate ?? { opacity: 1 }}
                transition={fade?.transition}
                className="flex justify-start"
              >
                <div
                  aria-label="Assistant is typing"
                  className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-line bg-inset px-4 py-3.5"
                >
                  <span className="typing-dot size-1.5 rounded-full bg-accent" />
                  <span className="typing-dot size-1.5 rounded-full bg-accent" />
                  <span className="typing-dot size-1.5 rounded-full bg-accent" />
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="px-3 pb-3 sm:px-6 sm:pb-6">
            <div className="composer flex items-center gap-1.5 rounded-xl border border-line bg-composer py-1.5 pr-1.5 pl-4 transition-colors">
              <input
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isChatReady || isAsking}
                placeholder={
                  isChatReady
                    ? "Ask a question…"
                    : "Select a document to begin"
                }
                aria-label="Question"
                autoComplete="off"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send"
                className="accent-btn inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform disabled:cursor-not-allowed enabled:hover:scale-105 enabled:active:scale-95"
              >
                <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.25} />
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
