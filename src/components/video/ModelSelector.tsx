import { Sparkles } from 'lucide-react';
import { videoModels } from '../../models/videoModels';

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ModelSelector({ value, onChange }: ModelSelectorProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {videoModels.map((model) => {
        const active = value === model.id;
        const disabled = model.status !== 'active';
        return (
          <button
            key={model.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(model.id)}
            className={[
              'min-h-20 rounded-lg border p-3 text-left transition',
              active ? 'border-violet-400 bg-violet-500/15 text-white' : 'border-white/10 bg-white/[0.04] text-slate-200',
              disabled ? 'cursor-not-allowed opacity-45' : 'hover:border-blue-400/70 hover:bg-blue-500/10',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-extrabold">{model.name}</span>
              <Sparkles className="h-4 w-4 text-violet-300" />
            </div>
            <p className="mt-2 text-xs text-slate-400">{disabled ? 'Coming soon' : 'Active model'}</p>
          </button>
        );
      })}
    </div>
  );
}
