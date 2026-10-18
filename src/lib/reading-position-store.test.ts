// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createReadingPositionStore,
  READING_DISABLED_KEY as DISABLED,
  READING_PAYLOAD_LIMIT,
  READING_POSITIONS_KEY as POSITIONS,
  READING_RETENTION_MS as RETENTION,
  type ReadingPositionStorage,
} from "./reading-position-store";
import type { ReadingChapter } from "./content-reading-address";

const NOW = RETENTION * 2;
const chapter = { kind: "heading", id: "chapter-four" } as const;
const headings = new Set([chapter.id]);
const entry = (overrides: Record<string, unknown> = {}) =>
  ({ contentId: "article", locale: "fi", headingId: chapter.id, savedAt: NOW, ...overrides });

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const calls: { method: string; key: string; value?: string }[] = [];
  const fail = { get: false, set: false, remove: false };
  const port: ReadingPositionStorage = {
    getItem(key) {
      calls.push({ method: "get", key });
      if (fail.get) throw new Error("denied");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      calls.push({ method: "set", key, value });
      if (fail.set) throw new Error("quota");
      values.set(key, value);
    },
    removeItem(key) {
      calls.push({ method: "remove", key });
      if (fail.remove) throw new Error("denied");
      values.delete(key);
    },
  };
  return { values, calls, fail, port, store: createReadingPositionStore(port, () => NOW) };
}

describe("browser-local reading-position foundation", () => {
  it("stores precisely the four allowed fields and works across instances", () => {
    const m = memory();
    expect(m.store.save("article", "fi", { ...chapter, title: "private", url: "/secret" } as ReadingChapter)).toBe(true);
    expect(JSON.parse(m.values.get(POSITIONS)!)).toEqual([entry()]);
    expect(createReadingPositionStore(m.port, () => NOW).load("article", "fi", headings)).toBe(chapter.id);
    expect(m.values.has(DISABLED)).toBe(false);
  });

  it("keys by stable article identity and locale, not URL or title", () => {
    const m = memory();
    m.store.save("article", "fi", chapter);
    m.store.save("article", "en-GB", { kind: "heading", id: "english" });
    m.store.save("other", "fi", { kind: "heading", id: "other" });
    expect(m.store.load("article", "fi", headings)).toBe(chapter.id);
    expect(m.store.load("article", "en-GB", new Set(["english"]))).toBe("english");
    expect(m.store.load("missing", "fi", headings)).toBeNull();
    m.store.save("article", "fi", { kind: "heading", id: "updated" });
    expect(JSON.parse(m.values.get(POSITIONS)!)).toHaveLength(3);
  });

  it("does not destroy a saved position when headings are absent or have changed", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry()]) });
    expect(m.store.load("article", "fi", new Set())).toBeNull();
    expect(m.store.load("article", "fi", new Set(["renamed"]))).toBeNull();
    expect(m.store.load("article", "fi", headings)).toBe(chapter.id);
    expect(m.calls.filter((c) => c.method !== "get")).toEqual([]);
  });

  it.each(["intro", "outside", "invalid"] as const)("does not write a %s chapter", (kind) => {
    const m = memory();
    expect(m.store.save("article", "fi", { kind })).toBe(false);
    expect(m.calls.filter((c) => c.method !== "get")).toEqual([]);
  });

  it.each(["", " ", "a".repeat(513)])("rejects invalid article identity %j", (id) => {
    const m = memory();
    expect(m.store.save(id, "fi", chapter)).toBe(false);
    expect(m.values.size).toBe(0);
  });

  it("rejects invalid locales, chapters and runtime non-heading values", () => {
    const m = memory();
    for (const locale of ["", " ", "a".repeat(65)]) expect(m.store.save("article", locale, chapter)).toBe(false);
    for (const id of ["", " ", "a".repeat(513)]) expect(m.store.save("article", "fi", { kind: "heading", id })).toBe(false);
    expect(m.store.save("article", "fi", null as unknown as ReadingChapter)).toBe(false);
    expect(m.store.save("article", "fi", { kind: "heading", id: 1 } as unknown as ReadingChapter)).toBe(false);
    expect(m.values.size).toBe(0);
  });

  it.each([
    [RETENTION - 1, true], [RETENTION, false], [RETENTION + 1, false], [-1, false],
  ])("applies exact 90-day retention at age %d", (age, valid) => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry({ savedAt: NOW - age })]) });
    expect(m.store.load("article", "fi", headings)).toBe(valid ? chapter.id : null);
    expect(JSON.parse(m.values.get(POSITIONS)!)).toEqual(valid ? [entry({ savedAt: NOW - age })] : []);
  });

  it("prunes only malformed, expired and future records while retaining other valid entries", () => {
    const candidates = [entry(), entry({ contentId: "extra", url: "/not-allowed" }),
      entry({ contentId: "old", savedAt: NOW - RETENTION }), entry({ contentId: "future", savedAt: NOW + 1 }),
      entry({ contentId: "negative", savedAt: -1 }), entry({ contentId: "float", savedAt: NOW - 0.5 }),
      entry({ contentId: "empty", headingId: "" }), entry({ contentId: "oversize", locale: "a".repeat(65) }),
      null, [], "not an entry", JSON.parse('{"__proto__":{},"contentId":"bad","locale":"fi","headingId":"x","savedAt":0}')];
    const m = memory({ [POSITIONS]: JSON.stringify(candidates) });
    expect(m.store.load("article", "fi", headings)).toBe(chapter.id);
    expect(JSON.parse(m.values.get(POSITIONS)!)).toEqual([entry()]);
  });

  it.each(["{", "null", "{}", '"string"', " ".repeat(READING_PAYLOAD_LIMIT + 1)])(
    "recovers from malformed or oversized input case %#", (raw) => {
      const m = memory({ [POSITIONS]: raw });
      expect(m.store.load("article", "fi", headings)).toBeNull();
      expect(m.store.save("article", "fi", chapter)).toBe(true);
      expect(JSON.parse(m.values.get(POSITIONS)!)).toEqual([entry()]);
    },
  );

  it("deduplicates by newest timestamp with a deterministic code-unit tie break", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([
      entry({ headingId: "z", savedAt: NOW - 1 }), entry({ headingId: "a" }), entry({ headingId: "b" }),
    ]) });
    expect(m.store.load("article", "fi", new Set(["a", "b", "z"]))).toBe("b");
    expect(JSON.parse(m.values.get(POSITIONS)!)).toEqual([entry({ headingId: "b" })]);
  });

  it("keeps the newest 100 entries on read and evicts the oldest on save", () => {
    let time = NOW;
    const m = memory({ [POSITIONS]: JSON.stringify(Array.from({ length: 101 }, (_, i) =>
      entry({ contentId: `article-${i}`, savedAt: NOW - 101 + i }))) });
    const store = createReadingPositionStore(m.port, () => time);
    expect(store.load("article-0", "fi", headings)).toBeNull();
    expect(JSON.parse(m.values.get(POSITIONS)!)).toHaveLength(100);
    time++;
    expect(store.save("newest", "fi", chapter)).toBe(true);
    expect(store.load("article-1", "fi", headings)).toBeNull();
    expect(JSON.parse(m.values.get(POSITIONS)!)).toHaveLength(100);
    expect(store.load("newest", "fi", headings)).toBe(chapter.id);
  });

  it("bounds the serialized output including escaped control characters", () => {
    const m = memory();
    for (let i = 0; i < 100; i++) {
      expect(m.store.save(`${i}:${"\u0001".repeat(500)}`, "fi", { kind: "heading", id: "\u0002".repeat(512) })).toBe(true);
    }
    const raw = m.values.get(POSITIONS)!;
    expect(raw.length).toBeLessThanOrEqual(READING_PAYLOAD_LIMIT);
    expect(JSON.parse(raw).length).toBeGreaterThan(0);
    expect(JSON.parse(raw).length).toBeLessThan(100);
    const reopened = createReadingPositionStore(m.port, () => NOW);
    expect(reopened.load(`99:${"\u0001".repeat(500)}`, "fi", new Set(["\u0002".repeat(512)]))).toBe("\u0002".repeat(512));
  });

  it("clears only its positions and preserves unrelated storage and the preference", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry()]), [DISABLED]: "0", theme: "dark" });
    expect(m.store.clear()).toBe(true);
    expect(m.values).toEqual(new Map([[DISABLED, "0"], ["theme", "dark"]]));
    expect(m.store.load("article", "fi", headings)).toBeNull();
  });

  it("persists disable, clears positions, and enables without resurrecting them", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry()]) });
    expect(m.store.setEnabled(false)).toBe(true);
    expect(m.values.get(DISABLED)).toBe("1");
    expect(m.store.isEnabled()).toBe(false);
    expect(createReadingPositionStore(m.port, () => NOW).isEnabled()).toBe(false);
    expect(m.store.save("article", "fi", chapter)).toBe(false);
    expect(m.store.setEnabled(true)).toBe(true);
    expect(m.store.isEnabled()).toBe(true);
    expect(m.store.load("article", "fi", headings)).toBeNull();
    expect(m.store.save("article", "fi", chapter)).toBe(true);
  });

  it("observes another instance's persisted disable flag on every operation", () => {
    const m = memory();
    const other = createReadingPositionStore(m.port, () => NOW);
    other.setEnabled(false);
    expect(m.store.isEnabled()).toBe(false);
    expect(m.store.save("article", "fi", chapter)).toBe(false);
    other.setEnabled(true);
    expect(m.store.isEnabled()).toBe(true);
  });

  it("treats non-1 string preferences as enabled", () => {
    const m = memory({ [DISABLED]: "old-unknown-value" });
    expect(m.store.isEnabled()).toBe(true);
  });

  it("uses an empty-array fallback when removal is denied, including for a new instance", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry()]) });
    m.fail.remove = true;
    expect(m.store.clear()).toBe(true);
    expect(m.values.get(POSITIONS)).toBe("[]");
    expect(createReadingPositionStore(m.port, () => NOW).load("article", "fi", headings)).toBeNull();
    expect(m.store.setEnabled(false)).toBe(true);
    expect(m.store.setEnabled(true)).toBe(true);
    expect(m.values.get(DISABLED)).toBe("0");
  });

  it("suppresses stale records after failed clear and overwrites from empty on the next successful save", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry()]) });
    m.fail.remove = m.fail.set = true;
    expect(m.store.clear()).toBe(false);
    expect(m.store.load("article", "fi", headings)).toBeNull();
    // If every mutation is denied, a new instance can still see the old bytes.
    expect(createReadingPositionStore(m.port, () => NOW).load("article", "fi", headings)).toBe(chapter.id);
    m.fail.remove = m.fail.set = false;
    expect(m.store.setEnabled(true)).toBe(true);
    expect(m.store.load("article", "fi", headings)).toBeNull();
    expect(m.store.save("new", "fi", chapter)).toBe(true);
    expect(JSON.parse(m.values.get(POSITIONS)!)).toEqual([entry({ contentId: "new" })]);
  });

  it("keeps session disable after all preference writes fail and failed enabling", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry()]) });
    m.fail.set = m.fail.remove = true;
    expect(m.store.setEnabled(false)).toBe(false);
    expect(m.store.isEnabled()).toBe(false);
    expect(m.store.setEnabled(true)).toBe(false);
    expect(m.store.isEnabled()).toBe(false);
    m.fail.set = m.fail.remove = false;
    expect(m.store.setEnabled(true)).toBe(true);
    expect(m.store.load("article", "fi", headings)).toBeNull();
  });

  it("reads a valid position even when persistence of unrelated pruning fails", () => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry(), entry({ contentId: "expired", savedAt: 0 })]) });
    m.fail.set = true;
    expect(m.store.load("article", "fi", headings)).toBe(chapter.id);
    expect(m.store.save("new", "fi", chapter)).toBe(false);
  });

  it("handles unavailable, denied and contract-invalid storage without escaping exceptions", () => {
    const absent = createReadingPositionStore(undefined, () => NOW);
    expect(absent.isEnabled()).toBe(false);
    expect(absent.load("article", "fi", headings)).toBeNull();
    expect(absent.save("article", "fi", chapter)).toBe(false);
    expect(absent.clear()).toBe(false);
    expect(absent.setEnabled(false)).toBe(false);
    expect(absent.setEnabled(true)).toBe(false);
    const m = memory();
    m.fail.get = true;
    expect(m.store.isEnabled()).toBe(false);
    expect(m.store.load("article", "fi", headings)).toBeNull();
    expect(m.store.save("article", "fi", chapter)).toBe(false);
    const invalid = createReadingPositionStore({ ...m.port, getItem: () => 7 as unknown as string }, () => NOW);
    expect(invalid.isEnabled()).toBe(false);
    const malformed = createReadingPositionStore({ ...m.port, getItem: (key) => key === DISABLED ? null : 7 as unknown as string }, () => NOW);
    expect(malformed.load("article", "fi", headings)).toBeNull();
  });

  it.each([() => NaN, () => Infinity, () => -1, () => 0.5, () => Number.MAX_SAFE_INTEGER + 1,
    () => { throw new Error("clock"); }])("fails safely for invalid clock %#", (clock) => {
    const m = memory({ [POSITIONS]: JSON.stringify([entry()]) });
    const store = createReadingPositionStore(m.port, clock);
    expect(store.load("article", "fi", headings)).toBeNull();
    expect(store.save("article", "fi", chapter)).toBe(false);
    expect(m.calls.filter((c) => c.method !== "get")).toEqual([]);
  });
});
