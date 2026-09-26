import { describe, expect, it } from "vitest";

import {
  parsePinnedTheme,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme-preference";

describe("parsePinnedTheme", () => {
  it("accepts only the two pinned themes", () => {
    expect(parsePinnedTheme("light")).toBe("light");
    expect(parsePinnedTheme("dark")).toBe("dark");
    for (const value of [null, undefined, "", "device", "Dark", "sepia", 1]) {
      expect(parsePinnedTheme(value)).toBeUndefined();
    }
  });
});

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  function run(stored: string | null, throws = false) {
    const attributes = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => {
        if (throws) throw new Error("blocked");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    };
    const document = {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    };
    new Function("localStorage", "document", THEME_BOOTSTRAP_SCRIPT)(localStorage, document);
    return attributes.get("data-theme");
  }

  it("applies a stored light or dark pin", () => {
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBe("light");
  });

  it("leaves the device setting in charge for anything else, including blocked storage", () => {
    expect(run(null)).toBeUndefined();
    expect(run("sepia")).toBeUndefined();
    expect(run('"><script>')).toBeUndefined();
    expect(run("dark", true)).toBeUndefined();
  });
});
