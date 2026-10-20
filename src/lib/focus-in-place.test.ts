import { afterEach, describe, expect, it, vi } from "vitest";
import { focusInPlace } from "./focus-in-place";

// Node has no layout, so the elements are minimal stand-ins exposing only what
// focusInPlace reads: boxes, client sizes, computed overflow and the parent chain.
type Box = { top: number; bottom: number; left: number; right: number };
type Fake = {
  parentElement: Fake | null;
  getBoundingClientRect(): Box;
  clientTop: number; clientLeft: number; clientHeight: number; clientWidth: number;
  overflow: string;
  focus: ReturnType<typeof vi.fn>;
};
function element(box: Box, parent: Fake | null, overflow = "visible", client?: { height: number; width: number }): Fake {
  return {
    parentElement: parent, getBoundingClientRect: () => box,
    clientTop: 0, clientLeft: 0, clientHeight: client?.height ?? box.bottom - box.top, clientWidth: client?.width ?? box.right - box.left,
    overflow, focus: vi.fn(),
  };
}
function setup(viewport = { width: 320, height: 568 }) {
  const html = element({ top: -1000, bottom: 9000, left: 0, right: 320 }, null, "visible");
  const body = element({ top: -1000, bottom: 9000, left: 0, right: 320 }, html, "visible");
  vi.stubGlobal("window", {
    innerHeight: viewport.height, innerWidth: viewport.width,
    getComputedStyle: (el: Fake) => ({ overflowX: el.overflow, overflowY: el.overflow }),
  });
  vi.stubGlobal("document", { body, documentElement: html });
  return { html, body };
}
afterEach(() => { vi.unstubAllGlobals(); });

const call = (el: Fake) => focusInPlace(el as unknown as HTMLElement);

describe("focusInPlace (AB#377)", () => {
  it("keeps the page still for a control already fully on screen", () => {
    const { body } = setup();
    const toggle = element({ top: 10, bottom: 46, left: 270, right: 306 }, body);
    call(toggle);
    expect(toggle.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("lets the browser scroll a control that is above or below the viewport", () => {
    const { body } = setup();
    for (const box of [{ top: -56, bottom: -20, left: 0, right: 36 }, { top: 560, bottom: 596, left: 0, right: 36 }]) {
      const toggle = element(box, body);
      call(toggle);
      expect(toggle.focus).toHaveBeenCalledWith(undefined);
    }
  });

  it("lets the browser scroll a control clipped by a scrolling ancestor inside the viewport", () => {
    const { body } = setup();
    const panel = element({ top: 126, bottom: 420, left: 0, right: 320 }, body, "auto");
    const submenu = element({ top: -119, bottom: -83, left: 0, right: 36 }, panel);
    call(submenu);
    expect(submenu.focus).toHaveBeenCalledWith(undefined);
    const behindHeader = element({ top: 60, bottom: 96, left: 0, right: 36 }, panel);
    call(behindHeader);
    expect(behindHeader.focus).toHaveBeenCalledWith(undefined);
  });

  it("ignores overflow on <html> and <body>, which the viewport check already covers", () => {
    const { body, html } = setup();
    body.overflow = "hidden";
    html.overflow = "clip";
    const toggle = element({ top: 10, bottom: 46, left: 0, right: 36 }, body);
    call(toggle);
    expect(toggle.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does nothing without an element", () => {
    setup();
    expect(() => focusInPlace(null)).not.toThrow();
    expect(() => focusInPlace(undefined)).not.toThrow();
  });
});
