"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  FileText,
  Upload,
  User,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

const API_BASE = "http://localhost:8000";

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

function fileKind(file: File): "pdf" | "txt" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  return "txt";
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

function LogoMark() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-teal-700 text-white shadow-md shadow-teal-900/15">
      <BookOpen aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
    </span>
  );
}

function FileKindBadge({ kind }: { kind: "pdf" | "txt" }) {
  const isPdf = kind === "pdf";
  return (
    <span
      className={`flex size-11 shrink-0 flex-col items-center justify-center rounded-2xl shadow-sm ${
        isPdf ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-800"
      }`}
    >
      <FileText aria-hidden="true" className="size-4" strokeWidth={1.75} />
      <span className="mt-0.5 text-[8px] font-semibold tracking-[0.12em]">
        {isPdf ? "PDF" : "TXT"}
      </span>
    </span>
  );
}

function YouAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white shadow-sm shadow-teal-900/10">
      <User aria-hidden="true" className="size-3.5" strokeWidth={2} />
    </span>
  );
}

function DocentAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-teal-800 shadow-sm">
      <BookOpen aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
    </span>
  );
}

function StatusPill({
  status,
  pickedFile,
}: {
  status: UploadStatus;
  pickedFile: PickedFile | null;
}) {
  const loadedName =
    status.kind === "success"
      ? status.filename
      : status.kind === "loading" && pickedFile
        ? pickedFile.name
        : null;

  if (loadedName) {
    return (
      <span
        title={loadedName}
        className="inline-flex max-w-44 items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-stone-700 shadow-sm sm:max-w-52"
      >
        <FileText
          aria-hidden="true"
          className="size-3 shrink-0 text-teal-700"
          strokeWidth={2}
        />
        <span className="truncate">{loadedName}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-stone-400 shadow-sm">
      <FileText aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
      No document
    </span>
  );
}

export default function Home() {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    kind: "idle",
  });
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSuccessRef = useRef<{
    filename: string;
    chunksStored: number;
  } | null>(null);

  const isUploading = uploadStatus.kind === "loading";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

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
    } catch {
      setUploadStatus({
        kind: "error",
        message: "Something went wrong, please try again",
      });
    }
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

  async function sendQuestion(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || isAsking) return;

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setIsAsking(true);

    try {
      const response = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!response.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: "Something went wrong, please try again",
          },
        ]);
        return;
      }

      const data: { answer: string; sources: string[] } = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: data.answer,
          sources: data.sources ?? [],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: "Something went wrong, please try again",
        },
      ]);
    } finally {
      setIsAsking(false);
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

  const canSend = !isAsking && question.trim().length > 0;

  return (
    <div className="app-shell flex h-dvh flex-col font-sans text-stone-900">
      <header className="sticky top-0 z-10 bg-[#f3f0ea]/80 shadow-[0_1px_0_rgba(28,25,23,0.04),0_10px_24px_rgba(28,25,23,0.04)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3.5">
            <LogoMark />
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="font-display text-[1.5rem] leading-none font-medium tracking-tight text-stone-900 italic">
                  Docent
                </h1>
                <span className="text-[10px] font-medium tracking-[0.18em] text-stone-400 uppercase">
                  AI
                </span>
              </div>
              <p className="mt-1 text-[13px] text-stone-500">
                Ask questions about your documents
              </p>
            </div>
          </div>

          <StatusPill status={uploadStatus} pickedFile={pickedFile} />
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8">
        <section
          aria-label="Upload document"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-colors sm:p-6 ${
            isDragging
              ? "border-teal-500 bg-teal-50/80"
              : "border-stone-300/80"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              {pickedFile ? (
                <FileKindBadge kind={pickedFile.kind} />
              ) : (
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${
                    isDragging
                      ? "bg-teal-100 text-teal-800"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  <Upload aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800">
                  {isDragging
                    ? "Drop to upload"
                    : pickedFile
                      ? pickedFile.name
                      : "Add a document"}
                </p>
                <p className="mt-0.5 text-[13px] text-stone-500">
                  PDF or TXT, up to 10MB — drag in or browse
                </p>
              </div>
            </div>
            <div>
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
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-teal-700 px-4 text-sm font-medium text-white shadow-md shadow-teal-900/10 transition-colors hover:bg-teal-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:bg-teal-700/40 disabled:shadow-none sm:w-auto"
              >
                {isUploading ? "Indexing…" : "Upload Document"}
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {uploadStatus.kind === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22 }}
                className="mt-5"
              >
                <div className="mb-2 flex items-center justify-between text-[12px] text-stone-500">
                  <span>Indexing document…</span>
                  <span className="animate-pulse">Please wait</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-200/80">
                  <motion.div
                    className="h-full w-1/3 rounded-full bg-teal-600"
                    animate={{ x: ["-120%", "320%"] }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                </div>
              </motion.div>
            )}

            {uploadStatus.kind === "success" && (
              <motion.p
                key="success"
                role="status"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="mt-5 flex items-start gap-2.5 rounded-2xl bg-teal-50/90 px-3.5 py-3 text-[13px] text-teal-900 shadow-sm"
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white">
                  <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                </span>
                <span>
                  Uploaded{" "}
                  <span className="font-medium">{uploadStatus.filename}</span> —{" "}
                  {uploadStatus.chunksStored} chunks indexed
                </span>
              </motion.p>
            )}

            {uploadStatus.kind === "error" && (
              <motion.div
                key="error"
                role="alert"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-5 flex items-start gap-2.5 rounded-2xl bg-red-50 px-3.5 py-3 text-[13px] text-red-800 shadow-sm"
              >
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-red-600"
                  strokeWidth={2}
                />
                <p className="min-w-0 flex-1 leading-relaxed">
                  {uploadStatus.message}
                </p>
                <button
                  type="button"
                  onClick={dismissError}
                  aria-label="Dismiss error"
                  className="rounded-full p-0.5 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section
          aria-label="Chat"
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white/70 shadow-md backdrop-blur-sm"
        >
          <div className="messages-scroll flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6 sm:py-7">
            {messages.length === 0 && !isAsking && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="flex h-full min-h-56 flex-col items-center justify-center px-6 text-center"
              >
                <span className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-teal-700/8 text-teal-800 shadow-sm">
                  <BookOpen
                    aria-hidden="true"
                    className="size-7"
                    strokeWidth={1.5}
                  />
                </span>
                <p className="font-display text-[1.35rem] italic text-stone-800">
                  Start a conversation
                </p>
                <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-stone-500">
                  Upload a document, then ask a question. Answers stay grounded
                  in what you indexed.
                </p>
              </motion.div>
            )}

            {messages.map((message) => {
              const sources = uniqueSources(message.sources);
              const isUser = message.role === "user";

              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  className={`flex items-end gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
                >
                  {!isUser && <DocentAvatar />}
                  <div
                    className={`max-w-[85%] px-4 py-3 text-[15px] leading-relaxed sm:max-w-[75%] ${
                      isUser
                        ? "rounded-2xl rounded-br-md bg-teal-700 text-white shadow-md shadow-teal-900/10"
                        : "rounded-2xl rounded-bl-md bg-[#f7f4ee] text-stone-800 shadow-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {!isUser && sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {sources.map((source) => (
                          <span
                            key={source}
                            className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-stone-500 shadow-sm"
                          >
                            <FileText
                              aria-hidden="true"
                              className="size-3 text-stone-400"
                              strokeWidth={2}
                            />
                            {source}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {isUser && <YouAvatar />}
                </motion.div>
              );
            })}

            {isAsking && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-end justify-start gap-2.5"
              >
                <DocentAvatar />
                <div
                  aria-label="Assistant is typing"
                  className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-[#f7f4ee] px-4 py-3.5 shadow-sm"
                >
                  <span className="size-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-stone-400" />
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="px-4 pb-5 sm:px-6 sm:pb-6">
            <div className="flex items-center gap-1.5 rounded-full bg-white py-1.5 pr-1.5 pl-5 shadow-md">
              <input
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isAsking}
                placeholder="Ask a question…"
                aria-label="Question"
                autoComplete="off"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <motion.button
                type="submit"
                disabled={!canSend}
                aria-label="Send"
                whileHover={canSend ? { scale: 1.06 } : undefined}
                whileTap={canSend ? { scale: 0.94 } : undefined}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white shadow-sm shadow-teal-900/15 transition-opacity hover:bg-teal-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:opacity-70 disabled:shadow-none"
              >
                <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.25} />
              </motion.button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
