"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { appendPrivateDraftRows, type PrivateDraftListRow, type PrivateDraftPage } from "@/lib/private-gallery-draft-list";

async function readPage<T extends PrivateDraftListRow>(path: string, signal: AbortSignal, cursor?: string): Promise<PrivateDraftPage<T>> {
  const response = await fetch(cursor === undefined ? path : path + "?cursor=" + encodeURIComponent(cursor),
    { signal, cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("unavailable");
  const data = await response.json() as { ok?: boolean } & PrivateDraftPage<T>;
  if (data.ok !== true || !Array.isArray(data.items) || data.items.length > 100 || typeof data.hasMore !== "boolean" ||
      (data.hasMore && (data.items.length === 0 || typeof data.nextCursor !== "string" || data.nextCursor.length === 0 || data.nextCursor.length > 256)) ||
      (!data.hasMore && data.nextCursor !== undefined) ||
      data.items.some((row) => !row || typeof row.handle !== "string" || !Number.isSafeInteger(row.revision) || row.revision < 0)) throw new Error("unavailable");
  return { items: data.items, hasMore: data.hasMore, ...(data.nextCursor === undefined ? {} : { nextCursor: data.nextCursor }) };
}

/** Reads are replaceable; acknowledged mutations always update local state. */
export function usePrivateGalleryDraftList<T extends PrivateDraftListRow>(apiPath: string) {
  const [list, setList] = useState<PrivateDraftPage<T>>();
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const listRef = useRef<PrivateDraftPage<T> | undefined>(undefined);
  const firstPageLoaded = useRef(false);
  // Completion is only known after an authoritative first page was read.
  const [firstPageReady, setFirstPageReady] = useState(false);
  const active = useRef(false);
  const epoch = useRef(0);
  const busy = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);

  const cancel = useCallback(() => {
    ++epoch.current; controller.current?.abort(); busy.current = false;
    if (active.current) setLoading(false);
  }, []);
  const load = useCallback(async (append: boolean, preserveAcknowledged = false) => {
    if (append && (busy.current || !listRef.current?.nextCursor)) return;
    if (!append) { ++epoch.current; controller.current?.abort(); }
    const version = ++epoch.current;
    const abort = new AbortController(); controller.current = abort; busy.current = true;
    setLoading(true); setListError(false);
    const cursor = append ? listRef.current!.nextCursor : undefined;
    try {
      const page = await readPage<T>(apiPath, abort.signal, cursor);
      if (!active.current || epoch.current !== version) return;
      const next = append || preserveAcknowledged
        ? { ...page, items: appendPrivateDraftRows(listRef.current?.items ?? [], page.items) } : page;
      if (!append) { firstPageLoaded.current = true; setFirstPageReady(true); }
      listRef.current = next; setList(next);
    } catch {
      if (active.current && epoch.current === version && !abort.signal.aborted) setListError(true);
    } finally {
      if (active.current && epoch.current === version) { busy.current = false; setLoading(false); }
    }
  }, [apiPath]);
  const refresh = useCallback(() => load(false), [load]);
  const loadMore = useCallback(() => load(true), [load]);
  const acknowledge = useCallback((row: T, prepend = false) => {
    cancel();
    if (!active.current) return;
    setListError(false);
    const old = listRef.current;
    const merged = appendPrivateDraftRows(old?.items ?? [], [row]);
    const items = prepend
      ? [merged.find((item) => item.handle === row.handle)!, ...merged.filter((item) => item.handle !== row.handle)]
      : merged;
    const next = { ...old, items, hasMore: old?.hasMore ?? false };
    listRef.current = next; setList(next);
    // Creating before the first successful read must not hide existing drafts.
    // A second acknowledgement restarts recovery while preserving both rows.
    if (!firstPageLoaded.current) void load(false, true);
  }, [cancel, load]);
  const stop = useCallback(() => {
    active.current = false; ++epoch.current; controller.current?.abort(); busy.current = false;
  }, []);
  useEffect(() => {
    active.current = true;
    // Defer subscription work; the epoch guard discards superseded reads.
    void Promise.resolve().then(() => { if (active.current) void refresh(); });
    return stop;
  }, [refresh, stop]);
  return { list, firstPageReady, loading, listError, refresh, loadMore, acknowledge, cancel };
}
