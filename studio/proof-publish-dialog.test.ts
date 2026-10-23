import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProofPublishDialog, type ProofDialogRequest } from "./proof-publish-dialog";

const site = { origin: "https://photos.example", locales: ["fi"] };
const handle = "a".repeat(32);
function render(request: ProofDialogRequest, locale = "fi-FI") {
  const fetcher = vi.fn(), readToken = vi.fn(() => "editor-token");
  const html = renderToStaticMarkup(createElement(ProofPublishDialog, {
    request, site, locale, readToken, fetcher: fetcher as unknown as typeof fetch, onBusy: vi.fn(), onClose: vi.fn(),
  }));
  return { html, fetcher, readToken };
}

describe("proof publication dialog", () => {
  it("asks for the terms on the first publication and sends nothing on render", () => {
    const { html, fetcher, readToken } = render({ operation: "publish", galleryId: "proof-1", expectedDraftRevision: "rev-2", handle, firstPublication: true });
    expect(html).toContain("numeroi vedokset pysyvästi");
    for (const label of ["Hintaan sisältyvien kuvien määrä", "Lisäkuvan hinta", "Valuutta", "Työn tunniste", "Asiakkaan sähköpostiosoite"]) expect(html).toContain(label);
    expect(html).toContain('value="7"');
    expect(html).toContain("Muistutusten lähetys otetaan käyttöön myöhemmin");
    expect(fetcher).not.toHaveBeenCalled(); expect(readToken).not.toHaveBeenCalled();
  });

  it("asks for no terms on a later publication", () => {
    const { html } = render({ operation: "publish", galleryId: "proof-1", expectedDraftRevision: "rev-3", handle, firstPublication: false }, "en-US");
    expect(html).toContain("existing numbers do not change");
    expect(html).not.toContain("Price per additional image");
  });

  it("warns that rotation stops the old link before anything is sent", () => {
    const { html, fetcher } = render({ operation: "rotate-key", galleryId: "proof-1", handle });
    expect(html).toContain("vanha valintalinkki lakkaa toimimasta");
    expect(html).toContain("Luo uusi linkki");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
