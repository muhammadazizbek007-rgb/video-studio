import { durations } from '../../models/videoModels';
import type { VideoDuration } from '../../types/video';

interface DurationSelectorProps {
  value: VideoDuration;
  onChange: (value: VideoDuration) => void;
}

export default function DurationSelector({ value, onChange }: DurationSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {durations.map((duration) => (
        <button
          key={duration}
          type="button"
          onClick={() => onChange(duration)}
          className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${
            value === duration
              ? 'border-violet-300 bg-violet-500/20 text-white'
              : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-violet-400'
          }`}
        >
          {duration} sec
        </button>
      ))}
    </div>
  );
}
