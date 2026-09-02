import { describe, expect, it } from "vitest";

import {
  isPrivateObjectStoreOrigin,
  PrivateObjectStoreOriginError,
  readPrivateObjectStoreOrigin,
} from "@/lib/private-object-store-origin";

const enabled = (endpoint?: string) => ({
  PRIVATE_GALLERY_STORE: "enabled",
  ...(endpoint === undefined ? {} : { PRIVATE_GALLERY_S3_ENDPOINT: endpoint }),
});

describe("readPrivateObjectStoreOrigin", () => {
  it("returns the configured origin for an enabled store", () => {
    expect(readPrivateObjectStoreOrigin(enabled("https://objects.example"))).toBe(
      "https://objects.example",
    );
  });

  it("normalises a configured trailing slash away", () => {
    // The CSP source must be exactly the origin the signer addresses; a value
    // that differs only by a slash would read differently to a browser.
    expect(readPrivateObjectStoreOrigin(enabled("https://objects.example/"))).toBe(
      "https://objects.example",
    );
  });

  it("keeps an explicit port, which is part of the origin", () => {
    expect(
      readPrivateObjectStoreOrigin(enabled("https://objects.example:8443")),
    ).toBe("https://objects.example:8443");
  });

  it.each([
    ["unset", {}],
    ["off", { PRIVATE_GALLERY_STORE: "off" }],
    ["the development fixture", { PRIVATE_GALLERY_STORE: "memory" }],
  ])("grants nothing when the store is %s", (_case, environment) => {
    // Neither has an object store, so neither may widen the browser's image
    // policy. A grant present in every build would be a permanent hole for a
    // feature most deployments never turn on.
    expect(
      readPrivateObjectStoreOrigin({
        ...environment,
        PRIVATE_GALLERY_S3_ENDPOINT: "https://objects.example",
      }),
    ).toBeUndefined();
  });

  it("fails the build when an enabled store names no endpoint", () => {
    // Silently emitting no grant would ship a gallery whose every photograph is
    // blocked by the browser, with no build error to explain it.
    expect(() => readPrivateObjectStoreOrigin(enabled())).toThrow(
      PrivateObjectStoreOriginError,
    );
    expect(() => readPrivateObjectStoreOrigin(enabled("   "))).toThrow(
      PrivateObjectStoreOriginError,
    );
  });

  it.each([
    ["plain HTTP", "http://objects.example"],
    ["a path", "https://objects.example/bucket"],
    ["a query", "https://objects.example/?a=1"],
    ["a fragment", "https://objects.example/#x"],
    ["credentials", "https://user:pass@objects.example"],
    ["a bare host", "objects.example"],
    ["a space", "https://objects.example https://evil.example"],
    ["a semicolon", "https://objects.example; script-src *"],
    ["nothing usable", "not a url"],
  ])("refuses an endpoint carrying %s", (_case, endpoint) => {
    // The value is interpolated into a Content-Security-Policy source, where a
    // stray space or semicolon widens the whole policy.
    expect(() => readPrivateObjectStoreOrigin(enabled(endpoint))).toThrow(
      PrivateObjectStoreOriginError,
    );
  });
});

describe("isPrivateObjectStoreOrigin", () => {
  it.each(["https://objects.example", "https://objects.example/"])(
    "accepts the bare origin %s",
    (value) => {
      expect(isPrivateObjectStoreOrigin(value)).toBe(true);
    },
  );

  it.each([
    "http://objects.example",
    "https://objects.example/path",
    "https://objects.example//",
    "ftp://objects.example",
    "",
  ])("refuses %s", (value) => {
    expect(isPrivateObjectStoreOrigin(value)).toBe(false);
  });
});
