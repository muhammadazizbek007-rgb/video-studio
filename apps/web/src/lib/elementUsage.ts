const STORAGE_KEY = 'vs.elementUsage';

/**
 * When each element was last inserted, kept in the browser.
 *
 * "Last used" is a property of the person picking, not of the element: two accounts reach for
 * different characters, and the record has no field for it. Writing it locally keeps the sort
 * useful without a schema change — the cost is that it does not follow the user to another
 * browser, where the order falls back to newest-first.
 */
export type ElementUsage = Record<string, string>;

export function readElementUsage(): ElementUsage {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const usage: ElementUsage = {};
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === 'string') usage[id] = at;
    }
    return usage;
  } catch {
    // A corrupted entry must not take the picker down with it.
    return {};
  }
}

export function markElementUsed(id: string, at = new Date().toISOString()): ElementUsage {
  const usage = { ...readElementUsage(), [id]: at };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
    } catch {
      // Private mode and a full quota both land here; the sort simply stays as it was.
    }
  }
  return usage;
}
