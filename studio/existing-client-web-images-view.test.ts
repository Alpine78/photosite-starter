import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, studioTheme } from "@sanity/ui";
import { describe, expect, it, vi } from "vitest";
import { ExistingClientWebImagesView, existingImageText } from "./existing-client-web-images-view";
import { existingImageViewFixture } from "../test-support/existing-client-web-images-fixture";
import { CLIENT_DELIVERY_MAX_ITEMS } from "../sanity/schemas/client-delivery-gallery";

type ViewProps = ReturnType<typeof existingImageViewFixture>;
/** The same UI theme provider Studio supplies around every input. */
const markup = (props: ViewProps) => renderToStaticMarkup(createElement(ThemeProvider, { theme: studioTheme }, createElement(ExistingClientWebImagesView, props)));

describe("actual native picker control semantics", () => {
  it.each(["fi-FI", "en-GB"])("renders %s labelled native controls, capacity and a single status", locale => {
    const props = existingImageViewFixture(locale), text = existingImageText(locale), html = markup(props);
    expect(html).toContain('type="checkbox"'); expect(html.match(/type="checkbox"/gu)).toHaveLength(2);
    expect(html).toContain(text.image(1, 2, props.state.rows[0])); expect(html).toContain(text.image(2, 2, props.state.rows[1]));
    expect(html).toContain('aria-expanded="true"'); expect(html).toContain(`aria-controls="${props.id}"`); expect(html.match(/role="status"/gu)).toHaveLength(1);
    expect(html).toContain(text.count(0, 256)); expect(html).toContain(text.notice.replaceAll("'", "&#x27;"));
    expect(html).not.toMatch(/type="submit"|onkeydown|never-project|image-000000/);
  });
  it("does not expose controls or trigger reads from a closed render", () => {
    const props = existingImageViewFixture("en", { phase: "closed" }), html = markup(props);
    expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('role="status"');
  });
  it.each(["load", "permission", "changed", "capacity", "keys", "cutoff"] as const)("renders fixed %s feedback and native retry", error => {
    const props = existingImageViewFixture("fi", { phase: "error", error }), html = markup(props);
    expect(html).toContain('role="alert"'); expect(html).toContain(existingImageText("fi").errors[error]); expect(html).toContain(existingImageText("fi").retry);
  });
  it("renders empty/loading/busy/selected order and already-used feedback", () => {
    const empty = existingImageViewFixture("en", { rows: [] }); expect(markup(empty)).toContain(existingImageText("en").empty);
    const loading = existingImageViewFixture("fi", { phase: "loading" }); expect(markup(loading)).toContain(existingImageText("fi").loading);
    const selected = existingImageViewFixture("en"); selected.state = { ...selected.state, selected: [selected.state.rows[1]._id, selected.state.rows[0]._id] };
    selected.value = [{ image: { asset: { _ref: selected.state.rows[0]._id } } }]; const html = markup(selected);
    expect(html).toContain(existingImageText("en").order(2)); expect(html).toContain(existingImageText("en").used);
  });
  it("keeps actual readOnly controls disabled and uses a bounded older-assets notice", () => {
    const props = existingImageViewFixture("en", { truncated: true }); props.readOnly = true;
    const html = markup(props);
    expect(html.match(/<input[^>]*\bdisabled=""[^>]*type="checkbox"/gu)).toHaveLength(2); expect(html).toContain(existingImageText("en").limited);
    expect(html).not.toContain("private-provider");
  });
});


describe("picker focus anchors across state changes", () => {
  type ButtonProps = { children?: ReactNode; text?: ReactNode; disabled?: boolean; "aria-disabled"?: boolean; onClick?: () => void };
  function control(props: ReturnType<typeof existingImageViewFixture>, label: string) {
    function find(node: ReactNode, path: number[] = []): { path: number[]; props: ButtonProps } | undefined {
      if (!isValidElement<ButtonProps>(node)) return;
      if (node.props.text === label) return { path, props: node.props };
      for (const [index, child] of (Array.isArray(node.props.children) ? node.props.children : [node.props.children]).entries()) {
        const found = find(child, [...path, index]); if (found) return found;
      }
    }
    const found = find(ExistingClientWebImagesView(props)); expect(found).toBeDefined(); return found!;
  }
  it("retains the retry focus anchor through loading and success without repeating its action", () => {
    const props = existingImageViewFixture("en", { phase: "error", error: "load" }), retry = vi.fn(); props.onRetry = retry;
    const label = existingImageText("en").retry, before = control(props, label);
    before.props.onClick?.(); expect(retry).toHaveBeenCalledOnce();
    for (const phase of ["loading", "ready"] as const) {
      const next = control({ ...props, state: { ...props.state, phase, error: undefined } }, label);
      expect(next.path).toEqual(before.path); expect(next.props.disabled).not.toBe(true); expect(next.props["aria-disabled"]).toBe(true);
      next.props.onClick?.(); expect(retry).toHaveBeenCalledOnce();
    }
  });
  it("retains the Clear focus anchor when the selection empties or the picker is busy/readOnly", () => {
    const props = existingImageViewFixture("en"), clear = vi.fn(); props.onClear = clear;
    props.state = { ...props.state, selected: [props.state.rows[0]._id] };
    const label = existingImageText("en").clear, before = control(props, label);
    expect(before.props["aria-disabled"]).not.toBe(true); before.props.onClick?.(); expect(clear).toHaveBeenCalledOnce();
    for (const next of [
      { ...props, state: { ...props.state, selected: [] } },
      { ...props, state: { ...props.state, phase: "adding" as const } },
      { ...props, readOnly: true },
    ]) {
      const found = control(next, label);
      expect(found.path).toEqual(before.path); expect(found.props.disabled).not.toBe(true); expect(found.props["aria-disabled"]).toBe(true);
      found.props.onClick?.(); expect(clear).toHaveBeenCalledOnce();
    }
  });
  it("retains the Add focus anchor through adding, error, capacity and readOnly without repeating its action", () => {
    const props = existingImageViewFixture("fi"), add = vi.fn(); props.onAdd = add;
    props.state = { ...props.state, selected: props.state.rows.map(row => row._id) };
    const label = existingImageText("fi").add, before = control(props, label);
    expect(before.props["aria-disabled"]).not.toBe(true); before.props.onClick?.(); expect(add).toHaveBeenCalledOnce();
    const full = Array.from({ length: CLIENT_DELIVERY_MAX_ITEMS }, (_, i) => ({ image: { asset: { _ref: `image-used-${i}` } } }));
    for (const next of [
      { ...props, state: { ...props.state, phase: "adding" as const } },
      { ...props, value: full },
      { ...props, readOnly: true },
    ]) {
      const found = control(next, label);
      expect(found.path).toEqual(before.path); expect(found.props.disabled).not.toBe(true); expect(found.props["aria-disabled"]).toBe(true);
      found.props.onClick?.(); expect(add).toHaveBeenCalledOnce();
    }
    // A failed Add returns to the ready phase with feedback; the same anchor stays enabled for a deliberate retry,
    // and the controller rechecks the selection against fresh data on each call.
    for (const error of ["changed", "capacity", "keys"] as const) {
      const found = control({ ...props, state: { ...props.state, phase: "ready", error } }, label);
      expect(found.path).toEqual(before.path); expect(found.props.disabled).not.toBe(true); expect(found.props["aria-disabled"]).toBe(false);
    }
    const retry = control({ ...props, state: { ...props.state, phase: "ready", error: "changed" } }, label);
    retry.props.onClick?.(); expect(add).toHaveBeenCalledTimes(2);
  });
  it("retains the final-page focus anchor and refuses more actions when exhausted or readOnly", () => {
    const props = existingImageViewFixture("fi", { visible: 1 }), more = vi.fn(); props.onMore = more;
    const label = existingImageText("fi").more, before = control(props, label);
    before.props.onClick?.(); expect(more).toHaveBeenCalledOnce();
    for (const nextProps of [{ ...props, state: { ...props.state, visible: 2 } }, { ...props, readOnly: true }]) {
      const next = control(nextProps, label);
      expect(next.path).toEqual(before.path); expect(next.props.disabled).not.toBe(true); expect(next.props["aria-disabled"]).toBe(true);
      next.props.onClick?.(); expect(more).toHaveBeenCalledOnce();
    }
  });
});


describe("native UTC cutoff binding", () => {
  type ElementProps = { children?: ReactNode; text?: ReactNode; ref?: { current: unknown }; onClick?: () => void; onChange?: (event: unknown) => void; readOnly?: boolean; value?: string; defaultValue?: string; "aria-invalid"?: boolean };
  function elements(node: ReactNode): { type: unknown; props: ElementProps }[] {
    if (!isValidElement<ElementProps>(node)) return [];
    return [{ type: node.type, props: node.props }, ...(Array.isArray(node.props.children) ? node.props.children : [node.props.children]).flatMap(elements)];
  }
  it.each(["fi-FI", "en-GB"])("labels %s UTC input, actual effective filter, cleared/error and filtered empty states", locale => {
    const text = existingImageText(locale), props = existingImageViewFixture(locale, { cutoff: "2025-03-01T12:30", rows: [] });
    const html = markup(props);
    expect(html).toContain('type="datetime-local"'); expect(html).toContain(text.cutoff); expect(html).toContain(text.cutoffHelp);
    expect(html).toContain(text.before(props.state.cutoff)); expect(html).toContain(text.emptyBefore);
    const idle = markup({ ...props, state: { ...props.state, phase: "idle", error: "cutoff", badInput: true, selectionCleared: true } });
    expect(idle).toContain('aria-invalid="true"'); expect(idle).toContain(text.errors.cutoff); expect(idle).toContain(text.cleared); expect(idle).not.toContain(text.emptyBefore);
  });
  it("keeps partial native fields uncontrolled, checks actual badInput again on Search and preserves focus while adding", () => {
    const props = existingImageViewFixture("en"), change = vi.fn(), search = vi.fn(); props.onCutoffChange = change; props.onSearch = search;
    const all = elements(ExistingClientWebImagesView(props)), input = all.find(x => x.props.defaultValue !== undefined)!.props;
    expect(input).not.toHaveProperty("value"); expect(input.readOnly).toBe(false);
    const native = { value: "", validity: { badInput: true } }; input.ref!.current = native;
    input.onChange?.({ currentTarget: native }); expect(change).toHaveBeenLastCalledWith("", true);
    const button = all.find(x => x.props.text === existingImageText("en").search)!.props;
    button.onClick?.(); expect(change).toHaveBeenLastCalledWith("", true); expect(search).toHaveBeenCalledOnce();
    const pending = elements(ExistingClientWebImagesView({ ...props, state: { ...props.state, phase: "adding" } }));
    const locked = pending.find(x => x.props.defaultValue !== undefined)!.props;
    expect(locked.readOnly).toBe(true); expect(locked).not.toHaveProperty("disabled");
    pending.find(x => x.props.text === existingImageText("en").search)!.props.onClick?.(); expect(search).toHaveBeenCalledOnce();
  });
});
