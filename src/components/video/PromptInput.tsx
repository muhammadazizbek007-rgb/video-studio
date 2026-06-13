interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function PromptInput({ value, onChange }: PromptInputProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-200">Prompt</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Describe the PingTop ad, scene, audience, pacing, UI moments, and final CTA..."
        className="min-h-40 w-full resize-y rounded-lg border border-white/10 bg-[#0b1020] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15"
      />
    </label>
  );
}
