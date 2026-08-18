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

/** `true` when the value is acceptable, otherwise the editor-facing reason. */
export type SchemaValidationResult = true | string;

/**
 * The read client a validation rule may use. `custom` may return a promise, so
 * a rule can ask the dataset a question — whether an identity is already taken,
 * or how large an uploaded asset actually is — instead of only inspecting the
 * value in front of it.
 */
export type SchemaValidationClient = {
  fetch<TResult>(
    query: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<TResult>;
  /**
   * Returns a client with different settings. A validation rule needs it
   * because the default perspective hides unpublished documents, and a rule
   * that only sees published ones cannot tell an editor their identity is
   * already taken by a draft.
   */
  withConfig(config: {
    readonly perspective: string;
    readonly useCdn?: boolean;
  }): SchemaValidationClient;
};

/**
 * What a `custom` check is told about its surroundings: the document being
 * edited, and a client scoped to the dataset it lives in.
 */
export type SchemaValidationContext = {
  readonly document?: Readonly<Record<string, unknown>>;
  getClient(options: { readonly apiVersion: string }): SchemaValidationClient;
};

export type SchemaValidationRule = {
  required(): SchemaValidationRule;
  min(value: number): SchemaValidationRule;
  max(value: number): SchemaValidationRule;
  custom<TValue>(
    check: (
      value: TValue | undefined,
      context: SchemaValidationContext,
    ) => SchemaValidationResult | Promise<SchemaValidationResult>,
  ): SchemaValidationRule;
  /**
   * A non-blocking severity: the editor sees the message but Publish still
   * succeeds. Used where an author may have a legitimate reason to keep a
   * flagged state (ADR-0002 §2's "repeating a photograph in one gallery is
   * allowed, but the CMS surfaces a warning") — `custom` alone can only block.
   */
  warning<TValue>(
    check: (
      value: TValue | undefined,
      context: SchemaValidationContext,
    ) => SchemaValidationResult | Promise<SchemaValidationResult>,
  ): SchemaValidationRule;
};

export type SchemaValidation = (
  rule: SchemaValidationRule,
) => SchemaValidationRule;

export type SchemaListOption = {
  readonly title: string;
  readonly value: string | number;
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
  /**
   * Whether the uploaded file's own name is kept on the asset document.
   * Defaults to `true` in Sanity, which its documentation warns about: a
   * filename can carry a client's name or an internal working title, and an
   * asset document in a public dataset is readable by anyone.
   */
  readonly storeOriginalFilename?: boolean;
  /** MIME types the file picker offers. A hint to an editor, not a control. */
  readonly accept?: string;
};

export type SchemaFieldDefinition = {
  readonly name: string;
  readonly title: string;
  readonly type: string;
  /** Shown under the field in the Studio; the editorial rule, in one sentence. */
  readonly description?: string;
  readonly of?: readonly SchemaArrayMemberDefinition[];
  /** Document types a `reference` field may point to. */
  readonly to?: readonly { readonly type: string }[];
  readonly fields?: readonly SchemaFieldDefinition[];
  readonly options?: SchemaFieldOptions;
  readonly initialValue?: string | boolean;
  readonly validation?: SchemaValidation;
};

export type SchemaArrayMemberDefinition = {
  readonly type: string;
  /** Inline object members, used where a named reusable type adds no value. */
  readonly fields?: readonly SchemaFieldDefinition[];
  /** Document types an inline `reference` array member may point to. */
  readonly to?: readonly { readonly type: string }[];
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
  /** Whole-document validation, used when correctness spans several records. */
  readonly validation?: SchemaValidation;
};
