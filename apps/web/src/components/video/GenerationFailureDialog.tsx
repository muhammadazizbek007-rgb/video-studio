import { classifyGenerationFailure, isGenerationFailureWorthRetrying } from '@video-studio/shared';
import { Modal, Surface } from '@/components/ui';
import { FAILURE_COPY } from '@/i18n/failureCopy';
import { useLanguage } from '@/i18n/LanguageContext';

export interface GenerationFailureDialogProps {
  open: boolean;
  onClose: () => void;
  errorMessage?: string;
}

/**
 * What went wrong, said twice.
 *
 * The card can only afford two clipped lines of a message written for a log reader, which is
 * how "Downloading the reference image failed." ends up looking like a fault in the app. Here
 * the failure is named in the user's own language and followed by the one thing they can do
 * about it — and then the server's own words are shown underneath rather than replaced, so
 * anything the classifier did not recognise is still readable and still reportable.
 */
export function GenerationFailureDialog({
  open,
  onClose,
  errorMessage,
}: GenerationFailureDialogProps) {
  const { t } = useLanguage();

  const cause = classifyGenerationFailure(errorMessage);
  const copy = FAILURE_COPY[cause];
  const trimmed = errorMessage?.trim() ?? '';

  return (
    <Modal open={open} onClose={onClose} title={t('failure.title')} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-6">{t(copy.body)}</p>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
            {t('failure.whatToDo')}
          </p>
          <p className="text-sm leading-6">{t(copy.action)}</p>
          <p className="text-sm leading-6 opacity-70">
            {isGenerationFailureWorthRetrying(cause)
              ? t('failure.retryHint')
              : t('failure.noRetryHint')}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
            {t('failure.detail')}
          </p>
          {trimmed ? (
            <Surface elevation="inset-sm" radius="md" className="p-3">
              {/* The message can be a Vertex error body with no spaces to break on, so it
                  wraps anywhere rather than pushing the dialog wider than the screen. */}
              <code className="block whitespace-pre-wrap break-words text-xs leading-5">
                {trimmed}
              </code>
            </Surface>
          ) : (
            <p className="text-sm leading-6 opacity-70">{t('failure.noMessage')}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default GenerationFailureDialog;
