import { stylePresets } from '../../models/videoModels';
import type { VideoStylePreset } from '../../types/video';

interface StylePresetSelectorProps {
  value: VideoStylePreset;
  onChange: (value: VideoStylePreset) => void;
}

export default function StylePresetSelector({ value, onChange }: StylePresetSelectorProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {stylePresets.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onChange(preset)}
          className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
            value === preset
              ? 'border-blue-300 bg-blue-500/20 text-white'
              : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-blue-400'
          }`}
        >
          {preset}
        </button>
      ))}
    </div>
  );
}
