import { aspectRatios } from '../../models/videoModels';
import type { VideoAspectRatio } from '../../types/video';

interface AspectRatioSelectorProps {
  value: VideoAspectRatio;
  onChange: (value: VideoAspectRatio) => void;
}

export default function AspectRatioSelector({ value, onChange }: AspectRatioSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {aspectRatios.map((ratio) => (
        <button
          key={ratio}
          type="button"
          onClick={() => onChange(ratio)}
          className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${
            value === ratio
              ? 'border-blue-300 bg-blue-500/20 text-white'
              : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-blue-400'
          }`}
        >
          {ratio}
        </button>
      ))}
    </div>
  );
}
