import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../../public/private-gallery-bootstrap.js", import.meta.url),
  "utf8",
);
const capability = "synthetic-capability";
const base = "https://fixture.invalid/private/synthetic-handle?return=1";

function harness({
  loading = true,
  statusPresent = false,
  historyBlocked = false,
  initialCapability = capability,
}: {
  loading?: boolean;
  statusPresent?: boolean;
  historyBlocked?: boolean;
  initialCapability?: string;
} = {}) {
  let url = new URL(initialCapability ? `${base}#${initialCapability}` : base);
  const windowEvents = new Map<string, (event?: { persisted: boolean }) => void>();
  const documentEvents = new Map<string, () => void>();
  const attributes = { "data-invalid": "invalid", "data-connected": "connected" };
  let status = {
    textContent: "opening",
    getAttribute: (name: string) => attributes[name as keyof typeof attributes],
  };
  let present = statusPresent;
  const state = { marker: "preserve-this-state" };
  const history = {
    state,
    replaceState: vi.fn((nextState: typeof state, _title: string, path: string) => {
      if (historyBlocked) throw new Error("history blocked");
      history.state = nextState;
      url = new URL(path, url);
    }),
  };
  const location = {
    get hash() { return url.hash; },
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    replace: vi.fn(),
  };
  let finish!: (response: { ok: boolean }) => void;
  const fetch = vi.fn<(path: string, options: RequestInit) => Promise<{ ok: boolean }>>(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  const document = {
    readyState: loading ? "loading" : "complete",
    getElementById: (id: string) => id === "private-gallery-status" && present ? status : null,
    addEventListener: (name: string, handler: () => void) => documentEvents.set(name, handler),
  };
  runInNewContext(source, {
    window: { history, location, addEventListener: (name: string, handler: () => void) => windowEvents.set(name, handler) },
    document,
    fetch,
  });
  return {
    history, location, fetch, state,
    get url() { return url; },
    get status() { return status; },
    ready(withStatus = true) {
      present = withStatus;
      document.readyState = "complete";
      documentEvents.get("DOMContentLoaded")?.();
    },
    changeHash(value: string) { url.hash = value; },
    event(name: string, persisted = true) { windowEvents.get(name)?.({ persisted }); },
    replaceStatus() {
      status = { ...status, textContent: "replacement" };
    },
    async respond(ok: boolean) {
      finish({ ok });
      // Drain this local promise chain, including finally, without timers or IO.
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

describe("private-gallery bootstrap startup", () => {
  it("scrubs before markup exists and preserves history state before the router reads the URL", () => {
    const h = harness();
    expect(h.url.href).toBe(base);
    expect(h.history.state).toBe(h.state);
    expect(h.history.replaceState).toHaveBeenCalledWith(h.state, "", "/private/synthetic-handle?return=1");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(h.history.state)).not.toContain(capability);
  });

  it("retains one capture across duplicate empty events until the bootstrap markup is ready", () => {
    const h = harness();
    h.event("popstate");
    h.event("hashchange");
    h.ready();
    h.ready();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [path, options] = h.fetch.mock.calls[0];
    expect(path).toBe("/private/synthetic-handle/exchange");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(options.body as string)).toEqual({ capability });
    expect(h.url.hash).toBe("");
  });

  it.each([true, false])("does not exchange on an authorized document (historyBlocked=%s)", (historyBlocked) => {
    const h = harness({ historyBlocked });
    h.ready(false);
    h.event("pageshow");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.url.hash).toBe(historyBlocked ? `#${capability}` : "");
  });

  it("uses the newest fragment at DOM readiness even before its event is dispatched", () => {
    const h = harness();
    h.changeHash("newer-synthetic-capability");
    h.ready();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.fetch.mock.calls)).toContain("newer-synthetic-capability");
    expect(h.url.hash).toBe("");
  });

  it("processes already parsed bootstrap markup without waiting for another ready event", () => {
    const h = harness({ loading: false, statusPresent: true });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.url.hash).toBe("");
  });

  it("scrubs and drops new captures during one in-flight exchange", () => {
    const h = harness();
    h.ready();
    h.changeHash("another-synthetic-capability");
    h.event("hashchange");
    h.event("popstate");
    expect(h.url.hash).toBe("");
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("updates a replaced status node and keeps success terminal through duplicate events", async () => {
    const h = harness();
    h.ready();
    h.replaceStatus();
    await h.respond(true);
    h.event("popstate");
    h.event("hashchange");
    expect(h.status.textContent).toBe("connected");
    expect(h.location.replace).toHaveBeenCalledWith("/private/synthetic-handle?return=1");
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("allows a deliberate new capture after a generic refusal", async () => {
    const h = harness();
    h.ready();
    await h.respond(false);
    h.event("popstate");
    expect(h.status.textContent).toBe("invalid");
    h.changeHash("retry-synthetic-capability");
    h.event("hashchange");
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not re-exchange an unsrubbable fragment through readiness and traversal events", async () => {
    const h = harness({ historyBlocked: true });
    h.event("hashchange");
    h.ready();
    await h.respond(false);
    h.event("popstate");
    h.event("pageshow");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.status.textContent).toBe("invalid");
    expect(h.url.hash).toBe(`#${capability}`);
  });

  it("scrubs a restored authorized entry without starting a POST", () => {
    const h = harness();
    h.ready(false);
    h.changeHash(capability);
    h.event("pageshow", false);
    expect(h.url.hash).toBe(`#${capability}`);
    h.event("pageshow", true);
    expect(h.url.hash).toBe("");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("shows generic invalid state for an initially empty link once markup is ready", () => {
    const h = harness({ initialCapability: "" });
    h.event("popstate");
    h.ready();
    h.event("hashchange");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.status.textContent).toBe("invalid");
  });
});
