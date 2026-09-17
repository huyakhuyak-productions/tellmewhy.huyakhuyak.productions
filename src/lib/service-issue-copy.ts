// The calm notice for a failure on OUR side that the person cannot fix by
// retrying — today, the owner's OpenRouter balance hitting zero. Single-sourced
// like pacing-copy.ts so the sentence can never drift between the chat banner
// and the exercise affordance.
//
// Deliberately says nothing about credits, models, or a provider: the person
// is talking to a companion, and an outage notice that names the machinery
// behind it breaks that. "The owner has been told" is a promise the server
// keeps (see ai/provider-failure.ts) — never say it where it isn't true.
export const SERVICE_ISSUE = "Something's not right on our end — the owner has been told.";
export const SERVICE_ISSUE_WORDS_SAFE_BELOW = `${SERVICE_ISSUE} Your words are safe below.`;
export const SERVICE_ISSUE_TRY_LATER = `${SERVICE_ISSUE} Try again a little later.`;

// The `errorText` the chat stream carries for this case. It is a code, not
// prose: the client maps it to the copy above, and it is the ONLY thing about
// the failure that leaves the server.
export const SERVICE_ISSUE_CODE = "service-issue";
