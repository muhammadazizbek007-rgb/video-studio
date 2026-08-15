import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VeoModelSpec } from '@video-studio/shared';
import { requireVeoModel } from '@video-studio/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CinemaBottomBar, type CinemaInputMode } from '@/components/cinema/CinemaBottomBar';
import { CinemaPlayer } from '@/components/cinema/CinemaPlayer';
import { type SegmentState, SegmentStrip } from '@/components/cinema/SegmentStrip';
import { LanguageProvider } from '@/i18n/LanguageContext';

/**
 * Pins the dictionary to English. Left to itself the provider follows `navigator.language`,
 * which differs between a developer's machine and CI — and every assertion here is a label.
 */
function renderUi(ui: ReactElement) {
  window.localStorage.setItem('vs.language', 'en');
  // The prompt field reads the saved voices, so the bar needs a query client the same way
  // the app gives it one.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{ui}</LanguageProvider>
    </QueryClientProvider>,
  );
}

interface StripOverrides {
  segmentStates?: Record<string, SegmentState>;
  slotImages?: Record<string, string>;
  segmentVideos?: Record<string, string>;
}

function renderStrip(
  handlers: Partial<Parameters<typeof SegmentStrip>[0]>,
  over: StripOverrides = {},
) {
  const props = {
    segments: ['1'],
    slotImages: over.slotImages ?? {},
    segmentVideos: over.segmentVideos ?? {},
    segmentStates: over.segmentStates ?? { '1': 'empty' as SegmentState },
    onPickImage: vi.fn(),
    onPickVideo: vi.fn(),
    onClearSegment: vi.fn(),
    onClearSlot: vi.fn(),
    onRetrySegment: vi.fn(),
    ...handlers,
  };
  renderUi(<SegmentStrip {...props} />);
  return props;
}

describe('SegmentStrip', () => {
  it('asks for a frame on a plain click', async () => {
    const user = userEvent.setup();
    const onPickImage = vi.fn();
    const onPickVideo = vi.fn();
    renderStrip({ onPickImage, onPickVideo });

    await user.click(screen.getByRole('button', { name: /^1\.1/ }));

    expect(onPickImage).toHaveBeenCalledWith('1.1');
    expect(onPickVideo).not.toHaveBeenCalled();
  });

  it('asks for a clip on Ctrl+Click instead', async () => {
    const user = userEvent.setup();
    const onPickImage = vi.fn();
    const onPickVideo = vi.fn();
    renderStrip({ onPickImage, onPickVideo });

    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('button', { name: /^1\.2/ }));
    await user.keyboard('{/Control}');

    expect(onPickVideo).toHaveBeenCalledWith('1');
    expect(onPickImage).not.toHaveBeenCalled();
  });

  it('clears a filled slot without also opening the file picker', async () => {
    const user = userEvent.setup();
    const onPickImage = vi.fn();
    const onClearSlot = vi.fn();
    renderStrip(
      { onPickImage, onClearSlot },
      { slotImages: { '1.1': 'https://example.test/a.png' } },
    );

    await user.click(screen.getByRole('button', { name: /remove the image/i }));

    expect(onClearSlot).toHaveBeenCalledWith('1.1');
    expect(onPickImage).not.toHaveBeenCalled();
  });

  it('offers a retry on a failed segment', async () => {
    const user = userEvent.setup();
    const onRetrySegment = vi.fn();
    renderStrip({ onRetrySegment }, { segmentStates: { '1': 'failed' } });

    expect(screen.getByText(/^failed$/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^retry$/i }));

    expect(onRetrySegment).toHaveBeenCalledWith('1');
  });
});

describe('CinemaPlayer', () => {
  const noop = () => undefined;

  it('shows an empty stage and disables transport when nothing is generated', () => {
    renderUi(
      <CinemaPlayer
        completedSegs={[]}
        segmentVideos={{}}
        segmentDurations={{}}
        onDurationMeasured={noop}
        onExport={noop}
        isSaving={false}
        saveProgress={0}
      />,
    );

    expect(screen.getByRole('button', { name: /^play$/i })).toBeDisabled();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true');
  });

  it('sizes each pill from its measured duration', () => {
    const { container } = renderUi(
      <CinemaPlayer
        completedSegs={['1', '2']}
        segmentVideos={{ '1': 'a.mp4', '2': 'b.mp4' }}
        // 2s and 6s: a quarter and three quarters of the timeline.
        segmentDurations={{ '1': 2, '2': 6 }}
        onDurationMeasured={noop}
        onExport={noop}
        isSaving={false}
        saveProgress={0}
      />,
    );

    const pills = container.querySelectorAll<HTMLElement>('[role="slider"] > div');
    expect(pills).toHaveLength(2);
    expect(pills[0]?.style.width).toBe('25%');
    expect(pills[1]?.style.width).toBe('75%');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '8');
  });

  it('disables forward on the last segment', () => {
    renderUi(
      <CinemaPlayer
        completedSegs={['1']}
        segmentVideos={{ '1': 'a.mp4' }}
        segmentDurations={{ '1': 4 }}
        onDurationMeasured={noop}
        onExport={noop}
        isSaving={false}
        saveProgress={0}
      />,
    );

    expect(screen.getByRole('button', { name: /next segment/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous segment/i })).toBeEnabled();
  });

  it('reports export progress on the save button while stitching', () => {
    renderUi(
      <CinemaPlayer
        completedSegs={['1']}
        segmentVideos={{ '1': 'a.mp4' }}
        segmentDurations={{ '1': 4 }}
        onDurationMeasured={noop}
        onExport={noop}
        isSaving
        saveProgress={40}
      />,
    );

    expect(screen.getByRole('button', { name: /stitching 40%/i })).toBeDisabled();
  });
});

/** Drives the bar with real state so model changes flow back through the props. */
function BottomBarHarness({
  onDuration,
  mode = 'Video',
}: {
  onDuration?: (value: number) => void;
  mode?: CinemaInputMode;
}) {
  const [modelId, setModelId] = useState('veo-3.1');
  const model: VeoModelSpec = requireVeoModel(modelId);
  const [duration, setDuration] = useState<VeoModelSpec['defaultDuration']>(8);
  const [imageModelId, setImageModelId] = useState('gemini-image');

  return (
    <CinemaBottomBar
      mode={mode}
      onModeChange={() => undefined}
      prompt="a shot"
      onPromptChange={() => undefined}
      model={model}
      modelId={modelId}
      onModelChange={setModelId}
      imageModelId={imageModelId}
      onImageModelChange={setImageModelId}
      aspect="16:9"
      onAspectChange={() => undefined}
      duration={duration}
      onDurationChange={(value) => {
        setDuration(value);
        onDuration?.(value);
      }}
      stylePreset="Cinematic"
      onStylePresetChange={() => undefined}
      cameraMotion="Static"
      onCameraMotionChange={() => undefined}
      samples={1}
      onSamplesChange={() => undefined}
      busy={false}
      onGenerate={() => undefined}
    />
  );
}

describe('CinemaBottomBar', () => {
  it('closes the other setting panels when one opens', async () => {
    const user = userEvent.setup();
    renderUi(<BottomBarHarness />);

    await user.click(screen.getByRole('button', { name: /^16:9$/ }));
    expect(screen.getByRole('listbox', { name: /aspect ratio/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^8s$/ }));
    expect(screen.getByRole('listbox', { name: /^duration$/i })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: /aspect ratio/i })).not.toBeInTheDocument();
  });

  it('offers only the durations the selected model supports', async () => {
    const user = userEvent.setup();
    renderUi(<BottomBarHarness />);

    // Veo 3.1 offers 4, 6 and 8 seconds — 5 and 7 are the ones it does not.
    await user.click(screen.getByRole('button', { name: /^8s$/ }));
    const panel = screen.getByRole('listbox', { name: /^duration$/i });
    expect(within(panel).getByRole('option', { name: /^4s$/ })).toBeInTheDocument();
    expect(within(panel).queryByRole('option', { name: /^5s$/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('option', { name: /^7s$/ })).not.toBeInTheDocument();
  });

  it('lists only image models in Image mode, and drops the duration chip', async () => {
    const user = userEvent.setup();
    renderUi(<BottomBarHarness mode="Image" />);

    // 8s, matching the harness: asserting the absence of a chip that never had
    // that label would pass whatever the component did.
    expect(screen.queryByRole('button', { name: /^8s$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /google gemini image/i }));
    const panel = screen.getByRole('listbox', { name: /choose a model/i });
    expect(within(panel).getByRole('option', { name: /google gemini image/i })).toBeInTheDocument();
    // The load-bearing half: Image mode must not offer video models. The picker happens to
    // hold a single entry now that every Imagen model was withdrawn, so an assertion about
    // "some other image model" would only be testing the catalogue's length.
    expect(within(panel).queryByRole('option', { name: /veo/i })).not.toBeInTheDocument();
  });
});
