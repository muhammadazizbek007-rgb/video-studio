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
import { VideoToolsMenu } from '@/components/video/VideoToolsMenu';
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
let extendGenerationMock: MutationMock;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authMock,
}));

vi.mock('@/hooks/useElements', () => ({
  useElements: () => ({ data: elementsMock, isLoading: false, isError: false }),
  useUpdateElement: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** The reference slots open the media picker, which reads these libraries. */
vi.mock('@/hooks/useMediaLibrary', () => ({
  useUploads: () => ({ data: [], isPending: false, refetch: vi.fn() }),
  useImageGenerations: () => ({ data: [], isPending: false }),
  useUpdateUpload: () => ({ mutate: vi.fn() }),
  useDeleteUpload: () => ({ mutate: vi.fn() }),
  useUpdateImageGeneration: () => ({ mutate: vi.fn() }),
  useDeleteImageGeneration: () => ({ mutate: vi.fn() }),
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
  useExtendGeneration: () => extendGenerationMock,
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

const CAFE: ElementDto = {
  id: 'el-cafe',
  userId: 'user-1',
  name: 'Кафе',
  handle: '@Cafe',
  category: 'location',
  description: 'неоновое кафе',
  imageUrl: '/media/uploads/user-1/cafe.jpg',
  pinned: false,
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
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
  extendGenerationMock = {
    mutateAsync: vi.fn(async () => generationFixture({ id: 'gen-extended', status: 'pending' })),
    isPending: false,
  };
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

  it('renders every loaded generation rather than the first screenful', () => {
    // Fourteen, because the page used to slice at nine. A fixture of ten would still
    // pass against the old cap on some renders and prove nothing.
    const many = Array.from({ length: 14 }, (_, index) =>
      generationFixture({
        id: `g${index + 1}`,
        status: 'completed',
        prompt: `ролик номер ${index + 1}`,
      }),
    );
    generationsMock = generationsResult(many);
    renderWithProviders(<DashboardPage />, '/dashboard');

    expect(screen.getByText('ролик номер 1')).toBeInTheDocument();
    expect(screen.getByText('ролик номер 14')).toBeInTheDocument();
    expect(statValue('Всего')).toBe('14');
  });

  it('asks for the next page only when there is one', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    generationsMock = {
      ...generationsResult([generationFixture({ id: 'g1', status: 'completed' })]),
      hasMore: true,
      loadMore,
    };
    renderWithProviders(<DashboardPage />, '/dashboard');

    await user.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('hides the control once everything is loaded', () => {
    generationsMock = generationsResult([generationFixture({ id: 'g1', status: 'completed' })]);
    renderWithProviders(<DashboardPage />, '/dashboard');

    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
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

  // Which category an element belongs to is the thing being chosen between, so the popup
  // says it rather than leaving a bare list of names.
  it('groups the suggestions under their category, characters first', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromptHarness elements={[CAFE, AVA]} />);

    await user.type(screen.getByRole('textbox', { name: 'Промпт' }), 'Сцена @');

    const listbox = await screen.findByRole('listbox', { name: 'Упомянутые элементы' });
    expect(within(listbox).getByText('Персонажи')).toBeInTheDocument();
    expect(within(listbox).getByText('Локации')).toBeInTheDocument();

    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveTextContent('@Ava');
    expect(options[1]).toHaveTextContent('@Cafe');
  });

  // A mention that resolves to nothing must not look the same as one that attached a photo.
  it('matches by name as well as by handle', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromptHarness elements={[AVA, CAFE]} />);

    await user.type(screen.getByRole('textbox', { name: 'Промпт' }), 'Сцена @Кафе');

    const listbox = await screen.findByRole('listbox', { name: 'Упомянутые элементы' });
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('@Cafe');
  });
});

describe('StudioPage attached elements', () => {
  it('shows what a mention attaches, and warns about a handle it cannot resolve', async () => {
    const user = userEvent.setup();
    elementsMock = [AVA, CAFE];
    renderWithProviders(<StudioPage />, '/studio');

    await user.type(
      screen.getByRole('textbox', { name: 'Промпт' }),
      '@Cafe вечером, @Ava и @Ghost',
    );

    const panel = await screen.findByTestId('attached-elements');
    // The location has a photo and takes the only slot in use; Ава has none, so she can
    // only travel as words — and the panel has to say which is which.
    expect(within(panel).getByText('Фото-слоты: 1 из 3')).toBeInTheDocument();
    expect(within(panel).getByText(/Локации · по фото/)).toBeInTheDocument();
    expect(within(panel).getByText(/Персонажи · только описанием/)).toBeInTheDocument();
    expect(within(panel).getByText(/Не найдены в библиотеке: @Ghost/)).toBeInTheDocument();
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

describe('GenerationCard regeneration', () => {
  const failed = generationFixture({
    id: 'gen-failed',
    status: 'failed',
    prompt: 'кот в неоне',
  });

  it('offers another run on a clip that failed, and reports it without a confirmation', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    renderWithProviders(<GenerationCard generation={failed} onRegenerate={onRegenerate} />);

    await user.click(screen.getByRole('button', { name: 'Сгенерировать заново' }));

    expect(onRegenerate).toHaveBeenCalledWith(failed);
  });

  // Nothing failed, so there is nothing to run again — the button would only invite a
  // duplicate of a clip the user already has.
  it('stays away from a clip that completed', () => {
    const completed = generationFixture({ id: 'gen-ok', status: 'completed' });
    renderWithProviders(<GenerationCard generation={completed} onRegenerate={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Сгенерировать заново' })).toBeNull();
  });

  it('blocks a second click while the first run is still starting', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    renderWithProviders(
      <GenerationCard generation={failed} onRegenerate={onRegenerate} isRegenerating />,
    );

    await user.click(screen.getByRole('button', { name: 'Сгенерировать заново' }));

    expect(onRegenerate).not.toHaveBeenCalled();
  });
});

describe('VideoToolsMenu', () => {
  it('keeps the control row to a single button while closed', () => {
    renderWithProviders(<VideoToolsMenu open={false} onOpenChange={vi.fn()} onPick={vi.fn()} />);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Инструменты' })).toBeInTheDocument();
  });

  it('lists every tool with what it does', () => {
    renderWithProviders(<VideoToolsMenu open onOpenChange={vi.fn()} onPick={vi.fn()} />);

    const menu = screen.getByRole('menu', { name: 'Инструменты' });
    for (const label of [
      'Продолжить ролик',
      'Убрать предмет',
      'Добавить предмет',
      'Расширить кадр',
      'Улучшить качество',
    ]) {
      expect(within(menu).getByText(label)).toBeInTheDocument();
    }
  });

  it('hands back the tool that was clicked', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithProviders(<VideoToolsMenu open onOpenChange={vi.fn()} onPick={onPick} />);

    await user.click(screen.getByRole('menuitem', { name: /Продолжить ролик/ }));

    expect(onPick).toHaveBeenCalledWith('extend');
  });

  // A tool that is not built yet is shown rather than hidden — but it must not be clickable,
  // or the menu promises something the server cannot do.
  it('shows an unavailable tool without letting it be chosen', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithProviders(
      <VideoToolsMenu open onOpenChange={vi.fn()} onPick={onPick} unavailable={['upscale']} />,
    );

    const item = screen.getByRole('menuitem', { name: /Улучшить качество/ });
    expect(item).toBeDisabled();
    await user.click(item);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('GenerationCard failure explanation', () => {
  function failedWith(errorMessage?: string): GenerationDto {
    return { ...generationFixture({ id: 'gen-failed', status: 'failed' }), errorMessage };
  }

  it('explains a reference image failure in the reader’s language, server words included', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GenerationCard generation={failedWith('Downloading the reference image failed.')} />,
    );

    await user.click(screen.getByRole('button', { name: 'Почему произошла ошибка' }));

    const dialog = await screen.findByRole('dialog', { name: 'Почему не получилось' });
    expect(within(dialog).getByText(/не смог получить одну из картинок/)).toBeInTheDocument();
    expect(within(dialog).getByText(/загрузите изображение заново/)).toBeInTheDocument();
    // The raw message is introduced, never swapped out — it is what a bug report needs.
    expect(within(dialog).getByText('Downloading the reference image failed.')).toBeInTheDocument();
  });

  // A safety block is a decision about the request, so promising that a retry might work
  // would be a lie the button itself already tempts people into.
  it('says a retry will not help when the request was blocked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GenerationCard generation={failedWith('Veo blocked the generation: safety filters')} />,
    );

    await user.click(screen.getByRole('button', { name: 'Почему произошла ошибка' }));

    const dialog = await screen.findByRole('dialog', { name: 'Почему не получилось' });
    expect(within(dialog).getByText(/сначала измените промпт/)).toBeInTheDocument();
  });

  it('admits it cannot explain a message it does not recognise', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GenerationCard generation={failedWith('kernel panic in the mainframe')} />,
    );

    await user.click(screen.getByRole('button', { name: 'Почему произошла ошибка' }));

    const dialog = await screen.findByRole('dialog', { name: 'Почему не получилось' });
    expect(within(dialog).getByText(/определить причину не удалось/)).toBeInTheDocument();
    expect(within(dialog).getByText('kernel panic in the mainframe')).toBeInTheDocument();
  });

  it('says so when the server recorded no message at all', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GenerationCard generation={failedWith()} />);

    await user.click(screen.getByRole('button', { name: 'Почему произошла ошибка' }));

    const dialog = await screen.findByRole('dialog', { name: 'Почему не получилось' });
    expect(within(dialog).getByText(/не сохранил сообщение об ошибке/)).toBeInTheDocument();
  });

  it('stays off a card that did not fail', () => {
    renderWithProviders(
      <GenerationCard generation={generationFixture({ id: 'gen-ok', status: 'completed' })} />,
    );

    expect(screen.queryByRole('button', { name: 'Почему произошла ошибка' })).toBeNull();
  });
});
