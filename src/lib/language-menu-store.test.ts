import { describe, expect, it } from "vitest";

import {
  getLanguageLinks,
  languageMenuCode,
  publishLanguageLinks,
  subscribeLanguageLinks,
  withdrawLanguageLinks,
} from "@/lib/language-menu-store";

const english = [{ locale: "en-GB", label: "British English", href: "/en/stories" }];
const finnish = [{ locale: "fi", label: "suomi", href: "/tarinat" }];

describe("language menu store", () => {
  it("lets only the owner withdraw its links, whichever order a navigation runs in", () => {
    const oldPage = Symbol("old");
    const newPage = Symbol("new");
    publishLanguageLinks(oldPage, english);
    publishLanguageLinks(newPage, finnish);
    withdrawLanguageLinks(oldPage);
    expect(getLanguageLinks()?.links).toBe(finnish);

    withdrawLanguageLinks(newPage);
    expect(getLanguageLinks()).toBeNull();
  });

  it("notifies subscribers on every change", () => {
    let calls = 0;
    const unsubscribe = subscribeLanguageLinks(() => {
      calls += 1;
    });
    const owner = Symbol("page");
    publishLanguageLinks(owner, english);
    withdrawLanguageLinks(owner);
    withdrawLanguageLinks(owner);
    unsubscribe();
    publishLanguageLinks(owner, english);
    expect(calls).toBe(2);
    withdrawLanguageLinks(owner);
  });
});

describe("languageMenuCode", () => {
  it("shows the language subtag, or the whole tag when two links share it", () => {
    expect(languageMenuCode("en-GB", english)).toBe("EN");
    expect(languageMenuCode("fi", finnish)).toBe("FI");
    const both = [{ locale: "en-GB" }, { locale: "en-US" }];
    expect(languageMenuCode("en-GB", both)).toBe("EN-GB");
    expect(languageMenuCode("en-US", both)).toBe("EN-US");
  });
});
