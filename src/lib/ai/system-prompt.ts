import { normalizeForPrompt } from "@/lib/text";

export function buildSystemPrompt(): string {
  return [
    "You are a warm, attentive emotional-support companion inside the tellmewhy app.",
    "The person is talking to you the way they would talk to a therapist between sessions.",
    "",
    "How to respond:",
    "- Listen first. Reflect what you heard before offering anything.",
    "- Ask one gentle, open question at a time. Never interrogate.",
    "- Validate feelings without rushing to fix them. Avoid toxic positivity.",
    "- Keep replies short and human — a few sentences, not essays.",
    "- Markdown is supported; use it sparingly (emphasis, short lists).",
    "",
    "Boundaries:",
    "- You are not a licensed therapist and do not diagnose, prescribe, or treat.",
    "- If asked, be honest that you are an AI companion.",
    "- If the person mentions self-harm or suicide, respond with care and seriousness,",
    "  acknowledge their pain, and encourage them to reach out to a crisis line or a",
    "  trusted person right away. Never provide methods or encouragement of self-harm.",
    "",
    // Unconditional base material: the standalone law promises this same
    // walk-through with no therapist and no assignment, so it can never live in
    // the (conditional) homework section — it is always here, before any mood,
    // homework, or guidance section, and always before the crisis addendum.
    "Thought records (a CBT tool the person can work through here, with you or on their own):",
    'When they ask you to "walk me through it", guide them one column at a time (ONE, then wait) — situation → thoughts → emotions → behavior → optional body sensations — never rushing to the next, never forcing an answer they are not ready to give.',
  ].join("\n");
}

const HOMEWORK_INSTRUCTION_CLAMP = 300; // per exercise, so one long instruction can't dominate the prompt
const HOMEWORK_MAX_EXERCISES = 3; // newest few only — the caller passes them newest-first

// A gentle, non-coercive briefing so the companion KNOWS what homework the
// client already has and can help with it when it fits — never nag, never
// force. The column-by-column walk-through protocol itself lives unconditionally
// in buildSystemPrompt (the standalone law); this section only ever LISTS the
// specific assignments. Returns null when the client has no active exercises
// (nothing to add). Instructions are clamped per item and capped at the newest
// few so this section can never balloon the system prompt. This is CLIENT-
// visible data (see listExercisesForClient) — deliberately no grant check.
export function buildHomeworkSection(exercises: { type: string; instruction: string }[]): string | null {
  if (exercises.length === 0) return null;

  const items = exercises
    .slice(0, HOMEWORK_MAX_EXERCISES)
    // Normalize at interpolation time: fold CRLF, cap blank-line runs, and clamp
    // length so one instruction can't reshape or dominate the prompt. Never
    // normalized at storage — encrypted history can't be retro-fixed.
    .map((e) => `- ${normalizeForPrompt(e.instruction, HOMEWORK_INSTRUCTION_CLAMP)}`)
    .join("\n");

  return [
    "The client has active homework from their therapist — thought records to work through.",
    "You may gently weave it in when the moment fits, but never force it, never nag, and never make it feel like a checklist.",
    "Active exercises:",
    items,
  ].join("\n");
}

// The digest is read by the client's OWN therapist before a session — an
// orientation, never a diagnosis. Anchors must reference only the real
// [message <uuid>] markers in the transcript; the caller drops any id the
// model invents, but the prompt asks for fidelity up front too.
export function buildDigestPrompt(input: { priorDigest: string | null; transcript: string }): string {
  const lines = [
    "You are preparing a concise summary of a client's AI-companion conversation for the client's own therapist to read before a session.",
    "Write in calm, plain, non-diagnostic language. You are orienting a professional who will form their own assessment — do not diagnose, label, or prescribe.",
    "",
    "Return:",
    "- overview: a short paragraph on where the client is right now.",
    "- themes: a few recurring emotional themes as short phrases.",
    "- anchors: notable moments worth revisiting. Each anchor references EXACTLY ONE of the [message <uuid>] markers below, by its uuid — never invent or alter an id. Use kind \"moment\" for a meaningful turn, kind \"risk\" for a safety signal.",
    "Flag any risk signals — self-harm, hopelessness, crisis — plainly and without euphemism.",
    "",
  ];
  if (input.priorDigest) {
    lines.push(
      "Previous digest (extend it with what is new; do not repeat unchanged detail):",
      input.priorDigest,
      "",
    );
  }
  lines.push("Conversation:", input.transcript);
  return lines.join("\n");
}

export function buildTitlePrompt(userText: string, replyText: string): string {
  return [
    "Name the emotional topic of this exchange in 3 to 6 plain words.",
    "No quotes, no punctuation, no names.",
    "",
    `Person: ${userText}`,
    `Companion: ${replyText}`,
  ].join("\n");
}
