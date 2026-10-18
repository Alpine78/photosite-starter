import { describe, expect, it } from "vitest";
import { mayRestoreReadingPosition } from "./reading-restoration";

const href = "https://example.test/stories/article?view=one";
const fresh = {
  initialHref: href, currentHref: href, initialDocumentHref: href,
  initialNavigationType: "navigate", hasFragment: false, interacted: false,
  scrollY: 0, modalOpen: false, visible: true,
};

describe("saved reading position navigation precedence", () => {
  it.each(["navigate", "reload"])("permits a fresh top-of-page visit %s", (initialNavigationType) => {
    expect(mayRestoreReadingPosition({ ...fresh, initialNavigationType })).toBe(true);
  });

  it.each([
    { hasFragment: true }, { currentHref: `${href}#explicit` },
    { currentHref: "https://example.test/stories/other" },
    { currentHref: "https://example.test/stories/article?view=two" },
    { historyDestination: href }, { initialNavigationType: "back_forward" },
    { initialNavigationType: undefined }, { initialNavigationType: "unknown" },
    { interacted: true }, { scrollY: 1 }, { scrollY: 300 }, { scrollY: -1 },
    { scrollY: NaN }, { modalOpen: true }, { visible: false },
  ])("preserves deliberate/native navigation case %#", (override) => {
    expect(mayRestoreReadingPosition({ ...fresh, ...override })).toBe(false);
  });

  it("does not apply the initial document's history flag to a new article link", () => {
    expect(mayRestoreReadingPosition({ ...fresh, initialNavigationType: "back_forward",
      initialDocumentHref: "https://example.test/previous" })).toBe(true);
  });

  it("permits a later fresh link to the initial document URL", () => {
    expect(mayRestoreReadingPosition({ ...fresh, initialNavigationType: "back_forward",
      freshLinkDestination: href })).toBe(true);
  });

  it("a fresh-link hint cannot override a subsequent native history event or input", () => {
    expect(mayRestoreReadingPosition({ ...fresh, freshLinkDestination: href, historyDestination: href })).toBe(false);
    expect(mayRestoreReadingPosition({ ...fresh, freshLinkDestination: href, interacted: true })).toBe(false);
  });
});
