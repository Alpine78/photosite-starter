import { mockPolls } from "@/lib/mock-polls";
import type { GalleryPresentationFields } from "@/lib/gallery-presentation";
/**
 * Authored bodies for the mock content tree, until the CMS adapter lands.
 *
 * Split from `mock-content-listing.ts` the same way a real adapter must split
 * its queries: those are the few fields a card projects, and these are the ones
 * only a detail page reads. Nothing here is ever loaded to render a listing.
 *
 * The shared fields — title, lead, publication date, cover — are not restated
 * here. A page composes them from its listing record, so a card and its detail
 * page cannot drift apart; the CMS equivalent is two projections of one
 * document. A body without a matching record is a fixture defect and fails at
 * import rather than at a visitor's request.
 *
 * A `gallery` page carries the same shared fields and declares its variant, but
 * its ordered result set is deliberately not here: that is the AB#67 contract,
 * read through `gallery.ts` by the route that renders the grid. Most gallery
 * bodies below stay empty — a gallery is not required to carry one — while
 * `content-coastal-mornings` authors one (AB#106), so the long-form body, its
 * page-jump navigation, and a body media placement distinct from the
 * gallery's own curated items are all exercised by a fixture rather than only
 * by a test. `content-large-archive` authors a short one too: it is the
 * multi-page gallery `gallery-append.spec.ts`/`gallery-sections.spec.ts`
 * already exercise for pagination, so it doubles as the one fixture that can
 * prove AB#106 decision 3's first-page-only rule — the lead, the body, and
 * the page-jump navigation appearing on the first page and actually being
 * absent from a continuation, not merely absent everywhere because there was
 * nothing to omit.
 *
 * One set per language subtag, keyed by the immutable `contentId`. Some pages
 * remain English-only, which is the normal state of a bilingual site whose
 * translations are still being written and keeps the fallback path exercised.
 */

import type { ContentBlock, ContentPage } from "@/lib/content-page";
import type { ContentVariant } from "@/lib/content-tree";
import { withLocalizedText } from "@/lib/media";
import { mockAuthoredContentRecords } from "@/lib/mock-content-listing";
import { FIELDNOTE_NUMBERS, fieldnoteContentId } from "@/lib/mock-fieldnotes";
import { getMockImages, mockImages } from "@/lib/mock-media";

/** What a page adds to the record a card already carries. */
type AuthoredPage = GalleryPresentationFields & {
  readonly variant: ContentVariant;
  readonly endGalleryId?: string;
  /**
   * Overrides the site-wide `photographerName` on this article's byline
   * (AB#151). Article-only by convention — never set on a `variant: "gallery"`
   * entry, matching `ArticleContentPage`'s own field; nothing here enforces
   * that structurally, the same trust this fixture layer already places in
   * itself for other per-variant fields.
   */
  readonly author?: string;
  readonly tags?: readonly string[];
  readonly body: readonly ContentBlock[];
};

/**
 * Minimal bodies for the generated Gear field notes — see `mock-fieldnotes.ts`.
 * One paragraph each: enough for the detail route each listing card links to
 * to resolve, without a body worth reading.
 */
const fieldnotePages: Readonly<Record<string, AuthoredPage>> = Object.fromEntries(
  FIELDNOTE_NUMBERS.map((n) => [
    fieldnoteContentId(n),
    {
      variant: "article" as const,
      body: [
        {
          type: "paragraph",
          text: "A short placeholder note. Replaced with real content from the CMS.",
        },
      ] satisfies readonly ContentBlock[],
    },
  ]),
);

function comparisonFixtures(language: string): readonly ContentBlock[] {
  const images = getMockImages(language);
  const fi = language === "fi";
  return [
    { type: "image-comparison", key: "comparison-compatible", title: fi ? "Valon vertailu" : "Comparing light", first: { ...images.lakesideReeds, caption: fi ? "Ensimmäinen esimerkkikuva." : "First example image." }, second: { ...images.lichenStones, credit: "Placeholder credit" }, firstLabel: fi ? "Ensimmäinen näkymä" : "First view", secondLabel: fi ? "Toinen näkymä" : "Second view" },
    { type: "image-comparison", key: "comparison-incompatible", title: fi ? "Erilaiset kuvasuhteet" : "Different image ratios", first: images.coastalLandscape, second: images.forestStream, firstLabel: fi ? "Vaakakuva" : "Landscape", secondLabel: fi ? "Pystykuva" : "Portrait" },
  ];
}

const englishPages: Readonly<Record<string, AuthoredPage>> = {
  ...fieldnotePages,
  "content-selected-work": {
    variant: "gallery",
    body: [],
  },
  // AB#150/ADR-0017 auto-hide fixtures. Both carry a permanently-past
  // `endDate` (on their authored records), so every public read treats them
  // as unpublished — their detail routes 404. A minimal body is enough for
  // `compose` to resolve them.
  "content-ended-gallery": {
    variant: "gallery",
    body: [],
  },
  "content-ended-article": {
    variant: "article",
    body: [
      {
        type: "paragraph",
        text: "A time-limited announcement whose scheduled end date has passed. Placeholder content.",
      },
    ],
  },
  "content-coastal-mornings": {
    variant: "gallery",
    tags: ["coastal", "morning light"],
    body: [
      ...comparisonFixtures("en"),
      { type: "media", media: mockImages.coastalLandscape },
      { type: "mini-gallery", items: [
        { media: mockImages.forestStream }, { media: mockImages.mistyBirch },
        { media: mockImages.forestStream },
      ] },
      { type: "mini-gallery", items: [
        { media: mockImages.openMarsh }, { media: mockImages.lakesideReeds },
      ] },

      {
        type: "paragraph",
        text: "This series began as a habit rather than a plan: a handful of early starts turned into a standing appointment with the tide. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Why first light" },
      {
        type: "paragraph",
        text: "The half hour before sunrise gives the coast its own quiet contrast — enough definition in the wet rock to hold texture, not yet enough sun to flatten it. Placeholder copy.",
      },
      {
        type: "list",
        ordered: false,
        items: [
          "Arrive while it is still properly dark",
          "Let the eyes adjust before checking a screen",
          "Wait for the tide table, not the alarm clock",
        ],
      },
      {
        type: "media",
        media: {
          ...mockImages.lichenStones,
          caption:
            "Placeholder image and caption; replaced with real photography from the CMS.",
        },
      },
      { type: "heading", level: 2, text: "Returning to the same shoreline" },
      {
        type: "blockquote",
        text: "The coast is different every morning you bother to show up for it.",
      },
    ],
  },
  // AB#21: the gallery-side fixture authoring all three body heading levels
  // (content-choosing-a-telephoto-lens is the article-side one), alongside
  // `content-hero.spec.ts`'s existing use of this gallery to prove the
  // no-authored-cover state — this body change does not touch its cover
  // field.
  "content-polar-night-sessions": {
    variant: "gallery",
    body: [
      {
        type: "paragraph",
        text: "Winter darkness above the Arctic Circle leaves a narrow window each day where the sky still holds some colour. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Planning around the light" },
      {
        type: "paragraph",
        text: "The blue hour on either side of the short polar day is the most reliable window for a session; midday sun barely clears the horizon here. Placeholder copy.",
      },
      { type: "heading", level: 3, text: "Checking the aurora forecast" },
      {
        type: "paragraph",
        text: "A clear forecast is necessary but not sufficient — cloud low on the horizon can still block a display a wider index would otherwise predict. Placeholder copy.",
      },
      { type: "heading", level: 4, text: "Reading the KP index" },
      {
        type: "paragraph",
        text: "A KP index of three or higher is a reasonable minimum at this latitude, though a strong display can appear at lower values too. Placeholder copy.",
      },
      { type: "heading", level: 2, text: "Staying warm enough to wait" },
      {
        type: "paragraph",
        text: "Most failed sessions end early because of cold hands, not clouds. Placeholder copy.",
      },
      // AB#22: the gallery-side table, proving the block is shared by both
      // content variants rather than article-only. Deliberately narrow and
      // caption-less, so the fixture layer also covers the fallback that names
      // the scroll region from the built-in labels instead of a caption.
      {
        type: "table",
        headers: ["Session", "Start", "Cloud cover"],
        rows: [
          ["Blue hour", "10:40", "Broken"],
          ["Civil twilight", "11:25", "Overcast"],
          ["Aurora watch", "21:00", "Clear"],
        ],
      },
      // AB#163: the gallery-side tab group, one data table per tab — the same
      // scoped shape the Joomla migration's own Bootstrap tab widget carried.
      // Each tab's table is captioned deliberately: the standalone AB#22
      // table just above is this page's own fixture for the *fallback*
      // built-in-label case, and a same-page caption-less table here would
      // collide with it under the shared "Table" name (found by the CI
      // journey `content-table.spec.ts` itself, run against a real build).
      {
        type: "tab-group",
        tabs: [
          {
            key: "december",
            label: "December",
            table: {
              caption: "December sessions",
              headers: ["Session", "Start", "Cloud cover"],
              rows: [
                ["Blue hour", "10:50", "Clear"],
                ["Aurora watch", "20:30", "Broken"],
              ],
            },
          },
          {
            key: "january",
            label: "January",
            table: {
              caption: "January sessions",
              headers: ["Session", "Start", "Cloud cover"],
              rows: [
                ["Blue hour", "10:35", "Overcast"],
                ["Aurora watch", "21:15", "Clear"],
              ],
            },
          },
        ],
      },
    ],
  },
  "content-awaiting-selection": {
    variant: "gallery",
    body: [],
  },
  "content-large-archive": {
    variant: "gallery",
    // Deliberately minimal: this gallery's own job is exercising pagination
    // at scale (AB#114/AB#134), not editorial content. A short body still
    // proves the first-page-only rendering rule (AB#106 decision 3) — the
    // page-jump navigation and this body must appear on the first page and
    // be absent from every continuation, not merely be absent everywhere
    // because there was nothing to show in the first place.
    body: [
      {
        type: "paragraph",
        text: "This archive exists to exercise pagination at scale rather than to tell a story. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "About this archive" },
      {
        type: "paragraph",
        text: "Every item below is part of the same bounded, keyset-paginated result the grid and the lightbox share. Placeholder copy.",
      },
    ],
  },
  "content-shuffled-showcase": {
    // The seeded-random gallery (AB#129). Like the large archive, its job is
    // exercising an ordering rule and its keyset pagination, not editorial
    // content, so it carries no body.
    variant: "gallery",
    body: [],
  },
  "content-masonry-below": { variant: "gallery", galleryLayout: "masonry", galleryCaptionPlacement: "below", body: [] },
  "content-masonry-overlay": { variant: "gallery", galleryLayout: "masonry", galleryCaptionPlacement: "overlay", body: [] },
  "content-grid-overlay": { variant: "gallery", galleryLayout: "grid", galleryCaptionPlacement: "overlay", body: [] },
  "content-justified-below": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "below", body: [] },
  "content-justified-overlay": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "overlay", body: [] },
  "content-layout-single": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "below", body: [] },
  "content-layout-pair": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "overlay", body: [] },
  "content-reading-coastal-light": {
    variant: "article",
    endGalleryId: "coastal-light-end-gallery",
    tags: ["light", "coastal", "landscape"],
    body: [
      ...comparisonFixtures("en"),
      {
        type: "paragraph",
        text: "An overcast morning is not a compromise on the coast. Flat light removes the contrast that hides texture in wet rock, and the shoreline shows a great deal more of itself than it does an hour after sunrise. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Waiting for the cloud to even out" },
      {
        type: "paragraph",
        text: "The half hour while high cloud thickens is usually the most useful of the morning. Shadows lose their edges without the scene going grey, and the water keeps enough shape to read as water. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "Bad light is mostly light you have not worked out what to do with yet.",
      },
    ],
  },
  "content-choosing-a-telephoto-lens": {
    variant: "article",
    // AB#151 override-path fixture: a guest-contributor byline, distinct from
    // the site-wide `photographerName` ("Jane Example") every other article
    // falls back to.
    author: "Alex Rivers",
    tags: ["lenses", "telephoto", "sports photography"],
    body: [
      ...mockPolls.map((poll) => ({ type: "poll" as const, ...poll, key: poll.pollId })),

      {
        type: "paragraph",
        text: "A telephoto lens purchase is one of the most significant investments a photographer makes. The headline specs — focal length range and maximum aperture — are easy to compare, but they rarely tell you how a lens actually behaves in the field. Placeholder copy; replaced with real content from the CMS.",
      },
      {
        type: "paragraph",
        text: "Read the checklist below, or visit the example reference.",
        spans: [
          {text: "Read the "},
          {text: "checklist below", href: "#section-key-specifications-to-evaluate"},
          {text: ", or visit the "},
          {text: "example reference", href: "https://example.org/reference"},
          {text: "."},
        ],
      },
      {
        type: "list",
        ordered: true,
        items: ["Review the specifications.", "Keep your own notes."],
        itemSpans: [
          [{text: "Review the "}, {text: "specifications", href: "#section-key-specifications-to-evaluate"}, {text: "."}],
          [{text: "Keep your own notes."}],
        ],
      },
      { type: "heading", level: 2, text: "Autofocus: speed vs. accuracy" },
      {
        type: "paragraph",
        text: "For action shooting, autofocus accuracy matters more than raw speed. A lens that locks on instantly but hunts under challenging light will cost you more keepers than a slightly slower one that hits reliably. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "The best telephoto is the one you can hand-hold reliably — weight and balance matter as much as optics.",
      },
      { type: "heading", level: 2, text: "Key specifications to evaluate" },
      // AB#21: a level-3 and level-4 heading nested under this level-2
      // section, so the fixture layer exercises the full three-level body
      // heading model rather than only level 2.
      { type: "heading", level: 3, text: "Build and handling" },
      {
        type: "list",
        ordered: false,
        items: [
          "Minimum focusing distance (especially for events and portraits)",
          "Tripod collar included or optional",
          "Weather sealing rating",
          "Teleconverter compatibility",
          "Image stabilisation effectiveness in stops",
        ],
      },
      // AB#22: the article-side data table. Eight columns — the maximum — so
      // the fixture exercises the overflow path the block's own scroll region
      // exists for, and one deliberately empty cell, because a gap in a
      // comparison table is authored content rather than a defect.
      {
        type: "table",
        caption: "Placeholder specifications; replaced with real data from the CMS.",
        headers: [
          "Lens",
          "Focal length",
          "Max aperture",
          "Weight",
          "Min focus",
          "Stabilisation",
          "Sealing",
          "Teleconverter",
        ],
        rows: [
          ["Model A", "70–200 mm", "f/2.8", "1480 g", "0.96 m", "5.5 stops", "Yes", "1.4× / 2×"],
          ["Model B", "100–400 mm", "f/4.5–5.6", "1395 g", "0.98 m", "5.0 stops", "Yes", "1.4×"],
          ["Model C", "300 mm", "f/4", "755 g", "1.40 m", "4.0 stops", "Yes", ""],
          ["Model D", "150–600 mm", "f/5–6.3", "2100 g", "2.20 m", "4.5 stops", "No", "1.4× / 2×"],
        ],
      },
      // AB#163: the article-side tab group, one data table per tab — the same
      // scoped shape the Joomla migration's own Bootstrap tab widget carried.
      {
        type: "tab-group",
        tabs: [
          {
            key: "burst-raw",
            label: "RAW burst",
            table: {
              headers: ["Card", "Buffer clear", "Frames"],
              rows: [
                ["Card A", "16.7 s", "28"],
                ["Card B", "37.0 s", "25"],
              ],
            },
          },
          {
            key: "burst-jpeg",
            label: "JPEG burst",
            table: {
              headers: ["Card", "Buffer clear", "Frames"],
              rows: [
                ["Card A", "5.2 s", "85"],
                ["Card B", "6.1 s", "80"],
              ],
            },
          },
        ],
      },
      { type: "heading", level: 4, text: "Weather sealing in the field" },
      {
        type: "paragraph",
        text: "A weather-sealed lens still needs a matched body to be fully protected — check the manufacturer's own compatibility notes rather than assuming any sealed lens plus any sealed body adds up to a sealed system. Placeholder copy.",
      },
      {
        type: "media",
        media: {
          ...mockImages.mistyBirch,
          caption:
            "Placeholder image and caption; replaced with real photography from the CMS.",
        },
      },
      { type: "heading", level: 2, text: "Video walkthrough" },
      {
        type: "paragraph",
        text: "The video below shows the lens in use during a real motorsport event. Placeholder copy.",
      },
      {
        type: "youtube",
        videoId: "dQw4w9WgXcQ",
        title: "Telephoto lens field test — motorsport",
      },
      { type: "heading", level: 2, text: "Conclusion" },
      {
        type: "paragraph",
        text: "No single telephoto suits every photographer. Define your primary use case first, then evaluate lenses against those real-world demands rather than spec-sheet numbers. Placeholder copy.",
      },
      {
        // A second body image after the video block, so the body lightbox has
        // an ordered sequence to navigate and the YouTube block between the two
        // images is provably not a slide.
        type: "media",
        media: {
          ...mockImages.forestStream,
          caption:
            "Second placeholder image and caption; replaced with real photography from the CMS.",
        },
      },
    ],
  },
  "content-understanding-exposure-triangle": {
    variant: "article",
    tags: ["exposure", "basics", "technique"],
    body: [
      {
        type: "paragraph",
        text: "Every exposure decision is a trade-off. Freeze motion with a fast shutter and you pay with a wider aperture or higher ISO. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Aperture: depth of field vs. light" },
      {
        type: "paragraph",
        text: "A wide aperture (small f-number) gathers more light and compresses depth of field. This is desirable for portraits and isolating subjects, but counterproductive for landscapes where front-to-back sharpness is the goal. Placeholder copy.",
      },
      {
        type: "media",
        media: {
          ...mockImages.forestStream,
          caption:
            "Placeholder image and caption; replaced with real photography from the CMS.",
        },
      },
      {
        type: "heading",
        level: 2,
        text: "Shutter speed: motion and camera shake",
      },
      {
        type: "paragraph",
        text: "The classic rule is to keep shutter speed above the reciprocal of focal length (1/200s at 200 mm). Image stabilisation buys you extra stops, but cannot freeze a moving subject. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "Expose to the right: a slightly overexposed raw file recovers better than an underexposed one.",
        attribution: "Common digital photography guideline",
      },
      { type: "heading", level: 2, text: "ISO: noise vs. exposure" },
      {
        type: "list",
        ordered: true,
        items: [
          "Set aperture for desired depth of field",
          "Set shutter speed to freeze or blur motion as needed",
          "Raise ISO until exposure is correct",
          "Check noise at 100% and adjust if necessary",
        ],
      },
    ],
  },
  "content-packing-for-a-photo-trip": {
    variant: "article",
    tags: ["travel", "packing", "gear"],
    body: [
      {
        type: "paragraph",
        text: "The single biggest mistake photographers make when packing for travel is over-packing lenses and under-packing accessories. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "The camera bag" },
      {
        type: "list",
        ordered: false,
        items: [
          "Camera body + one spare battery",
          "Two lenses: a versatile zoom and one prime",
          "Circular polariser and ND filter",
          "Cleaning kit: sensor swabs, blower, microfibre cloth",
          "Two memory cards plus one backup card in wallet",
        ],
      },
      { type: "heading", level: 2, text: "What stays in the hold luggage" },
      {
        type: "paragraph",
        text: "Heavier support gear travels in checked luggage: tripod, extra lenses, laptop and hard drives. Everything I need for a day of shooting fits in the carry-on. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "If the airline loses my hold luggage I can still shoot. That is the test.",
      },
    ],
  },
  "content-shooting-in-low-light": {
    variant: "article",
    tags: ["low light", "technique", "ISO"],
    body: [
      {
        type: "paragraph",
        text: "Shooting hand-held in low light used to mean accepting significant noise or motion blur. Current camera bodies at ISO 3200–6400 produce files that clean up well in post. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Maximise light gathering" },
      {
        type: "list",
        ordered: false,
        items: [
          "Use the fastest lens available (f/1.4–f/2.8)",
          "Enable in-body image stabilisation if available",
          "Switch to electronic shutter to eliminate vibration",
          "Shoot raw: more latitude for noise reduction in post",
        ],
      },
      {
        type: "media",
        media: {
          ...mockImages.mistyBirch,
          caption:
            "Placeholder image and caption; replaced with real photography from the CMS.",
        },
      },
      { type: "heading", level: 2, text: "Post-processing" },
      {
        type: "paragraph",
        text: "Luminance noise reduction has improved dramatically with AI-based tools. Apply it selectively: reduce chroma noise aggressively, luminance noise more conservatively to preserve texture. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "A slightly noisy, sharp image beats a noise-free, blurry one every time.",
      },
    ],
  },
};

/**
 * A small Finnish set makes the localized browsing route useful while some
 * English siblings deliberately remain untranslated. The latter still make
 * the switch exercise ADR-0003 decision 7's parent-category or story-root
 * fallback.
 */
const finnishPages: Readonly<Record<string, AuthoredPage>> = {
  "content-selected-work": {
    variant: "gallery",
    body: [],
  },
  "content-coastal-mornings": {
    variant: "gallery",
    tags: ["rannikko", "aamuvalo"],
    body: [
      ...comparisonFixtures("fi"),
      {
        type: "paragraph",
        text: "Tästä sarjasta tuli tapa ennemmin kuin suunnitelma: muutamasta aikaisesta aamusta kasvoi vakituinen tapaaminen vuoroveden kanssa. Paikkamerkkiteksti; korvataan CMS:n sisällöllä.",
      },
      { type: "heading", level: 2, text: "Miksi ensimmäinen valo" },
      {
        type: "paragraph",
        text: "Puoli tuntia ennen auringonnousua rannikko saa oman hiljaisen kontrastinsa — juuri tarpeeksi valoa paljastamaan märän kiven pinnan, mutta ei vielä liikaa tasoittamaan sitä. Paikkamerkkiteksti.",
      },
      {
        type: "list",
        ordered: false,
        items: [
          "Saavu vielä pimeään aikaan",
          "Anna silmien tottua ennen puhelimeen vilkaisua",
          "Odota vuorovettä, älä herätyskelloa",
        ],
      },
      {
        type: "media",
        media: withLocalizedText(mockImages.lichenStones, {
          alt: "Jäkälän peittämiä kiviä rantaviivalla",
          caption:
            "Paikkamerkkikuva ja -kuvateksti; korvataan oikealla valokuvalla CMS:stä.",
        }),
      },
      { type: "heading", level: 2, text: "Samalle rantaviivalle palaaminen" },
      {
        type: "blockquote",
        text: "Rannikko on erilainen joka aamu, jolloin viitsit tulla katsomaan sitä.",
      },
    ],
  },
  "content-polar-night-sessions": {
    variant: "gallery",
    body: [
      {
        type: "paragraph",
        text: "Napapiirin pohjoispuolinen talvipimeys jättää joka päivä kapean hetken, jolloin taivaalla on yhä hieman väriä. Paikkamerkkisisältöä; korvataan CMS:n oikealla sisällöllä.",
      },
      { type: "heading", level: 2, text: "Valon mukaan suunnittelu" },
      {
        type: "paragraph",
        text: "Sinihetki lyhyen napapäivän molemmin puolin on kuvausajankohdista luotettavin; keskipäivän aurinko tuskin nousee horisontin yläpuolelle täällä. Paikkamerkkisisältöä.",
      },
      { type: "heading", level: 3, text: "Revontuliennusteen tarkistaminen" },
      {
        type: "paragraph",
        text: "Kirkas ennuste on välttämätön mutta ei riittävä — matala pilvi horisontissa voi yhä estää näkymän, jonka laajempi indeksi muuten ennustaisi. Paikkamerkkisisältöä.",
      },
      { type: "heading", level: 4, text: "KP-indeksin lukeminen" },
      {
        type: "paragraph",
        text: "KP-indeksi kolme tai enemmän on kohtuullinen vähimmäisarvo tällä leveysasteella, vaikka voimakas näytös voi ilmestyä pienemmilläkin arvoilla. Paikkamerkkisisältöä.",
      },
      { type: "heading", level: 2, text: "Riittävän lämpimänä odottaessa" },
      {
        type: "paragraph",
        text: "Useimmat epäonnistuneet kuvausretket päättyvät kylmien käsien, ei pilvien, takia. Paikkamerkkisisältöä.",
      },
      // AB#22: the Finnish gallery-side table, caption-less like its English
      // counterpart, so the built-in-label fallback is covered in both
      // locales rather than only the harness's own.
      {
        type: "table",
        headers: ["Kuvausikkuna", "Alkaa", "Pilvisyys"],
        rows: [
          ["Sinihetki", "10.40", "Puolipilvistä"],
          ["Siviilihämärä", "11.25", "Pilvistä"],
          ["Revontulivahti", "21.00", "Selkeää"],
        ],
      },
      // AB#163: the Finnish gallery-side tab group, the same scoped shape the
      // Joomla migration's own Bootstrap tab widget carried. Captioned for
      // the same reason the English copy is: this page's own AB#22 fixture
      // already owns the caption-less fallback-label case.
      {
        type: "tab-group",
        tabs: [
          {
            key: "joulukuu",
            label: "Joulukuu",
            table: {
              caption: "Joulukuun kuvausikkunat",
              headers: ["Kuvausikkuna", "Alkaa", "Pilvisyys"],
              rows: [
                ["Sinihetki", "10.50", "Selkeää"],
                ["Revontulivahti", "20.30", "Puolipilvistä"],
              ],
            },
          },
          {
            key: "tammikuu",
            label: "Tammikuu",
            table: {
              caption: "Tammikuun kuvausikkunat",
              headers: ["Kuvausikkuna", "Alkaa", "Pilvisyys"],
              rows: [
                ["Sinihetki", "10.35", "Pilvistä"],
                ["Revontulivahti", "21.15", "Selkeää"],
              ],
            },
          },
        ],
      },
    ],
  },
  "content-awaiting-selection": {
    variant: "gallery",
    body: [],
  },
  "content-large-archive": {
    variant: "gallery",
    body: [
      {
        type: "paragraph",
        text: "Tämä arkisto on olemassa laajan sivutuksen testaamista varten, ei tarinankerrontaa. Paikkamerkkisisältöä; korvataan CMS:n oikealla sisällöllä.",
      },
      { type: "heading", level: 2, text: "Tietoa tästä arkistosta" },
      {
        type: "paragraph",
        text: "Jokainen alla oleva kohde on osa samaa rajattua, avaimin sivutettua tulosjoukkoa, jota ruudukko ja valotaulu jakavat. Paikkamerkkisisältöä.",
      },
    ],
  },
  "content-shuffled-showcase": {
    variant: "gallery",
    body: [],
  },
  "content-masonry-below": { variant: "gallery", galleryLayout: "masonry", galleryCaptionPlacement: "below", body: [] },
  "content-masonry-overlay": { variant: "gallery", galleryLayout: "masonry", galleryCaptionPlacement: "overlay", body: [] },
  "content-grid-overlay": { variant: "gallery", galleryLayout: "grid", galleryCaptionPlacement: "overlay", body: [] },
  "content-justified-below": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "below", body: [] },
  "content-justified-overlay": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "overlay", body: [] },
  "content-layout-single": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "below", body: [] },
  "content-layout-pair": { variant: "gallery", galleryLayout: "justified", galleryCaptionPlacement: "overlay", body: [] },
  "content-reading-coastal-light": {
    variant: "article",
    endGalleryId: "coastal-light-end-gallery",
    tags: ["valo", "rannikko", "maisemakuvaus"],
    body: [
      ...comparisonFixtures("fi"),
      {
        type: "paragraph",
        text: "Pilvinen aamu ei ole rannikolla kompromissi. Tasainen valo tuo märän kiven pinnan ja veden pienet sävyerot näkyviin ilman kovia varjoja. Paikkamerkkiteksti; korvataan CMS:n sisällöllä.",
      },
      { type: "heading", level: 2, text: "Odota valon tasaantumista" },
      {
        type: "paragraph",
        text: "Hyödyllisin hetki alkaa usein silloin, kun yläpilvi tihenee mutta maisema ei vielä muutu harmaaksi. Vesi säilyttää muotonsa ja rantaviivan yksityiskohdat erottuvat. Paikkamerkkiteksti.",
      },
      {
        type: "blockquote",
        text: "Huono valo on usein vain valoa, jolle et ole vielä löytänyt käyttötapaa.",
      },
    ],
  },
  "content-understanding-exposure-triangle": {
    variant: "article",
    tags: ["valotus", "perusteet", "tekniikka"],
    body: [
      {
        type: "paragraph",
        text: "Jokainen valotuspäätös on vaihtokauppa. Kun pysäytät liikkeen lyhyellä valotusajalla, maksat siitä suuremmalla aukolla tai korkeammalla herkkyydellä. Paikkamerkkiteksti; korvataan CMS:n sisällöllä.",
      },
      { type: "heading", level: 2, text: "Aukko: syväterävyys ja valo" },
      {
        type: "paragraph",
        text: "Suuri aukko kerää enemmän valoa ja kaventaa syväterävyyttä. Muotokuvassa se on etu, maisemassa haitta, kun kuvan pitäisi olla terävä reunasta reunaan. Paikkamerkkiteksti.",
      },
      {
        type: "media",
        // The same rendition its English version places, with Finnish words:
        // alt text and a caption are read aloud and displayed in the page's own
        // language, so they are authored rather than copied across locales.
        media: withLocalizedText(mockImages.forestStream, {
          alt: "Metsäpuro virtaa tummien sammaleisten kivien yli",
          caption:
            "Paikkamerkkikuva ja -kuvateksti; korvataan oikealla valokuvalla CMS:stä.",
        }),
      },
      { type: "heading", level: 2, text: "Valotusaika: liike ja tärähdys" },
      {
        type: "paragraph",
        text: "Nyrkkisääntö on pitää valotusaika lyhyempänä kuin polttovälin käänteisluku (1/200 s, kun polttoväli on 200 mm). Kuvanvakain antaa lisää aukkoja, mutta ei pysäytä liikkuvaa kohdetta. Paikkamerkkiteksti.",
      },
      { type: "heading", level: 2, text: "Herkkyys: kohina ja valotus" },
      {
        type: "list",
        ordered: true,
        items: [
          "Valitse aukko halutun syväterävyyden mukaan",
          "Valitse valotusaika liikkeen mukaan",
          "Nosta herkkyyttä, kunnes valotus on oikea",
          "Tarkista kohina täydellä suurennoksella",
        ],
      },
      // AB#22: the Finnish article-side table. Headers and caption are
      // authored in the page's own language for the same reason its alt text
      // and captions are — a table is read, not just displayed.
      {
        type: "table",
        caption: "Paikkamerkkiarvoja; korvataan CMS:n oikeilla tiedoilla.",
        headers: ["Tilanne", "Aukko", "Valotusaika", "Herkkyys"],
        rows: [
          ["Muotokuva ulkona", "f/2.0", "1/250 s", "ISO 200"],
          ["Maisema jalustalta", "f/11", "1/15 s", "ISO 100"],
          ["Urheilu sisällä", "f/2.8", "1/800 s", "ISO 3200"],
          ["Yökuvaus", "f/4.0", "20 s", "ISO 1600"],
        ],
      },
      // AB#163: the Finnish article-side tab group, the same scoped shape the
      // Joomla migration's own Bootstrap tab widget carried.
      {
        type: "tab-group",
        tabs: [
          {
            key: "raw-sarja",
            label: "RAW-sarjakuvaus",
            table: {
              headers: ["Kortti", "Puskurin tyhjennys", "Kuvia"],
              rows: [
                ["Kortti A", "16,7 s", "28"],
                ["Kortti B", "37,0 s", "25"],
              ],
            },
          },
          {
            key: "jpeg-sarja",
            label: "JPEG-sarjakuvaus",
            table: {
              headers: ["Kortti", "Puskurin tyhjennys", "Kuvia"],
              rows: [
                ["Kortti A", "5,2 s", "85"],
                ["Kortti B", "6,1 s", "80"],
              ],
            },
          },
        ],
      },
    ],
  },
  "content-shooting-in-low-light": {
    variant: "article",
    tags: ["hämärä", "käsivarakuvaus", "tekniikka"],
    body: [
      {
        type: "paragraph",
        text: "Hämärässä käsivaralta kuvaaminen alkaa liikkeen tunnistamisesta: liikkuva kohde tarvitsee lyhyemmän valotusajan kuin paikallaan pysyvä maisema. Paikkamerkkiteksti; korvataan CMS:n sisällöllä.",
      },
      { type: "heading", level: 2, text: "Valitse valotusaika ensin" },
      {
        type: "paragraph",
        text: "Aseta lyhin valotusaika, jolla kohteen liike pysähtyy, ja anna herkkyyden nousta vasta sen jälkeen. Kuvanvakain auttaa kameran tärähdykseen, mutta ei pysäytä kohdetta. Paikkamerkkiteksti.",
      },
      { type: "heading", level: 2, text: "Tarkista tulos paikan päällä" },
      {
        type: "list",
        ordered: false,
        items: [
          "Tarkista tärkeimmän yksityiskohdan terävyys",
          "Seuraa kirkkaiden alueiden palamista",
          "Nosta herkkyyttä ennen kuin pidennät valotusaikaa liikaa",
        ],
      },
    ],
  },
};

/**
 * Joins each authored body to the listing record that carries its shared
 * fields. A body naming a `contentId` the language has no record for is a
 * fixture defect, and saying so here is the cheapest place to find it.
 *
 * `cover` is read from `mockAuthoredContentRecords` — the pre-fallback record
 * — never `mockContentListingRecords`'s `cover`, which may carry the
 * gallery's deterministic first-item fallback the listing card is allowed to
 * show but a hero must not repeat by default (AB#149, ADR-0003's 2026-09-04
 * amendment). The raw `publishedAt`/`eventDate`/`endDate` a `ContentPage`
 * carries (AB#150, ADR-0017) live only on the authored record — the card
 * contract's `mockContentListingRecords` exposes the already-resolved
 * effective `eventDate` instead — so this function reads everything from the
 * authored map rather than splitting the read across both.
 */
function compose(
  language: string,
  pages: Readonly<Record<string, AuthoredPage>>,
): ReadonlyMap<string, ContentPage> {
  const authoredRecords = mockAuthoredContentRecords[language];

  return new Map(
    Object.entries(pages).map(([contentId, page]) => {
      const record = authoredRecords?.get(contentId);
      if (record === undefined) {
        throw new TypeError(
          `mock content page "${contentId}" has no ${language} listing record`,
        );
      }
      const images = getMockImages(language);
      const miniItems = [
        { media: { ...images.forestStream, caption: language === "fi" ? "Esimerkkikuvateksti" : "Example caption", credit: "Placeholder credit" } },
        { media: { ...images.openMarsh, alt: "" } },
        { media: images.forestStream },
      ];
      const body: readonly ContentBlock[] = contentId === "content-reading-coastal-light"
        ? [...page.body,
          { type: "media", media: images.forestStream },
          { type: "mini-gallery", title: language === "fi" ? "Yksityiskohtia" : "Details", items: miniItems },
          { type: "mini-gallery", title: language === "fi" ? "Yksityiskohtia" : "Details", items: miniItems.slice(0, 2) },
        ]
        : language === "fi" && contentId === "content-coastal-mornings"
          ? [
            { type: "media", media: images.coastalLandscape },
            { type: "mini-gallery", items: miniItems },
            { type: "mini-gallery", items: miniItems.slice(0, 2) },
            ...page.body,
          ]
          : page.body;
      return [
        contentId,
        {
          contentId,
          title: record.title,
          ...(record.summary === undefined ? {} : { summary: record.summary }),
          publishedAt: record.publishedAt,
          ...(record.eventDate === undefined ? {} : { eventDate: record.eventDate }),
          ...(record.endDate === undefined ? {} : { endDate: record.endDate }),
          ...(record.cover === undefined ? {} : { cover: record.cover }),
          ...page,
          body,
        },
      ];
    }),
  );
}

/** Authored content pages per language subtag. */
export const mockContentPages: Readonly<
  Record<string, ReadonlyMap<string, ContentPage>>
> = {
  en: compose("en", englishPages),
  fi: compose("fi", finnishPages),
};
