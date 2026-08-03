const deploymentSettingNames = {
  locale: "SITE_LOCALE",
  canonicalBaseUrl: "SITE_CANONICAL_BASE_URL",
  defaultSocialImage: "SITE_DEFAULT_SOCIAL_IMAGE",
} as const;

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
  readonly locale: string;
  readonly canonicalBaseUrl: URL;
  /** Validated here; AB#17 owns emitting it as Open Graph metadata. */
  readonly defaultSocialImage: URL;
  readonly labels: BuiltInLabels;
};

/**
 * Application-owned copy that a clone can adjust without editing route or
 * component markup. Authored content and brand data remain in SiteSettings.
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

function parseLocale(value: string): string {
  try {
    return new Intl.Locale(value).toString();
  } catch {
    throw new Error(
      `[deployment-config] Invalid ${deploymentSettingNames.locale}: expected a valid BCP 47 locale, received "${value}"`,
    );
  }
}

function parseHttpUrl(
  value: string,
  settingName: string,
  baseUrl?: URL,
): URL {
  let url: URL;

  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected an absolute HTTP(S) URL${baseUrl ? " or relative path" : ""}, received "${value}"`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[deployment-config] Invalid ${settingName}: expected HTTP(S), received "${value}"`,
    );
  }

  return url;
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
  const canonicalBaseUrl = parseHttpUrl(
    requireSetting(environment, deploymentSettingNames.canonicalBaseUrl),
    deploymentSettingNames.canonicalBaseUrl,
  );
  const defaultSocialImage = parseHttpUrl(
    requireSetting(environment, deploymentSettingNames.defaultSocialImage),
    deploymentSettingNames.defaultSocialImage,
    canonicalBaseUrl,
  );

  return {
    locale,
    canonicalBaseUrl,
    defaultSocialImage,
    labels: builtInLabels,
  };
}

let cachedDeploymentConfig: DeploymentConfig | undefined;

export function getDeploymentConfig(): DeploymentConfig {
  cachedDeploymentConfig ??= loadDeploymentConfig(process.env);
  return cachedDeploymentConfig;
}
