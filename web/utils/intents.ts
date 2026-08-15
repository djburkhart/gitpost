export const FORK_INTENTS = [
  { id: "counter-argument", label: "Counter-argument", hint: "Disagree and make the opposite case." },
  { id: "extension", label: "Extension", hint: "Build on the idea and take it further." },
  { id: "translation", label: "Translation", hint: "Restate it for another language or audience." },
  { id: "simplification", label: "Simplification", hint: "Say the same thing more clearly." },
  { id: "implementation", label: "Implementation", hint: "Turn the idea into a plan, spec, or how-to." },
] as const;

export type ForkIntentId = (typeof FORK_INTENTS)[number]["id"];

export function intentLabel(id?: string) {
  return FORK_INTENTS.find((i) => i.id === id)?.label || id || "";
}
