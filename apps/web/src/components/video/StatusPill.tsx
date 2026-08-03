import type { VideoGenerationStatus } from '@video-studio/shared';
import type { BadgeTone } from '@/components/ui';
import { Badge } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';

const TONE_BY_STATUS: Record<VideoGenerationStatus, BadgeTone> = {
  pending: 'neutral',
  processing: 'accent',
  completed: 'success',
  failed: 'danger',
};

interface StatusPillProps {
  status: VideoGenerationStatus;
}

export function StatusPill({ status }: StatusPillProps) {
  const { t } = useLanguage();

  return (
    <Badge tone={TONE_BY_STATUS[status]} dot>
      {t(`status.${status}`)}
    </Badge>
  );
}

export default StatusPill;
