import { useEffect, useState } from 'react';
import { Button, Modal, Textarea } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';

const PROMPT_MAX_LENGTH = 8000;

export interface ExtendClipDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (prompt: string) => Promise<void> | void;
  pending?: boolean;
  error?: string;
  /**
   * What the clip being continued was asked to be, shown as a reminder of which one this is.
   * A string rather than the generation itself: the storyboard reaches this dialog too, and
   * a segment there is not a generation the page is holding.
   */
  sourcePrompt?: string;
  /** Said after the fact when the continuation lands somewhere other than this screen. */
  note?: string;
}

/**
 * Asks what happens next, and nothing else.
 *
 * Model, ratio, style and camera are inherited from the clip being continued — offering them
 * again would invite a change of look halfway through a take, which is exactly what makes a
 * continuation stop reading as the same shot. So the only question is the action.
 */
export function ExtendClipDialog({
  open,
  onClose,
  onConfirm,
  pending = false,
  error,
  sourcePrompt,
  note,
}: ExtendClipDialogProps) {
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState('');

  // A dialog reopened after one continuation should not still hold the last one's text.
  useEffect(() => {
    if (open) setPrompt('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('tools.extendTitle')}
      description={t('tools.extendBody')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <Textarea
          rows={3}
          value={prompt}
          placeholder={t('tools.extendPlaceholder')}
          disabled={pending}
          onChange={(event) => setPrompt(event.target.value.slice(0, PROMPT_MAX_LENGTH))}
        />

        {/* What it continues from, so nobody has to remember which clip they clicked. */}
        {sourcePrompt ? (
          <p className="line-clamp-2 text-xs text-text-subtle">{sourcePrompt}</p>
        ) : null}

        {note ? <p className="text-xs text-text-muted">{note}</p> : null}

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={pending}
            onClick={() => void onConfirm(prompt.trim())}
          >
            {t('tools.extendCta')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ExtendClipDialog;
