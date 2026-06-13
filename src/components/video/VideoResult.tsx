import { Copy, Download, Heart, RefreshCw } from 'lucide-react';
import type { VideoGenerationRequest } from '../../types/video';

interface VideoResultProps {
  generation?: VideoGenerationRequest | null;
  onRegenerate: () => void;
  onCopyPrompt: () => void;
  onSave: () => void;
}

const aspectClass: Record<string, string> = {
  '9:16': 'aspect-[9/16] max-h-[600px]',
  '16:9': 'aspect-video',
  '1:1': 'aspect-square max-h-[480px]',
};

export default function VideoResult({ generation, onRegenerate, onCopyPrompt, onSave }: VideoResultProps) {
  if (!generation?.resultVideoUrl) return null;

  const ratioClass = aspectClass[generation.aspectRatio] ?? 'aspect-video';

  return (
    <section className="rounded-2xl border border-[#d7ff00]/20 bg-[#141719] p-4 shadow-2xl shadow-black/40">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d7ff00]/70">Результат</p>
          <h2 className="text-base font-black text-white">Сгенерированное видео</h2>
        </div>
        <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-300">Готово</span>
      </div>
      <video
        src={generation.resultVideoUrl}
        controls
        playsInline
        className={`${ratioClass} w-full rounded-xl bg-black object-contain`}
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={generation.resultVideoUrl}
          download
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm font-bold text-white hover:bg-white/[0.09]"
        >
          <Download className="h-4 w-4" />
          Скачать
        </a>
        <button type="button" onClick={onCopyPrompt} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm font-bold text-white hover:bg-white/[0.09]">
          <Copy className="h-4 w-4" />
          Копировать промпт
        </button>
        <button type="button" onClick={onRegenerate} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm font-bold text-white hover:bg-white/[0.09]">
          <RefreshCw className="h-4 w-4" />
          Повторить
        </button>
        <button
          type="button"
          onClick={onSave}
          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${generation.saved ? 'border-pink-400/30 bg-pink-400/15 text-pink-300' : 'border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.09]'}`}
        >
          <Heart className={`h-4 w-4 ${generation.saved ? 'fill-pink-400' : ''}`} />
          {generation.saved ? 'Сохранено' : 'Сохранить'}
        </button>
      </div>
    </section>
  );
}
