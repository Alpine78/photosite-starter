import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExistingClientWebImagesView, existingImageText } from "./existing-client-web-images-view";
import { existingImageViewFixture } from "../test-support/existing-client-web-images-fixture";
import { CLIENT_DELIVERY_MAX_ITEMS } from "../sanity/schemas/client-delivery-gallery";

describe("actual native picker control semantics", () => {
  it.each(["fi-FI", "en-GB"])("renders %s labelled native controls, capacity and a single status", locale => {
    const props = existingImageViewFixture(locale), text = existingImageText(locale), html = renderToStaticMarkup(createElement(ExistingClientWebImagesView, props));
    expect(html).toContain('type="checkbox"'); expect(html.match(/type="checkbox"/gu)).toHaveLength(2);
    expect(html).toContain(text.image(1, 2, props.state.rows[0])); expect(html).toContain(text.image(2, 2, props.state.rows[1]));
    expect(html).toContain('aria-expanded="true"'); expect(html).toContain(`aria-controls="${props.id}"`); expect(html.match(/role="status"/gu)).toHaveLength(1);
    expect(html).toContain(text.count(0, 256)); expect(html).toContain(text.notice.replaceAll("'", "&#x27;"));
    expect(html).not.toMatch(/type="submit"|onkeydown|never-project|image-000000/);
  });
  it("does not expose controls or trigger reads from a closed render", () => {
    const props = existingImageViewFixture("en", { phase: "closed" }), html = renderToStaticMarkup(createElement(ExistingClientWebImagesView, props));
    expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('role="status"');
  });
  it.each(["load", "permission", "changed", "capacity", "keys"] as const)("renders fixed %s feedback and native retry", error => {
    const props = existingImageViewFixture("fi", { phase: "error", error }), html = renderToStaticMarkup(createElement(ExistingClientWebImagesView, props));
    expect(html).toContain('role="alert"'); expect(html).toContain(existingImageText("fi").errors[error]); expect(html).toContain(existingImageText("fi").retry);
  });
  it("renders empty/loading/busy/selected order and already-used feedback", () => {
    const empty = existingImageViewFixture("en", { rows: [] }); expect(renderToStaticMarkup(createElement(ExistingClientWebImagesView, empty))).toContain(existingImageText("en").empty);
    const loading = existingImageViewFixture("fi", { phase: "loading" }); expect(renderToStaticMarkup(createElement(ExistingClientWebImagesView, loading))).toContain(existingImageText("fi").loading);
    const selected = existingImageViewFixture("en"); selected.state = { ...selected.state, selected: [selected.state.rows[1]._id, selected.state.rows[0]._id] };
    selected.value = [{ image: { asset: { _ref: selected.state.rows[0]._id } } }]; const html = renderToStaticMarkup(createElement(ExistingClientWebImagesView, selected));
    expect(html).toContain(existingImageText("en").order(2)); expect(html).toContain(existingImageText("en").used);
  });
  it("keeps actual readOnly controls disabled and uses a bounded older-assets notice", () => {
    const props = existingImageViewFixture("en", { truncated: true }); props.readOnly = true;
    const html = renderToStaticMarkup(createElement(ExistingClientWebImagesView, props));
    expect(html.match(/type="checkbox" disabled=""/gu)).toHaveLength(2); expect(html).toContain(existingImageText("en").limited);
    expect(html).not.toContain("private-provider");
  });
});


describe("picker focus anchors across state changes", () => {
  type ButtonProps = { children?: ReactNode; disabled?: boolean; "aria-disabled"?: boolean; onClick?: () => void };
  function control(props: ReturnType<typeof existingImageViewFixture>, label: string) {
    function find(node: ReactNode, path: number[] = []): { path: number[]; props: ButtonProps } | undefined {
      if (!isValidElement<ButtonProps>(node)) return;
      if (node.type === "button" && node.props.children === label) return { path, props: node.props };
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
