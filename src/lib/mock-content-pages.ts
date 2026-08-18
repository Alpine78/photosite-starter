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
 * `content-coastal-mornings` authors one (AB#106), so the long-form body,
 * its page-jump navigation, and a body media placement distinct from the
 * gallery's own curated items are all exercised by a fixture rather than only
 * by a test.
 *
 * One set per language subtag, keyed by the immutable `contentId`. Some pages
 * remain English-only, which is the normal state of a bilingual site whose
 * translations are still being written and keeps the fallback path exercised.
 */

import type { ContentBlock, ContentPage } from "@/lib/content-page";
import type { ContentVariant } from "@/lib/content-tree";
import { withLocalizedText } from "@/lib/media";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
import { mockImages } from "@/lib/mock-media";

/** What a page adds to the record a card already carries. */
type AuthoredPage = {
  readonly variant: ContentVariant;
  readonly tags?: readonly string[];
  readonly body: readonly ContentBlock[];
};

const englishPages: Readonly<Record<string, AuthoredPage>> = {
  "content-selected-work": {
    variant: "gallery",
    body: [],
  },
  "content-coastal-mornings": {
    variant: "gallery",
    tags: ["coastal", "morning light"],
    body: [
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
  "content-polar-night-sessions": {
    variant: "gallery",
    body: [],
  },
  "content-awaiting-selection": {
    variant: "gallery",
    body: [],
  },
  "content-large-archive": {
    variant: "gallery",
    body: [],
  },
  "content-reading-coastal-light": {
    variant: "article",
    tags: ["light", "coastal", "landscape"],
    body: [
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
    tags: ["lenses", "telephoto", "sports photography"],
    body: [
      {
        type: "paragraph",
        text: "A telephoto lens purchase is one of the most significant investments a photographer makes. The headline specs — focal length range and maximum aperture — are easy to compare, but they rarely tell you how a lens actually behaves in the field. Placeholder copy; replaced with real content from the CMS.",
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
    body: [],
  },
  "content-awaiting-selection": {
    variant: "gallery",
    body: [],
  },
  "content-large-archive": {
    variant: "gallery",
    body: [],
  },
  "content-reading-coastal-light": {
    variant: "article",
    tags: ["valo", "rannikko", "maisemakuvaus"],
    body: [
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
 */
function compose(
  language: string,
  pages: Readonly<Record<string, AuthoredPage>>,
): ReadonlyMap<string, ContentPage> {
  const records = mockContentListingRecords[language];

  return new Map(
    Object.entries(pages).map(([contentId, page]) => {
      const record = records?.get(contentId);
      if (record === undefined) {
        throw new TypeError(
          `mock content page "${contentId}" has no ${language} listing record`,
        );
      }
      return [contentId, { ...record, ...page }];
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
