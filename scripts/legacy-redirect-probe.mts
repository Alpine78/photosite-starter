/** AB#224: anonymous legacy HTTP probe; one total deadline and fixed errors. */
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const FAILURE = "legacy-probe-failed";

/** Cleanup must not extend the deadline, even for an injected stalled stream. */
function observeCleanup(cancel: () => Promise<void> | undefined): void {
  try { void cancel()?.catch(() => {}); } catch { /* cleanup cannot replace the result */ }
}

export async function probeLegacyRedirect(
  url: string,
  readHtml = false,
  options: { readonly fetchImplementation?: typeof fetch; readonly timeoutMs?: number; readonly maxBytes?: number } = {},
) {
  const controller = new AbortController();
  let finished = false;
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(FAILURE)); }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  });
  void deadline.catch(() => {});
  try {
    const pending = Promise.resolve().then(() => (options.fetchImplementation ?? fetch)(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "text/html" },
    })).then((saved) => {
      if (finished) observeCleanup(() => saved.body?.cancel());
      return saved;
    });
    response = await Promise.race([pending, deadline]);
    let html = "";
    if (readHtml && response.status === 200 && response.body) {
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      while (true) {
        const { done, value } = await Promise.race([reader.read(), deadline]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > (options.maxBytes ?? MAX_HTML_BYTES)) throw new Error(FAILURE);
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    }
    return {
      status: response.status,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type"),
      html,
    };
  } catch {
    throw new Error(FAILURE);
  } finally {
    finished = true;
    clearTimeout(timer!);
    controller.abort();
    if (reader) {
      const savedReader = reader;
      observeCleanup(() => savedReader.cancel());
      try { savedReader.releaseLock(); } catch { /* pending IO is already observed by the race */ }
    } else if (response) {
      const savedResponse = response;
      observeCleanup(() => savedResponse.body?.cancel());
    }
  }
}
