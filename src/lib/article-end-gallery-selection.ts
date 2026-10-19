import type { ArticleContentPage } from "@/lib/content-page";
import type { GallerySectionSummary } from "@/lib/gallery-sections";
import { MAX_ITEM_ID_LENGTH } from "@/lib/gallery-pagination";

export type ArticleEndSectionSelection =
  | { readonly kind: "legacy-ignore" | "all" | "not-found" }
  | { readonly kind: "selected"; readonly section: GallerySectionSummary };

/** Resolve before token validation; missing catalogs retain incidental query behavior. */
export function resolveArticleEndSection(
  article: Pick<ArticleContentPage, "endGallerySections">,
  raw: string | readonly string[] | undefined,
): ArticleEndSectionSelection {
  const sections = article.endGallerySections;
  if (!sections?.length) return { kind: "legacy-ignore" };
  if (raw === undefined || raw === "" || raw === "all") return { kind: "all" };
  if (
    typeof raw !== "string" ||
    raw.length > MAX_ITEM_ID_LENGTH ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)
  )
    return { kind: "not-found" };
  const section = sections.find((item) => item.slug === raw);
  return section === undefined
    ? { kind: "not-found" }
    : { kind: "selected", section };
}
