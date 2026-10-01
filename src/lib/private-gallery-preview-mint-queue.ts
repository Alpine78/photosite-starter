/**
 * Per-proof-page admission for Stage 1 signed-preview URL requests.
 * The server's per-session rate and byte budget remain authoritative. This
 * smaller per-tab window keeps fast scrolling from spending all 60 allowed
 * mint attempts in one minute before other tabs or retries have room.
 */
export const PRIVATE_GALLERY_PREVIEW_MINT_MAX_IN_FLIGHT = 4;
export const PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE = 50;
const WINDOW_MS = 60_000;

type QueuedMint = {
  readonly signal: AbortSignal;
  readonly run: () => void;
};

export class PrivateGalleryPreviewMintQueue {
  private readonly waiting: QueuedMint[] = [];
  private readonly startedAt: number[] = [];
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  enqueue<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiting.indexOf(job);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        signal.removeEventListener("abort", onAbort);
        reject(new DOMException("Aborted", "AbortError"));
        this.pump();
      };
      const job: QueuedMint = {
        signal,
        run: () => {
          signal.removeEventListener("abort", onAbort);
          Promise.resolve().then(task).then(resolve, reject).finally(() => {
            this.active -= 1;
            this.pump();
          });
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const now = Date.now();
    while (this.startedAt.length > 0 && now - this.startedAt[0] >= WINDOW_MS) {
      this.startedAt.shift();
    }
    while (
      this.active < PRIVATE_GALLERY_PREVIEW_MINT_MAX_IN_FLIGHT &&
      this.startedAt.length < PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE &&
      this.waiting.length > 0
    ) {
      const job = this.waiting.shift()!;
      this.active += 1;
      this.startedAt.push(Date.now());
      job.run();
    }
    if (
      this.waiting.length > 0 &&
      this.active < PRIVATE_GALLERY_PREVIEW_MINT_MAX_IN_FLIGHT &&
      this.startedAt.length >= PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE
    ) {
      const delay = Math.max(1, this.startedAt[0] + WINDOW_MS - Date.now());
      this.timer = setTimeout(() => this.pump(), delay);
    }
  }
}
