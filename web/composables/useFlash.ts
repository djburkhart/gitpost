export type FlashKind = "error" | "ok" | "info";

export type Flash = {
  id: number;
  kind: FlashKind;
  title: string;
  detail?: string;
};

export function friendlyError(raw: string): { title: string; detail?: string } {
  const text = (raw || "Something went wrong").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();

  if (lower.includes("cherry-pick is now empty") || lower.includes("nothing to commit") || lower.includes("already in this history")) {
    return {
      title: "Already in this history",
      detail: "That commit is already applied here — nothing new to cherry-pick.",
    };
  }
  if (lower.includes("paragraph has changed")) {
    return {
      title: "Paragraph moved on",
      detail: "That paragraph has changed since this proposal. Re-read the current text and open a new take.",
    };
  }
  if (lower.includes("conflict")) {
    return {
      title: "Couldn’t apply cleanly",
      detail: "The change conflicts with the current tip.",
    };
  }
  if (lower.includes("unauthorized") || lower.includes("sign in")) {
    return { title: "Sign in required", detail: "Open a session and try again." };
  }
  if (lower.includes("forbidden") || lower.includes("not allowed")) {
    return { title: "Not allowed", detail: "You don’t have permission for that action." };
  }
  if (lower.includes("not found")) {
    return { title: "Not found", detail: "That object is gone or the path is wrong." };
  }
  if (lower.includes("invite")) {
    return { title: "Invite needed", detail: text };
  }
  if (lower.includes("locked")) {
    return { title: "Account locked", detail: "Too many failed attempts. Wait and try again." };
  }
  if (lower.includes("password")) {
    return { title: "Couldn’t sign in", detail: text };
  }
  if (text.length > 140 || lower.includes("exit status") || lower.includes("git ")) {
    return { title: "That git action failed", detail: "The working tree is clean — nothing new to apply." };
  }
  return { title: text };
}

export function useFlash() {
  const items = useState<Flash[]>("flash-items", () => []);

  function dismiss(id: number) {
    items.value = items.value.filter((item) => item.id !== id);
  }

  function push(kind: FlashKind, title: string, detail?: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    items.value = [...items.value, { id, kind, title, detail }].slice(-3);
    const wait = kind === "error" ? 8000 : 4200;
    window.setTimeout(() => dismiss(id), wait);
  }

  function error(raw: unknown) {
    const message = raw instanceof Error ? raw.message : String(raw || "Something went wrong");
    const parsed = friendlyError(message);
    push("error", parsed.title, parsed.detail);
  }

  function ok(title: string, detail?: string) {
    push("ok", title, detail);
  }

  function info(title: string, detail?: string) {
    push("info", title, detail);
  }

  return { items, error, ok, info, dismiss };
}
