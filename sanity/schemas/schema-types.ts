/**
 * The subset of Sanity's schema object model this project uses, typed here so
 * the schema files can stay dependency-free.
 *
 * A Sanity schema type is a plain object. `defineType` and `defineField` are
 * typed identity helpers — convenient inside a Studio, and a dependency here:
 * importing them would pull the `sanity` package into a repository that
 * deliberately has no CMS library (ADR-0006 §2). So the schemas below are
 * written as plain objects and checked against these local declarations
 * instead, which costs one small file and keeps `npm install` unchanged.
 *
 * These declarations describe only what the schemas actually use. They are not
 * a model of Sanity's schema API, and they are deliberately narrow: a field
 * option that is not declared here is one this project has not committed to.
 * Widen them when a schema needs something, not in advance.
 */

/**
 * The validation rule builder a Studio passes to a `validation` function.
 *
 * Only the four methods the schemas below call. `custom` returns `true` when
 * the value is acceptable and an editor-facing message when it is not.
 */
export type SchemaValidationRule = {
  required(): SchemaValidationRule;
  min(value: number): SchemaValidationRule;
  max(value: number): SchemaValidationRule;
  custom<TValue>(
    check: (
      value: TValue | undefined,
      context: SchemaValidationContext,
    ) => true | string,
  ): SchemaValidationRule;
};

/**
 * What a `custom` check is told about its surroundings. Only `document`, which
 * is what a cross-field rule needs — whether an asset is required depends on
 * the media type chosen two fields above it.
 */
export type SchemaValidationContext = {
  readonly document?: Readonly<Record<string, unknown>>;
};

export type SchemaValidation = (
  rule: SchemaValidationRule,
) => SchemaValidationRule;

export type SchemaListOption = {
  readonly title: string;
  readonly value: string;
};

export type SchemaFieldOptions = {
  /** Closed set of accepted values, rendered as radios or a dropdown. */
  readonly list?: readonly SchemaListOption[];
  readonly layout?: "radio" | "dropdown";
  /**
   * Crop-and-hotspot editing. Always `false` here: this project never crops a
   * photograph, so an editor must not be offered a control that does.
   */
  readonly hotspot?: false;
};

export type SchemaFieldDefinition = {
  readonly name: string;
  readonly title: string;
  readonly type: string;
  /** Shown under the field in the Studio; the editorial rule, in one sentence. */
  readonly description?: string;
  readonly of?: readonly { readonly type: string }[];
  readonly fields?: readonly SchemaFieldDefinition[];
  readonly options?: SchemaFieldOptions;
  readonly initialValue?: string | boolean;
  readonly validation?: SchemaValidation;
};

export type SchemaPreview = {
  readonly select: Readonly<Record<string, string>>;
};

export type SchemaTypeDefinition = {
  readonly name: string;
  readonly title: string;
  readonly type: "document" | "object";
  readonly description?: string;
  readonly fields: readonly SchemaFieldDefinition[];
  readonly preview?: SchemaPreview;
};
