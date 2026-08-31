import type { GenerationFailureCause } from '@video-studio/shared';
import type { TranslationKey } from '@/i18n/translations';

export interface FailureCopy {
  /** One line that fits on a tile: the cause, named the way a person would name it. */
  short: TranslationKey;
  /** The full paragraph: what happened and whose side it happened on. */
  body: TranslationKey;
  /** The one thing worth doing about it. */
  action: TranslationKey;
}

/**
 * The words for each failure cause, in one place.
 *
 * The dialog and the segment tile say the same thing at different lengths — a strip 120px
 * wide cannot hold the paragraph, and the paragraph should not be reduced to "error". Keeping
 * both in one table is what stops the two from drifting apart as causes are added.
 */
export const FAILURE_COPY: Record<GenerationFailureCause, FailureCopy> = {
  'reference-image': {
    short: 'failure.shortReferenceImage',
    body: 'failure.referenceImage',
    action: 'failure.referenceImageAction',
  },
  blocked: {
    short: 'failure.shortBlocked',
    body: 'failure.blocked',
    action: 'failure.blockedAction',
  },
  'empty-result': {
    short: 'failure.shortEmptyResult',
    body: 'failure.emptyResult',
    action: 'failure.emptyResultAction',
  },
  'rate-limit': {
    short: 'failure.shortRateLimit',
    body: 'failure.rateLimit',
    action: 'failure.rateLimitAction',
  },
  service: {
    short: 'failure.shortService',
    body: 'failure.service',
    action: 'failure.serviceAction',
  },
  configuration: {
    short: 'failure.shortConfiguration',
    body: 'failure.configuration',
    action: 'failure.configurationAction',
  },
  unsupported: {
    short: 'failure.shortUnsupported',
    body: 'failure.unsupported',
    action: 'failure.unsupportedAction',
  },
  unknown: {
    short: 'failure.shortUnknown',
    body: 'failure.unknown',
    action: 'failure.unknownAction',
  },
};
