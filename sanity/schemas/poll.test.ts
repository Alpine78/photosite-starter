import { describe, expect, it } from "vitest";

import { inspectValidationRules } from "./validation-test-helper";
import { defineSchemaTypes } from "./index";
import { MAX_POLL_OPTIONS, MIN_POLL_OPTIONS, pollType, POLL_TYPE_NAME } from "./poll";
import type {
  SchemaFieldDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
} from "./schema-types";

type RecordedQuery = { query: string; params: Readonly<Record<string, unknown>> | undefined };

function inspect(validation: SchemaValidation | undefined, dataset: { answer?: unknown } = {}) {
  const queries: RecordedQuery[] = [];
  const { required, min, max, checks } = inspectValidationRules(validation);

  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, params });
      return dataset.answer as never;
    },
    withConfig() {
      return client;
    },
  };

  const contextFor = (document?: Record<string, unknown>): SchemaValidationContext => ({
    ...(document === undefined ? {} : { document }),
    getClient: () => client,
  });

  const run = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(checks.map((check) => check(value, contextFor(document))));

  return { required, min, max, run, queries };
}

function fieldOf(name: string): SchemaFieldDefinition {
  const field = pollType.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

const UNIQUE_AND_UNCHANGED = { taken: false, publishedPollId: null };

describe("the poll document", () => {
  it("is registered in the schema index", () => {
    const types = defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] });
    expect(types.map((type) => type.name)).toContain(POLL_TYPE_NAME);
  });
});

describe("pollId", () => {
  it("requires the documented form", async () => {
    const { required, run } = inspect(fieldOf("pollId").validation, { answer: UNIQUE_AND_UNCHANGED });

    expect(required).toBe(true);
    expect(await run("camera-preference")).toEqual([true]);
    for (const rejected of ["Camera Preference", "camera_preference", "-camera", ""]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it("refuses an id another published-or-draft poll already claims", async () => {
    const { run } = inspect(fieldOf("pollId").validation, { answer: { taken: true, publishedPollId: null } });

    expect((await run("camera-preference", { _id: "abc" }))[0]).toContain("already uses");
  });

  it("does not collide with its own published version, draft, or release version", async () => {
    const { run } = inspect(fieldOf("pollId").validation, { answer: UNIQUE_AND_UNCHANGED });

    for (const ownId of ["abc", "drafts.abc", "versions.summer-drop.abc"]) {
      expect(await run("camera-preference", { _id: ownId })).toEqual([true]);
    }
  });

  it("refuses to rename an id that has already been published", async () => {
    const { run } = inspect(fieldOf("pollId").validation, {
      answer: { taken: false, publishedPollId: "camera-preference" },
    });

    expect((await run("renamed-poll", { _id: "abc" }))[0]).toContain("camera-preference");
  });

  it("asks with a perspective that can see unpublished documents", async () => {
    const { run, queries } = inspect(fieldOf("pollId").validation, { answer: UNIQUE_AND_UNCHANGED });

    await run("camera-preference", { _id: "abc" });

    expect(queries[0].query).toContain("!sanity::versionOf($published)");
  });
});

describe("language", () => {
  it("requires a two- or three-letter subtag, optionally regionalized", async () => {
    const { required, run } = inspect(fieldOf("language").validation);

    expect(required).toBe(true);
    expect(await run("fi")).toEqual([true]);
    expect(await run("en-GB")).toEqual([true]);
    for (const rejected of ["FI", "finnish", "", "en-gb"]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });
});

describe("question", () => {
  it("requires non-blank text", async () => {
    const { required, run } = inspect(fieldOf("question").validation);

    expect(required).toBe(true);
    expect(await run("Which do you prefer?")).toEqual([true]);
    expect((await run("   "))[0]).toEqual(expect.any(String));
  });
});

describe("options", () => {
  const optionOf = (optionId: string, label: string) => ({ optionId, label });

  it(`requires between ${MIN_POLL_OPTIONS} and ${MAX_POLL_OPTIONS} options`, () => {
    const { required, min, max } = inspect(fieldOf("options").validation);
    expect(required).toBe(true);
    expect(min).toBe(MIN_POLL_OPTIONS);
    expect(max).toBe(MAX_POLL_OPTIONS);
  });

  it("accepts distinct, well-formed option ids", async () => {
    const { run } = inspect(fieldOf("options").validation);
    expect(await run([optionOf("mirrorless", "Mirrorless"), optionOf("dslr", "DSLR")])).toEqual([true]);
  });

  it("rejects a malformed option id", async () => {
    const { run } = inspect(fieldOf("options").validation);
    expect((await run([optionOf("Not Valid", "x")]))[0]).toEqual(expect.any(String));
  });

  it("rejects a duplicate option id within one poll", async () => {
    const { run } = inspect(fieldOf("options").validation);
    expect((await run([optionOf("mirrorless", "Mirrorless"), optionOf("mirrorless", "Again")]))[0]).toContain(
      "more than once",
    );
  });
});

describe("closeDate", () => {
  it("is required", () => {
    expect(inspect(fieldOf("closeDate").validation).required).toBe(true);
  });
});

it("preserves published option identities so editorial changes cannot lose tally buckets", async () => {
  const { run } = inspect(fieldOf("options").validation, { answer: ["one", "two"] });
  expect((await run([{ optionId: "one", label: "One" }, { optionId: "new", label: "New" }], { _id: "drafts.poll" }))[0]).toContain("cannot be removed");
  expect(await run([{ optionId: "two", label: "A revised label" }, { optionId: "one", label: "One" }], { _id: "drafts.poll" })).toEqual([true]);
});
