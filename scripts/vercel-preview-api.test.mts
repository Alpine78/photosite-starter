import { describe, expect, it, vi } from "vitest";

import {
  assignPreviewAlias,
  deleteAlias,
  deletePreviewDeployment,
  deletePreviewDeploymentFromUrl,
  inspectPreviewDeployment,
  readAliasCurrentTarget,
  resolveDeploymentIfLive,
  type VercelPreviewApiSettings,
} from "./vercel-preview-api.mts";

const SETTINGS: VercelPreviewApiSettings = {
  token: "test-token-never-logged",
  orgId: "team_expected123",
  projectId: "prj_expected123",
};

const ALIAS = "acme-photosite-preview.vercel.app";

const DEPLOYMENT = {
  id: "dpl_expected123",
  projectId: SETTINGS.projectId,
  ownerId: SETTINGS.orgId,
  url: "photosite-starter-abc123-acme.vercel.app",
  createdAt: 1_724_000_000_000,
  name: "photosite-starter",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Vercel Preview deployment API", () => {
  it("resolves a URL through the team-scoped authenticated API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(DEPLOYMENT));

    const result = await inspectPreviewDeployment(
      `https://${DEPLOYMENT.url}`,
      SETTINGS,
      DEPLOYMENT.id,
      fetcher,
    );

    expect(result.deployment.id).toBe(DEPLOYMENT.id);
    expect(result.createdAt).toBe(DEPLOYMENT.createdAt);
    expect(result.projectName).toBe("photosite-starter");
    expect(fetcher).toHaveBeenCalledTimes(1);

    const [request, init] = fetcher.mock.calls[0];
    const endpoint = new URL(String(request));
    expect(endpoint.origin).toBe("https://api.vercel.com");
    expect(endpoint.pathname).toBe(`/v13/deployments/${DEPLOYMENT.url}`);
    expect(endpoint.searchParams.get("teamId")).toBe(SETTINGS.orgId);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${SETTINGS.token}`,
    );
  });

  it("refuses an API answer from another project", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ ...DEPLOYMENT, projectId: "prj_attacker123" }),
      );

    await expect(
      inspectPreviewDeployment(
        `https://${DEPLOYMENT.url}`,
        SETTINGS,
        DEPLOYMENT.id,
        fetcher,
      ),
    ).rejects.toThrow(/belongs to project/);
  });

  it("looks up an immutable ID before deleting exactly that deployment", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(DEPLOYMENT))
      .mockResolvedValueOnce(jsonResponse({ uid: DEPLOYMENT.id, state: "DELETED" }));

    await expect(
      deletePreviewDeployment(DEPLOYMENT.id, SETTINGS, fetcher),
    ).resolves.toEqual({ deleted: true, id: DEPLOYMENT.id });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [deleteRequest, deleteInit] = fetcher.mock.calls[1];
    const endpoint = new URL(String(deleteRequest));
    expect(endpoint.pathname).toBe(`/v13/deployments/${DEPLOYMENT.id}`);
    expect(endpoint.searchParams.get("teamId")).toBe(SETTINGS.orgId);
    expect(deleteInit?.method).toBe("DELETE");
  });

  it("treats an already absent deployment as successful cleanup", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    await expect(
      deletePreviewDeployment(DEPLOYMENT.id, SETTINGS, fetcher),
    ).resolves.toEqual({ deleted: false, id: DEPLOYMENT.id });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recovers a captured URL, binds it, and deletes only its returned ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(DEPLOYMENT))
      .mockResolvedValueOnce(jsonResponse({ uid: DEPLOYMENT.id, state: "DELETED" }));

    await expect(
      deletePreviewDeploymentFromUrl(
        `https://${DEPLOYMENT.url}`,
        SETTINGS,
        fetcher,
      ),
    ).resolves.toEqual({ deleted: true, id: DEPLOYMENT.id });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [lookupRequest] = fetcher.mock.calls[0];
    const [deleteRequest, deleteInit] = fetcher.mock.calls[1];
    expect(new URL(String(lookupRequest)).pathname).toBe(
      `/v13/deployments/${DEPLOYMENT.url}`,
    );
    expect(new URL(String(deleteRequest)).pathname).toBe(
      `/v13/deployments/${DEPLOYMENT.id}`,
    );
    expect(deleteInit?.method).toBe("DELETE");
  });

  it("treats an already absent captured URL as successful cleanup", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      deletePreviewDeploymentFromUrl(
        `https://${DEPLOYMENT.url}`,
        SETTINGS,
        fetcher,
      ),
    ).resolves.toEqual({ deleted: false, id: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a project name or URL before making a destructive request", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      deletePreviewDeployment("photosite-starter", SETTINGS, fetcher),
    ).rejects.toThrow(/immutable dpl_/);
    await expect(
      deletePreviewDeployment(
        "https://photosite-starter.vercel.app",
        SETTINGS,
        fetcher,
      ),
    ).rejects.toThrow(/immutable dpl_/);
    await expect(
      deletePreviewDeploymentFromUrl("photosite-starter", SETTINGS, fetcher),
    ).rejects.toThrow(/absolute HTTPS URL/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("stable Preview alias assignment", () => {
  it("POSTs the alias to the deployment's atomic alias endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ uid: "al_1", alias: ALIAS, oldDeploymentId: "dpl_old99" }),
      );

    const result = await assignPreviewAlias(
      DEPLOYMENT.id,
      ALIAS,
      SETTINGS,
      fetcher,
    );

    expect(result).toEqual({
      uid: "al_1",
      alias: ALIAS,
      oldDeploymentId: "dpl_old99",
    });
    const [request, init] = fetcher.mock.calls[0];
    const endpoint = new URL(String(request));
    expect(endpoint.origin).toBe("https://api.vercel.com");
    expect(endpoint.pathname).toBe(`/v2/deployments/${DEPLOYMENT.id}/aliases`);
    expect(endpoint.searchParams.get("teamId")).toBe(SETTINGS.orgId);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${SETTINGS.token}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ alias: ALIAS });
  });

  it("returns a null previous target when the alias was never assigned", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ uid: "al_1", alias: ALIAS }));

    await expect(
      assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher),
    ).resolves.toEqual({ uid: "al_1", alias: ALIAS, oldDeploymentId: null });
  });

  it("refuses a custom-domain alias before making any request", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      assignPreviewAlias(DEPLOYMENT.id, "preview.acme.photography", SETTINGS, fetcher),
    ).rejects.toThrow(/custom domain is refused/);
    await expect(
      assignPreviewAlias("photosite-starter", ALIAS, SETTINGS, fetcher),
    ).rejects.toThrow(/immutable dpl_/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([400, 403, 409])(
    "raises a classified error on HTTP %i without leaking the token",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("nope", { status }));

      const error = await assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher).then(
        () => {
          throw new Error("expected a rejection");
        },
        (cause: unknown) => cause as Error,
      );

      expect(error.message).toContain(String(status));
      expect(error.message).not.toContain(SETTINGS.token);
    },
  );

  it("rejects a response echoing a different alias", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ uid: "al_1", alias: "someone-else.vercel.app" }),
      );

    await expect(
      assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher),
    ).rejects.toThrow(/expected "acme-photosite-preview\.vercel\.app"/);
  });

  it("rejects a malformed oldDeploymentId rather than passing it on", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({
          uid: "al_1",
          alias: ALIAS,
          oldDeploymentId: "not-an-id",
        }),
      );

    await expect(
      assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher),
    ).rejects.toThrow(/immutable dpl_/);
  });
});

describe("reading the alias's current target", () => {
  it("resolves the alias, binds its deployment, and reports time and target", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ uid: "al_1", alias: ALIAS, deploymentId: "dpl_prior1" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...DEPLOYMENT, id: "dpl_prior1", createdAt: 1_723_000_000_000 }),
      );

    await expect(
      readAliasCurrentTarget(ALIAS, SETTINGS, fetcher),
    ).resolves.toEqual({
      aliasUid: "al_1",
      deploymentId: "dpl_prior1",
      createdAt: 1_723_000_000_000,
      isProductionTarget: false,
    });

    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe(
      `/v4/aliases/${ALIAS}`,
    );
    expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe(
      "/v13/deployments/dpl_prior1",
    );
  });

  it("flags an alias resolving to a production deployment", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ uid: "al_prod", alias: ALIAS, deploymentId: "dpl_prod" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...DEPLOYMENT, id: "dpl_prod", target: "production" }),
      );

    await expect(
      readAliasCurrentTarget(ALIAS, SETTINGS, fetcher),
    ).resolves.toMatchObject({ deploymentId: "dpl_prod", isProductionTarget: true });
  });

  it("treats an unassigned alias as no prior target", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(readAliasCurrentTarget(ALIAS, SETTINGS, fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("treats an alias pointing at a deleted deployment as no prior target", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          uid: "al_gone",
          alias: ALIAS,
          deployment: { id: "dpl_gone1" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(readAliasCurrentTarget(ALIAS, SETTINGS, fetcher)).resolves.toBeNull();
  });

  it("refuses an alias whose deployment belongs to another project", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ uid: "al_other", alias: ALIAS, deploymentId: "dpl_x" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...DEPLOYMENT, id: "dpl_x", projectId: "prj_other" }),
      );

    await expect(
      readAliasCurrentTarget(ALIAS, SETTINGS, fetcher),
    ).rejects.toThrow(/belongs to project/);
  });
});

describe("removing the stable alias", () => {
  it("DELETEs the alias and treats a missing one as already removed", async () => {
    const ok = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "SUCCESS" }));
    await expect(deleteAlias("al_1", SETTINGS, ok)).resolves.toEqual({
      removed: true,
    });
    const [request, init] = ok.mock.calls[0];
    expect(new URL(String(request)).pathname).toBe("/v2/aliases/al_1");
    expect(init?.method).toBe("DELETE");

    const gone = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));
    await expect(deleteAlias("al_1", SETTINGS, gone)).resolves.toEqual({
      removed: false,
    });

    await expect(deleteAlias(ALIAS, SETTINGS, gone)).rejects.toThrow(
      /not a hostname/,
    );
  });
});

describe("resolveDeploymentIfLive", () => {
  it("returns the deployment when it still exists in this project", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ ...DEPLOYMENT, id: "dpl_prior1", createdAt: 111 }),
      );

    await expect(
      resolveDeploymentIfLive("dpl_prior1", SETTINGS, fetcher),
    ).resolves.toEqual({ id: "dpl_prior1", createdAt: 111 });
  });

  it("returns null for a deployment Vercel no longer knows", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      resolveDeploymentIfLive("dpl_gone", SETTINGS, fetcher),
    ).resolves.toBeNull();
  });

  it("throws for a deployment owned by another project", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ ...DEPLOYMENT, id: "dpl_x", projectId: "prj_other" }),
      );

    await expect(
      resolveDeploymentIfLive("dpl_x", SETTINGS, fetcher),
    ).rejects.toThrow(/belongs to project/);
  });
});
