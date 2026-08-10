/**
 * Why a generation failed, in the few shapes a person can act on.
 *
 * The stored `errorMessage` is written for whoever reads the logs: it names HTTP statuses,
 * byte limits and Vertex operation fields. Someone looking at a red card wants to know
 * whether the fault was theirs, ours or momentary — and whether pressing the button again
 * is worth anything. That is a much smaller question, and these are all of its answers.
 *
 * The raw message is never replaced by this, only introduced by it. An unrecognised failure
 * falls to `unknown`, where the message stands on its own rather than hiding behind a guess.
 */
export type GenerationFailureCause =
  | 'reference-image'
  | 'blocked'
  | 'empty-result'
  | 'rate-limit'
  | 'service'
  | 'configuration'
  | 'unsupported'
  | 'unknown';

/**
 * Each cause and the fragments that identify it, in the order they are tried.
 *
 * Order matters where families overlap: a 429 from Vertex arrives as `429 Quota exceeded…`
 * and would also match the service family on its status digits, so rate limiting is tested
 * first. The fragments are matched case-insensitively against the message the API stored,
 * which is the same string in every deployment — it is built in `apps/api/src/vertex`.
 */
const SIGNATURES: readonly (readonly [GenerationFailureCause, readonly string[]])[] = [
  [
    'reference-image',
    [
      'downloading the',
      'failed to download the first frame',
      'failed to download the last frame',
      'failed to download the reference',
      'is not an image',
      'exceeds the',
      'data url is malformed',
      'has no usable location',
    ],
  ],
  ['blocked', ['veo blocked the generation', 'safety', 'rai', 'blocked by']],
  ['empty-result', ['finished without returning a video', 'returned no operation name']],
  ['rate-limit', ['429', 'quota', 'rate limit', 'resource exhausted', 'too many requests']],
  ['configuration', ['is not configured', 'access token', 'permission denied', 'unauthorized']],
  ['unsupported', ['does not support', 'unknown video model']],
  ['service', ['500', '502', '503', '504', 'unavailable', 'internal error', 'timed out']],
];

/**
 * Reads a stored failure message and says which kind of failure it was.
 *
 * A generation can also fail with nothing recorded — a crash between the write and the
 * message — and that is `unknown` too: there is no cause to report, only the fact.
 */
export function classifyGenerationFailure(errorMessage?: string): GenerationFailureCause {
  const message = errorMessage?.trim().toLowerCase() ?? '';
  if (message === '') return 'unknown';

  for (const [cause, fragments] of SIGNATURES) {
    if (fragments.some((fragment) => message.includes(fragment))) return cause;
  }

  return 'unknown';
}

/**
 * Whether running the same request again has a real chance of a different outcome.
 *
 * A safety block and an unsupported option are decisions about the request itself: the same
 * request will be refused the same way, and the prompt or the settings have to change first.
 * Everything else here is circumstance — a file that was briefly unreachable, a busy region,
 * a quota that refills — so a retry is worth offering without a caveat.
 */
export function isGenerationFailureWorthRetrying(cause: GenerationFailureCause): boolean {
  return cause !== 'blocked' && cause !== 'unsupported';
}
