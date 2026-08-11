import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ intervalMs: 60, maxAttempts: 5 }));

vi.mock('../env.js', () => ({
  getEnv: () => ({
    veoSubmitIntervalMs: state.intervalMs,
    veoSubmitMaxAttempts: state.maxAttempts,
  }),
  resetEnvCache: () => undefined,
}));

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ApiError } from '../errors.js';
import { baseModelOf, isQuotaRefusal, resetSubmissionSlots, submitToVertex } from './veoQueue.js';

/** What Vertex actually answers when the per-minute quota is spent. */
function quotaRefusal(): ApiError {
  return new ApiError(
    'unavailable',
    '429 Quota exceeded for aiplatform.googleapis.com/long_running_online_prediction_requests_per_base_model with base model: veo-3.1-generate-001.',
  );
}

beforeEach(() => {
  resetSubmissionSlots();
  state.intervalMs = 60;
  state.maxAttempts = 5;
});

describe('baseModelOf', () => {
  // The quota is counted against the Vertex id, not the id the studio shows.
  it('maps a registry id to the Vertex base model the quota belongs to', () => {
    expect(baseModelOf('veo-3.1')).toBe('veo-3.1-generate-001');
    expect(baseModelOf('veo-3.1-fast')).toBe('veo-3.1-fast-generate-001');
  });

  it('passes an unknown id through rather than inventing one', () => {
    expect(baseModelOf('veo-9.9')).toBe('veo-9.9');
  });
});

describe('isQuotaRefusal', () => {
  it('recognises the refusal Vertex actually sends', () => {
    expect(isQuotaRefusal(quotaRefusal())).toBe(true);
  });

  it('leaves other failures alone', () => {
    expect(isQuotaRefusal(new ApiError('unavailable', 'The service is briefly unreachable.'))).toBe(
      false,
    );
    expect(isQuotaRefusal(new ApiError('invalid-argument', 'quota'))).toBe(false);
    expect(isQuotaRefusal(new Error('quota'))).toBe(false);
  });
});

describe('submitToVertex', () => {
  it('lets the first submission through with no wait', async () => {
    const started = Date.now();
    await expect(submitToVertex({ modelId: 'veo-3.1', submit: async () => 'ok' })).resolves.toBe(
      'ok',
    );
    expect(Date.now() - started).toBeLessThan(state.intervalMs);
  });

  // The whole point: two clips asked for in the same minute must both survive.
  it('spaces a second submission for the same model instead of losing it', async () => {
    const at: number[] = [];
    const submit = async () => {
      at.push(Date.now());
      return 'ok';
    };

    await Promise.all([
      submitToVertex({ modelId: 'veo-3.1', submit }),
      submitToVertex({ modelId: 'veo-3.1', submit }),
    ]);

    expect(at).toHaveLength(2);
    expect((at[1] ?? 0) - (at[0] ?? 0)).toBeGreaterThanOrEqual(state.intervalMs - 5);
  });

  // The quota is per base model, so spreading a campaign across models is free speed.
  it('does not make one model wait behind another', async () => {
    const started = Date.now();
    await Promise.all([
      submitToVertex({ modelId: 'veo-3.1', submit: async () => 'a' }),
      submitToVertex({ modelId: 'veo-3.1-fast', submit: async () => 'b' }),
      submitToVertex({ modelId: 'veo-3.1-lite', submit: async () => 'c' }),
    ]);
    expect(Date.now() - started).toBeLessThan(state.intervalMs);
  });

  it('keeps a burst in the order it was asked for', async () => {
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        submitToVertex({
          modelId: 'veo-3.1',
          submit: async () => {
            order.push(n);
            return n;
          },
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it('re-queues a refusal rather than failing the clip', async () => {
    let calls = 0;
    const result = await submitToVertex({
      modelId: 'veo-3.1',
      submit: async () => {
        calls += 1;
        if (calls < 3) throw quotaRefusal();
        return 'ok';
      },
    });

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('reports that a clip is waiting, with the attempt it is on', async () => {
    const attempts: number[] = [];
    let calls = 0;

    await submitToVertex({
      modelId: 'veo-3.1',
      onAttempt: (attempt) => {
        attempts.push(attempt);
      },
      submit: async () => {
        calls += 1;
        if (calls < 2) throw quotaRefusal();
        return 'ok';
      },
    });

    // Nothing to report on the first attempt: it goes out immediately.
    expect(attempts).toEqual([2]);
  });

  // Waiting a minute only to be told the same thing again helps nobody.
  it('returns a non-quota failure straight away, without retrying', async () => {
    let calls = 0;
    const failure = new ApiError('invalid-argument', 'veo-3.1 does not support image-to-video.');

    await expect(
      submitToVertex({
        modelId: 'veo-3.1',
        submit: async () => {
          calls += 1;
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(calls).toBe(1);
  });

  it('gives up after the attempt ceiling and surfaces the refusal', async () => {
    state.maxAttempts = 3;
    let calls = 0;

    await expect(
      submitToVertex({
        modelId: 'veo-3.1',
        submit: async () => {
          calls += 1;
          throw quotaRefusal();
        },
      }),
    ).rejects.toThrow(/Quota exceeded/);

    expect(calls).toBe(3);
  });

  // One clip failing must not strand the ones queued behind it.
  it('keeps serving the queue after a submission throws', async () => {
    const first = submitToVertex({
      modelId: 'veo-3.1',
      submit: async () => {
        throw new ApiError('invalid-argument', 'bad prompt');
      },
    });
    const second = submitToVertex({ modelId: 'veo-3.1', submit: async () => 'ok' });

    await expect(first).rejects.toThrow('bad prompt');
    await expect(second).resolves.toBe('ok');
  });
});
