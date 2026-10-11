import { describe, expect, it } from "vitest";
import { loadStudioSettings, studioStoryRoots } from "./settings";

const environment = {
  SANITY_STUDIO_PROJECT_ID: "example1",
  SANITY_STUDIO_DATASET: "example",
  SANITY_STUDIO_DATASET_VISIBILITY: "public",
  SANITY_STUDIO_TITLE: "Example Studio",
  SANITY_STUDIO_LOCALE_ROUTES: "fi||tarinat|palvelut,en-GB|en|stories|services",
};

describe("Studio configuration", () => {
  it("derives all locale roots with the default in any position", () => {
    expect(loadStudioSettings(environment)).toEqual({
      projectId: "example1", dataset: "example", datasetVisibility: "public",
      title: "Example Studio", storyRootPaths: ["/tarinat", "/en/stories"],
    });
    expect(studioStoryRoots("en-GB|en|stories,fi||tarinat")).toEqual(["/en/stories", "/tarinat"]);
  });

  it("accepts field whitespace and empty comma entries as the site's route parser does", () => {
    expect(studioStoryRoots(" , fi || tarinat | palvelut ,, en-GB | en | stories | services, "))
      .toEqual(["/tarinat", "/en/stories"]);
  });

  it.each(Object.keys(environment))("requires %s explicitly", (key) => {
    expect(() => loadStudioSettings({ ...environment, [key]: " " })).toThrow(key);
  });

  it.each([
    ["SANITY_STUDIO_PROJECT_ID", "https://example.test"],
    ["SANITY_STUDIO_PROJECT_ID", "-example"],
    ["SANITY_STUDIO_DATASET", "Production"],
    ["SANITY_STUDIO_DATASET", "production-"],
    ["SANITY_STUDIO_DATASET_VISIBILITY", "unknown"],
    ["SANITY_STUDIO_TITLE", "x".repeat(121)],
  ])("rejects invalid %s", (key, value) => {
    expect(() => loadStudioSettings({ ...environment, [key]: value })).toThrow(key);
  });

  it.each([
    "", "fi", "fi|fi|tarinat", "fi||tarinat,en-GB||stories", "fi||tarinat,fi|en|stories",
    "fi||tarinat,en-GB|en|stories,de|en|berichte", "invalid!||stories", "und||stories",
    "fi||../stories", "fi||stories?query", "fi||stories|", "fi||stories|stories",
    "fi||stories|services|extra", ", , ", "fi||stories" + " ".repeat(4096),
  ])("rejects malformed routing declarations: %s", (value) => {
    expect(() => studioStoryRoots(value)).toThrow("SANITY_STUDIO_LOCALE_ROUTES");
  });
});
