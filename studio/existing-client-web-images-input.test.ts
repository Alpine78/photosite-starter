import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, studioTheme } from "@sanity/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArrayOfObjectsInputProps } from "sanity";
import { clientDeliveryGalleryType } from "../sanity/schemas/client-delivery-gallery";
import type { SchemaTypeDefinition } from "../sanity/schemas/schema-types";
import { makeExistingClientItems } from "./existing-client-web-images";

const native = vi.hoisted(() => ({ fetch: vi.fn(), withConfig: vi.fn(), readOnly: false }));
vi.mock("sanity", async importOriginal => {
  const actual = await importOriginal<typeof import("sanity")>();
  const client = { fetch: native.fetch, config: () => ({ projectId: "fixture01", dataset: "fixture" }), withConfig: (config: unknown) => { native.withConfig(config); return client; } };
  return { ...actual, useClient: () => client, useFormValue: () => "synthetic-gallery", useCurrentLocale: () => ({ id: "fi-FI" }) };
});
import { existingClientImagePatches, ExistingClientWebImagesInput, withExistingClientWebImages } from "./existing-client-web-images-input";
function props(renderDefault = vi.fn(() => createElement("p", null, "Native editing preserved"))) {
  return { path: ["items"], value: undefined, readOnly: native.readOnly, onChange: vi.fn(), renderDefault } as unknown as ArrayOfObjectsInputProps;
}
beforeEach(() => { vi.clearAllMocks(); native.readOnly = false; });
/** Studio supplies the UI theme around every input. */
const themed = (node: ReactElement) => createElement(ThemeProvider, { theme: studioTheme }, node);

describe("native array decoration and patches", () => {
  it("uses real native setIfMissing then one append insert, never a whole-array replacement", () => {
    const id = `image-${"1".repeat(40)}-1600x1000-webp`, items = makeExistingClientItems([id], undefined, bytes => { bytes.fill(1); });
    const patches = existingClientImagePatches(items);
    expect(patches).toHaveLength(2); expect(patches[0]).toMatchObject({ type: "setIfMissing", path: [], value: [] });
    expect(patches[1]).toMatchObject({ type: "insert", position: "after", path: [-1], items });
    expect(patches.some(patch => patch.type === "set")).toBe(false);
  });
  it("decorates only the items field without mutating the shared schema and is idempotent", () => {
    const originalFields = clientDeliveryGalleryType.fields, originalItems = originalFields.find(field => field.name === "items")!;
    const decorated = withExistingClientWebImages(clientDeliveryGalleryType), items = decorated.fields.find(field => field.name === "items")!;
    expect(decorated).not.toBe(clientDeliveryGalleryType); expect(clientDeliveryGalleryType.fields).toBe(originalFields); expect(originalItems).not.toHaveProperty("components");
    expect(items).toMatchObject({ validation: originalItems.validation, of: originalItems.of, components: { input: ExistingClientWebImagesInput } });
    expect(decorated.fields.filter(field => field.name !== "items")).toEqual(originalFields.filter(field => field.name !== "items"));
    expect(withExistingClientWebImages(decorated)).toBe(decorated);
    const unrelated = { ...clientDeliveryGalleryType, name: "legacyDeliveryGallery" }; expect(withExistingClientWebImages(unrelated)).toBe(unrelated);
  });
  it("keeps a previously installed input and its original renderDefault chain", () => {
    const previous = vi.fn((input: ArrayOfObjectsInputProps) => createElement("div", null, input.renderDefault(input)));
    const schema = { ...clientDeliveryGalleryType, fields: clientDeliveryGalleryType.fields.map(field => field.name === "items" ? { ...field, components: { input: previous, field: "preserved" } } : field) } as SchemaTypeDefinition;
    const result = withExistingClientWebImages(schema), field = result.fields.find(field => field.name === "items") as unknown as { components: { input: typeof ExistingClientWebImagesInput; field: string } };
    const inputProps = props(), html = renderToStaticMarkup(themed(createElement(field.components.input, inputProps)));
    expect(html).toContain("Native editing preserved"); expect(html).toContain("Valitse valmiita verkkokuvia");
    expect(previous).toHaveBeenCalledTimes(1); expect(inputProps.renderDefault).toHaveBeenCalledTimes(1); expect(field.components.field).toBe("preserved");
    expect(native.fetch).not.toHaveBeenCalled(); expect(withExistingClientWebImages(result)).toBe(result);
  });
  it("renders the untouched native input with no fetch on mount and raw current-project reads only", () => {
    native.readOnly = true; const inputProps = props(), html = renderToStaticMarkup(themed(createElement(ExistingClientWebImagesInput, inputProps)));
    expect(html).toContain("Native editing preserved"); expect(html).toContain('disabled=""'); expect(native.fetch).not.toHaveBeenCalled();
    expect(native.withConfig).toHaveBeenCalledWith({ useCdn: false, perspective: "raw" }); expect(inputProps.onChange).not.toHaveBeenCalled();
  });
});
