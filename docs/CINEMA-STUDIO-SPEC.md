# Cinema Studio — complete implementation spec

This document specifies the **Cinema Studio** tab in full: layout geometry, every
control, every interaction, state, and the backend contract. It is written to be
handed to an AI coding agent as a prompt so the tab can be rebuilt from zero in a
different project.

Everything below describes real, shipped behaviour. Where the current
implementation has a defect or an unfinished edge, it is marked
**⚠️ KNOWN ISSUE** — decide deliberately whether to reproduce or fix it.

---

## 1. What Cinema Studio is

A storyboard-based video workspace. The user builds a multi-segment film by
generating each segment separately, then plays all completed segments back as one
continuous timeline and exports them as a single file.

It is one tab inside a larger video-generation app. It shares the app's model
registry and generation backend but has its own layout, its own settings, and its
own player.

The tab has **two distinct modes** that render completely different layouts:

| Mode | Layout | Purpose |
|---|---|---|
| `Image` | Hero / empty state | Marketing splash. Delegates generation to the main tab. |
| `Video` | Storyboard | The real workspace: player + segment cards + generation. |

The mode is chosen with a toggle in the bottom bar and **persists in
`sessionStorage` under the key `cinemaInputMode`**. Default on first visit:
`Image`.

---

## 2. Tech baseline

- React 18+ with hooks, TypeScript
- Tailwind CSS (all styling below is Tailwind utility classes)
- `lucide-react` for icons
- No component library, no animation library
- Video playback via the native `<video>` element
- Export via `<canvas>` + `MediaRecorder`

---

## 3. Complete state inventory

All state lives in the parent page component. Names are given exactly so the
spec can be followed literally.

### 3.1 Mode and settings

```ts
const [cinemaInputMode, setCinemaInputMode] = useState<'Image' | 'Video'>(
  () => (sessionStorage.getItem('cinemaInputMode') as 'Image' | 'Video') ?? 'Image'
);
const [cinemaPrompt, setCinemaPrompt]   = useState('');
const [cinemaAspect, setCinemaAspect]   = useState('16:9');   // '16:9' | '9:16' | '1:1'
const [cinemaQuality, setCinemaQuality] = useState('2K');     // '1K' | '2K' | '4K'
const [cinemaDuration, setCinemaDuration] = useState<VideoDuration>(8);
const [cinemaModelId, setCinemaModelId] = useState(defaultVideoModelId);
const [cinemaSamples, setCinemaSamples] = useState(1);        // number of segments
```

### 3.2 Dropdown open/closed flags

```ts
const [cinemaModelPickerOpen, setCinemaModelPickerOpen]       = useState(false);
const [cinemaAspectPickerOpen, setCinemaAspectPickerOpen]     = useState(false);
const [cinemaQualityPickerOpen, setCinemaQualityPickerOpen]   = useState(false);
const [cinemaDurationPickerOpen, setCinemaDurationPickerOpen] = useState(false);
```

### 3.3 Storyboard content

```ts
// Uploaded frame images, keyed "<segment>.<slot>" e.g. "1.1", "1.2", "2.1"
const [slotImages, setSlotImages] = useState<Record<string, string>>({});

// Finished video per segment, keyed by segment number as a string: "1", "2"
const [segmentVideos, setSegmentVideos] = useState<Record<string, string>>({});

// In-flight generation id per segment, used to look up live status
const [segmentGenerationIds, setSegmentGenerationIds] = useState<Record<string, string>>({});

// Measured playback duration per segment (seconds), filled from loadedmetadata
const [segmentDurations, setSegmentDurations] = useState<Record<string, number>>({});

// Which slot the hidden file input is currently filling
const [activeSlot, setActiveSlot] = useState<string | null>(null);
const [activeSegForVideo, setActiveSegForVideo] = useState('');
```

### 3.4 Player

```ts
const [playerSegIdx, setPlayerSegIdx]         = useState(0);   // index into completedSegs
const [playerPlaying, setPlayerPlaying]       = useState(false);
const [playerCurrentTime, setPlayerCurrentTime] = useState(0); // seconds within current segment
const [isFullscreen, setIsFullscreen]         = useState(false);
const [barHover, setBarHover] = useState<{ pct: number; time: number } | null>(null);
const [volumeState, setVolumeState] = useState<'max' | 'medium' | 'mute'>('max');
```

### 3.5 Export

```ts
const [isSaving, setIsSaving]         = useState(false);
const [saveProgress, setSaveProgress] = useState(0);  // 0..100
```

### 3.6 Refs

```ts
const slotFileInputRef   = useRef<HTMLInputElement | null>(null);  // hidden image input
const slotVideoInputRef  = useRef<HTMLInputElement | null>(null);  // hidden video input
const playerVideoRef     = useRef<HTMLVideoElement | null>(null);
const playerContainerRef = useRef<HTMLDivElement | null>(null);    // fullscreen target
const completedSegsRef   = useRef<string[]>([]);   // mirror for the onEnded handler
const pendingPlayRef     = useRef(false);          // autoplay next segment after remount
const pollIntervalsRef   = useRef<Record<string, ReturnType<typeof setInterval>>>({});
```

`completedSegsRef` exists because `onEnded` closes over a stale `completedSegs`
array; the ref is written on every render and read inside the handler.

---

## 4. Layout geometry

The tab is one positioned section. **All major blocks are absolutely positioned
against it**, which is what makes the layout stable while the player resizes.

```
<section class="relative overflow-hidden rounded-[24px] bg-[#0b0d0f] lg:min-h-[720px]">
```

### Video mode — three stacked layers, bottom-anchored

```
┌─ section (relative) ──────────────────────────────────────────┐
│                                                               │
│  ┌─ PLAYER ────────────────────────────────────────────────┐  │
│  │  absolute; left-4 right-4 top-4; bottom: 310px          │  │
│  │  ┌───────────────────────────────────────────────────┐  │  │
│  │  │  <video> flex-1  (or blank white area if empty)   │  │  │
│  │  ├───────────────────────────────────────────────────┤  │  │
│  │  │  controls bar  bg-[#111315]  px-4 pt-3 pb-3       │  │  │
│  │  │   • segmented progress bars (h-4)                 │  │  │
│  │  │   • time | ⏮ ▶ ⏭ | 🔊 ⛶ Сохранить                │  │  │
│  │  └───────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ CARD STRIP ────────────────────────────────────────────┐  │
│  │  absolute; left-4 right-4; bottom: 148px                │  │
│  │  bg-[#cecece] rounded-2xl p-3 flex gap-3                │  │
│  │  [seg1: 1.1 | 1.2]  [seg2: 2.1 | 2.2]  …                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  (error banner, if any: absolute bottom-[148px] left-4 right-4)│
│                                                               │
│  ┌─ BOTTOM BAR ────────────────────────────────────────────┐  │
│  │  absolute; bottom-0 left-0 right-0; px-4 pb-6 sm:px-8   │  │
│  │  inner: mx-auto max-w-3xl                               │  │
│  │  [Image/Video toggle] [prompt + chips] [GENERATE]       │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

**The three magic numbers — reproduce them exactly:**

| Value | Where | Meaning |
|---|---|---|
| `bottom: 310` | player container | leaves room for card strip + bottom bar |
| `bottom: 148` | card strip and error banner | sits directly above the bottom bar |
| `minHeight: 120` | each card | keeps cards square-ish at any width |

The parent page must also **hide the app's left sidebar** while this tab is
active, and drop the `lg:flex-row` on the page wrapper, so Cinema Studio spans
the full width.

---

## 5. Video mode — the player

Rendered inside an IIFE so derived values are computed once per render.

### 5.1 Derived values

```ts
const completedSegs = Object.keys(segmentVideos)
  .filter((s) => segmentVideos[s])
  .sort((a, b) => Number(a) - Number(b));
completedSegsRef.current = completedSegs;

const totalDur      = completedSegs.reduce((sum, s) => sum + (segmentDurations[s] ?? 0), 0);
const elapsedBefore = completedSegs.slice(0, playerSegIdx)
                        .reduce((sum, s) => sum + (segmentDurations[s] ?? 0), 0);
const totalElapsed  = elapsedBefore + playerCurrentTime;
const curSeg        = completedSegs[playerSegIdx] ?? completedSegs[0];
const hasVideo      = completedSegs.length > 0;
```

Time is formatted as whole seconds with an `s` suffix: `` `${Math.floor(s)}s` ``.

### 5.2 The video element

- `key={curSeg}` — **forces a remount when the segment changes.** This is what
  makes `src` swapping reliable; keep it.
- `src={segmentVideos[curSeg]}`, `className="min-h-0 flex-1 w-full object-contain"`
- Container background is `#000` when a video exists, `#fff` when empty.

Handlers:

| Event | Behaviour |
|---|---|
| `onTimeUpdate` | `setPlayerCurrentTime(video.currentTime)` |
| `onLoadedMetadata` | store `video.duration` into `segmentDurations[curSeg]` |
| `onEnded` | if not the last segment: set `pendingPlayRef.current = true`, advance `playerSegIdx`, reset time to 0. Otherwise `setPlayerPlaying(false)`. |
| `onCanPlay` | if `pendingPlayRef.current`, clear it and `play()` — this is the autoplay-through-segments mechanism |
| `onPlay` / `onPause` | mirror into `playerPlaying` |

When `completedSegs` is empty, render `<div className="min-h-0 flex-1" />`
instead of a `<video>` — a white empty stage.

### 5.3 Segmented progress bar

A row of pills, one per completed segment, `flex h-4 gap-1.5 cursor-pointer`.

**Colour palette — 50 entries, cycled by `PALETTE[i % PALETTE.length]`:**

```
#a855f7 #22c55e #f97316 #3b82f6 #ec4899 #06b6d4 #eab308 #ef4444 #10b981 #8b5cf6
#f43f5e #14b8a6 #f59e0b #6366f1 #84cc16 #0ea5e9 #d946ef #fb923c #34d399 #818cf8
#fb7185 #2dd4bf #fbbf24 #60a5fa #a3e635 #38bdf8 #e879f9 #fdba74 #6ee7b7 #a5b4fc
#fda4af #5eead4 #fcd34d #93c5fd #bef264 #7dd3fc #f0abfc #fed7aa #a7f3d0 #c7d2fe
#fecdd3 #99f6e4 #fde68a #bfdbfe #d9f99d #bae6fd #f5d0fe #ffedd5 #d1fae5 #e0e7ff
```

Per pill:
- width = `(segmentDuration / totalDur) * 100%`, or equal split if `totalDur === 0`
- `minWidth: 8`, `rounded-full`, `overflow-hidden`, `flex-shrink-0`
- track colour = `color + '55'` (hex alpha ≈ 33%)
- fill = solid `color`, width is 100% for past segments, `(playerCurrentTime / dur) * 100`
  for the current one, 0 for future ones
- fill transition: `width 0.25s linear`

When there are no segments, render a single full-width track at `#ffffff22`.

**Hover:** `onMouseMove` computes `pct` and `time` from the bar's bounding rect
and stores them in `barHover`; `onMouseLeave` clears it. While set, render a
vertical white line (`w-0.5`, `bg-white/90`) at `left: pct%` plus a tooltip above
it showing `${Math.floor(time)}s` on `bg-black/90`.

**Click to seek:**
1. Compute `ratio` from the click X within the bar.
2. If `totalDur > 0`: walk the segments accumulating duration; when
   `target <= elapsed + d` (or on the last segment), jump to that segment index
   with offset `target - elapsed`.
3. If durations are unknown, fall back to seeking by segment index:
   `Math.floor(ratio * completedSegs.length)`.

Seeking is done by `goTo(idx, t)`, which sets `playerSegIdx`, `playerCurrentTime`
and assigns `playerVideoRef.current.currentTime = t`.

### 5.4 Control row

Layout: `flex items-center` — elapsed time (fixed `w-16`), centred transport
group (`flex-1 justify-center gap-5`), then the right-hand buttons.

| Control | Size / style | Behaviour |
|---|---|---|
| Elapsed time | `w-16 text-xs text-slate-500` | `fmt(totalElapsed)` |
| ⏮ Back | `h-8 w-8` round, inline SVG | if `playerCurrentTime > 2` restart current segment, else go to previous |
| ▶/⏸ Play | `h-10 w-10` round, `bg-white text-black`, `hover:scale-105` | toggles playback; play icon is nudged `translate-x-0.5` |
| ⏭ Forward | `h-8 w-8` round | next segment, disabled on the last |
| 🔊 Volume | `h-8 w-8` `rounded-xl bg-white/[0.07]` | cycles `max → medium → mute → max` |
| ⛶ Fullscreen | `h-8 w-8` `rounded-xl bg-white/[0.07]` | toggles fullscreen on `playerContainerRef` |
| Сохранить | pill, `bg-[#d7ff00]/10 text-[#d7ff00]` | exports; shows spinner + `${saveProgress}%` while saving |

All disabled when `hasVideo === false` (`disabled:opacity-30`).

**Volume colours and icons:** `max` → `Volume2`, `#a3e635`; `medium` → `Volume1`,
`#fbbf24`; `mute` → `VolumeX`, `#ef4444`. Titles: `Громко` / `Средний` / `Без звука`.

Applied by an effect:

```ts
useEffect(() => {
  const v = playerVideoRef.current;
  if (!v) return;
  if (volumeState === 'max')         { v.muted = false; v.volume = 1; }
  else if (volumeState === 'medium') { v.muted = false; v.volume = 0.5; }
  else                               { v.muted = true;  v.volume = 0; }
}, [volumeState]);
```

**Fullscreen** must also listen for external exit (Esc):

```ts
useEffect(() => {
  const handler = () => setIsFullscreen(!!document.fullscreenElement);
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}, []);
```

---

## 6. Video mode — the card strip

One group per segment, `cinemaSamples` groups total. Segment `i` (1-based) owns
slot labels `"i.1"` and `"i.2"`.

Each group renders in **one of four states**, checked in this order:

### State A — finished video

Condition: `segmentVideos[segNum]` is set.

Full-bleed `<video autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover">`
inside a `rounded-2xl bg-[#4a4b4d]` card.

### State B — generating

Condition: the linked generation has status `pending` or `processing`.

Centred `Loader2` spinner (`h-7 w-7 animate-spin text-white/60`) above the label
`генерация...` (`text-[10px] font-bold text-white/50`).

### State C — failed

Condition: the linked generation has status `failed`.

`⚠️` glyph, the word `ошибка` in `text-red-400`, and a small `повтор` button that
clears `segmentGenerationIds[segNum]`, returning the card to State D.

### State D — empty, two upload slots

Two side-by-side buttons (`flex flex-1 gap-1.5`), one per slot label.

- Empty slot shows: the label (`1.1`), an `Images` icon (`h-7 w-7 text-white/50`),
  and a `+` sign.
- Filled slot shows the image as `object-cover` background, a `bg-black/30`
  scrim, the label, and a `изменить` pill at the bottom.

**Interactions on a slot button:**

| Gesture | Action |
|---|---|
| Click | open the hidden **image** input for that exact slot |
| **Ctrl+Click** | open the hidden **video** input for the whole segment — lets the user drop in a pre-made clip instead of generating |

`title="Клик — фото | Ctrl+Клик — загрузить видео"`

**Trash buttons** appear on hover (`opacity-0 group-hover:opacity-100`), top-right,
`h-7 w-7 rounded-full bg-black/60`, red on hover:
- On states A/B/C: clears both `segmentVideos[segNum]` and `segmentGenerationIds[segNum]`
- On a filled slot: clears just that `slotImages[label]`; the handler must call
  `e.stopPropagation()` or it will also trigger the file picker

**Slot semantics:** `X.1` is the **first frame**, `X.2` is the **last frame**.

### Hidden inputs

Two `<input type="file" className="sr-only">` elements, one `accept="image/*"`
bound to `slotFileInputRef`, one `accept="video/*"` bound to `slotVideoInputRef`.

```ts
function openSlotPicker(label: string) { setActiveSlot(label); slotFileInputRef.current?.click(); }
function handleSlotImageChange(e) {
  const file = e.target.files?.[0];
  if (!file || !activeSlot) return;
  setSlotImages((prev) => ({ ...prev, [activeSlot]: URL.createObjectURL(file) }));
  e.target.value = '';                     // allows re-picking the same file
}
```

The video variant is identical but writes into `segmentVideos[activeSegForVideo]`.

⚠️ **KNOWN ISSUE:** `URL.createObjectURL` results are never revoked — a long
session leaks blob URLs.

---

## 7. Image mode — hero layout

No player, no cards. Only an empty-state splash, plus the same bottom bar.

- Ambient glow: `absolute left-1/2 top-1/3 h-[500px] w-[500px]` centred by
  `-translate-x-1/2 -translate-y-1/2`, `rounded-full bg-[#d7ff00]/[0.04] blur-[120px]`,
  inside a `pointer-events-none` overlay
- Three stacked, rotated preview cards in a `relative h-48 w-72 sm:h-52 sm:w-80` box:
  - back: `-rotate-6 scale-90`, image at `opacity-60`
  - middle: `rotate-3 scale-95`, image at `opacity-75`
  - front: no transform, full opacity, `border-white/15`
- Headline, `max-w-2xl text-4xl font-black uppercase leading-[0.92] tracking-tight sm:text-5xl lg:text-6xl`:

  > Create your first project. **Generate the impossible.**

  with the second sentence in `text-[#d7ff00]`.

Content padding: `px-6 pb-52 pt-16 lg:pt-24` — the large `pb-52` keeps the hero
clear of the bottom bar.

---

## 8. The bottom bar (both modes)

Container: `absolute bottom-0 left-0 right-0 px-4 pb-6 sm:px-8`, inner
`mx-auto max-w-3xl`, then the bar itself:

```
flex items-stretch gap-3 rounded-2xl border border-white/10
bg-[#141618] p-2 shadow-2xl shadow-black/60 backdrop-blur-xl
```

Three columns: mode toggle · prompt+chips · generate button.

### 8.1 Mode toggle (left)

Two stacked buttons, each `h-10 w-14 rounded-xl`, icon over label, `text-[10px]`:
`Image` uses `ImageIcon`, `Video` uses `FileVideo`. Active gets
`bg-white/10 text-white`; inactive `text-slate-500`.

Clicking writes to state **and** `sessionStorage.setItem('cinemaInputMode', mode)`.

### 8.2 Prompt + settings chips (centre)

Borderless text input, `bg-transparent text-sm text-white`, placeholder
`Describe what you want to create...`.

Below it, a `flex flex-wrap items-center gap-2` row of chips. Every chip shares:

```
flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1
text-xs font-bold text-slate-300 hover:bg-white/10
```

each ending in a `ChevronDown` at `h-3 w-3 opacity-60`.

| Chip | Label | Options |
|---|---|---|
| Model | `🎬` + model name | every model from the shared registry |
| Aspect | `16:9` | `16:9`, `9:16`, `1:1` |
| Quality | `2K` | `1K`, `2K`, `4K` |
| Duration | `8s` | durations supported by the selected model |
| Samples | `− 1 +` | integer ≥ 1, no dropdown |

**Dropdown pattern — identical for all four:**

- Rendered only when the flag is true, as two siblings:
  1. a full-screen backdrop `fixed inset-0 z-40` whose `onClick` closes it
  2. the panel `absolute bottom-full left-0 z-50 mb-2 rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/60`
- Panel widths: model `w-64`, aspect `w-36`, quality `w-32`, duration `w-32`
- Each panel has a header strip with an uppercase caption in
  `text-[10px] font-bold uppercase tracking-widest text-slate-500`:
  `Выберите модель` / `Соотношение` / `Качество` / `Длительность`
- Rows: `flex w-full items-center justify-between px-3 py-2.5 text-sm font-bold`,
  selected row gets `bg-white/[0.08] text-white` plus a `h-2 w-2 rounded-full bg-[#d7ff00]` dot
- The model panel is richer: name + a `live` badge for active models
  (`bg-[#d7ff00]/20 text-[#d7ff00] text-[9px] font-black uppercase`), a secondary
  line `${provider} · до ${maxDuration}с`, and `max-h-72 overflow-y-auto`
- **Aspect, quality and duration close each other on open**; the model chip does
  not participate in that mutual exclusion.

**Duration must react to the model.** Keep a derived list and clamp on change:

```ts
const cinemaDurationOptions = useMemo(() => getDurationsForModel(cinemaModelId), [cinemaModelId]);
useEffect(() => {
  setCinemaDuration((prev) => clampDurationToModel(cinemaModelId, prev));
}, [cinemaModelId]);
```

### 8.3 Generate button (right)

```
flex min-w-[100px] flex-col items-center justify-center gap-1 rounded-xl
bg-[#d7ff00] px-4 py-3 text-xs font-black uppercase text-black
hover:bg-[#e2ff4d] disabled:cursor-not-allowed disabled:opacity-40
```

Content: `GENERATE` in `text-sm tracking-widest`, with a smaller
`→ 0.125` line at `opacity-60` beneath it. While generating in Video mode it
shows a `Loader2` spinner instead.

Disabled when the prompt is empty or a generation is in flight.

⚠️ **KNOWN ISSUE:** `→ 0.125` is a hardcoded leftover with no meaning in the
current build. Either bind it to something real or remove it.

**Click behaviour depends on mode:**

```ts
if (cinemaInputMode === 'Video') {
  void runCinemaVideoGeneration();
} else {
  setPrompt(cinemaPrompt);
  setMainTab('Создать видео');
  setTimeout(() => { void runGeneration(); }, 100);   // ⚠️ see below
}
```

⚠️ **KNOWN ISSUE:** the Image path hops to another tab and fires generation after
an arbitrary 100 ms, relying on React having flushed `setPrompt` by then. It is a
race. Prefer passing the prompt explicitly into the generation call.

---

## 9. Generation flow (Video mode)

```ts
async function runCinemaVideoGeneration() {
  if (!cinemaPrompt.trim()) return;

  // 1. Ensure a signed-in user, falling back to anonymous sign-in
  let activeUser = user;
  if (!activeUser) {
    try { activeUser = (await signInAnonymously(auth)).user; }
    catch { setError('Не удалось войти. Обновите страницу.'); return; }
  }

  setLoading(true); setError(''); setNotice(''); setCurrentGeneration(null);

  // 2. Pick the target segment: the first one that has at least one image,
  //    no finished video, and no generation already running. Fallback '1'.
  const targetSeg = Array.from({ length: cinemaSamples }, (_, i) => String(i + 1))
    .find((seg) =>
      (slotImages[`${seg}.1`] || slotImages[`${seg}.2`]) &&
      !segmentVideos[seg] &&
      !segmentGenerationIds[seg]
    ) ?? '1';

  // 3. Blob URLs cannot leave the browser — convert to data URLs
  const firstFrameUrl = slotImages[`${targetSeg}.1`] ? await blobUrlToDataUrl(slotImages[`${targetSeg}.1`]) : undefined;
  const lastFrameUrl  = slotImages[`${targetSeg}.2`] ? await blobUrlToDataUrl(slotImages[`${targetSeg}.2`]) : undefined;

  const mode = firstFrameUrl ? 'image_to_video' : 'text_to_video';

  // 4. Submit
  const generation = await generateVideo(activeUser.uid, {
    prompt: cinemaPrompt.trim(),
    modelId: cinemaModelId,
    mode,
    aspectRatio: cinemaAspect,
    duration: cinemaDuration,
    stylePreset: 'Cinematic',      // hardcoded
    cameraMotion: 'Static',        // hardcoded — ⚠️ see below
    referenceImageUrl: firstFrameUrl,
    lastFrameImageUrl: lastFrameUrl,
  });

  // 5. Remember the mapping and start polling
  setCurrentGeneration(generation);
  setSegmentGenerationIds((prev) => ({ ...prev, [targetSeg]: generation.id }));
  startSegmentPolling(targetSeg, generation.id);

  setLoading(false);   // in a finally block
}
```

`blobUrlToDataUrl` is a local helper: `fetch(url)` → `blob()` → `FileReader.readAsDataURL`.

⚠️ **KNOWN ISSUES here:**
- `stylePreset` and `cameraMotion` are hardcoded. Cinema Studio has no UI for
  either, so the tab silently ignores the app's camera-motion feature.
- `cinemaQuality` (1K/2K/4K) is **never sent anywhere**. The chip is decorative.
- Only one segment generates per click; the user must press GENERATE once per
  segment.

### 9.1 Polling and completion

```ts
function startSegmentPolling(segNum: string, generationId: string) {
  if (pollIntervalsRef.current[segNum]) clearInterval(pollIntervalsRef.current[segNum]);
  pollIntervalsRef.current[segNum] = setInterval(() => {
    void callBackend('checkVideoGeneration', { generationId });
  }, 6000);
}
```

The poll only *nudges* the backend. The UI updates from a live subscription to
the generation documents. A separate effect reconciles them:

```ts
useEffect(() => {
  for (const [seg, genId] of Object.entries(segmentGenerationIds)) {
    const gen = generations.find((g) => g.id === genId);
    if (gen?.status === 'completed' && gen.resultVideoUrl && !segmentVideos[seg]) {
      setSegmentVideos((prev) => ({ ...prev, [seg]: gen.resultVideoUrl! }));
      clearInterval(pollIntervalsRef.current[seg]);
      delete pollIntervalsRef.current[seg];
    }
    if (gen?.status === 'failed' && pollIntervalsRef.current[seg]) {
      clearInterval(pollIntervalsRef.current[seg]);
      delete pollIntervalsRef.current[seg];
    }
  }
}, [generations, segmentGenerationIds, segmentVideos]);
```

⚠️ **KNOWN ISSUE:** intervals are never cleared on unmount. Add a cleanup effect
that clears every interval in `pollIntervalsRef`.

---

## 10. Export — stitching segments into one file

Triggered by the `Сохранить` button. Concatenates all completed segments by
replaying them into a canvas and recording the canvas.

```ts
async function handleSaveVideo() {
  const segs = completedSegs.filter((s) => segmentVideos[s]);
  if (segs.length === 0 || isSaving) return;

  setIsSaving(true); setSaveProgress(0);

  const videoEl = document.createElement('video');
  videoEl.muted = true; videoEl.playsInline = true;

  // Size the canvas from the first segment
  await new Promise<void>((resolve, reject) => {
    videoEl.src = segmentVideos[segs[0]];
    videoEl.onloadedmetadata = () => resolve();
    videoEl.onerror = () => reject(new Error('Failed to load video'));
  });

  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9' : 'video/webm';

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start(100);

  // Play each segment in order, drawing every frame into the canvas
  for (let i = 0; i < segs.length; i++) {
    await new Promise<void>((resolve, reject) => {
      videoEl.src = segmentVideos[segs[i]];
      videoEl.currentTime = 0;
      let rafId: number;
      const draw = () => {
        if (!videoEl.ended && !videoEl.paused) {
          ctx.drawImage(videoEl, 0, 0, w, h);
          rafId = requestAnimationFrame(draw);
        }
      };
      videoEl.oncanplay = () => { videoEl.play().then(() => { rafId = requestAnimationFrame(draw); }).catch(reject); };
      videoEl.onended = () => {
        cancelAnimationFrame(rafId);
        ctx.drawImage(videoEl, 0, 0, w, h);
        setSaveProgress(Math.round(((i + 1) / segs.length) * 100));
        resolve();
      };
      videoEl.onerror = () => reject(new Error(`Failed to load segment ${segs[i]}`));
    });
  }

  recorder.stop();
  await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  // Download
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cinema-studio.webm';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setIsSaving(false); setSaveProgress(0);   // in a finally block
}
```

⚠️ **KNOWN ISSUES with export — decide before copying:**
- **Audio is lost.** Only the canvas stream is recorded, so the output is silent.
  With audio-capable models this discards half the result. Fix by mixing the
  video elements' audio tracks into the `MediaStream`.
- Output is **`.webm` only**, re-encoded at 30 fps — lossy and not what most
  users expect from a "save" button.
- Export happens in real time: three 8-second segments take 24 seconds.
- Cross-origin sources will taint the canvas and make the recording fail;
  the segment URLs must be CORS-readable.

---

## 11. Error banner

Shown when the shared `error` string is non-empty:

```
absolute bottom-[148px] left-4 right-4 z-50 flex items-center gap-2
rounded-xl bg-red-500/20 border border-red-500/30 px-4 py-2.5
text-sm text-red-400
```

Leading `X` icon (`h-4 w-4 shrink-0`), the message, and a right-aligned `✕`
dismiss button that clears the error.

---

## 12. Design tokens

| Token | Value | Used for |
|---|---|---|
| Accent | `#d7ff00` | Generate button, active dots, save button, live badge |
| Accent hover | `#e2ff4d` | Generate hover |
| Section background | `#0b0d0f` | tab canvas |
| Bar background | `#141618` | bottom bar |
| Panel background | `#1a1c1f` | dropdowns, preview cards |
| Controls background | `#111315` | player control strip |
| Card strip background | `#cecece` | the light tray behind the cards |
| Card background | `#4a4b4d` (hover `#555658`) | slot / segment cards |
| Error | `#ef4444` family via `red-500` | banner, mute icon |
| Radii | `rounded-[24px]` section · `rounded-2xl` blocks · `rounded-xl` buttons · `rounded-lg` chips | |
| Typography | `font-black uppercase` for headlines and Generate; `text-[10px]`/`text-[11px]` `font-bold` for labels | |

---

## 13. External dependencies from the host app

Cinema Studio is not self-contained. To port it you must supply:

| Dependency | Purpose |
|---|---|
| `videoModels` registry | model list for the picker: `{ id, name, provider, status, maxDuration }` |
| `defaultVideoModelId` | initial model |
| `getDurationsForModel(id)` | duration options per model |
| `clampDurationToModel(id, d)` | snap a duration when the model changes |
| `generateVideo(userId, input)` | submits a generation, returns `{ id }` |
| `generations` live list | array of `{ id, status, resultVideoUrl }`, kept fresh by a subscription |
| `callBackend('checkVideoGeneration', …)` | nudges the backend to poll the provider |
| auth object with anonymous sign-in | `signInAnonymously(auth)` |
| shared `error` / `notice` / `loading` / `setMainTab` / `setPrompt` state | banner and Image-mode handoff |
| icons | `Loader2, Trash2, Images, ImageIcon, FileVideo, ChevronDown, Volume2, Volume1, VolumeX, Maximize2, Minimize2, X` |

---

## 14. Build order for an implementing agent

1. Section shell + the two-mode switch, with the bottom bar shared by both.
2. Image-mode hero — it is static and proves the shell.
3. Bottom bar chips and the four dropdowns (backdrop + `bottom-full` panel pattern).
4. Card strip with the four card states and both hidden file inputs.
5. Generation flow + polling + the reconciliation effect.
6. Player: video element, remount key, segment advance on `onEnded`.
7. Segmented progress bar: widths, fills, hover tooltip, click-to-seek.
8. Control row: transport, volume cycle, fullscreen.
9. Export.
10. Error banner.

## 15. Acceptance checklist

- [ ] Mode survives a page reload (sessionStorage)
- [ ] Player empty state is a white stage, not a black one
- [ ] Playback runs continuously across all segments without user input
- [ ] Progress pill widths are proportional to real measured durations
- [ ] Hovering the bar shows a line and a seconds tooltip at the cursor
- [ ] Clicking the bar seeks to the right segment *and* the right offset inside it
- [ ] Back restarts the segment when >2 s in, otherwise steps back
- [ ] Volume cycles through three states with matching icon and colour
- [ ] Esc out of fullscreen updates the button icon
- [ ] Ctrl+Click on a slot opens the video picker, plain click the image picker
- [ ] Trash on a filled slot does not open the file picker
- [ ] A failed segment offers `повтор` and returns to the upload state
- [ ] Changing the model re-clamps the duration chip
- [ ] Export produces a playable file containing every segment in order
- [ ] Opening one dropdown closes aspect/quality/duration
