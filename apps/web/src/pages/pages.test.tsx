import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ElementDto,
  GenerationDto,
  UserDto,
  VideoGenerationStatus,
} from '@video-studio/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { GenerationCard } from '@/components/video/GenerationCard';
import { PromptComposer } from '@/components/video/PromptComposer';
import type { UseGenerationsResult } from '@/hooks/useGenerations';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { StudioPage } from '@/pages/StudioPage';

interface AuthMock {
  user: UserDto | null;
  isLoading: boolean;
  signIn: Mock;
  signOut: Mock;
}

interface MutationMock {
  mutateAsync: Mock;
  isPending: boolean;
}

/** Mirrors UseGenerationsResult so the stub cannot drift from the hook the pages consume. */
interface GenerationsMock extends Omit<UseGenerationsResult, 'loadMore' | 'refetch'> {
  loadMore: Mock;
  refetch: Mock;
}

let authMock: AuthMock;
let generationsMock: GenerationsMock;
let elementsMock: ElementDto[];
let createGenerationMock: MutationMock;
let updateGenerationMock: MutationMock;
let deleteGenerationMock: MutationMock;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authMock,
}));

vi.mock('@/hooks/useElements', () => ({
  useElements: () => ({ data: elementsMock, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useGenerationStream', () => ({
  useGenerationStream: () => ({
    generation: undefined,
    isLoading: false,
    isDone: false,
    isPolling: false,
  }),
}));

vi.mock('@/hooks/useGenerations', () => ({
  useGenerations: () => generationsMock,
  useCreateGeneration: () => createGenerationMock,
  useUpdateGeneration: () => updateGenerationMock,
  useDeleteGeneration: () => deleteGenerationMock,
}));

const USER: UserDto = {
  id: 'user-1',
  email: 'director@example.com',
  name: 'Director',
  picture: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

interface GenerationSeed {
  id: string;
  status: VideoGenerationStatus;
  prompt?: string;
  saved?: boolean;
  resultVideoUrl?: string;
}

function generationFixture(seed: GenerationSeed): GenerationDto {
  return {
    id: seed.id,
    userId: 'user-1',
    prompt: seed.prompt ?? 'кот на скейтборде',
    modelId: 'veo-3.1-fast',
    mode: 'text_to_video',
    aspectRatio: '16:9',
    duration: 8,
    stylePreset: 'Cinematic',
    cameraMotion: 'Dolly in',
    status: seed.status,
    resultVideoUrl: seed.resultVideoUrl,
    saved: seed.saved ?? false,
    referenceImageUrls: [],
    elements: [],
    referenceCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function generationsResult(items: GenerationDto[]): GenerationsMock {
  return {
    generations: items,
    isLoading: false,
    isError: false,
    error: null,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  };
}

const AVA: ElementDto = {
  id: 'el-ava',
  userId: 'user-1',
  name: 'Ава',
  handle: '@Ava',
  category: 'character',
  description: 'рыжая героиня',
  imageUrl: undefined,
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The provider stack App.tsx actually mounts: query client → language → router. */
function renderWithProviders(ui: ReactElement, route = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Stat tiles are a label followed by its count; status pills reuse some of the same words. */
function statValue(label: string): string {
  for (const node of screen.getAllByText(label)) {
    const value = node.nextElementSibling?.textContent ?? '';
    if (/^\d+$/.test(value)) return value;
  }
  throw new Error(`No stat tile labelled ${label}`);
}

beforeEach(() => {
  // LanguageProvider otherwise falls back to the navigator language, which jsdom reports as en.
  window.localStorage.setItem('vs.language', 'ru');

  authMock = {
    user: USER,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
  };
  elementsMock = [];
  generationsMock = generationsResult([]);
  createGenerationMock = {
    mutateAsync: vi.fn(async () => generationFixture({ id: 'gen-new', status: 'pending' })),
    isPending: false,
  };
  updateGenerationMock = { mutateAsync: vi.fn(async () => undefined), isPending: false };
  deleteGenerationMock = { mutateAsync: vi.fn(async () => undefined), isPending: false };
});

describe('LoginPage', () => {
  it('starts the Google sign-in flow when the control is activated', async () => {
    const user = userEvent.setup();
    authMock.user = null;
    renderWithProviders(<LoginPage />, '/login');

    await user.click(screen.getByRole('button', { name: 'Продолжить с Google' }));

    expect(authMock.signIn).toHaveBeenCalledTimes(1);
  });

  it('hides the sign-in control while the session is still being checked', () => {
    authMock.user = null;
    authMock.isLoading = true;
    renderWithProviders(<LoginPage />, '/login');

    expect(screen.queryByRole('button', { name: 'Продолжить с Google' })).toBeNull();
  });

  it('explains a rejected account when the callback reports it', () => {
    authMock.user = null;
    renderWithProviders(<LoginPage />, '/login?error=forbidden');

    expect(screen.getByRole('alert')).toHaveTextContent('нет доступа');
  });
});

describe('DashboardPage', () => {
  it('counts total, completed, processing and failed generations', () => {
    generationsMock = generationsResult([
      generationFixture({ id: 'g1', status: 'completed' }),
      generationFixture({ id: 'g2', status: 'completed' }),
      generationFixture({ id: 'g3', status: 'processing' }),
      generationFixture({ id: 'g4', status: 'pending' }),
      generationFixture({ id: 'g5', status: 'failed' }),
    ]);
    renderWithProviders(<DashboardPage />, '/dashboard');

    expect(statValue('Всего')).toBe('5');
    expect(statValue('Готово')).toBe('2');
    expect(statValue('В работе')).toBe('2');
    expect(statValue('Ошибки')).toBe('1');
  });

  it('offers the empty state and zeroed stats when nothing has been generated', () => {
    renderWithProviders(<DashboardPage />, '/dashboard');

    expect(screen.getByText('Пока ничего не сгенерировано')).toBeInTheDocument();
    expect(statValue('Всего')).toBe('0');
    expect(statValue('Ошибки')).toBe('0');
    expect(screen.getAllByRole('button', { name: 'Новое видео' }).length).toBeGreaterThan(1);
  });
});

describe('StudioPage', () => {

  it('keeps the generate control disabled until the prompt has content', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StudioPage />, '/studio');

    const generate = screen.getByRole('button', { name: 'Сгенерировать' });
    expect(generate).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Промпт' }), 'кот на скейтборде');

    expect(generate).toBeEnabled();
  });
});

function PromptHarness({ elements }: { elements: readonly ElementDto[] }) {
  const [value, setValue] = useState('');

  return (
    <PromptComposer
      value={value}
      onChange={setValue}
      elements={elements}
      enrichContext={{
        stylePreset: 'Cinematic',
        cameraMotion: 'Dolly in',
        mode: 'text_to_video',
        elements: [],
      }}
    />
  );
}

describe('PromptComposer mentions', () => {
  it('inserts the highlighted handle when Enter is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromptHarness elements={[AVA]} />);

    const textarea = screen.getByRole('textbox', { name: 'Промпт' });
    await user.type(textarea, 'Сцена @av');

    const listbox = await screen.findByRole('listbox', { name: 'Упомянутые элементы' });
    expect(within(listbox).getByRole('option', { name: /@Ava/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{Enter}');

    expect(textarea).toHaveValue('Сцена @Ava ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the suggestions on Escape without touching the prompt', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromptHarness elements={[AVA]} />);

    const textarea = screen.getByRole('textbox', { name: 'Промпт' });
    await user.type(textarea, 'Сцена @av');
    await screen.findByRole('listbox', { name: 'Упомянутые элементы' });

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(textarea).toHaveValue('Сцена @av');
  });
});

describe('GenerationCard deletion', () => {
  const generation = generationFixture({
    id: 'gen-1',
    status: 'completed',
    prompt: 'кот в неоне',
  });

  it('confirms before deleting and only then reports the intent', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderWithProviders(<GenerationCard generation={generation} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    const dialog = await screen.findByRole('dialog', { name: 'Удалить генерацию' });
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    expect(onDelete).toHaveBeenCalledWith(generation);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('leaves the generation alone when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderWithProviders(<GenerationCard generation={generation} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить генерацию' });
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onDelete).not.toHaveBeenCalled();
  });
});
