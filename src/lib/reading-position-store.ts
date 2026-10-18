import type { ReadingChapter } from "@/lib/content-reading-address";

/** Versioned, origin-local keys; never pass an entire URL or article title. */
export const READING_POSITIONS_KEY = "photosite.reading-positions.v1";
export const READING_DISABLED_KEY = "photosite.reading-positions-disabled.v1";
export const READING_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const READING_POSITION_LIMIT = 100;
/** UTF-16 code units, including JSON escaping, not an estimate of browser quota. */
export const READING_PAYLOAD_LIMIT = 128 * 1024;

export interface ReadingPositionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Position = {
  contentId: string;
  locale: string;
  headingId: string;
  savedAt: number;
};

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Oldest first; deterministic even when several tabs write at the same instant. */
function compare(a: Position, b: Position): number {
  return a.savedAt - b.savedAt || codeUnitCompare(a.contentId, b.contentId) ||
    codeUnitCompare(a.locale, b.locale) || codeUnitCompare(a.headingId, b.headingId);
}

function bounded(entries: Position[]): Position[] {
  entries.sort(compare);
  while (entries.length > READING_POSITION_LIMIT ||
      JSON.stringify(entries).length > READING_PAYLOAD_LIMIT) entries.shift();
  return entries;
}

function parse(raw: unknown, now: number): Position[] {
  if (typeof raw !== "string" || raw.length > READING_PAYLOAD_LIMIT) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const entries: Position[] = [];
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) ||
        Object.keys(candidate).sort().join(",") !== "contentId,headingId,locale,savedAt") continue;
    const { contentId, locale, headingId, savedAt } = candidate;
    if (!text(contentId, 512) || !text(locale, 64) || !text(headingId, 512) ||
        !Number.isSafeInteger(savedAt) || savedAt < 0 || savedAt > now ||
        now - savedAt >= READING_RETENTION_MS) continue;
    // Pick fields explicitly, even for data read back from our own key.
    entries.push({ contentId, locale, headingId, savedAt });
  }
  entries.sort(compare);
  const unique: Position[] = [];
  for (const entry of entries) {
    const previous = unique.findIndex((other) =>
      other.contentId === entry.contentId && other.locale === entry.locale);
    if (previous !== -1) unique.splice(previous, 1);
    unique.push(entry);
  }
  return bounded(unique);
}

/**
 * Storage foundation only. The caller acquires localStorage inside try/catch and
 * owns navigation, heading readiness, scroll/focus, UI and cross-tab events.
 * Concurrent tabs use last-writer-wins. Failed writes are never durability claims.
 */
export function createReadingPositionStore(
  storage: ReadingPositionStorage | undefined,
  now: () => number = Date.now,
) {
  let sessionDisabled = false;
  let suppressed = false;

  function time(): number | undefined {
    try {
      const value = now();
      return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    } catch { return undefined; }
  }

  function isEnabled(): boolean {
    if (!storage || sessionDisabled) return false;
    try {
      const flag: unknown = storage.getItem(READING_DISABLED_KEY);
      return flag === null || (typeof flag === "string" && flag !== "1");
    } catch { return false; }
  }

  function read(at: number): Position[] {
    if (!storage || suppressed) return [];
    const raw = storage.getItem(READING_POSITIONS_KEY);
    const entries = parse(raw, at);
    const serialized = JSON.stringify(entries);
    // Expired or corrupt records are removed on next use, not while a browser is closed.
    if (raw !== null && raw !== serialized) {
      try { storage.setItem(READING_POSITIONS_KEY, serialized); } catch {
        // A valid live record can still be read when pruning cannot be persisted.
      }
    }
    return entries;
  }

  function clear(): boolean {
    suppressed = true;
    if (!storage) return false;
    try { storage.removeItem(READING_POSITIONS_KEY); return true; } catch {
      try { storage.setItem(READING_POSITIONS_KEY, "[]"); return true; } catch { return false; }
    }
  }

  function setEnabled(enabled: boolean): boolean {
    if (!enabled) {
      sessionDisabled = true;
      let persisted = false;
      try { storage?.setItem(READING_DISABLED_KEY, "1"); persisted = storage !== undefined; } catch {
        // This instance stays disabled even if the browser refuses the preference.
      }
      return clear() && persisted;
    }
    // Enabling never releases the suppression established by clear/disable.
    if (!storage) return false;
    try { storage.removeItem(READING_DISABLED_KEY); } catch {
      try { storage.setItem(READING_DISABLED_KEY, "0"); } catch { return false; }
    }
    sessionDisabled = false;
    return isEnabled();
  }

  function load(contentId: string, locale: string, headingIds: ReadonlySet<string>): string | null {
    if (!isEnabled() || !text(contentId, 512) || !text(locale, 64)) return null;
    const at = time();
    if (at === undefined) return null;
    try {
      const entry = read(at).find((item) => item.contentId === contentId && item.locale === locale);
      // A not-yet-ready heading list must not destroy an otherwise valid record.
      return entry && headingIds.has(entry.headingId) ? entry.headingId : null;
    } catch { return null; }
  }

  function save(contentId: string, locale: string, chapter: ReadingChapter): boolean {
    if (!storage || !isEnabled() || !text(contentId, 512) || !text(locale, 64) ||
        !chapter || chapter.kind !== "heading" || !text(chapter.id, 512)) return false;
    const at = time();
    if (at === undefined) return false;
    try {
      const entries = read(at).filter((item) => item.contentId !== contentId || item.locale !== locale);
      entries.push({ contentId, locale, headingId: chapter.id, savedAt: at });
      storage.setItem(READING_POSITIONS_KEY, JSON.stringify(bounded(entries)));
      suppressed = false;
      return true;
    } catch { return false; }
  }

  return { isEnabled, load, save, clear, setEnabled };
}
