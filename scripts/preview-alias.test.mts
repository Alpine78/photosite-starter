import { describe, expect, it, vi } from "vitest";

import {
  isTransientProbe,
  repointAndVerifyPreviewAlias,
  type AliasProbe,
} from "./preview-alias.mts";
import type { PreviewProbes } from "./preview-verification.mts";
import type { VercelPreviewApiSettings } from "./vercel-preview-api.mts";

const SETTINGS: VercelPreviewApiSettings = {
  token: "test-token",
  orgId: "team_x",
  projectId: "prj_x",
};

const ALIAS = "acme-preview.vercel.app";
const PROJECT_NAME = "photosite-starter";
const OUR_HOST = "photosite-starter-new123-acme.vercel.app";
const OUR_URL = `https://${OUR_HOST}`;
const OUR_ID = "dpl_new123";
const OLD_ID = "dpl_old99";
const PROD_ID = "dpl_prod1";

type DeploymentRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly url: string;
  readonly createdAt: number;
  readonly name: string;
  readonly target?: "production";
};

const DEPLOYMENTS: Record<string, DeploymentRecord> = {
  [OUR_ID]: {
    id: OUR_ID,
    projectId: "prj_x",
    ownerId: "team_x",
    url: OUR_HOST,
    createdAt: 2_000,
    name: PROJECT_NAME,
  },
  [OLD_ID]: {
    id: OLD_ID,
    projectId: "prj_x",
    ownerId: "team_x",
    url: "photosite-starter-old99-acme.vercel.app",
    createdAt: 1_000,
    name: PROJECT_NAME,
  },
  dpl_newer: {
    id: "dpl_newer",
    projectId: "prj_x",
    ownerId: "team_x",
    url: "photosite-starter-newer-acme.vercel.app",
    createdAt: 3_000,
    name: PROJECT_NAME,
  },
  // A live deployment an operator might repoint the alias to out of band.
  dpl_manual: {
    id: "dpl_manual",
    projectId: "prj_x",
    ownerId: "team_x",
    url: "photosite-starter-manual-acme.vercel.app",
    createdAt: 2_500,
    name: PROJECT_NAME,
  },
  [PROD_ID]: {
    id: PROD_ID,
    projectId: "prj_x",
    ownerId: "team_x",
    url: "photosite-starter-prod1-acme.vercel.app",
    createdAt: 500,
    name: PROJECT_NAME,
    target: "production",
  },
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A tiny stateful Vercel fake covering exactly the four endpoints the
 * orchestrator reaches: deployment lookup, alias lookup, alias assignment, and
 * alias deletion. `state.aliasTarget` is the deployment id the alias currently
 * points at (null when unassigned).
 */
type FakeOptions = {
  /** POST /aliases applies the change to state, then throws (lost response). */
  readonly assignThrowsAfterApply?: boolean;
  /** GET /v4/aliases throws once the alias has been assigned by this run. */
  readonly aliasReadThrowsAfterAssign?: boolean;
  /**
   * The `oldDeploymentId` the first POST reports — models an operator repointing
   * the alias between this run's lookup and its own atomic assignment.
   */
  readonly aliasTargetAtAssign?: string;
  /** The initial alias resolves, but its deployment lookup returns 404. */
  readonly initialTargetWasDeleted?: boolean;
};

function createFakeVercel(
  initialAliasTarget: string | null,
  options: FakeOptions = {},
) {
  const state = { aliasTarget: initialAliasTarget, assigned: false };
  const calls: Array<{ method: string; pathname: string }> = [];

  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, pathname: url.pathname });

    // GET /v13/deployments/{ref}  (ref is a hostname or a dpl_ id)
    const deploymentMatch = url.pathname.match(/^\/v13\/deployments\/(.+)$/);
    if (deploymentMatch) {
      const ref = decodeURIComponent(deploymentMatch[1]);
      if (options.initialTargetWasDeleted && ref === initialAliasTarget) {
        // A deleted deployment stays deleted for every later lookup, including
        // the post-assignment liveness check.
        return new Response(null, { status: 404 });
      }
      const record =
        DEPLOYMENTS[ref] ??
        Object.values(DEPLOYMENTS).find((entry) => entry.url === ref);
      return record ? json(record) : new Response(null, { status: 404 });
    }

    // GET /v4/aliases/{host}
    const aliasGet = url.pathname.match(/^\/v4\/aliases\/(.+)$/);
    if (aliasGet && method === "GET") {
      if (options.aliasReadThrowsAfterAssign && state.assigned) {
        throw new Error("ECONNRESET reading the alias");
      }
      if (state.aliasTarget === null) return new Response(null, { status: 404 });
      return json({
        alias: decodeURIComponent(aliasGet[1]),
        deploymentId: state.aliasTarget,
        uid: "al_fake",
      });
    }

    // POST /v2/deployments/{id}/aliases
    const assign = url.pathname.match(/^\/v2\/deployments\/(.+)\/aliases$/);
    if (assign && method === "POST") {
      const id = decodeURIComponent(assign[1]);
      const firstAssign = !state.assigned;
      const previous =
        firstAssign && options.aliasTargetAtAssign !== undefined
          ? options.aliasTargetAtAssign
          : state.aliasTarget;
      state.aliasTarget = id;
      state.assigned = true;
      if (options.assignThrowsAfterApply && id === OUR_ID) {
        throw new Error("socket hang up after the alias was assigned");
      }
      const body = JSON.parse(String(init?.body)) as { alias: string };
      return json({
        uid: "al_fake",
        alias: body.alias,
        ...(previous ? { oldDeploymentId: previous } : {}),
      });
    }

    // DELETE /v2/aliases/{uid}
    const aliasDelete = url.pathname.match(/^\/v2\/aliases\/(.+)$/);
    if (aliasDelete && method === "DELETE") {
      if (decodeURIComponent(aliasDelete[1]) !== "al_fake") {
        return new Response(null, { status: 404 });
      }
      state.aliasTarget = null;
      return json({ status: "SUCCESS" });
    }

    throw new Error(`unexpected request: ${method} ${url.pathname}`);
  });

  return { fetcher, state, calls };
}

const PASS: PreviewProbes = {
  protectionStatus: 302,
  protectionLocation:
    "https://vercel.com/sso-api?url=https%3A%2F%2Facme-preview.vercel.app%2F",
  bypassStatus: 200,
  robotsTag: "noindex",
};

const APP_SERVED: PreviewProbes = {
  protectionStatus: 200,
  protectionLocation: null,
  bypassStatus: 200,
  robotsTag: "noindex",
};

const PROPAGATING: PreviewProbes = {
  protectionStatus: 404,
  protectionLocation: null,
  bypassStatus: 404,
  robotsTag: null,
};

function run(
  probe: AliasProbe,
  fake = createFakeVercel(null),
  overrides: Partial<Parameters<typeof repointAndVerifyPreviewAlias>[0]> = {},
) {
  const sleep = vi.fn(async () => {});
  return {
    sleep,
    fake,
    promise: repointAndVerifyPreviewAlias({
      deploymentUrl: OUR_URL,
      deploymentId: OUR_ID,
      aliasHost: ALIAS,
      settings: SETTINGS,
      retryDelayMs: 1,
      deps: { fetcher: fake.fetcher, probe, sleep },
      ...overrides,
    }),
  };
}

describe("isTransientProbe", () => {
  it("retries only a 404/503 on either probe", () => {
    expect(isTransientProbe(PROPAGATING)).toBe(true);
    expect(
      isTransientProbe({ ...PASS, protectionStatus: 503 }),
    ).toBe(true);
    expect(isTransientProbe(PASS)).toBe(false);
    expect(isTransientProbe(APP_SERVED)).toBe(false);
  });
});

describe("repointAndVerifyPreviewAlias", () => {
  it("assigns and verifies when the alias was never pointed anywhere", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const { promise, fake } = run(probe);

    await expect(promise).resolves.toEqual({
      kind: "assigned",
      previousTarget: null,
      checks: expect.any(Array),
      attempts: 1,
    });
    expect(fake.state.aliasTarget).toBe(OUR_ID);
  });

  it("moves the alias forward from an older deployment", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const { promise, fake } = run(probe, createFakeVercel(OLD_ID));

    await expect(promise).resolves.toMatchObject({
      kind: "assigned",
      previousTarget: OLD_ID,
    });
    expect(fake.state.aliasTarget).toBe(OUR_ID);
  });

  it("does nothing when the alias already points at this deployment", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const { promise, fake } = run(probe, createFakeVercel(OUR_ID));

    await expect(promise).resolves.toMatchObject({ kind: "already-current" });
    expect(probe).not.toHaveBeenCalled();
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("refuses to move the alias backward to an older deployment", async () => {
    // Alias already points at OUR_ID (createdAt 2000); pretend we are an older
    // run deploying OLD_ID (createdAt 1000).
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const sleep = vi.fn(async () => {});
    const fake = createFakeVercel(OUR_ID);

    await expect(
      repointAndVerifyPreviewAlias({
        deploymentUrl: "https://photosite-starter-old99-acme.vercel.app",
        deploymentId: OLD_ID,
        aliasHost: ALIAS,
        settings: SETTINGS,
        deps: { fetcher: fake.fetcher, probe, sleep },
      }),
    ).resolves.toMatchObject({ kind: "already-current", currentTarget: OUR_ID });
    expect(fake.state.aliasTarget).toBe(OUR_ID);
    expect(probe).not.toHaveBeenCalled();
  });

  it("retries a propagating alias before succeeding", async () => {
    const probe = vi
      .fn<AliasProbe>()
      .mockResolvedValueOnce(PROPAGATING)
      .mockResolvedValueOnce(PROPAGATING)
      .mockResolvedValueOnce(PASS);
    const { promise, sleep } = run(probe);

    await expect(promise).resolves.toMatchObject({ kind: "assigned", attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("restores the previous target when verification fails definitively", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(APP_SERVED);
    const { promise, sleep, fake } = run(probe, createFakeVercel(OLD_ID));

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: OLD_ID,
    });
    expect(sleep).not.toHaveBeenCalled(); // a definitive failure is not retried
    expect(fake.state.aliasTarget).toBe(OLD_ID);
  });

  it("removes the alias when verification fails and there was no prior target", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(APP_SERVED);
    const { promise, fake } = run(probe, createFakeVercel(null));

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: null,
    });
    expect(fake.state.aliasTarget).toBeNull();
  });

  it("removes the alias when its prior deployment had been deleted", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(APP_SERVED);
    const { promise, fake } = run(
      probe,
      createFakeVercel(OLD_ID, { initialTargetWasDeleted: true }),
    );

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: null,
    });
    expect(fake.state.aliasTarget).toBeNull();
    expect(fake.calls).toContainEqual({
      method: "DELETE",
      pathname: "/v2/aliases/al_fake",
    });
  });

  it("does not delete an alias that is already unassigned during reconciliation", async () => {
    const fake = createFakeVercel(null);
    const probe = vi.fn<AliasProbe>().mockImplementation(async () => {
      fake.state.aliasTarget = null;
      return APP_SERVED;
    });
    const { promise } = run(probe, fake);

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: null,
    });
    expect(fake.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("restores a healthy target an operator assigned between the lookup and the POST", async () => {
    // The pre-assignment read saw no alias, but an operator pointed it at a
    // live deployment before this run's POST; Vercel reports it in
    // oldDeploymentId. Rollback must restore it, not delete the alias.
    const probe = vi.fn<AliasProbe>().mockResolvedValue(APP_SERVED);
    const { promise, fake } = run(
      probe,
      createFakeVercel(null, { aliasTargetAtAssign: "dpl_manual" }),
    );

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: "dpl_manual",
    });
    expect(fake.state.aliasTarget).toBe("dpl_manual");
    expect(fake.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("leaves the alias alone when a newer run has already published to it", async () => {
    const fake = createFakeVercel(OLD_ID);
    // The alias probe fails, but between the assign and the re-read another run
    // repoints the alias to a newer deployment.
    const probe = vi.fn<AliasProbe>().mockImplementation(async () => {
      fake.state.aliasTarget = "dpl_newer";
      return APP_SERVED;
    });
    const { promise } = run(probe, fake);

    await expect(promise).resolves.toMatchObject({
      kind: "abandoned",
      movedOnTo: "dpl_newer",
    });
    expect(fake.state.aliasTarget).toBe("dpl_newer");
  });

  it("gives up after the attempt budget when the alias host never responds", async () => {
    const probe = vi.fn<AliasProbe>().mockRejectedValue(new Error("ECONNREFUSED"));
    const { promise, sleep, fake } = run(probe, createFakeVercel(OLD_ID), {
      maxAttempts: 3,
    });

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: OLD_ID,
      attempts: 3,
    });
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fake.state.aliasTarget).toBe(OLD_ID);
  });

  it("refuses the project's own default production domain before any mutation", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const fake = createFakeVercel(null);

    await expect(
      repointAndVerifyPreviewAlias({
        deploymentUrl: OUR_URL,
        deploymentId: OUR_ID,
        aliasHost: `${PROJECT_NAME}.vercel.app`,
        settings: SETTINGS,
        deps: { fetcher: fake.fetcher, probe, sleep: vi.fn(async () => {}) },
      }),
    ).resolves.toMatchObject({ kind: "refused" });
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it("refuses an alias that currently resolves to a production deployment", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const { promise, fake } = run(probe, createFakeVercel(PROD_ID));

    await expect(promise).resolves.toMatchObject({ kind: "refused" });
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
    expect(fake.state.aliasTarget).toBe(PROD_ID);
    expect(probe).not.toHaveBeenCalled();
  });

  it("reconciles after an assignment whose response is lost", async () => {
    // The POST is applied remotely (alias now points at OUR_ID) but the client
    // sees a transport error. The orchestrator must re-read and restore.
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const { promise, fake } = run(
      probe,
      createFakeVercel(OLD_ID, { assignThrowsAfterApply: true }),
    );

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: OLD_ID,
    });
    expect(fake.state.aliasTarget).toBe(OLD_ID);
    expect(probe).not.toHaveBeenCalled(); // never got a clean assignment
  });

  it("restores the target the atomic assignment reported, not the stale pre-read", async () => {
    // Our lookup saw OLD_ID, but an operator repointed the alias to dpl_manual
    // before our POST; Vercel's response says oldDeploymentId: dpl_manual.
    const probe = vi.fn<AliasProbe>().mockResolvedValue(APP_SERVED);
    const { promise, fake } = run(
      probe,
      createFakeVercel(OLD_ID, { aliasTargetAtAssign: "dpl_manual" }),
    );

    await expect(promise).resolves.toMatchObject({
      kind: "restored",
      restoredTo: "dpl_manual",
    });
    expect(fake.state.aliasTarget).toBe("dpl_manual");
  });

  it("reports an unreconciled alias when the post-assignment read also fails", async () => {
    const probe = vi.fn<AliasProbe>().mockResolvedValue(PASS);
    const { promise, fake } = run(
      probe,
      createFakeVercel(OLD_ID, {
        assignThrowsAfterApply: true,
        aliasReadThrowsAfterAssign: true,
      }),
    );

    await expect(promise).resolves.toMatchObject({ kind: "unreconciled" });
    // The alias is left wherever the lost POST put it; a human must fix it.
    expect(fake.state.aliasTarget).toBe(OUR_ID);
  });
});
