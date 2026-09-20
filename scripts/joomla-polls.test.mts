import { describe, expect, it } from "vitest";
import { parseLegacyPollResults, validateHistoricalPollDocuments } from "./joomla-polls.mts";
import { convertJoomlaBody, resolvedConversionDigest } from "./joomla-html-conversion.mts";
import { buildImportPlan, validateMigrationDocuments } from "./joomla-import-plan.mts";
import { splitIntoWaves, validatePlanContract } from "./write-joomla-content.mts";
import { CONVERSION_POLICY_VERSION } from "./joomla-html-conversion.mts";
const header = "poll_id\tquestion\ttotal_votes\tlanguage\toption_title\toption_votes\n";
const data = header + "2\tQuestion?\t4\tfi-FI\tFirst\t3\n2\tQuestion?\t4\tfi-FI\tSecond\t1\n";
const context = { language: "fi", resolveImage: () => undefined, resolveGallery: () => undefined };

describe("historical poll import", () => {
  it("preserves the real counts, marks polls closed, and emits the block in source order", () => {
    const polls = parseLegacyPollResults(data);
    const result = convertJoomlaBody("<p>Before {CONTENTPOLL id=2} After</p>", { ...context, resolvePoll: (id) => polls.get(id) });
    expect(result.convertible).toBe(true);
    expect(result.blocks.map((b) => b._type)).toEqual(["contentParagraphBlock", "contentPollBlock", "contentParagraphBlock"]);
    expect(result.pollDocuments).toHaveLength(2);
    expect(result.pollDocuments![1]).toMatchObject({ counts: { "option-1": 3, "option-2": 1 } });
    expect(validateHistoricalPollDocuments(result.pollDocuments!)).toEqual([]);
  });
  it("refuses an unresolved poll or a poll in the wrong language", () => {
    const polls = parseLegacyPollResults(data);
    expect(convertJoomlaBody("{contentpoll id=99}", context).convertible).toBe(false);
    expect(convertJoomlaBody("{contentpoll id=2}", { ...context, language: "en", resolvePoll: (id) => polls.get(id) }).convertible).toBe(false);
  });
  it("binds approval to the historical counts as well as the block's reference", () => {
    const polls = parseLegacyPollResults(data), changed = parseLegacyPollResults(data.replace("First\t3", "First\t2").replace("Second\t1", "Second\t2"));
    const convert = (p: typeof polls) => convertJoomlaBody("{contentpoll id=2}", { ...context, resolvePoll: (id) => p.get(id) });
    expect(resolvedConversionDigest(convert(polls))).not.toBe(resolvedConversionDigest(convert(changed)));
  });
  it("carries historical pairs into a validated plan and writes them before the article references", () => {
    const polls = parseLegacyPollResults(data);
    const conversion = convertJoomlaBody("{contentpoll id=2}", { ...context, resolvePoll: (id) => polls.get(id) });
    const sourceDigest = "a".repeat(64);
    const plan = buildImportPlan({ phase: "launch", manifestDigest: "b".repeat(64), sourceExportDigest: "c".repeat(64), knownCategoryIds: ["blog"], sourceLocators: {}, articles: [{
      title: "Synthetic article", sourceDigest, conversion,
      approval: { sourceId: "1", language: "fi", contentId: "synthetic", slug: "synthetic", canonicalAtStoryRoot: false, canonicalCategory: "blog", secondaryCategories: [], phase: "launch", publishedAt: "2020-01-01T00:00:00Z", sourceDigest, resolvedDigest: resolvedConversionDigest(conversion), conversionPolicy: CONVERSION_POLICY_VERSION, acknowledgedFindings: [], approvedBy: "test", approvedAt: "2026-09-18" },
    }] });
    expect(plan.errors).toEqual([]); expect(plan.blocked).toEqual([]);
    expect(plan.documents).toHaveLength(3);
    expect(validatePlanContract(plan).issues).toEqual([]);
    expect(splitIntoWaves(plan.documents).map((wave) => wave.map((d) => d._type))).toEqual([[], ["poll", "pollTally"], ["article"]]);
    const article = plan.documents.find(d => d._type === "article")!;
    expect(validateMigrationDocuments([article]).join(" ")).toContain("poll block must resolve");
    expect(validateMigrationDocuments(plan.documents.map(d => d._type === "article" ? {
      ...d, body: [{ _key: "poll", _type: "contentPollBlock", poll: { _type: "reference", _ref: article._id } }],
    } : d)).join(" ")).toContain("poll block must resolve");
    expect(validateMigrationDocuments(plan.documents.map(d => d._type === "poll" ? {
      ...d, language: "en",
    } : d)).join(" ")).toContain("poll block must use the article language");
    expect(validateMigrationDocuments(plan.documents.map(d => d._type === "poll" ? {
      ...d, language: "und",
    } : d))).toEqual([]);
  });
  it("refuses historical totals which do not match their option counts", () => {
    expect(() => parseLegacyPollResults(data.replace(/\t4\t/g, "\t5\t"))).toThrow();
  });
  it("rejects a live poll or a mismatched tally in a hand-edited plan", () => {
    const pair = parseLegacyPollResults(data).get("2")!;
    expect(validateHistoricalPollDocuments([{ ...pair.poll, closeDate: "2099-01-01T00:00:00Z" }, pair.tally])).not.toEqual([]);
    expect(validateHistoricalPollDocuments([pair.poll, { ...pair.tally, counts: { "option-1": -1 } }])).not.toEqual([]);
  });
  it("rejects individually safe buckets whose combined total overflows", () => {
    const pair = parseLegacyPollResults(data).get("2")!;
    expect(validateHistoricalPollDocuments([pair.poll, {
      ...pair.tally, counts: { "option-1": Number.MAX_SAFE_INTEGER, "option-2": 1 },
    }])).toContain("Historical tally total exceeds the safe integer range");
  });
});
