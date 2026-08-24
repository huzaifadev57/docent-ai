"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  FileText,
  Layers,
  Moon,
  Sparkles,
  Sun,
  Upload,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";

const API_BASE = "http://localhost:8000";

const INDEXING_STEPS = [
  "Extracting the text",
  "Splitting into passages",
  "Embedding & indexing",
];

const SUGGESTIONS = [
  "Summarize this document",
  "What are the key points?",
  "Explain it simply",
];

const MOTES = [
  { left: "12%", delay: "0s", duration: "16s" },
  { left: "28%", delay: "4s", duration: "18s" },
  { left: "47%", delay: "8s", duration: "14s" },
  { left: "63%", delay: "2s", duration: "20s" },
  { left: "81%", delay: "6s", duration: "17s" },
  { left: "91%", delay: "11s", duration: "15s" },
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

const easeOut = [0.22, 1, 0.36, 1] as const;

function LogoMark({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center">
      <motion.span
        aria-hidden="true"
        className="absolute inset-0 rounded-2xl bg-gold/25"
        animate={reduceMotion ? undefined : { opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ filter: "blur(10px)" }}
      />
      <span className="relative flex size-11 items-center justify-center rounded-2xl gold-btn">
        <BookOpen aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
      </span>
    </span>
  );
}

function FileKindBadge({ kind }: { kind: "pdf" | "txt" }) {
  const isPdf = kind === "pdf";
  return (
    <span
      className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl border ${
        isPdf
          ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200"
          : "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200"
      }`}
    >
      <FileText aria-hidden="true" className="size-4" strokeWidth={1.75} />
      <span className="mt-0.5 text-[8px] font-semibold tracking-[0.16em]">
        {isPdf ? "PDF" : "TXT"}
      </span>
    </span>
  );
}

function StatusChip({
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

  return (
    <span className="inline-flex max-w-36 items-center gap-2 rounded-full border border-line bg-inset px-3 py-1.5 text-[11px] font-medium text-ivory-dim sm:max-w-64">
      <span className="relative flex size-1.5 shrink-0">
        <span
          className={`absolute inset-0 rounded-full ${
            status.kind === "success"
              ? "bg-gold live-dot"
              : status.kind === "loading"
                ? "bg-gold-hi live-dot"
                : status.kind === "error"
                  ? "bg-terracotta"
                  : "bg-muted"
          }`}
        />
        <span
          className={`size-1.5 rounded-full ${
            status.kind === "success" || status.kind === "loading"
              ? "bg-gold-hi"
              : status.kind === "error"
                ? "bg-terracotta"
                : "bg-muted"
          }`}
        />
      </span>
      <span className="truncate tracking-wide">
        {loadedName ?? "No collection yet"}
      </span>
    </span>
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
    <motion.button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      className="theme-toggle relative flex size-9 shrink-0 items-center justify-center rounded-full"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -40, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 40, scale: 0.7 }}
          transition={{ duration: 0.22 }}
          className="flex"
        >
          {isDark ? (
            <Sun aria-hidden="true" className="size-4" strokeWidth={1.75} />
          ) : (
            <Moon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function AmbientBackground({
  spot,
}: {
  spot: { x: string; y: string };
}) {
  return (
    <div className="ambient" aria-hidden="true">
      <div
        className="ambient-spotlight"
        style={{ "--spot-x": spot.x, "--spot-y": spot.y } as CSSProperties}
      />
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
      <div className="grid-fade" />
      <div className="vignette" />
      <div className="grain" />
      {MOTES.map((mote) => (
        <span
          key={mote.left}
          className="mote"
          style={{
            left: mote.left,
            bottom: "-4%",
            animationDelay: mote.delay,
            animationDuration: mote.duration,
          }}
        />
      ))}
    </div>
  );
}

export default function Home() {
  const reduceMotion = useReducedMotion();
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    kind: "idle",
  });
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [indexingStep, setIndexingStep] = useState(0);
  const [spot, setSpot] = useState({ x: "50%", y: "18%" });
  const [theme, setTheme] = useState<Theme>("light");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSuccessRef = useRef<{
    filename: string;
    chunksStored: number;
  } | null>(null);

  const isUploading = uploadStatus.kind === "loading";
  const hasCollection = uploadStatus.kind === "success";
  const canSend = !isAsking && question.trim().length > 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

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

  useEffect(() => {
    if (uploadStatus.kind !== "loading") {
      setIndexingStep(0);
      return;
    }
    const id = window.setInterval(() => {
      setIndexingStep((step) => (step + 1) % INDEXING_STEPS.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, [uploadStatus.kind]);

  function handlePointerMove(event: MouseEvent<HTMLDivElement>): void {
    if (reduceMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setSpot({ x: `${x}%`, y: `${y}%` });
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

  return (
    <div
      className="app-shell flex h-dvh flex-col overflow-hidden text-ivory"
      onMouseMove={handlePointerMove}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AmbientBackground spot={spot} />

      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-scrim backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.35, ease: easeOut }}
              className="rounded-4xl border border-gold/35 bg-drop-card px-10 py-8 text-center shadow-[0_0_80px_rgba(176,137,72,0.16)]"
            >
              <p className="font-display text-3xl italic text-gold-hi">
                Release to add to the collection
              </p>
              <p className="mt-2 text-sm text-ivory-dim">PDF or TXT, up to 10MB</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: easeOut }}
        className="relative z-10 px-4 pt-4 sm:px-8 sm:pt-6"
      >
        <div className="glass-panel mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-[1.75rem] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3.5">
            <LogoMark reduceMotion={reduceMotion} />
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="font-display text-[1.45rem] leading-none font-medium tracking-tight text-ivory italic sm:text-[1.7rem]">
                  Docent
                </h1>
                <span className="text-[10px] font-medium tracking-[0.22em] text-gold uppercase">
                  AI
                </span>
              </div>
              <p className="mt-1 text-[12px] tracking-wide text-muted">
                Private reading room
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <StatusChip status={uploadStatus} pickedFile={pickedFile} />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </motion.header>

      <main className="relative z-10 mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 px-4 py-3 sm:gap-5 sm:px-8 sm:py-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-1">
        <motion.aside
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.08, ease: easeOut }}
          className={`upload-ring glass-panel flex flex-col rounded-3xl p-4 sm:rounded-[1.85rem] sm:p-6 ${
            isDragging ? "is-dragging" : ""
          } ${isUploading ? "is-indexing" : ""}`}
        >
          <p className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">
            Collection
          </p>
          <p className="mt-1.5 hidden font-display text-xl italic text-ivory sm:block lg:mt-2 lg:text-2xl">
            Place a document on the plinth
          </p>
          <p className="mt-2 hidden text-[13px] leading-relaxed text-muted lg:block">
            Answers stay grounded in what you index — nothing is invented outside
            the pages.
          </p>

          <div className="mt-4 flex flex-1 flex-col lg:mt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
              <div className="flex min-w-0 items-start gap-3.5">
                {pickedFile ? (
                  <FileKindBadge kind={pickedFile.kind} />
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-line bg-inset text-gold">
                    <Upload aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ivory">
                    {isDragging
                      ? "Drop to illuminate"
                      : pickedFile
                        ? pickedFile.name
                        : "Awaiting a manuscript"}
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

              <motion.button
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                whileHover={isUploading ? undefined : { y: -1, scale: 1.01 }}
                whileTap={isUploading ? undefined : { scale: 0.98 }}
                className="gold-btn inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full text-sm font-semibold tracking-wide disabled:cursor-not-allowed sm:w-auto sm:px-5 lg:mt-2 lg:w-full"
              >
                <Sparkles aria-hidden="true" className="size-3.5" strokeWidth={2} />
                {isUploading ? "Illuminating…" : "Upload document"}
              </motion.button>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {uploadStatus.kind === "loading" && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28 }}
                  className="mt-4 lg:mt-6"
                >
                  <div className="mb-2 flex items-center justify-between text-[12px] text-ivory-dim">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={indexingStep}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.25 }}
                      >
                        {INDEXING_STEPS[indexingStep]}
                      </motion.span>
                    </AnimatePresence>
                    <span className="text-gold/80">Please wait</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-inset">
                    <motion.div
                      className="shimmer h-full w-1/3 rounded-full bg-gold"
                      animate={reduceMotion ? undefined : { x: ["-30%", "280%"] }}
                      transition={{
                        duration: 1.4,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                  </div>
                </motion.div>
              )}

              {uploadStatus.kind === "success" && (
                <motion.div
                  key="success"
                  role="status"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: easeOut }}
                  className="mt-4 rounded-2xl border border-gold/20 bg-gold/8 px-3.5 py-3.5 lg:mt-6"
                >
                  <div className="flex items-start gap-2.5 text-[13px] text-gold-hi">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-gold text-[#1a1408]">
                      <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                    </span>
                    <span>
                      <span className="font-medium">{uploadStatus.filename}</span>{" "}
                      is in the collection
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[12px] text-ivory-dim">
                    <Layers aria-hidden="true" className="size-3.5 text-gold" />
                    {uploadStatus.chunksStored} passages indexed
                  </div>
                </motion.div>
              )}

              {uploadStatus.kind === "error" && (
                <motion.div
                  key="error"
                  role="alert"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 flex items-start gap-2.5 rounded-2xl border border-terracotta/25 bg-terracotta/10 px-3.5 py-3 text-[13px] text-error lg:mt-6"
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
                    className="rounded-full p-0.5 text-error/70 transition-colors hover:bg-inset hover:text-error"
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-8 hidden lg:block">
            <div className="hairline mb-4 h-px w-full" />
            <ol className="space-y-2.5 text-[12px] text-muted">
              {["Extract", "Chunk", "Embed", "Ask"].map((step, index) => (
                <li key={step} className="flex items-center gap-3">
                  <span className="font-mono text-[10px] tracking-[0.18em] text-gold/70">
                    0{index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </motion.aside>

        <motion.section
          aria-label="Chat"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.16, ease: easeOut }}
          className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-3xl sm:rounded-[1.85rem]"
        >
          {isAsking && (
            <div className="h-px w-full overflow-hidden">
              <div className="shimmer h-full w-full bg-gold/50" />
            </div>
          )}

          <div className="messages-scroll flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-7 sm:py-8">
            {messages.length === 0 && !isAsking && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: easeOut }}
                className="flex h-full min-h-52 flex-col items-center justify-center px-4 text-center sm:min-h-64 sm:px-6"
              >
                <motion.span
                  className="mb-5 flex size-14 items-center justify-center rounded-[1.25rem] border border-gold/20 bg-gold/8 text-gold-hi sm:mb-6 sm:size-18 sm:rounded-[1.6rem]"
                  animate={
                    reduceMotion
                      ? undefined
                      : { y: [0, -6, 0], rotate: [0, 1.5, 0] }
                  }
                  transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
                >
                  <BookOpen aria-hidden="true" className="size-7" strokeWidth={1.4} />
                </motion.span>
                <p className="font-display text-[1.65rem] text-balance italic text-ivory sm:text-[2rem]">
                  Ask anything in the collection
                </p>
                <p className="mt-3 max-w-md text-[13px] leading-relaxed text-pretty text-muted sm:text-[14px]">
                  {hasCollection
                    ? "The pages are indexed. Pose a question and I’ll stay faithful to the source."
                    : "Upload a document first, then begin. I’ll only answer from what you’ve given me."}
                </p>

                {hasCollection && (
                  <div className="mt-8 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((suggestion, index) => (
                      <motion.button
                        key={suggestion}
                        type="button"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 + index * 0.08, duration: 0.4 }}
                        whileHover={{ y: -2, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => void sendQuestion(suggestion)}
                        className="rounded-full border border-line bg-inset px-3.5 py-1.5 text-[12px] text-ivory-dim transition-colors hover:border-gold/35 hover:text-gold-hi"
                      >
                        {suggestion}
                      </motion.button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {messages.map((message) => {
              const sources = uniqueSources(message.sources);
              const isUser = message.role === "user";

              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.45, ease: easeOut }}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] px-4 py-3.5 text-[15px] leading-relaxed sm:max-w-[78%] ${
                      isUser
                        ? "rounded-[1.35rem] rounded-br-md gold-btn shadow-[0_12px_32px_rgba(201,163,106,0.18)]"
                        : "rounded-[1.35rem] rounded-bl-md border border-line bg-inset text-ivory"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {!isUser && sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {sources.map((source) => (
                          <span
                            key={source}
                            className="inline-flex items-center gap-1 rounded-full border border-gold/15 bg-chip px-2 py-0.5 text-[11px] text-ivory-dim"
                          >
                            <FileText
                              aria-hidden="true"
                              className="size-3 text-gold"
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

            {isAsking && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div
                  aria-label="Assistant is typing"
                  className="flex items-center gap-2 rounded-[1.35rem] rounded-bl-md border border-line bg-inset px-4 py-3.5"
                >
                  {[0, 1, 2].map((dot) => (
                    <motion.span
                      key={dot}
                      className="size-1.5 rounded-full bg-gold"
                      animate={reduceMotion ? undefined : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{
                        duration: 0.9,
                        repeat: Infinity,
                        delay: dot * 0.14,
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="px-3 pb-3 sm:px-6 sm:pb-6">
            <div className="composer-glow flex items-center gap-1.5 rounded-full border border-line bg-composer py-1.5 pr-1.5 pl-5 transition-shadow duration-300">
              <input
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isAsking}
                placeholder="Ask a question…"
                aria-label="Question"
                autoComplete="off"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ivory outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50"
              />
              <motion.button
                type="submit"
                disabled={!canSend}
                aria-label="Send"
                whileHover={canSend ? { scale: 1.06 } : undefined}
                whileTap={canSend ? { scale: 0.94 } : undefined}
                className="gold-btn inline-flex size-10 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-muted"
              >
                <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.25} />
              </motion.button>
            </div>
          </form>
        </motion.section>
      </main>
    </div>
  );
}
