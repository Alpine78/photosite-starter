import { describe, expect, it } from "vitest";

import { defineSchemaTypes } from "./index";
import { MEDIA_TYPE_NAME } from "./media";
import { serviceType, SERVICE_TYPE_NAME } from "./service";
import type {
  SchemaFieldDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

/**
 * Duplicated from `media.test.ts` rather than shared — see `category.test.ts`'s
 * comment on the same choice.
 */
type CustomCheck = (
  value: unknown,
  context: SchemaValidationContext,
) => SchemaValidationResult | Promise<SchemaValidationResult>;

type RecordedQuery = {
  query: string;
  params: Readonly<Record<string, unknown>> | undefined;
};

function inspect(
  validation: SchemaValidation | undefined,
  dataset: { answer?: unknown } = {},
) {
  const checks: CustomCheck[] = [];
  const queries: RecordedQuery[] = [];
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

  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, params });
      return dataset.answer as never;
    },
    withConfig() {
      return client;
    },
  };

  const contextFor = (
    document?: Record<string, unknown>,
  ): SchemaValidationContext => ({
    ...(document === undefined ? {} : { document }),
    getClient: () => client,
  });

  const run = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(checks.map((check) => check(value, contextFor(document))));

  return { required, min, run, queries };
}

function fieldOf(name: string): SchemaFieldDefinition {
  const field = serviceType.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

describe("the service document", () => {
  it("is registered in the schema index", () => {
    const types = defineSchemaTypes({
      datasetVisibility: "public",
      storyRootPaths: ["/stories"],
    });
    expect(types.map((type) => type.name)).toContain(SERVICE_TYPE_NAME);
  });

  it("references the shared media document for its cover", () => {
    expect(fieldOf("coverMedia").to).toEqual([{ type: MEDIA_TYPE_NAME }]);
  });
});

describe("the slug", () => {
  it("requires the documented form", async () => {
    const { required, run } = inspect(fieldOf("slug").validation, {
      answer: false,
    });

    expect(required).toBe(true);
    expect(await run("portrait-sessions")).toEqual([true]);
    for (const rejected of ["Portrait Sessions", "portrait_sessions", "-portrait", ""]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it("refuses a slug another published-or-draft service already claims", async () => {
    const { run } = inspect(fieldOf("slug").validation, { answer: true });

    expect((await run("portrait-sessions", { _id: "abc" }))[0]).toContain(
      "already uses",
    );
  });

  it("does not require immutability once published, unlike media or category identity", async () => {
    // Services have no redirect-history story: `service.ts`'s module comment
    // explains this is a deliberate, narrower check than media.ts/category.ts.
    const { run } = inspect(fieldOf("slug").validation, { answer: false });

    expect(await run("renamed-sessions", { _id: "abc" })).toEqual([true]);
  });
});

describe("required editorial fields", () => {
  it.each(["name", "shortDescription"])("requires %s", (name) => {
    expect(inspect(fieldOf(name).validation).required).toBe(true);
  });

  it("requires at least one description paragraph", () => {
    const { required, min } = inspect(fieldOf("description").validation);
    expect(required).toBe(true);
    expect(min).toBe(1);
  });
});

describe("optional fields", () => {
  it("does not require a cover, a starting price, or pricing", () => {
    expect(inspect(fieldOf("coverMedia").validation).required).toBe(false);
    expect(inspect(fieldOf("startingPrice").validation).required).toBe(false);
    expect(inspect(fieldOf("pricing").validation).required).toBe(false);
  });

  it("requires a name and a price inside each pricing package", () => {
    const packageFields = fieldOf("pricing").of?.[0]?.fields ?? [];
    const nameField = packageFields.find((field) => field.name === "name");
    const priceField = packageFields.find((field) => field.name === "price");
    const noteField = packageFields.find((field) => field.name === "note");

    expect(inspect(nameField?.validation).required).toBe(true);
    expect(inspect(priceField?.validation).required).toBe(true);
    expect(inspect(noteField?.validation).required).toBe(false);
  });
});

describe("listing order", () => {
  it("requires an explicit order value", () => {
    expect(inspect(fieldOf("order").validation).required).toBe(true);
  });
});
