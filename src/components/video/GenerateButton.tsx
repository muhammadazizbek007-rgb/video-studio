import { Clapperboard, Loader2 } from 'lucide-react';

interface GenerateButtonProps {
  disabled: boolean;
  loading: boolean;
}

export default function GenerateButton({ disabled, loading }: GenerateButtonProps) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-violet-950/30 transition hover:from-blue-400 hover:to-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
      {loading ? 'Generating...' : 'Generate Video'}
    </button>
  );
}
