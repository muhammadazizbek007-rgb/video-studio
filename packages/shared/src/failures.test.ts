import { describe, expect, it } from 'vitest';
import { classifyGenerationFailure, isGenerationFailureWorthRetrying } from './failures.js';

describe('classifyGenerationFailure', () => {
  // Every string below is one the API actually stores — see apps/api/src/vertex/veo.ts and
  // apps/api/src/vertex/client.ts. A classifier tested against invented messages would
  // agree with itself and with nothing else.
  it.each([
    ['Downloading the reference image failed.', 'reference-image'],
    ['Downloading the first frame image timed out.', 'reference-image'],
    ['Failed to download the reference image 1 (HTTP 404).', 'reference-image'],
    ['The first frame image is not an image (content type: text/html).', 'reference-image'],
    ['A reference image exceeds the 8388608 byte limit.', 'reference-image'],
    ['The last frame image data URL is malformed.', 'reference-image'],
    ['Veo blocked the generation: safety filters', 'blocked'],
    ['Veo finished without returning a video.', 'empty-result'],
    ['Veo accepted the request but returned no operation name.', 'empty-result'],
    ['429 Quota exceeded for aiplatform.googleapis.com', 'rate-limit'],
    ['Vertex AI is not configured: no Google service account is available.', 'configuration'],
    ['veo-3.1-fast does not support image-to-video.', 'unsupported'],
    ['503 The service is currently unavailable.', 'service'],
  ])('reads %j as %s', (message, expected) => {
    expect(classifyGenerationFailure(message)).toBe(expected);
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyGenerationFailure('Something nobody wrote a branch for')).toBe('unknown');
  });

  it('treats a failure with no message as unknown', () => {
    expect(classifyGenerationFailure()).toBe('unknown');
    expect(classifyGenerationFailure('   ')).toBe('unknown');
  });

  it('ignores the case the message happened to arrive in', () => {
    expect(classifyGenerationFailure('DOWNLOADING THE REFERENCE IMAGE FAILED.')).toBe(
      'reference-image',
    );
  });

  // A 429 carries both a rate-limit word and a status number the service family also
  // watches for, so the order the families are tried in is load-bearing.
  it('prefers rate limiting over the service family on a 429', () => {
    expect(classifyGenerationFailure('429 Too many requests, please retry')).toBe('rate-limit');
  });
});

describe('isGenerationFailureWorthRetrying', () => {
  it('holds back on the failures that are decisions about the request', () => {
    expect(isGenerationFailureWorthRetrying('blocked')).toBe(false);
    expect(isGenerationFailureWorthRetrying('unsupported')).toBe(false);
  });

  it('encourages a retry on everything circumstantial', () => {
    expect(isGenerationFailureWorthRetrying('reference-image')).toBe(true);
    expect(isGenerationFailureWorthRetrying('rate-limit')).toBe(true);
    expect(isGenerationFailureWorthRetrying('service')).toBe(true);
    expect(isGenerationFailureWorthRetrying('unknown')).toBe(true);
  });
});
