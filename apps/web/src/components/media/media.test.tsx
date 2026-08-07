import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ElementDto,
  GenerationDto,
  ImageGenerationDto,
  UploadDto,
} from '@video-studio/shared';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaPicker } from '@/components/media/MediaPicker';
import { LanguageProvider } from '@/i18n/LanguageContext';

const listUploads = vi.fn();
const listImages = vi.fn();
const listGenerations = vi.fn();
const listElements = vi.fn();
const updateUpload = vi.fn();
const uploadFile = vi.fn();

vi.mock('@/lib/api', () => ({
  ApiClientError: class extends Error {},
  api: {
    media: {
      list: (...args: unknown[]) => listUploads(...args),
      upload: (...args: unknown[]) => uploadFile(...args),
      update: (...args: unknown[]) => updateUpload(...args),
      remove: vi.fn(),
    },
    images: { list: () => listImages(), update: vi.fn(), remove: vi.fn() },
    generations: { list: () => listGenerations(), update: vi.fn(), remove: vi.fn() },
    elements: { list: () => listElements(), update: vi.fn(), remove: vi.fn() },
  },
}));

function upload(over: Partial<UploadDto> = {}): UploadDto {
  return {
    id: 'up-1',
    userId: 'user-1',
    url: 'https://example.test/desk.png',
    path: 'uploads/user-1/desk.png',
    kind: 'image',
    contentType: 'image/png',
    bytes: 2048,
    filename: 'desk.png',
    saved: false,
    createdAt: '2026-08-07T10:00:00.000Z',
    ...over,
  };
}

function element(over: Partial<ElementDto> = {}): ElementDto {
  return {
    id: 'el-1',
    userId: 'user-1',
    name: 'Luna',
    handle: '@Luna',
    category: 'character',
    imageUrl: 'https://example.test/luna.png',
    pinned: false,
    createdAt: '2026-08-07T09:00:00.000Z',
    updatedAt: '2026-08-07T09:00:00.000Z',
    ...over,
  };
}

function still(over: Partial<ImageGenerationDto> = {}): ImageGenerationDto {
  return {
    id: 'img-1',
    userId: 'user-1',
    prompt: 'a lighthouse at dusk',
    finalPrompt: 'a lighthouse at dusk, cinematic',
    modelId: 'imagen-4',
    aspectRatio: '16:9',
    stylePreset: 'Cinematic',
    status: 'completed',
    imageUrl: 'https://example.test/lighthouse.png',
    saved: false,
    createdAt: '2026-08-07T08:00:00.000Z',
    ...over,
  };
}

function clip(over: Partial<GenerationDto> = {}): GenerationDto {
  return {
    id: 'gen-1',
    userId: 'user-1',
    prompt: 'a drone shot over dunes',
    modelId: 'veo-3.1-fast',
    mode: 'text_to_video',
    aspectRatio: '16:9',
    duration: 8,
    stylePreset: 'Cinematic',
    cameraMotion: 'Static',
    status: 'completed',
    resultVideoUrl: 'https://example.test/dunes.mp4',
    saved: false,
    referenceImageUrls: [],
    elements: [],
    referenceCount: 0,
    createdAt: '2026-08-07T07:00:00.000Z',
    updatedAt: '2026-08-07T07:00:00.000Z',
    ...over,
  };
}

function renderPicker(ui: ReactElement) {
  window.localStorage.setItem('vs.language', 'en');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>{ui}</LanguageProvider>
    </QueryClientProvider>,
  );
}

const noop = () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  listUploads.mockResolvedValue({ items: [upload()] });
  listImages.mockResolvedValue({ items: [still()] });
  listGenerations.mockResolvedValue({ items: [clip()], nextCursor: null });
  listElements.mockResolvedValue([element()]);
});

describe('MediaPicker', () => {
  it('opens on the library, with the file dialog as one tile inside it', async () => {
    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);

    // The tab strip is the first thing offered — not the OS file dialog.
    expect(screen.getByRole('tab', { name: /uploads/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /upload a file/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /select — desk\.png/i })).toBeInTheDocument(),
    );
  });

  it('hands the caller the URL of whatever was picked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={onSelect} />);

    await user.click(await screen.findByRole('button', { name: /select — desk\.png/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.test/desk.png', source: 'upload' }),
    );
  });

  it('shows each source under its own tab', async () => {
    const user = userEvent.setup();
    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);

    await user.click(screen.getByRole('tab', { name: /elements/i }));
    expect(await screen.findByRole('button', { name: /select — luna/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /image generations/i }));
    expect(
      await screen.findByRole('button', { name: /select — a lighthouse at dusk/i }),
    ).toBeInTheDocument();
  });

  it('offers clips instead of stills when the caller wants a video', async () => {
    const user = userEvent.setup();
    renderPicker(<MediaPicker open onClose={noop} accept="video" onSelect={noop} />);

    // An image-only tab would be a dead end for a segment that needs an MP4.
    expect(screen.queryByRole('tab', { name: /elements/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /image generations/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /video generations/i }));
    expect(
      await screen.findByRole('button', { name: /select — a drone shot over dunes/i }),
    ).toBeInTheDocument();
  });

  it('collects liked items from every source', async () => {
    const user = userEvent.setup();
    listUploads.mockResolvedValue({ items: [upload({ saved: true })] });
    listImages.mockResolvedValue({ items: [still({ saved: false })] });
    listElements.mockResolvedValue([element({ pinned: true })]);

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);

    await user.click(screen.getByRole('tab', { name: /liked/i }));
    const grid = await screen.findByTestId('media-grid');

    expect(within(grid).getByRole('button', { name: /select — desk\.png/i })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: /select — luna/i })).toBeInTheDocument();
    // The unliked still stays out of it.
    expect(
      within(grid).queryByRole('button', { name: /select — a lighthouse at dusk/i }),
    ).not.toBeInTheDocument();
  });

  it('likes an upload through the API', async () => {
    const user = userEvent.setup();
    updateUpload.mockResolvedValue(upload({ saved: true }));
    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);

    await user.click(await screen.findByRole('button', { name: /add to liked/i }));

    expect(updateUpload).toHaveBeenCalledWith('up-1', { saved: true });
  });
});
