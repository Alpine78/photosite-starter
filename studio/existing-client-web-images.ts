import { CLIENT_DELIVERY_MAX_ITEMS, isClientDeliveryAsset, type ClientDeliveryAsset } from "../sanity/schemas/client-delivery-gallery";
import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "../sanity/schemas/media";

export const EXISTING_IMAGE_PAGE_SIZE = 64;
export const EXISTING_IMAGE_LIMIT = 256;
const projection = `{_id, _type, sha1hash, extension, mimeType, _createdAt,
  "width": metadata.dimensions.width, "height": metadata.dimensions.height,
  "restricted": count(*[_type == "media" && image.asset._ref == ^._id && defined(privateOnly) && privateOnly != false]) > 0}`;
const existingImagesFilter = `*[_type == "sanity.imageAsset" &&
  metadata.dimensions.width > 0 && metadata.dimensions.width <= ${MAX_PUBLIC_DELIVERY_DIMENSION} &&
  metadata.dimensions.height > 0 && metadata.dimensions.height <= ${MAX_PUBLIC_DELIVERY_DIMENSION} &&
  extension in ${JSON.stringify(Object.keys(PUBLIC_DELIVERY_FORMATS))} &&
  count(*[_type == "media" && image.asset._ref == ^._id && defined(privateOnly) && privateOnly != false]) == 0`;
export const EXISTING_IMAGES_QUERY = `${existingImagesFilter}]
  | order(_createdAt desc, _id asc)[0...257]${projection}`;
export const EXISTING_IMAGES_BEFORE_QUERY = `${existingImagesFilter} && dateTime(_createdAt) < dateTime($before)]
  | order(dateTime(_createdAt) desc, _id asc)[0...257]${projection}`;
export const SELECTED_EXISTING_IMAGES_QUERY = `*[_id in $ids]${projection}`;
/** Native minute-resolution fields are interpreted as UTC, never machine local time. */
export function existingImageCutoff(value: string): string | undefined {
  if (value === "") return undefined;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) throw Error("invalid-cutoff");
  const canonical = `${value}:00.000Z`, time = Date.parse(canonical);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical) throw Error("invalid-cutoff");
  return canonical;
}
export type ExistingClientImage = ClientDeliveryAsset & Readonly<{ _createdAt: string }>;
export type NewClientItem = Readonly<{
  _key: string; _type: "clientDeliveryItem"; mediaType: "image";
  image: { _type: "image"; asset: { _type: "reference"; _ref: string } };
}>;
export type PickerError = "load" | "permission" | "changed" | "capacity" | "keys" | "cutoff";
export type ExistingImageState = Readonly<{
  phase: "closed" | "idle" | "loading" | "ready" | "adding" | "error";
  rows: readonly ExistingClientImage[]; selected: readonly string[]; visible: number;
  truncated: boolean; error?: PickerError; cutoff: string; badInput: boolean; selectionCleared: boolean;
}>;
export type ExistingImageScope = Readonly<{
  documentId: string; path: string; readOnly: boolean; value: unknown;
  append(items: readonly NewClientItem[]): void;
}>;
export type ExistingImageRequest = Readonly<{ query: string; ids?: readonly string[]; before?: string; signal: AbortSignal }>;
const closedState = (): ExistingImageState => ({ phase: "closed", rows: [], selected: [], visible: EXISTING_IMAGE_PAGE_SIZE, truncated: false, cutoff: "", badInput: false, selectionCleared: false });
const fields = ["_id", "_type", "sha1hash", "extension", "mimeType", "_createdAt", "width", "height", "restricted"];
const order = (a: ExistingClientImage, b: ExistingClientImage) => Date.parse(b._createdAt) - Date.parse(a._createdAt) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
function invalid(): never { throw Error("invalid-existing-image-response"); }
export function parseExistingClientImages(value: unknown, maximum: number, ordered = false): ExistingClientImage[] {
  if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length) invalid();
  const seen = new Set<string>();
  const rows = value.map(row => {
    if (!isClientDeliveryAsset(row) || Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))) invalid();
    const createdAt = (row as Record<string, unknown>)._createdAt;
    if (typeof createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) ||
      ![new Date(createdAt).toISOString(), new Date(createdAt).toISOString().replace(".000Z", "Z")].includes(createdAt) || seen.has(row._id)) invalid();
    seen.add(row._id); return row as ExistingClientImage;
  });
  if (ordered && rows.some((row, index) => index > 0 && order(rows[index - 1], row) >= 0)) invalid();
  return rows;
}
export function existingImageCapacity(value: unknown): number {
  return value === undefined ? CLIENT_DELIVERY_MAX_ITEMS : Array.isArray(value) ? Math.max(0, CLIENT_DELIVERY_MAX_ITEMS - value.length) : 0;
}
export function existingImageReferences(value: unknown): Set<string> {
  const refs = new Set<string>();
  if (Array.isArray(value)) for (const item of value) {
    const ref = item?.image?.asset?._ref; if (typeof ref === "string") refs.add(ref);
  }
  return refs;
}
export function makeExistingClientItems(ids: readonly string[], value: unknown, random: (bytes: Uint8Array<ArrayBuffer>) => void): NewClientItem[] {
  if (!ids.length || ids.length > EXISTING_IMAGE_LIMIT || new Set(ids).size !== ids.length || ids.length > existingImageCapacity(value)) throw Error("capacity");
  const keys = new Set<string>();
  if (Array.isArray(value)) for (const item of value) if (typeof item?._key === "string") keys.add(item._key);
  return ids.map(id => {
    let key = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const bytes = new Uint8Array(16); random(bytes); key = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      if (!keys.has(key)) break; key = "";
    }
    if (!key) throw Error("keys"); keys.add(key);
    return { _key: key, _type: "clientDeliveryItem", mediaType: "image", image: { _type: "image", asset: { _type: "reference", _ref: id } } };
  });
}

/** Thin native input binding supplies current scope; async behavior is independently testable. */
export type ExistingImageBinding = Readonly<{
  getScope(): ExistingImageScope;
  read(request: ExistingImageRequest): Promise<unknown>;
}>;
const unboundScope: ExistingImageScope = { documentId: "", path: "", readOnly: true, value: undefined, append() {} };
const unbound: ExistingImageBinding = { getScope: () => unboundScope, read: () => Promise.reject(Error("unbound")) };
export function createExistingImageController(options: Partial<ExistingImageBinding> & {
  random?(bytes: Uint8Array<ArrayBuffer>): void;
} = {}) {
  let state = closedState(), generation = 0, active: AbortController | undefined, scopeKey = "";
  // Latest committed binding; the input replaces it from a layout effect, never during render.
  let binding: ExistingImageBinding = { getScope: options.getScope ?? unbound.getScope, read: options.read ?? unbound.read };
  const getScope = () => binding.getScope(), read = (request: ExistingImageRequest) => binding.read(request);
  const listeners = new Set<() => void>();
  const emit = (next: ExistingImageState) => { state = next; for (const listener of listeners) listener(); };
  const keyOf = (scope: ExistingImageScope) => `${scope.documentId}\u0000${scope.path}`;
  const usable = (scope: ExistingImageScope) => Boolean(scope.documentId) && Boolean(scope.path) && !scope.readOnly && (scope.value === undefined || Array.isArray(scope.value));
  function current(token: number) {
    const scope = getScope();
    return token === generation && !active?.signal.aborted && usable(scope) && keyOf(scope) === scopeKey ? scope : undefined;
  }
  const random = options.random ?? (bytes => globalThis.crypto.getRandomValues(bytes));
  function close() { generation++; active?.abort(); active = undefined; scopeKey = ""; emit(closedState()); }
  function failure(error: unknown, fallback: PickerError) {
    const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    return status === 401 || status === 403 ? "permission" : fallback;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close,
    dispose() { generation++; active?.abort(); active = undefined; listeners.clear(); },
    bind(next: ExistingImageBinding) { binding = next; },
    scopeChanged() { if (state.phase !== "closed" && (!usable(getScope()) || keyOf(getScope()) !== scopeKey)) close(); },
    changeCutoff(value: string, badInput = false) {
      if (state.phase === "closed" || state.phase === "adding" || !current(generation)) return;
      const cutoff = value.slice(0, 17);
      if (cutoff === state.cutoff && badInput === state.badInput) return;
      generation++; active?.abort(); active = undefined;
      emit({ ...closedState(), phase: "idle", cutoff, badInput, selectionCleared: true });
    },
    async open() {
      const scope = getScope(); if (!usable(scope) || state.phase === "loading" || state.phase === "adding") return;
      const cutoff = state.cutoff, badInput = state.badInput;
      let before: string | undefined;
      try { if (badInput) throw Error("invalid-cutoff"); before = existingImageCutoff(cutoff); }
      catch { emit({ ...state, phase: "idle", error: "cutoff" }); return; }
      active?.abort(); active = new AbortController(); const signal = active.signal, token = ++generation; scopeKey = keyOf(scope);
      emit({ ...closedState(), phase: "loading", cutoff, badInput });
      try {
        const result = await read({ query: before ? EXISTING_IMAGES_BEFORE_QUERY : EXISTING_IMAGES_QUERY, ...(before ? { before } : {}), signal });
        if (!current(token)) return;
        const rows = parseExistingClientImages(result, EXISTING_IMAGE_LIMIT + 1, true);
        if (before && rows.some(row => Date.parse(row._createdAt) >= Date.parse(before))) invalid();
        emit({ ...closedState(), phase: "ready", cutoff, rows: rows.slice(0, EXISTING_IMAGE_LIMIT), truncated: rows.length > EXISTING_IMAGE_LIMIT });
      } catch (error) { if (current(token)) emit({ ...closedState(), phase: "error", cutoff, error: failure(error, "load") }); }
    },
    showMore() { if (state.phase === "ready" && current(generation)) emit({ ...state, visible: Math.min(state.rows.length, state.visible + EXISTING_IMAGE_PAGE_SIZE) }); },
    clear() { if (state.phase === "ready" && current(generation)) emit({ ...state, selected: [], error: undefined }); },
    toggle(id: string) {
      if (state.phase !== "ready" || !current(generation) || !state.rows.slice(0, state.visible).some(row => row._id === id)) return;
      emit({ ...state, error: undefined, selected: state.selected.includes(id) ? state.selected.filter(selected => selected !== id) : [...state.selected, id] });
    },
    async add() {
      if (state.phase !== "ready" || !state.selected.length) return;
      const start = current(generation); if (!start) return;
      if (state.selected.length > existingImageCapacity(start.value)) { emit({ ...state, error: "capacity" }); return; }
      const token = generation, selected = [...state.selected], displayed = new Map(state.rows.map(row => [row._id, row]));
      emit({ ...state, phase: "adding", error: undefined });
      try {
        const response = await read({ query: SELECTED_EXISTING_IMAGES_QUERY, ids: selected, signal: active!.signal });
        const latest = current(token); if (!latest) return;
        const fresh = parseExistingClientImages(response, selected.length);
        if (fresh.length !== selected.length || fresh.some(row => !selected.includes(row._id) || fields.some(field => row[field as keyof ExistingClientImage] !== displayed.get(row._id)?.[field as keyof ExistingClientImage]))) throw Error("changed");
        if (selected.length > existingImageCapacity(latest.value)) { emit({ ...state, phase: "ready", error: "capacity" }); return; }
        let items: NewClientItem[];
        try { items = makeExistingClientItems(selected, latest.value, random); }
        catch { emit({ ...state, phase: "ready", error: "keys" }); return; }
        // No await between this final current-scope check and the one native patch call.
        const final = current(token); if (!final) return;
        if (final.value !== latest.value) { emit({ ...state, phase: "ready", error: "changed" }); return; }
        final.append(items); close();
      } catch (error) { if (current(token)) emit({ ...state, phase: "ready", error: failure(error, "changed") }); }
    },
  };
}
