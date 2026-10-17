import { describe, expect, it } from "vitest";

import { formatDate, formatUtcDateTime } from "@/lib/date-format";

describe("formatDate", () => {
  it("uses the provided locale", () => {
    expect(formatDate("2026-01-15", "en-GB")).toBe("15 January 2026");
    expect(formatDate("2026-01-15", "fi-FI")).toBe("15. tammikuuta 2026");
  });
});

describe("exact UTC page deadlines", () => {
  it("keeps date, seconds and fractional precision independent of the host timezone", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["Pacific/Honolulu", "Europe/Helsinki"]) {
        process.env.TZ = zone;
        expect(formatUtcDateTime("2027-01-01T00:15:05Z", "en-GB")).toBe("1 January 2027 at 00:15:05");
        expect(formatUtcDateTime("2100-01-02T03:04:05.123Z", "fi")).toBe("2. tammikuuta 2100 klo 03.04.05,123");
      }
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
});
