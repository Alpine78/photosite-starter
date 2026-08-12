import { describe, expect, it, vi } from "vitest";

import {
  deletePreviewDeployment,
  deletePreviewDeploymentFromUrl,
  inspectPreviewDeployment,
  type VercelPreviewApiSettings,
} from "./vercel-preview-api.mts";

const SETTINGS: VercelPreviewApiSettings = {
  token: "test-token-never-logged",
  orgId: "team_expected123",
  projectId: "prj_expected123",
};

const DEPLOYMENT = {
  id: "dpl_expected123",
  projectId: SETTINGS.projectId,
  ownerId: SETTINGS.orgId,
  url: "photosite-starter-abc123-acme.vercel.app",
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
