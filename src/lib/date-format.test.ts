import { describe, expect, it } from "vitest";

import { formatDate } from "@/lib/date-format";

describe("formatDate", () => {
  it("uses the provided locale", () => {
    expect(formatDate("2026-01-15", "en-GB")).toBe("15 January 2026");
    expect(formatDate("2026-01-15", "fi-FI")).toBe("15. tammikuuta 2026");
  });
});
