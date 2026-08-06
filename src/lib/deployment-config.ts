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
import { RESERVED_ROOT_SEGMENTS } from "@/lib/public-routes";

const deploymentSettingNames = {
  locale: "SITE_LOCALE",
  localeRoutes: "SITE_LOCALE_ROUTES",
  canonicalBaseUrl: "SITE_CANONICAL_BASE_URL",
  defaultSocialImage: "SITE_DEFAULT_SOCIAL_IMAGE",
  defaultSocialImageVersion: "SITE_DEFAULT_SOCIAL_IMAGE_VERSION",
  defaultSocialImageWidth: "SITE_DEFAULT_SOCIAL_IMAGE_WIDTH",
  defaultSocialImageHeight: "SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT",
  defaultSocialImageAlt: "SITE_DEFAULT_SOCIAL_IMAGE_ALT",
} as const;

/** Stable project identity for the deployment-owned social preview image. */
const DEFAULT_SOCIAL_IMAGE_MEDIA_ID = "deployment-default-social-image";

export type BuiltInLabels = {
  readonly pages: {
    readonly home: string;
    readonly services: string;
    readonly portfolio: string;
    readonly blog: string;
  };
  readonly navigation: {
    readonly main: string;
    readonly footer: string;
    readonly breadcrumb: string;
    readonly article: string;
    readonly categoryFilter: string;
    readonly menu: string;
    readonly closeMenu: string;
  };
  readonly actions: {
    readonly viewPortfolio: string;
    readonly contactAboutService: string;
    readonly previousArticle: string;
    readonly nextArticle: string;
    readonly watchOnYouTube: string;
  };
  readonly footer: {
    readonly contact: string;
    readonly explore: string;
    readonly follow: string;
    readonly businessId: string;
    readonly rightsReserved: string;
  };
  readonly blog: {
    readonly allCategories: string;
    readonly emptyCategory: string;
    readonly tags: string;
  };
  readonly services: {
    readonly pricing: string;
  };
  readonly gallery: {
    readonly images: string;
  };
  readonly media: {
    readonly video: string;
    readonly youtubePrivacyNotice: string;
  };
};

export type DeploymentConfig = {
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

/**
 * Application-owned copy that a clone can adjust without editing route or
 * component markup. Authored content and brand data remain in SiteSettings.
 *
 * These labels are deployment-wide, not per-locale: SITE_LOCALE does not
 * translate them, so a single-locale deployment keeps them in sync with that
 * setting by hand. A locale prefix reserves its route space (SITE_LOCALE_ROUTES),
 * but the first page rendered inside it needs a per-locale label set first.
 */
export const builtInLabels = {
  pages: {
    home: "Home",
    services: "Services",
    portfolio: "Portfolio",
    blog: "Blog",
  },
  navigation: {
    main: "Main",
    footer: "Footer",
    breadcrumb: "Breadcrumb",
    article: "Article navigation",
    categoryFilter: "Filter by category",
    menu: "Menu",
    closeMenu: "Close",
  },
  actions: {
    viewPortfolio: "View portfolio",
    contactAboutService: "Contact about this",
    previousArticle: "Previous",
    nextArticle: "Next",
    watchOnYouTube: "Watch on YouTube",
  },
  footer: {
    contact: "Contact",
    explore: "Explore",
    follow: "Follow",
    businessId: "Business ID",
    rightsReserved: "All rights reserved.",
  },
  blog: {
    allCategories: "All",
    emptyCategory: "No articles in this category yet.",
    tags: "Tags",
  },
  services: {
    pricing: "Pricing",
  },
  gallery: {
    images: "images",
  },
  media: {
    video: "Video",
    youtubePrivacyNotice:
      "Opens an embedded YouTube player. YouTube may set cookies.",
  },
} as const satisfies BuiltInLabels;

type DeploymentEnvironment = Record<string, string | undefined>;

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

function parseLocale(value: string): string {
  try {
    return new Intl.Locale(value).toString();
  } catch {
    throw new Error(
      `[deployment-config] Invalid ${deploymentSettingNames.locale}: expected a valid BCP 47 locale, received "${value}"`,
    );
  }
}

/**
 * Reads the deployment's locale routing: one `locale|prefix|namespace` entry
 * per supported locale, separated by commas. The default locale leaves the
 * prefix field empty, because its routes carry no prefix:
 *
 *     fi||tarinat,en|en|stories
 *
 * Every rule the entries must satisfy — one unprefixed default, unique
 * prefixes, no collision with a root route the application already owns — is
 * the route contract's, so the values are validated there and reported against
 * the setting that supplied them.
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
