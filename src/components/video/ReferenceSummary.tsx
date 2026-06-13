import { ImageIcon, AlertCircle } from 'lucide-react';
import type { ResolvedReferences } from '../../types/video';
import { CATEGORY_LABELS } from '../../services/videoElementsService';

interface ReferenceSummaryProps {
  resolved: ResolvedReferences;
  modelName?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

const MODE_LABEL: Record<string, string> = {
  multi_reference: 'Multi Reference',
  single_reference: 'Single Reference',
  text_only: 'Text Only',
};

const MODE_COLOR: Record<string, string> = {
  multi_reference: 'text-emerald-400',
  single_reference: 'text-blue-400',
  text_only: 'text-slate-500',
};

export default function ReferenceSummary({
  resolved,
  modelName,
  fallbackUsed,
  fallbackReason,
}: ReferenceSummaryProps) {
  const { visualRefs, textRefs, enrichedPrompt, referenceImageUrls, mode } = resolved;
  const hasAny = visualRefs.length > 0 || textRefs.length > 0;

  if (!hasAny) return null;

  const effectiveMode = fallbackUsed ? 'single_reference' : mode;

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 space-y-2.5">

      {/* Header: provider + mode */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {modelName ? (
            <span className="text-[10px] font-bold text-slate-500">{modelName}</span>
          ) : null}
          <span className={`text-[10px] font-bold ${MODE_COLOR[effectiveMode] ?? 'text-slate-500'}`}>
            {fallbackUsed ? 'Fallback — ' : ''}{MODE_LABEL[effectiveMode] ?? effectiveMode}
          </span>
        </div>
        {referenceImageUrls.length > 0 ? (
          <span className="text-[10px] text-slate-600">{referenceImageUrls.length} image{referenceImageUrls.length > 1 ? 's' : ''}</span>
        ) : null}
      </div>

      {/* Fallback warning */}
      {fallbackUsed ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/8 px-2.5 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-amber-300">Использован fallback режим</p>
            {fallbackReason ? <p className="text-[10px] text-amber-500/80 mt-0.5">{fallbackReason}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Visual references */}
      {visualRefs.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-500">
            Visual References
          </p>
          <div className="flex flex-wrap gap-2">
            {visualRefs.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1.5"
              >
                {ref.imageUrl ? (
                  <div className="relative">
                    <img src={ref.imageUrl} alt="" className="h-6 w-6 rounded object-cover" />
                    {ref.imageIndex ? (
                      <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-black text-white">
                        {ref.imageIndex}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <ImageIcon className="h-4 w-4 text-emerald-400/60" />
                )}
                <div>
                  <span className="text-xs font-bold text-emerald-300">{ref.handle}</span>
                  <span className="ml-1.5 text-[10px] text-emerald-600">{CATEGORY_LABELS[ref.type]}</span>
                  {ref.imageIndex ? (
                    <span className="ml-1 text-[10px] text-emerald-700">@Image{ref.imageIndex}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Text context */}
      {textRefs.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
            Text Context
          </p>
          <div className="flex flex-wrap gap-2">
            {textRefs.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5"
              >
                <span className="text-xs font-bold text-slate-400">{ref.handle}</span>
                <span className="text-[10px] text-slate-600">{CATEGORY_LABELS[ref.type]}</span>
                {ref.description ? (
                  <span className="max-w-[100px] truncate text-[10px] italic text-slate-700">
                    «{ref.description.slice(0, 28)}{ref.description.length > 28 ? '…' : ''}»
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-700">нет описания</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Enriched prompt preview */}
      {enrichedPrompt ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-700">
            Промпт для AI
          </p>
          <p className="line-clamp-2 text-[11px] leading-5 text-slate-600">{enrichedPrompt}</p>
        </div>
      ) : null}
    </div>
  );
}
