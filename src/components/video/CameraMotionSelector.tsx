import { cameraMotions } from '../../models/videoModels';
import type { CameraMotion } from '../../types/video';

interface CameraMotionSelectorProps {
  value: CameraMotion;
  onChange: (value: CameraMotion) => void;
}

export default function CameraMotionSelector({ value, onChange }: CameraMotionSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cameraMotions.map((motion) => (
        <button
          key={motion}
          type="button"
          onClick={() => onChange(motion)}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
            value === motion
              ? 'border-violet-300 bg-violet-500/20 text-white'
              : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-violet-400'
          }`}
        >
          {motion}
        </button>
      ))}
    </div>
  );
}
