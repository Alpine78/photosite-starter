import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, studioTheme } from "@sanity/ui";
import { ProofPublishDialog } from "../proof-publish-dialog";
import { GalleryLinkDialog } from "../client-gallery-share-dialog";

export type FixtureOptions = {
  kind: "first" | "later" | "rotate" | "share" | "missing";
  locale: string; scheme: "light" | "dark"; clipboard: "copied" | "manual" | "pending";
};
const site = { origin: "https://photos.example", defaultLocale: "fi", locales: ["fi", "en"] };
// All values are synthetic. The injected fetcher never calls a network API.
let root: Root | undefined;
let reply: ((response: Response) => void) | undefined;
let finishCopy: (() => void) | undefined;
let options: FixtureOptions;
let stats = { requests: 0, copies: 0, copiedMatches: false, busy: false, closes: 0 };
export function state() { return { ...stats }; }
export function answer(kind: "success" | "unknown" | "rejected") {
  const body = kind === "success" ? options.kind === "rotate"
    ? { status: "key-rotated", selectionKey: "s".repeat(43) }
    : { status: "published", firstPublication: options.kind === "first", ...(options.kind === "first" ? { selectionKey: "s".repeat(43) } : {}) }
    : kind === "rejected" ? { status: "rejected", reason: "conflict" } : {};
  reply?.(Response.json(body, { status: kind === "rejected" ? 409 : 200 })); reply = undefined;
}
export function copyDone() { finishCopy?.(); finishCopy = undefined; }
export function mount(next: FixtureOptions) {
  root?.unmount(); options = next; reply = undefined; finishCopy = undefined;
  stats = { requests: 0, copies: 0, copiedMatches: false, busy: false, closes: 0 };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText(value: string) {
    stats.copies++;
    stats.copiedMatches = value === document.querySelector<HTMLInputElement>("input[readonly]")?.value;
    if (options.clipboard === "manual") return Promise.reject(new Error("Synthetic clipboard refusal"));
    return options.clipboard === "pending" ? new Promise<void>((resolve) => { finishCopy = resolve; }) : Promise.resolve();
  } } });
  root = createRoot(document.getElementById("fixture")!);
  const onClose = () => { stats.closes++; };
  const dialog = options.kind === "share" || options.kind === "missing"
    ? <GalleryLinkDialog handle={options.kind === "missing" ? undefined : "a".repeat(32)} site={site} locale={options.locale} onClose={onClose} />
    : <ProofPublishDialog request={options.kind === "rotate"
      ? { operation: "rotate-key", galleryId: "synthetic-proof", handle: "a".repeat(32) }
      : { operation: "publish", galleryId: "synthetic-proof", handle: "a".repeat(32), expectedDraftRevision: "synthetic-revision", firstPublication: options.kind === "first" }}
      site={site} locale={options.locale} readToken={() => "synthetic-test-marker"}
      fetcher={async () => { stats.requests++; return new Promise<Response>((resolve) => { reply = resolve; }); }}
      onBusy={(busy) => { stats.busy = busy; }} onClose={onClose} />;
  root.render(<ThemeProvider theme={studioTheme} scheme={options.scheme}>{dialog}</ThemeProvider>);
}
