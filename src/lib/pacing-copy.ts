// The rate limiter's calm ask, single-sourced so the copy can never drift apart
// across the dozen places a 429 surfaces. The base sentence stands alone where
// there is nothing to reassure about (a keep, a version switch, a hide or
// restore); the two tails add the right reassurance where the person just wrote
// something and must be told their words are safe.
export const GENTLE_PACE = "A gentle pace — give it a moment, then try again.";
export const GENTLE_PACE_WORDS_STILL_HERE = `${GENTLE_PACE} Your words are still here.`;
export const GENTLE_PACE_WORDS_SAFE_HERE = `${GENTLE_PACE} Your words are safe here.`;
