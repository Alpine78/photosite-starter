import { describe, expect, it } from "vitest";
import { defineSchemaTypes } from "../sanity/schemas";
import {
  allowAction, allowTemplate, EDITORIAL_LISTS, IMPORTER_TYPES, NOT_YET_CREATABLE_TYPES, resolveSingletonDocumentId,
  SINGLETON_QUERY_LIMIT, SINGLETON_TYPES, singletonDocumentId,
} from "./editorial-policy";

describe("singleton identity", () => {
  it("reuses arbitrary imported IDs across published, draft and release documents", () => {
    expect(singletonDocumentId("siteSettings", [
      { _id: "foundation--settings" }, { _id: "drafts.foundation--settings" },
      { _id: "versions.release1.foundation--settings" },
    ])).toBe("foundation--settings");
    expect(singletonDocumentId("homePage", [{ _id: "drafts.existing-home" }])).toBe("existing-home");
    expect(singletonDocumentId("homePage", [{ _id: "versions.release1.existing-home" }])).toBe("existing-home");
  });

  it("offers the initial ID only for a successful empty response", async () => {
    expect(await resolveSingletonDocumentId("homePage", async () => [])).toBe("homePage");
    expect(singletonDocumentId("siteSettings", [])).toBe("siteSettings");
  });

  it.each(["network failure", "401 unauthorized", "403 forbidden"])("propagates %s without creating a singleton", async (message) => {
    await expect(resolveSingletonDocumentId("homePage", async () => { throw new Error(message); }))
      .rejects.toThrow(message);
  });

  it("refuses distinct existing identities", () => {
    expect(() => singletonDocumentId("homePage", [
      { _id: "imported-home" }, { _id: "drafts.different-home" },
    ])).toThrow("Multiple singleton");
  });

  it.each([null, {}, [{ _id: "" }], [{ _id: "drafts." }], [{ _id: 42 }],
    [{ _id: "versions.release1" }], [{ _id: "versions.release1." }],
    [{ _id: "unsafe/id" }], [undefined],
    Array.from({ length: SINGLETON_QUERY_LIMIT }, () => ({ _id: "home" })),
  ])("refuses invalid or full results %#", (response) => {
    expect(() => singletonDocumentId("homePage", response)).toThrow("Cannot resolve singleton");
  });
});

describe("editorial guardrails", () => {
  it("allows only publishing, discarding and restoring singleton edits", () => {
    for (const type of SINGLETON_TYPES) {
      for (const action of ["publish", "discardChanges", "restore"]) expect(allowAction(type, action)).toBe(true);
      for (const action of ["duplicate", "delete", "unpublish", "custom", undefined]) {
        expect(allowAction(type, action)).toBe(false);
      }
      expect(allowTemplate(type)).toBe(false);
    }
    expect(allowAction("article", "delete")).toBe(true);
    expect(allowTemplate("article")).toBe(true);
  });

  it("removes all importer document actions and creation templates", () => {
    for (const type of IMPORTER_TYPES) {
      for (const action of ["publish", "duplicate", "delete", "restore", undefined]) {
        expect(allowAction(type, action)).toBe(false);
      }
      expect(allowTemplate(type)).toBe(false);
    }
  });

  it("accounts for every canonical document type exactly once", () => {
    const documentTypes = defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] })
      .filter(({ type }) => type === "document").map(({ name }) => name).sort();
    const configuredTypes = [...SINGLETON_TYPES, ...EDITORIAL_LISTS.map(({ type }) => type), ...IMPORTER_TYPES, ...NOT_YET_CREATABLE_TYPES];
    expect(configuredTypes.slice().sort()).toEqual(documentTypes);
    expect(new Set(configuredTypes).size).toBe(configuredTypes.length);
  });
});

describe("proof galleries before their publication slice (ADR-0038, AB#130)", () => {
  it("cannot be created yet and can never be unpublished", () => {
    expect(allowTemplate("clientProofGallery")).toBe(false);
    for (const action of ["publish", "discardChanges", "delete"]) expect(allowAction("clientProofGallery", action)).toBe(true);
    for (const action of ["unpublish", "duplicate", "restore", "custom", undefined]) expect(allowAction("clientProofGallery", action)).toBe(false);
    expect(EDITORIAL_LISTS.map(({ type }) => type)).not.toContain("clientProofGallery");
  });
});
