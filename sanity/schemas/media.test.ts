import { describe, expect, it } from "vitest";

import { schemaTypes } from "./index";
import { localizedTextType } from "./localized-text";
import { mediaType } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaValidation,
  SchemaValidationContext,
  SchemaValidationRule,
} from "./schema-types";

/**
 * The schemas are plain objects, and their validation rules are plain
 * functions — so a Studio is not needed to check that they say what they mean.
 * This harness stands in for the rule builder a Studio passes in, records which
 * constraints were declared, and runs the custom checks directly.
 */
type CustomCheck = (
  value: unknown,
  context: SchemaValidationContext,
) => true | string;

function inspect(validation: SchemaValidation | undefined) {
  const checks: CustomCheck[] = [];
  let required = false;
  let min: number | undefined;

  const rule: SchemaValidationRule = {
    required() {
      required = true;
      return rule;
    },
    min(value) {
      min = value;
      return rule;
    },
    max() {
      return rule;
    },
    custom(check) {
      checks.push(check as CustomCheck);
      return rule;
    },
  };

  validation?.(rule);

  const run = (value: unknown, document?: Record<string, unknown>) =>
    checks.map((check) => check(value, document === undefined ? {} : { document }));

  return { required, min, run };
}

function fieldOf(
  type: { readonly fields: readonly SchemaFieldDefinition[] },
  name: string,
): SchemaFieldDefinition {
  const field = type.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

describe("the media document", () => {
  it("is registered with the object types it uses", () => {
    expect(schemaTypes).toContain(mediaType);
    expect(schemaTypes).toContain(localizedTextType);
  });

  it("requires a hand-minted identity in the documented form", () => {
    const { required, run } = inspect(fieldOf(mediaType, "mediaId").validation);

    expect(required).toBe(true);
    expect(run("coastal-landscape")).toEqual([true]);
    expect(run("winter-2026-01")).toEqual([true]);
    for (const rejected of [
      "Coastal Landscape",
      "coastal--landscape",
      "-coastal",
      "coastal_landscape",
      "",
      undefined,
    ]) {
      expect(run(rejected)[0]).toEqual(expect.any(String));
    }
  });

  it("requires an uploaded image only of an image media", () => {
    const { run } = inspect(fieldOf(mediaType, "image").validation);

    expect(run({ asset: { _ref: "image-…" } }, { mediaType: "image" })).toEqual([
      true,
    ]);
    expect(run(undefined, { mediaType: "video" })).toEqual([true]);
    expect(run(undefined, { mediaType: "image" })[0]).toEqual(
      expect.any(String),
    );
  });

  it("offers no crop control, because a cropped photograph is a different one", () => {
    expect(fieldOf(mediaType, "image").options?.hotspot).toBe(false);
  });

  it("requires alternative text and refuses two entries for one language", () => {
    const { required, min, run } = inspect(fieldOf(mediaType, "alt").validation);

    expect(required).toBe(true);
    expect(min).toBe(1);
    expect(run([{ language: "fi" }, { language: "en" }])).toEqual([true]);
    expect(run([{ language: "fi" }, { language: "fi" }])[0]).toContain("fi");
  });

  it("lets a caption exist in some languages and not others", () => {
    const caption = fieldOf(mediaType, "caption");
    const { required, run } = inspect(caption.validation);

    expect(required).toBe(false);
    expect(run([{ language: "en" }])).toEqual([true]);
    expect(run(undefined)).toEqual([true]);
  });

  it("keeps every placement-owned field off the photograph", () => {
    // Order, section membership, and a context-specific caption belong to the
    // container that places a photograph (ADR-0002 §3). On the media document
    // they would mean one photograph can live in only one gallery.
    const declared = mediaType.fields.map((field) => field.name);

    for (const placementField of [
      "order",
      "sectionId",
      "placementId",
      "captionOverride",
      "altOverride",
      "gallery",
    ]) {
      expect(declared).not.toContain(placementField);
    }
  });

  it("names the two kinds of media the model supports", () => {
    expect(
      fieldOf(mediaType, "mediaType").options?.list?.map(
        (option) => option.value,
      ),
    ).toEqual(["image", "video"]);
  });
});

describe("authored text in one language", () => {
  it("accepts a language subtag and refuses a locale or a name", () => {
    const { required, run } = inspect(
      fieldOf(localizedTextType, "language").validation,
    );

    expect(required).toBe(true);
    for (const accepted of ["fi", "en", "swe"]) {
      expect(run(accepted)).toEqual([true]);
    }
    for (const rejected of ["FI", "fi-FI", "finnish", "f", ""]) {
      expect(run(rejected)[0]).toEqual(expect.any(String));
    }
  });

  it("requires the text itself", () => {
    expect(inspect(fieldOf(localizedTextType, "value").validation).required).toBe(
      true,
    );
  });
});
