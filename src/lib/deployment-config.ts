import {
  buildLocaleRouteConfig,
  type LocaleRouteConfig,
  type LocaleRouteInput,
} from "@/lib/locale-routes";
import {
  MAX_PUBLIC_IMAGE_DIMENSION,
  projectPublicImageMedia,
  readLocalPublicImageVersion,
  type ImageMedia,
} from "@/lib/media";
import {
  RESERVED_LOCALE_ROUTE_SEGMENTS,
  RESERVED_ROOT_SEGMENTS,
} from "@/lib/public-routes";

const deploymentSettingNames = {
  stage: "SITE_DEPLOYMENT_STAGE",
  locale: "SITE_LOCALE",
  localeRoutes: "SITE_LOCALE_ROUTES",
  canonicalBaseUrl: "SITE_CANONICAL_BASE_URL",
  defaultSocialImage: "SITE_DEFAULT_SOCIAL_IMAGE",
  defaultSocialImageVersion: "SITE_DEFAULT_SOCIAL_IMAGE_VERSION",
  defaultSocialImageWidth: "SITE_DEFAULT_SOCIAL_IMAGE_WIDTH",
  defaultSocialImageHeight: "SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT",
  defaultSocialImageAlt: "SITE_DEFAULT_SOCIAL_IMAGE_ALT",
} as const;

type DeploymentEnvironment = Record<string, string | undefined>;

/** Stable project identity for the deployment-owned social preview image. */
const DEFAULT_SOCIAL_IMAGE_MEDIA_ID = "deployment-default-social-image";

export type BuiltInLabels = {
  readonly pages: {
    readonly home: string;
    readonly services: string;
    readonly portfolio: string;
    readonly contact: string;
    /** The public content tree's root, whatever segment the locale routes it at. */
    readonly stories: string;
  };
  readonly navigation: {
    readonly main: string;
    readonly footer: string;
    readonly breadcrumb: string;
    /** Names the links to a page's neighbours in publication order. */
    readonly adjacentContent: string;
    readonly menu: string;
    readonly closeMenu: string;
  };
  readonly actions: {
    readonly viewPortfolio: string;
    readonly contactAboutService: string;
    /** The newer neighbour, and the older one, in publication order. */
    readonly previousPage: string;
    readonly nextPage: string;
    readonly watchOnYouTube: string;
  };
  readonly footer: {
    readonly contact: string;
    readonly explore: string;
    readonly follow: string;
    readonly businessId: string;
    readonly rightsReserved: string;
  };
  readonly services: {
    readonly pricing: string;
  };
  readonly contact: {
    /**
     * Subject of the email the site owner receives. It carries no
     * visitor-supplied text, so a stranger never writes in the one line a mail
     * client shows before anyone has decided to trust the message.
     */
    readonly emailSubject: string;
    readonly nameLabel: string;
    readonly emailLabel: string;
    readonly messageLabel: string;
    /**
     * Accessible name of the field no person can see. It has to read like a
     * field a form-filling bot expects, which is why it is ordinary copy
     * rather than a warning.
     */
    readonly honeypotLabel: string;
    readonly submit: string;
    /** Replaces `submit` while a submission is in flight. */
    readonly submitting: string;
    readonly retry: string;
    readonly successTitle: string;
    readonly successBody: string;
    /** Heading of the summary that lists every field error at once. */
    readonly errorSummaryTitle: string;
    /** Marks a required field visually; assistive technology reads `required`. */
    readonly requiredMark: string;
    /** Delivery failed in a way a second attempt could survive. */
    readonly errorRetryable: string;
    /** Delivery failed in a way a second attempt cannot change. */
    readonly errorPermanent: string;
    /** The request itself was refused, so the page state is stale. */
    readonly errorRequest: string;
    /** Labels the correlation identifier a visitor can quote when asking. */
    readonly referenceLabel: string;
    readonly privacyTitle: string;
    readonly privacyCollected: string;
    readonly privacyPurpose: string;
    readonly privacyRecipient: string;
    readonly privacyRetention: string;
    /**
     * One message per validation issue the server can report. `tooLong`
     * contains `{max}`, replaced with the field's own limit, so one string
     * serves three fields with three different limits.
     */
    readonly fieldErrors: {
      readonly required: string;
      readonly tooLong: string;
      readonly invalidEmail: string;
    };
  };
  readonly contentTree: {
    /** Heading above a branch's public child categories. */
    readonly categories: string;
    /** Heading above the content pages a branch lists. */
    readonly content: string;
    /**
     * Heading above a page's keywords. Separate from categories: tags consume
     * no tree depth and own no route of their own.
     */
    readonly tags: string;
    /** Names the table of contents derived from a body's level-2 headings. */
    readonly onThisPage: string;
    /** Accessible name of the language switch. */
    readonly languages: string;
    /**
     * Qualifies a language the target version is missing from: the switch
     * opens the canonical parent category instead of an exact translation.
     */
    readonly parentCategoryFallback: string;
    /** Qualifies a language whose parent ancestry is missing too. */
    readonly storyRootFallback: string;
  };
  readonly gallery: {
    readonly images: string;
  };
  readonly lightbox: {
    /** Accessible name of the fullscreen dialog itself. */
    readonly viewer: string;
    /** Names a trigger whose image is decorative and carries no alt text. */
    readonly openImage: string;
    readonly close: string;
    readonly previous: string;
    readonly next: string;
    readonly zoom: string;
    /** Joins position and total in the counter, as in "1 of 6". */
    readonly indexSeparator: string;
    readonly loadError: string;
  };
  readonly media: {
    readonly video: string;
    readonly youtubePrivacyNotice: string;
  };
};

/**
 * Which environment this deployment *is*, as the deployment itself declares it.
 *
 * It exists so a safeguard can refuse something in production that is correct
 * everywhere else. The contact form's sink adapter is the first such case:
 * accepting a message and sending nothing is exactly right for development, CI,
 * and Preview, and is silent data loss in production.
 *
 * Read from a project-owned setting rather than a hosting provider's own
 * variable, because a clone may run anywhere and the guarantee has to survive
 * the move.
 */
export type DeploymentStage = "development" | "preview" | "production";

const DEPLOYMENT_STAGES: readonly DeploymentStage[] = [
  "development",
  "preview",
  "production",
];

export type DeploymentConfig = {
  readonly stage: DeploymentStage;
  /**
   * Default locale: the one that owns the unprefixed visitor-facing routes and
   * supplies the document language and date formatting outside a localized
   * route space.
   */
  readonly locale: string;
  /**
   * Which locales this deployment publishes and where their routes live.
   * Route configuration, not editable CMS content: adding a locale gives only
   * the new language a prefix, while changing the default locale or a live
   * prefix is a route migration with its own redirect plan.
   */
  readonly localeRoutes: LocaleRouteConfig;
  readonly canonicalBaseUrl: URL;
  /**
   * Social preview image used by pages that carry no content image of their
   * own. It crosses the same public media boundary as any other browser-facing
   * image, so a configured value that is not a versioned public web derivative
   * fails the deployment instead of reaching a crawler.
   *
   * Its dimensions are declared rather than measured: the file is
   * deployment-owned, and nothing in the running application can read its size.
   * A wrong declaration is a deployment error the clone owns, like the
   * canonical base URL itself.
   */
  readonly defaultSocialImage: ImageMedia;
};

const englishLabels = {
  pages: {
    home: "Home",
    services: "Services",
    portfolio: "Portfolio",
    contact: "Contact",
    stories: "Stories",
  },
  navigation: {
    main: "Main",
    footer: "Footer",
    breadcrumb: "Breadcrumb",
    adjacentContent: "Story navigation",
    menu: "Menu",
    closeMenu: "Close",
  },
  actions: {
    viewPortfolio: "View portfolio",
    contactAboutService: "Contact about this",
    previousPage: "Previous",
    nextPage: "Next",
    watchOnYouTube: "Watch on YouTube",
  },
  footer: {
    contact: "Contact",
    explore: "Explore",
    follow: "Follow",
    businessId: "Business ID",
    rightsReserved: "All rights reserved.",
  },
  services: {
    pricing: "Pricing",
  },
  contact: {
    emailSubject: "New contact message",
    nameLabel: "Name",
    emailLabel: "Email",
    messageLabel: "Message",
    honeypotLabel: "Company",
    submit: "Send message",
    submitting: "Sending…",
    retry: "Try again",
    successTitle: "Message sent",
    successBody: "Thank you. We will reply to the address you gave.",
    errorSummaryTitle: "Please check the following",
    requiredMark: "*",
    errorRetryable: "The message could not be sent. Please try again in a moment.",
    errorPermanent: "The message could not be sent. Please email us directly instead.",
    errorRequest: "The message could not be sent. Please reload the page and try again.",
    referenceLabel: "Reference",
    privacyTitle: "How your message is handled",
    privacyCollected: "Collected",
    privacyPurpose: "Purpose",
    privacyRecipient: "Recipient",
    privacyRetention: "Retention",
    fieldErrors: {
      required: "This field is required.",
      tooLong: "Please shorten this to {max} characters or fewer.",
      invalidEmail: "Please enter an email address we can reply to.",
    },
  },
  contentTree: {
    categories: "Categories",
    content: "Stories",
    tags: "Tags",
    onThisPage: "On this page",
    languages: "Language",
    parentCategoryFallback: "opens the parent category",
    storyRootFallback: "opens all stories",
  },
  gallery: {
    images: "images",
  },
  lightbox: {
    viewer: "Image viewer",
    openImage: "Open image",
    close: "Close",
    previous: "Previous image",
    next: "Next image",
    zoom: "Zoom",
    indexSeparator: " of ",
    loadError: "The image cannot be loaded",
  },
  media: {
    video: "Video",
    youtubePrivacyNotice:
      "Opens an embedded YouTube player. YouTube may set cookies.",
  },
} as const satisfies BuiltInLabels;

const finnishLabels = {
  pages: {
    home: "Etusivu",
    services: "Palvelut",
    portfolio: "Portfolio",
    contact: "Ota yhteyttä",
    stories: "Tarinat",
  },
  navigation: {
    main: "Päävalikko",
    footer: "Alatunniste",
    breadcrumb: "Murupolku",
    adjacentContent: "Tarinanavigointi",
    menu: "Valikko",
    closeMenu: "Sulje",
  },
  actions: {
    viewPortfolio: "Katso portfolio",
    contactAboutService: "Kysy lisää",
    previousPage: "Edellinen",
    nextPage: "Seuraava",
    watchOnYouTube: "Katso YouTubessa",
  },
  footer: {
    contact: "Yhteystiedot",
    explore: "Sivut",
    follow: "Seuraa",
    businessId: "Y-tunnus",
    rightsReserved: "Kaikki oikeudet pidätetään.",
  },
  services: {
    pricing: "Hinnoittelu",
  },
  contact: {
    emailSubject: "Uusi yhteydenotto",
    nameLabel: "Nimi",
    emailLabel: "Sähköposti",
    messageLabel: "Viesti",
    honeypotLabel: "Yritys",
    submit: "Lähetä viesti",
    submitting: "Lähetetään…",
    retry: "Yritä uudelleen",
    successTitle: "Viesti lähetetty",
    successBody: "Kiitos. Vastaamme antamaasi sähköpostiosoitteeseen.",
    errorSummaryTitle: "Tarkista seuraavat kohdat",
    requiredMark: "*",
    errorRetryable: "Viestin lähetys ei onnistunut. Yritä hetken kuluttua uudelleen.",
    errorPermanent: "Viestin lähetys ei onnistunut. Ota yhteyttä suoraan sähköpostitse.",
    errorRequest: "Viestin lähetys ei onnistunut. Lataa sivu uudelleen ja yritä uudestaan.",
    referenceLabel: "Viite",
    privacyTitle: "Näin viestisi käsitellään",
    privacyCollected: "Kerättävät tiedot",
    privacyPurpose: "Käyttötarkoitus",
    privacyRecipient: "Vastaanottaja",
    privacyRetention: "Säilytysaika",
    fieldErrors: {
      required: "Tämä kenttä on pakollinen.",
      tooLong: "Lyhennä tämä enintään {max} merkkiin.",
      invalidEmail: "Anna sähköpostiosoite, johon voimme vastata.",
    },
  },
  contentTree: {
    categories: "Kategoriat",
    content: "Tarinat",
    tags: "Avainsanat",
    onThisPage: "Tällä sivulla",
    languages: "Kieli",
    parentCategoryFallback: "avaa yläkategorian",
    storyRootFallback: "avaa kaikki tarinat",
  },
  gallery: {
    images: "kuvaa",
  },
  lightbox: {
    viewer: "Kuvakatselin",
    openImage: "Avaa kuva",
    close: "Sulje",
    previous: "Edellinen kuva",
    next: "Seuraava kuva",
    zoom: "Suurenna",
    // A counter reads "1 / 6" in Finnish, where English reads "1 of 6".
    indexSeparator: " / ",
    loadError: "Kuvaa ei voi ladata",
  },
  media: {
    video: "Video",
    youtubePrivacyNotice:
      "Avaa upotetun YouTube-soittimen. YouTube voi asettaa evästeitä.",
  },
} as const satisfies BuiltInLabels;

/**
 * Application-owned copy that a clone can adjust without editing route or
 * component markup. Authored content and brand data remain in SiteSettings.
 *
 * One set per language subtag, not per configured locale: `en-GB` and `en-US`
 * are the same UI copy, and the route contract already keeps their public paths
 * apart. Every locale in SITE_LOCALE_ROUTES must find a set here, so a
 * deployment cannot publish a route space whose chrome it has no words for;
 * `loadDeploymentConfig` rejects the configuration instead of falling back to
 * another language.
 */
const localeLabels = {
  en: englishLabels,
  fi: finnishLabels,
} as const satisfies Record<string, BuiltInLabels>;

/**
 * The label set a route renders in. Callers pass the locale their route space
 * belongs to, which for an unprefixed page is the deployment's default locale.
 */
export function getBuiltInLabels(locale: string): BuiltInLabels {
  const language = readLanguageSubtag(locale);
  const labels =
    language === undefined ? undefined : localeLabels[language as keyof typeof localeLabels];

  if (labels === undefined) {
    throw new TypeError(
      `no built-in label set for locale "${locale}"; add one to localeLabels in src/lib/deployment-config.ts`,
    );
  }
  return labels;
}

/**
 * Labels for the unprefixed route space, which the default locale owns. Routes
 * that can render in more than one locale space pass their own locale to
 * `getBuiltInLabels` instead.
 */
export function getDefaultLocaleLabels(): BuiltInLabels {
  return getBuiltInLabels(getDeploymentConfig().locale);
}

function readLanguageSubtag(locale: string): string | undefined {
  try {
    const { language } = new Intl.Locale(locale);
    return typeof language === "string" && language.length > 0
      ? language
      : undefined;
  } catch {
    return undefined;
  }
}

function requireSetting(
  environment: DeploymentEnvironment,
  settingName: string,
): string {
  const value = environment[settingName]?.trim();

  if (!value) {
    throw new Error(
      `[deployment-config] Missing required deployment setting: ${settingName}`,
    );
  }

  return value;
}

function readOptionalSetting(
  environment: DeploymentEnvironment,
  settingName: string,
): string | undefined {
  const value = environment[settingName]?.trim();
  return value ? value : undefined;
}

/**
 * Parses a declared intrinsic pixel dimension. The upper bound is the public
 * media boundary's, so a deployment cannot declare a social image larger than
 * any rendition the site is allowed to publish.
 */
function parseImageDimension(value: string, settingName: string): number {
  // Digits only: `Number` would also accept "1e3" and "0x10", so a typo could
  // parse into a plausible-looking dimension instead of failing.
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_PUBLIC_IMAGE_DIMENSION
  ) {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected an integer between 1 and ${MAX_PUBLIC_IMAGE_DIMENSION}, received "${value}"`,
    );
  }

  return parsed;
}

/**
 * Reads the declared deployment stage.
 *
 * An unset value means `production`, which is the fail-closed direction: an
 * operator who forgets the setting gets the environment with the safeguards
 * on, not the one that quietly accepts a development shortcut. Local
 * development and CI declare themselves explicitly, which `.env.example` and
 * the Playwright harness both do.
 */
export function readDeploymentStage(
  environment: DeploymentEnvironment,
): DeploymentStage {
  const value = environment[deploymentSettingNames.stage]?.trim();
  if (!value) return "production";

  if (!DEPLOYMENT_STAGES.includes(value as DeploymentStage)) {
    throw new Error(
      `[deployment-config] Invalid ${deploymentSettingNames.stage}: expected one of ${DEPLOYMENT_STAGES.join(", ")}, received "${value}"`,
    );
  }
  return value as DeploymentStage;
}

function parseLocale(value: string): string {
  let parsed: Intl.Locale;
  try {
    parsed = new Intl.Locale(value);
  } catch {
    throw new Error(
      `[deployment-config] Invalid ${deploymentSettingNames.locale}: expected a valid BCP 47 locale with a concrete language subtag, received "${value}"`,
    );
  }

  if (typeof parsed.language !== "string" || parsed.language.length === 0) {
    throw new Error(
      `[deployment-config] Invalid ${deploymentSettingNames.locale}: expected a valid BCP 47 locale with a concrete language subtag, received "${value}"`,
    );
  }

  return parsed.toString();
}

/**
 * Reads the deployment's locale routing: one `locale|prefix|namespace` entry
 * per supported locale, separated by commas. The default locale leaves the
 * prefix field empty, because its routes carry no prefix:
 *
 *     fi||tarinat,en|en|stories
 *
 * Every rule the entries must satisfy — one unprefixed default, unique
 * prefixes, no collision with a root route or localized static route — is the
 * route contract's, so the values are validated there and reported against the
 * setting that supplied them.
 */
function parseLocaleRoutes(
  environment: DeploymentEnvironment,
  defaultLocale: string,
): LocaleRouteConfig {
  const settingName = deploymentSettingNames.localeRoutes;
  const value = requireSetting(environment, settingName);

  const locales: LocaleRouteInput[] = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const fields = entry.split("|").map((field) => field.trim());
      if (fields.length !== 3) {
        throw new Error(
          `[deployment-config] Invalid ${settingName}: expected comma-separated "locale|prefix|namespace" entries, received "${entry}"`,
        );
      }
      const [locale, prefix, storyNamespace] = fields;
      return {
        locale,
        prefix: prefix.length === 0 ? null : prefix,
        storyNamespace,
      };
    });

  let config: LocaleRouteConfig;
  try {
    config = buildLocaleRouteConfig({
      locales,
      reservedRootSegments: RESERVED_ROOT_SEGMENTS,
      reservedLocaleRouteSegments: RESERVED_LOCALE_ROUTE_SEGMENTS,
    });
  } catch (cause) {
    if (cause instanceof TypeError) {
      throw new Error(
        `[deployment-config] Invalid ${settingName}: ${cause.message}`,
        { cause },
      );
    }
    throw cause;
  }

  // Which locale is default decides the whole unprefixed route space, so the
  // two settings that name it may not disagree: a deployment declaring one
  // language for its documents and another for its canonical URLs is a
  // configuration error, not a preference to reconcile at request time.
  if (config.defaultLocale !== defaultLocale) {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: the unprefixed default locale "${config.defaultLocale}" must match ${deploymentSettingNames.locale} "${defaultLocale}"`,
    );
  }

  // A configured locale owns a public route space, so its pages need UI copy.
  // Checked at startup rather than at request time: discovering the gap when a
  // visitor opens the route would render that language's chrome in another one.
  for (const route of config.locales) {
    try {
      getBuiltInLabels(route.locale);
    } catch (cause) {
      throw new Error(
        `[deployment-config] Invalid ${settingName}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }

  return config;
}

/**
 * Parses the public origin that every canonical and Open Graph URL is built
 * from.
 *
 * It must be a bare HTTP(S) origin. Credentials, a query, or a fragment would
 * be published in `rel="canonical"` and `og:url`; a base path would be silently
 * dropped when a root-relative route path is resolved against it, producing
 * canonical URLs that point at pages the deployment does not serve. Both are
 * rejected rather than repaired, because guessing the intended origin would
 * make every emitted URL a guess.
 */
function parseCanonicalBaseUrl(value: string): URL {
  const settingName = deploymentSettingNames.canonicalBaseUrl;
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected an absolute HTTP(S) URL, received "${value}"`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected HTTP(S), received "${value}"`,
    );
  }

  if (url.username || url.password) {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: credentials must not appear in a published canonical URL`,
    );
  }

  if (url.search || url.hash) {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected an origin without a query or fragment, received "${value}"`,
    );
  }

  if (url.pathname !== "/") {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected an origin without a path, received "${value}". Serving the site below a path would need a matching Next.js basePath and route-aware canonical composition.`,
    );
  }

  return url;
}

/**
 * Projects the configured social preview image through the public media
 * boundary, so the same rules that guard every browser-facing image guard this
 * one: a versioned public web derivative, HTTPS or a local gallery path, no
 * credentials, no fragment, and true intrinsic dimensions.
 *
 * A local gallery path carries its byte version in the filename. A remote
 * derivative has no such convention, so it declares the version separately and
 * the media boundary checks that the URL really contains it.
 */
function parseDefaultSocialImage(
  environment: DeploymentEnvironment,
): ImageMedia {
  const settingName = deploymentSettingNames.defaultSocialImage;
  const src = requireSetting(environment, settingName);
  const localVersion = readLocalPublicImageVersion(src);

  // Which version source applies depends on the shape of the configured value,
  // so the shape is settled first. Demanding a version for a value that could
  // never be a public derivative would report the wrong problem; the media
  // boundary below still owns the real validation.
  if (localVersion === undefined && !src.startsWith("https://")) {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected a versioned local /gallery path or an HTTPS URL, received "${src}"`,
    );
  }

  const version =
    localVersion ??
    requireSetting(
      environment,
      deploymentSettingNames.defaultSocialImageVersion,
    );

  try {
    return projectPublicImageMedia({
      mediaId: DEFAULT_SOCIAL_IMAGE_MEDIA_ID,
      publiclyRenderable: true,
      rendition: {
        sourceKind: "public-web-derivative",
        src,
        version,
        width: parseImageDimension(
          requireSetting(
            environment,
            deploymentSettingNames.defaultSocialImageWidth,
          ),
          deploymentSettingNames.defaultSocialImageWidth,
        ),
        height: parseImageDimension(
          requireSetting(
            environment,
            deploymentSettingNames.defaultSocialImageHeight,
          ),
          deploymentSettingNames.defaultSocialImageHeight,
        ),
      },
      // An undeclared alt is an empty one: decorative, and never invented.
      alt:
        readOptionalSetting(
          environment,
          deploymentSettingNames.defaultSocialImageAlt,
        ) ?? "",
    });
  } catch (cause) {
    if (cause instanceof TypeError || cause instanceof RangeError) {
      throw new Error(
        `[deployment-config] Invalid ${settingName}: ${cause.message}`,
        { cause },
      );
    }
    throw cause;
  }
}

/**
 * Builds and validates deployment-owned settings. Passing the environment in
 * keeps validation deterministic in tests while production uses process.env.
 */
export function loadDeploymentConfig(
  environment: DeploymentEnvironment,
): DeploymentConfig {
  const locale = parseLocale(
    requireSetting(environment, deploymentSettingNames.locale),
  );
  const canonicalBaseUrl = parseCanonicalBaseUrl(
    requireSetting(environment, deploymentSettingNames.canonicalBaseUrl),
  );

  return {
    stage: readDeploymentStage(environment),
    locale,
    localeRoutes: parseLocaleRoutes(environment, locale),
    canonicalBaseUrl,
    defaultSocialImage: parseDefaultSocialImage(environment),
  };
}

let cachedDeploymentConfig: DeploymentConfig | undefined;

export function getDeploymentConfig(): DeploymentConfig {
  cachedDeploymentConfig ??= loadDeploymentConfig(process.env);
  return cachedDeploymentConfig;
}
