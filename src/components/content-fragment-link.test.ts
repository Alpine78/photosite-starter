import { createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordContentFragmentNavigation } from "./content-fragment-link";
import { ContentPageJumpNav } from "./content-page-jump-nav";

function activation(overrides: Record<string, unknown> = {}) {
  return { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    currentTarget: { hash: "#next", href: "https://fixture.test/story?raw=a%2fb+word#next" }, preventDefault: vi.fn(), ...overrides } as unknown as MouseEvent<HTMLAnchorElement>;
}
afterEach(() => vi.unstubAllGlobals());

describe("same-document fragment history registration", () => {
  it("passes the exact browser-resolved address and existing state through opaquely", () => {
    const state = Object.freeze({ arbitraryOwnerValue: { preserved: true } }), pushState = vi.fn();
    vi.stubGlobal("window", { location: { hash: "#initial" }, history: { state, pushState } });
    const event = activation(); recordContentFragmentNavigation(event);
    expect(pushState).toHaveBeenCalledExactlyOnceWith(state, "", event.currentTarget.href);
    expect(pushState.mock.calls[0][0]).toBe(state);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it.each([{ defaultPrevented: true }, { button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])("leaves modified or already-handled activation untouched: %j", fields => {
    const pushState = vi.fn(); vi.stubGlobal("window", { location: { hash: "#initial" }, history: { state: null, pushState } });
    const event = activation(fields); recordContentFragmentNavigation(event);
    expect(pushState).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("does not add an entry for the current hash", () => {
    const pushState = vi.fn(); vi.stubGlobal("window", { location: { hash: "#next" }, history: { state: null, pushState } });
    recordContentFragmentNavigation(activation()); expect(pushState).not.toHaveBeenCalled();
  });
  it("keeps default navigation available when the History API throws", () => {
    vi.stubGlobal("window", { location: { hash: "#initial" }, history: { state: null, pushState: () => { throw new Error("unavailable"); } } });
    const event = activation(); expect(() => recordContentFragmentNavigation(event)).not.toThrow();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("renders a plain usable fragment anchor without a browser", () => {
    vi.stubGlobal("window", undefined);
    expect(() => recordContentFragmentNavigation(activation())).not.toThrow();
    const html = renderToStaticMarkup(createElement(ContentPageJumpNav, {
      label: "Contents", headings: [{ id: "authored", text: "Authored chapter", level: 2 }],
    }));
    expect(html).toMatch(/<a href="#authored" class="[^"]*focus-visible:outline[^"]*">Authored chapter<\/a>/);
  });
});
