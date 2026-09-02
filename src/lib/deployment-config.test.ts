import { describe, expect, it } from "vitest";

import { loadDeploymentConfig } from "@/lib/deployment-config";

const validEnvironment = {
  // Declared, because the deployment config now validates it: an unset value
  // fails, and `mock` in a production stage fails.
  SITE_CONTENT_SOURCE: "mock",
  SITE_DEPLOYMENT_STAGE: "development",
  SITE_LOCALE: "en-GB",
  SITE_LOCALE_ROUTES: "en-GB||stories",
  SITE_CANONICAL_BASE_URL: "https://example.com",
  SITE_DEFAULT_SOCIAL_IMAGE:
    "/gallery/coastal-landscape.1683eecb7e65.webp",
  SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536",
  SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
};

describe("deployment stage", () => {
  it("defaults to production when the stage is not declared", () => {
    // Fail-closed: an operator who forgets the setting gets the environment
    // with the safeguards on, not the one that accepts a development shortcut.
    // Paired with a Sanity source, because the production stage is exactly
    // where the mock fixtures are refused.
    expect(
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEPLOYMENT_STAGE: undefined,
        SITE_CONTENT_SOURCE: "sanity",
      }).stage,
    ).toBe("production");
  });

  it.each([
    ["development", "mock"],
    ["preview", "mock"],
    // Production is paired with a Sanity source because that stage refuses the
    // demo fixtures outright — the two settings are validated together.
    ["production", "sanity"],
  ])("reads a declared %s stage", (stage, contentSource) => {
    expect(
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEPLOYMENT_STAGE: stage,
        SITE_CONTENT_SOURCE: contentSource,
      }).stage,
    ).toBe(stage);
  });

  it("refuses a stage it does not recognize", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEPLOYMENT_STAGE: "staging",
      }),
    ).toThrow("Invalid SITE_DEPLOYMENT_STAGE");
  });
});

describe("content source", () => {
  it("carries the declared source on the deployment config", () => {
    expect(loadDeploymentConfig(validEnvironment).contentSource).toBe("mock");
  });

  it("fails the deployment when no source is declared", () => {
    // The whole point of validating it here: every route resolves the
    // deployment config, so this fails the build rather than waiting for some
    // future adapter to consult the setting.
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_CONTENT_SOURCE: undefined,
      }),
    ).toThrow("SITE_CONTENT_SOURCE");
  });

  it("fails a production deployment configured to serve demo content", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEPLOYMENT_STAGE: "production",
      }),
    ).toThrow("must not run in a production deployment");
  });
});

describe("loadDeploymentConfig", () => {
  it("loads and normalizes valid deployment settings", () => {
    const config = loadDeploymentConfig(validEnvironment);

    expect(config.locale).toBe("en-GB");
    expect(config.canonicalBaseUrl.href).toBe("https://example.com/");
    expect(config.defaultSocialImage.rendition).toMatchObject({
      src: "/gallery/coastal-landscape.1683eecb7e65.webp",
      version: "1683eecb7e65",
      width: 1536,
      height: 1024,
    });
  });

  it("treats an undeclared default social image alt text as decorative", () => {
    expect(loadDeploymentConfig(validEnvironment).defaultSocialImage.alt).toBe(
      "",
    );
  });

  describe("private client galleries (ADR-0014 §9)", () => {
    it("defaults to off with the reserved default route prefix", () => {
      expect(loadDeploymentConfig(validEnvironment).privateGallery).toEqual({
        store: "off",
        routePrefix: "private",
        adminRoutePrefix: "admin",
      });
    });

    it("reads an explicit enabled switch and a custom prefix", () => {
      expect(
        loadDeploymentConfig({
          ...validEnvironment,
          PRIVATE_GALLERY_STORE: "enabled",
          PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
          PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "studio",
        }).privateGallery,
      ).toEqual({
        store: "enabled",
        routePrefix: "clients",
        adminRoutePrefix: "studio",
      });
    });

    it("fails the build when a locale prefix collides with the private route prefix", () => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          SITE_LOCALE_ROUTES: "en-GB||stories,fi|clients|tarinat",
          PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
        }),
      ).toThrow(/locale prefix "clients" collides/);
    });

    it("fails the build when the private route prefix is a segment the app already owns", () => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          PRIVATE_GALLERY_ROUTE_PREFIX: "services",
        }),
      ).toThrow(/PRIVATE_GALLERY_ROUTE_PREFIX/);
    });

    it("fails the build when the private route prefix is a legacy-redirect root (ADR-0014 §6)", () => {
      // `component` is the root of every retired Joomla tag path
      // (`legacy-redirects-data.ts`); a `/component/...` request would resolve
      // as a cacheable 410 before the private response-hygiene headers apply.
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          PRIVATE_GALLERY_ROUTE_PREFIX: "component",
        }),
      ).toThrow(/legacy-redirect path/);
    });

    it("fails the build when a locale prefix collides with the admin route prefix", () => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          SITE_LOCALE_ROUTES: "en-GB||stories,fi|studio|tarinat",
          PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "studio",
        }),
      ).toThrow(/locale prefix "studio" collides/);
    });

    it("fails the build when a story namespace collides with the admin route prefix", () => {
      // The whole point of reserving the segment while the feature is off: a
      // clone that gave `/studio` to public routing could not turn
      // administration on later without a public URL migration.
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          SITE_LOCALE_ROUTES: "en-GB||studio,fi|fi|tarinat",
          PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "studio",
        }),
      ).toThrow(/studio/);
    });

    it("fails the build when the admin route prefix is a segment the app already owns", () => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "services",
        }),
      ).toThrow(/PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX/);
    });

    it("fails the build when the admin route prefix is a legacy-redirect root (ADR-0015 §1)", () => {
      // Same hazard as the customer namespace: the Proxy answers the legacy
      // registry before it can apply the response-hygiene headers, so a
      // colliding prefix would let an administrator path return a cacheable 410.
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "component",
        }),
      ).toThrow(/legacy-redirect path/);
    });

    it("reserves both namespaces at once rather than only the customer one", () => {
      // Both prefixes custom, so neither reservation can be passing by
      // coincidence of a default. Each is claimed by a locale prefix in turn.
      const customPrefixes = {
        ...validEnvironment,
        PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
        PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "studio",
      };

      expect(() =>
        loadDeploymentConfig({
          ...customPrefixes,
          SITE_LOCALE_ROUTES: "en-GB||stories,fi|clients|tarinat",
        }),
      ).toThrow(/locale prefix "clients" collides/);

      expect(() =>
        loadDeploymentConfig({
          ...customPrefixes,
          SITE_LOCALE_ROUTES: "en-GB||stories,fi|studio|tarinat",
        }),
      ).toThrow(/locale prefix "studio" collides/);

      // And the same configuration with neither claimed is valid, so the two
      // assertions above are refusals of the collision rather than of the
      // configuration itself.
      expect(() => loadDeploymentConfig(customPrefixes)).not.toThrow();
    });

    it("fails the build on a NEXT_PUBLIC_ mirror of a private-gallery secret, feature off", () => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          NEXT_PUBLIC_PRIVATE_GALLERY_CAPABILITY_KEYS: "k:AAAA",
        }),
      ).toThrow(/NEXT_PUBLIC_PRIVATE_GALLERY_CAPABILITY_KEYS/);
    });
  });

  it("keeps a declared default social image alt text", () => {
    const config = loadDeploymentConfig({
      ...validEnvironment,
      SITE_DEFAULT_SOCIAL_IMAGE_ALT: " Rocky shoreline beside calm water ",
    });

    expect(config.defaultSocialImage.alt).toBe(
      "Rocky shoreline beside calm water",
    );
  });

  it.each([
    "SITE_LOCALE",
    "SITE_LOCALE_ROUTES",
    "SITE_CANONICAL_BASE_URL",
    "SITE_DEFAULT_SOCIAL_IMAGE",
    "SITE_DEFAULT_SOCIAL_IMAGE_WIDTH",
    "SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT",
  ])("fails clearly when %s is missing", (settingName) => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        [settingName]: " ",
      }),
    ).toThrow(`Missing required deployment setting: ${settingName}`);
  });

  it("rejects an invalid locale", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_LOCALE: "not_a_locale",
      }),
    ).toThrow("Invalid SITE_LOCALE");
  });

  it("rejects a locale without a concrete language subtag", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_LOCALE: "und",
        SITE_LOCALE_ROUTES: "und||stories",
      }),
    ).toThrow("Invalid SITE_LOCALE");
  });

  it("reads the locale route space of a bilingual deployment", () => {
    const config = loadDeploymentConfig({
      ...validEnvironment,
      SITE_LOCALE: "fi",
      SITE_LOCALE_ROUTES: "fi||tarinat, en|en|stories",
    });

    expect(config.localeRoutes.defaultLocale).toBe("fi");
    expect(
      config.localeRoutes.locales.map((route) => [
        route.locale,
        route.basePath,
        route.storyNamespace,
      ]),
    ).toEqual([
      ["fi", "", "tarinat"],
      ["en", "/en", "stories"],
    ]);
  });

  it("rejects locale routes that do not name the configured default locale", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_LOCALE: "fi",
        SITE_LOCALE_ROUTES: "en||stories,fi|fi|tarinat",
      }),
    ).toThrow(
      'the unprefixed default locale "en" must match SITE_LOCALE "fi"',
    );
  });

  it("rejects a malformed locale route entry", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_LOCALE_ROUTES: "en-GB|stories",
      }),
    ).toThrow('expected comma-separated "locale|prefix|namespace" entries');
  });

  // The reservation is checked against this application's own root routes, so
  // a prefix that a static route would shadow fails the deployment.
  it("rejects a locale prefix an application route already owns", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_LOCALE_ROUTES: "en-GB||stories,fi|services|tarinat",
      }),
    ).toThrow(
      'Invalid SITE_LOCALE_ROUTES: locale prefix "services" collides with a root route',
    );
  });

  it("rejects a story namespace a localized static route already owns", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_LOCALE: "fi",
        SITE_LOCALE_ROUTES: "fi||tarinat,en|en|services",
      }),
    ).toThrow(
      'Invalid SITE_LOCALE_ROUTES: story namespace "services" for locale "en" collides with a localized static route',
    );
  });

  it("rejects a non-HTTP canonical base URL", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_CANONICAL_BASE_URL: "ftp://example.com",
      }),
    ).toThrow("Invalid SITE_CANONICAL_BASE_URL");
  });

  // A canonical base URL is published verbatim in rel="canonical" and og:url,
  // and a base path would be dropped when a route path resolves against it.
  it("rejects canonical base URL credentials", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_CANONICAL_BASE_URL: "https://user:secret@example.com",
      }),
    ).toThrow("credentials must not appear in a published canonical URL");
  });

  it.each(["https://example.com?utm=x", "https://example.com#top"])(
    "rejects the canonical base URL %s",
    (value) => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          SITE_CANONICAL_BASE_URL: value,
        }),
      ).toThrow("expected an origin without a query or fragment");
    },
  );

  it("rejects a canonical base URL carrying a path", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_CANONICAL_BASE_URL: "https://example.com/site",
      }),
    ).toThrow("expected an origin without a path");
  });

  it.each([
    "data:image/png;base64,abc",
    "/private/master.jpg",
    "/gallery/coastal-landscape.webp",
    "http://cdn.example.com/social.1683eecb7e65.webp",
  ])("rejects the default social image source %s", (value) => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: value,
      }),
    ).toThrow(
      "expected a versioned local /gallery path or an HTTPS URL",
    );
  });

  it("rejects a local social image whose filename version was edited away", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.nothex12345.webp",
      }),
    ).toThrow("expected a versioned local /gallery path or an HTTPS URL");
  });

  it("accepts a remote derivative that declares its byte version", () => {
    const config = loadDeploymentConfig({
      ...validEnvironment,
      SITE_DEFAULT_SOCIAL_IMAGE:
        "https://cdn.example.com/social.1683eecb7e65.webp",
      SITE_DEFAULT_SOCIAL_IMAGE_VERSION: "1683eecb7e65",
    });

    expect(config.defaultSocialImage.rendition.src).toBe(
      "https://cdn.example.com/social.1683eecb7e65.webp",
    );
  });

  it("requires a declared version for a remote derivative", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE:
          "https://cdn.example.com/social.1683eecb7e65.webp",
      }),
    ).toThrow(
      "Missing required deployment setting: SITE_DEFAULT_SOCIAL_IMAGE_VERSION",
    );
  });

  it("rejects a remote derivative whose URL omits the declared version", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: "https://cdn.example.com/social.webp",
        SITE_DEFAULT_SOCIAL_IMAGE_VERSION: "1683eecb7e65",
      }),
    ).toThrow("rendition.version must appear in rendition.src");
  });

  it.each([
    "https://user:secret@cdn.example.com/social.1683eecb7e65.webp",
    "https://cdn.example.com/social.1683eecb7e65.webp#preview",
  ])("rejects the unsafe remote social image URL %s", (value) => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: value,
        SITE_DEFAULT_SOCIAL_IMAGE_VERSION: "1683eecb7e65",
      }),
    ).toThrow("Invalid SITE_DEFAULT_SOCIAL_IMAGE");
  });

  it.each(["0", "-1", "12.5", "1e3", "0x10", "wide", "99999"])(
    "rejects the invalid default social image dimension %s",
    (value) => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: value,
        }),
      ).toThrow("Invalid SITE_DEFAULT_SOCIAL_IMAGE_WIDTH");
    },
  );
});
