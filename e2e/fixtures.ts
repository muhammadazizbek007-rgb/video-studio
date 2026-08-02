import { randomUUID } from 'node:crypto';
import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';

export const API_ORIGIN = process.env.VS_E2E_API_ORIGIN ?? 'http://127.0.0.1:8080';
export const WEB_ORIGIN = process.env.VS_E2E_WEB_ORIGIN ?? 'http://127.0.0.1:5173';

/**
 * Structural copies of the DTOs the API returns. Declared here rather than imported from
 * @video-studio/shared so the harness stays free of workspace build ordering: the suite is
 * meant to fail when the wire format drifts, not when a sibling package has not compiled.
 */
export interface E2EUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export type E2EStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface E2EGeneration {
  id: string;
  prompt: string;
  modelId: string;
  duration: number;
  status: E2EStatus;
  resultVideoUrl?: string;
  saved: boolean;
}

export interface E2EElement {
  id: string;
  name: string;
  handle: string;
  category: string;
}

export interface E2EAccount {
  email: string;
  name: string;
}

export interface E2ESession {
  account: E2EAccount;
  user: E2EUser;
  /** Shares its cookie jar with the browser context, so the page is signed in too. */
  request: APIRequestContext;
}

function apiUrl(path: string): string {
  return `${API_ORIGIN}/api${path}`;
}

/**
 * Every test gets its own account. Sharing one across parallel workers is the single most
 * reliable way to make a suite like this flake: list endpoints are scoped per user, so one
 * test's seed data would show up in another's assertions.
 */
export function newAccount(): E2EAccount {
  const id = randomUUID();
  return { email: `e2e-${id}@example.test`, name: `E2E ${id.slice(0, 8)}` };
}

export async function devLogin(request: APIRequestContext, account: E2EAccount): Promise<E2EUser> {
  const response = await request.post(apiUrl('/auth/dev-login'), { data: account });
  expect(response.status(), 'AUTH_DEV_LOGIN must be on for the e2e API').toBe(200);
  return (await response.json()) as E2EUser;
}

export interface SeedGenerationOptions {
  prompt: string;
  modelId?: string;
  duration?: number;
  /** Drives the FAKE_VERTEX operation to its terminal state before the test looks at it. */
  complete?: boolean;
}

export async function seedGeneration(
  request: APIRequestContext,
  options: SeedGenerationOptions,
): Promise<E2EGeneration> {
  const response = await request.post(apiUrl('/generations'), {
    data: {
      prompt: options.prompt,
      modelId: options.modelId ?? 'veo-3.1-fast',
      mode: 'text_to_video',
      aspectRatio: '16:9',
      duration: options.duration ?? 8,
      stylePreset: 'Cinematic',
      cameraMotion: 'Static',
    },
  });
  expect(response.status(), await failureDetail(response)).toBe(200);
  const created = (await response.json()) as E2EGeneration;
  if (options.complete !== true) return created;

  const refreshed = await request.post(apiUrl(`/generations/${created.id}/refresh`));
  expect(refreshed.status(), await failureDetail(refreshed)).toBe(200);
  return (await refreshed.json()) as E2EGeneration;
}

export interface SeedElementOptions {
  name: string;
  category?: 'general' | 'character' | 'location' | 'prop';
  description?: string;
}

export async function seedElement(
  request: APIRequestContext,
  options: SeedElementOptions,
): Promise<E2EElement> {
  const response = await request.post(apiUrl('/elements'), {
    data: {
      name: options.name,
      category: options.category ?? 'character',
      description: options.description,
    },
  });
  expect(response.status(), await failureDetail(response)).toBe(200);
  return (await response.json()) as E2EElement;
}

export async function listGenerations(request: APIRequestContext): Promise<E2EGeneration[]> {
  const response = await request.get(apiUrl('/generations'), { params: { limit: 100 } });
  expect(response.status(), await failureDetail(response)).toBe(200);
  const page = (await response.json()) as { items: E2EGeneration[] };
  return page.items;
}

export async function listElements(request: APIRequestContext): Promise<E2EElement[]> {
  const response = await request.get(apiUrl('/elements'));
  expect(response.status(), await failureDetail(response)).toBe(200);
  return (await response.json()) as E2EElement[];
}

/** Wipes only what the signed-in account owns, which is all a test is ever allowed to see. */
export async function clearAccount(request: APIRequestContext): Promise<void> {
  for (const generation of await listGenerations(request)) {
    await request.delete(apiUrl(`/generations/${generation.id}`));
  }
  for (const element of await listElements(request)) {
    await request.delete(apiUrl(`/elements/${element.id}`));
  }
}

/**
 * ?lang pins the dictionary ahead of localStorage and the browser locale, which keeps the
 * copy-based locators in the specs from depending on whatever the runner's locale is.
 */
export async function openApp(page: Page, path: string): Promise<void> {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}lang=en`);
}

async function failureDetail(response: {
  status: () => number;
  text: () => Promise<string>;
}): Promise<string> {
  return `${response.status()} ${(await response.text()).slice(0, 400)}`;
}

interface Fixtures {
  session: E2ESession;
  account: E2EAccount;
  api: APIRequestContext;
  signedInPage: Page;
}

export const test = base.extend<Fixtures>({
  session: async ({ context }, use) => {
    const account = newAccount();
    const user = await devLogin(context.request, account);

    await use({ account, user, request: context.request });

    // The account is disposable, but its rows are not: the database outlives the test and a
    // full run would otherwise leave hundreds of generations behind for the next one.
    await clearAccount(context.request).catch(() => undefined);
  },

  account: async ({ session }, use) => {
    await use(session.account);
  },

  api: async ({ session }, use) => {
    await use(session.request);
  },

  signedInPage: async ({ page, session }, use) => {
    // A dev-login that quietly failed would surface as an unexplained /login redirect in
    // every test downstream, so the session is checked where it is created.
    expect(session.user.email).toBe(session.account.email);
    await use(page);
  },
});

export { expect } from '@playwright/test';
