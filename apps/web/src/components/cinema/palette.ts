/**
 * Segment colours for the progress bar, cycled by index. Fifty entries is enough that a
 * storyboard never repeats a colour in practice, and the order is deliberate: adjacent
 * entries are far apart in hue so neighbouring segments never read as the same clip.
 *
 * These are the one place the tab is allowed to be colourful — the design note permits it
 * for content, and telling segments apart *is* the bar's job.
 */
export const SEGMENT_PALETTE: readonly string[] = [
  '#a855f7',
  '#22c55e',
  '#f97316',
  '#3b82f6',
  '#ec4899',
  '#06b6d4',
  '#eab308',
  '#ef4444',
  '#10b981',
  '#8b5cf6',
  '#f43f5e',
  '#14b8a6',
  '#f59e0b',
  '#6366f1',
  '#84cc16',
  '#0ea5e9',
  '#d946ef',
  '#fb923c',
  '#34d399',
  '#818cf8',
  '#fb7185',
  '#2dd4bf',
  '#fbbf24',
  '#60a5fa',
  '#a3e635',
  '#38bdf8',
  '#e879f9',
  '#fdba74',
  '#6ee7b7',
  '#a5b4fc',
  '#fda4af',
  '#5eead4',
  '#fcd34d',
  '#93c5fd',
  '#bef264',
  '#7dd3fc',
  '#f0abfc',
  '#fed7aa',
  '#a7f3d0',
  '#c7d2fe',
  '#fecdd3',
  '#99f6e4',
  '#fde68a',
  '#bfdbfe',
  '#d9f99d',
  '#bae6fd',
  '#f5d0fe',
  '#ffedd5',
  '#d1fae5',
  '#e0e7ff',
];

export function segmentColor(index: number): string {
  return SEGMENT_PALETTE[index % SEGMENT_PALETTE.length] ?? SEGMENT_PALETTE[0] ?? '#a855f7';
}

/** The unfilled part of a pill: the same hue at ~33% so the track still identifies the segment. */
export function segmentTrackColor(index: number): string {
  return `${segmentColor(index)}55`;
}
