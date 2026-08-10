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
const createElement = vi.fn();
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
    elements: {
      list: () => listElements(),
      create: (...args: unknown[]) => createElement(...args),
      update: vi.fn(),
      remove: vi.fn(),
    },
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

/** Three elements, one per category, so filtering and sorting have something to bite on. */
function elementLibrary(): ElementDto[] {
  return [
    element({ id: 'el-1', name: 'Luna', handle: '@Luna', category: 'character' }),
    element({
      id: 'el-2',
      name: 'Barn',
      handle: '@Barn',
      category: 'location',
      description: 'a red barn at dusk',
      createdAt: '2026-08-07T08:00:00.000Z',
    }),
    element({
      id: 'el-3',
      name: 'Torch',
      handle: '@Torch',
      category: 'prop',
      createdAt: '2026-08-07T07:00:00.000Z',
    }),
  ];
}

function tileNames(): string[] {
  return screen
    .getAllByRole('button', { name: /^select — /i })
    .map((tile) => tile.getAttribute('aria-label')?.replace('Select — ', '') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.removeItem('vs.elementUsage');
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

  it('creates an element without leaving the picker', async () => {
    const user = userEvent.setup();
    listElements.mockResolvedValue([]);
    uploadFile.mockResolvedValue(upload({ url: 'https://example.test/hero.png' }));
    createElement.mockResolvedValue(element({ id: 'el-2', name: 'Hero', handle: '@Hero' }));

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);

    await user.click(screen.getByRole('tab', { name: /elements/i }));
    await user.click(await screen.findByRole('button', { name: /create element/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'Hero');
    await user.type(screen.getByLabelText(/^description$/i), 'A tall knight');
    await user.selectOptions(screen.getByLabelText(/^category$/i), 'character');
    await user.upload(
      screen.getByLabelText(/upload media/i),
      new File(['x'], 'hero.png', { type: 'image/png' }),
    );

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(createElement).toHaveBeenCalledWith({
        name: 'Hero',
        category: 'character',
        description: 'A tall knight',
        imageUrl: 'https://example.test/hero.png',
      }),
    );
    // The form gives way to the library again once the element is saved.
    await waitFor(() => expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /elements/i })).toBeInTheDocument();
  });

  it('keeps the element form open until an image is attached', async () => {
    const user = userEvent.setup();
    listElements.mockResolvedValue([]);

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);

    await user.click(screen.getByRole('tab', { name: /elements/i }));
    await user.click(await screen.findByRole('button', { name: /create element/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'Hero');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    // The picker only lists elements that have an image, so saving one without it would
    // look like nothing happened.
    expect(createElement).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/add an image/i);
  });

  it('narrows the Elements tab by search text', async () => {
    const user = userEvent.setup();
    listElements.mockResolvedValue(elementLibrary());

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);
    await user.click(screen.getByRole('tab', { name: /elements/i }));
    await screen.findByRole('button', { name: /select — luna/i });

    // The description counts too — "red barn" is not in any name or handle.
    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'red barn');

    expect(tileNames()).toEqual(['Barn']);
  });

  it('filters the Elements tab by category', async () => {
    const user = userEvent.setup();
    listElements.mockResolvedValue(elementLibrary());

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);
    await user.click(screen.getByRole('tab', { name: /elements/i }));
    await screen.findByRole('button', { name: /select — luna/i });

    await user.click(screen.getByRole('button', { name: /^filter$/i }));
    await user.click(screen.getByRole('menuitemradio', { name: /locations/i }));

    expect(tileNames()).toEqual(['Barn']);
    // Picking an option closes the menu, the way the reference does.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('sorts elements by name and by last use', async () => {
    const user = userEvent.setup();
    listElements.mockResolvedValue(elementLibrary());

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);
    await user.click(screen.getByRole('tab', { name: /elements/i }));
    await screen.findByRole('button', { name: /select — luna/i });

    // Newest first is the default.
    expect(tileNames()).toEqual(['Luna', 'Barn', 'Torch']);

    await user.click(screen.getByRole('button', { name: /^filter$/i }));
    await user.click(screen.getByRole('menuitemradio', { name: /^name$/i }));
    expect(tileNames()).toEqual(['Barn', 'Luna', 'Torch']);

    // Selecting is what records a use, so the oldest element leads once it is picked.
    await user.click(screen.getByRole('button', { name: /select — torch/i }));
    await user.click(screen.getByRole('button', { name: /^filter$/i }));
    await user.click(screen.getByRole('menuitemradio', { name: /last used/i }));
    expect(tileNames()).toEqual(['Torch', 'Luna', 'Barn']);
  });

  it('says nothing matched instead of claiming the library is empty', async () => {
    const user = userEvent.setup();
    listElements.mockResolvedValue(elementLibrary());

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);
    await user.click(screen.getByRole('tab', { name: /elements/i }));
    await screen.findByRole('button', { name: /select — luna/i });

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'zzz');

    expect(screen.getByText(/nothing found/i)).toBeInTheDocument();
    expect(screen.queryByText(/no elements yet/i)).not.toBeInTheDocument();
  });

  it('says the library failed instead of showing it as empty', async () => {
    const user = userEvent.setup();
    listImages.mockRejectedValue(new Error('the server is down'));

    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);
    await user.click(screen.getByRole('tab', { name: /image generations/i }));

    expect(await screen.findByText(/could not load the library/i)).toBeInTheDocument();
    expect(screen.queryByText(/no images yet/i)).not.toBeInTheDocument();
  });

  it('refetches the libraries every time it opens', async () => {
    window.localStorage.setItem('vs.language', 'en');
    // One client across both renders — a fresh one would remount and refetch on its own,
    // which would prove nothing.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = (open: boolean) => (
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <MediaPicker open={open} onClose={noop} accept="image" onSelect={noop} />
        </LanguageProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(view(false));
    await waitFor(() => expect(listImages).toHaveBeenCalledTimes(1));

    // A still generated in the studio while the picker sat closed has to be on the tab.
    rerender(view(true));
    await waitFor(() => expect(listImages.mock.calls.length).toBeGreaterThan(1));
  });

  it('likes an upload through the API', async () => {
    const user = userEvent.setup();
    updateUpload.mockResolvedValue(upload({ saved: true }));
    renderPicker(<MediaPicker open onClose={noop} accept="image" onSelect={noop} />);

    await user.click(await screen.findByRole('button', { name: /add to liked/i }));

    expect(updateUpload).toHaveBeenCalledWith('up-1', { saved: true });
  });
});
