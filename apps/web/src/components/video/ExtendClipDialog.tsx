import type { GenerationDto } from '@video-studio/shared';
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
  source: GenerationDto;
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
  source,
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
        <p className="line-clamp-2 text-xs text-text-subtle">{source.prompt}</p>

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
