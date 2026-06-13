import { AlertCircle, CheckCircle2, Clock3, Loader2 } from 'lucide-react';
import type { VideoGenerationStatus } from '../../types/video';

interface GenerationStatusProps {
  status?: VideoGenerationStatus;
  error?: string;
  modelName?: string;
}

function getStatusCopy(modelName: string): Record<VideoGenerationStatus, { label: string; hint: string }> {
  return {
    pending: { label: 'Ожидание', hint: 'Запрос поставлен в очередь...' },
    processing: { label: 'Генерация', hint: `${modelName} создаёт ваше видео. Это может занять до 2 минут.` },
    completed: { label: 'Готово', hint: `${modelName} успешно сгенерировал видео.` },
    failed: { label: 'Ошибка', hint: 'Не удалось сгенерировать видео.' },
  };
}

export default function GenerationStatus({ status, error, modelName = 'AI' }: GenerationStatusProps) {
  const current = status ?? 'pending';
  const Icon = current === 'completed' ? CheckCircle2 : current === 'failed' ? AlertCircle : current === 'processing' ? Loader2 : Clock3;
  const { label, hint } = getStatusCopy(modelName)[current];

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 shrink-0 ${current === 'processing' ? 'animate-spin text-blue-300' : current === 'failed' ? 'text-rose-300' : current === 'completed' ? 'text-emerald-300' : 'text-violet-300'}`} />
        <div>
          <p className="text-sm font-extrabold text-white">{label}</p>
          <p className="mt-1 text-xs text-slate-400">{error || hint}</p>
        </div>
      </div>
    </div>
  );
}
