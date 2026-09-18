import { beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ readPollSnapshot: vi.fn(), recordPollVote: vi.fn(), readPollDisplayState: vi.fn() }));
vi.mock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => ({ contentSource: "sanity" }) }));
vi.mock("@/lib/poll-vote-sanity", async (original) => ({ ...await original<typeof import("@/lib/poll-vote-sanity")>(), ...store }));
import { GET, POST } from "./route";
import { generatePollVisitorToken, pollVoterCookieName } from "@/lib/poll-identity";
const poll = { pollId: "camera-preference", question: "Which?", closeDate: "2099-01-01T00:00:00Z", options: [{ optionId: "mirrorless", label: "Mirrorless" }, { optionId: "dslr", label: "DSLR" }] };
const token = generatePollVisitorToken();
const cookie = `${pollVoterCookieName(poll.pollId)}=${token}`;
let address = 0;
function request(method: "GET" | "POST", { body = { pollId: poll.pollId, optionId: "mirrorless" }, query = `?pollId=${poll.pollId}`, cookies = cookie, origin = "https://studio.example", type = "application/json", prepare = false }: { body?: unknown; query?: string; cookies?: string; origin?: string; type?: string; prepare?: boolean } = {}) {
  return new Request(`https://studio.example/api/poll-vote${method === "GET" ? query : ""}`, {
    method, headers: { host: "studio.example", origin, "Content-Type": type, cookie: cookies, "x-forwarded-for": `198.51.100.${++address}`, ...(prepare ? { "X-Poll-Prepare": "1", "Sec-Fetch-Site": "same-origin" } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  store.readPollSnapshot.mockResolvedValue(poll);
  store.recordPollVote.mockResolvedValue(true);
  store.readPollDisplayState.mockResolvedValue({ ...poll, closed: false, alreadyVoted: false, totalVotes: 0, options: poll.options.map((o) => ({ ...o, votes: 0, percentage: 0 })) });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
describe("poll request boundaries", () => {
  it.each([
    ["cross origin", { origin: "https://elsewhere.example" }, 403],
    ["wrong type", { type: "text/plain" }, 415],
    ["extra field", { body: { pollId: poll.pollId, optionId: "mirrorless", extra: 1 } }, 400],
    ["missing field", { body: { pollId: poll.pollId } }, 400],
    ["bad identity", { body: { pollId: "Bad.Path", optionId: "mirrorless" } }, 400],
  ])("rejects %s before any poll read/write", async (_name, options, status) => {
    expect((await POST(request("POST", options))).status).toBe(status);
    expect(store.readPollSnapshot).not.toHaveBeenCalled(); expect(store.recordPollVote).not.toHaveBeenCalled();
  });
  it("rejects a missing, malformed, or duplicate cookie before writing", async () => {
    for (const cookies of ["", `${pollVoterCookieName(poll.pollId)}=bad`, `${cookie}; ${cookie}`]) {
      expect((await POST(request("POST", { cookies }))).status).toBe(409);
    }
    expect(store.recordPollVote).not.toHaveBeenCalled();
  });
  it("rejects a body exceeding its bound", async () => {
    expect((await POST(request("POST", { body: { pollId: "x".repeat(2000), optionId: "mirrorless" } }))).status).toBe(400);
  });
  it("rejects an unknown poll/option or a closed poll without writing", async () => {
    store.readPollSnapshot.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...poll, closeDate: "2000-01-01T00:00:00Z" });
    expect((await POST(request("POST"))).status).toBe(404);
    expect((await POST(request("POST"))).status).toBe(409);
    expect((await POST(request("POST", { body: { pollId: poll.pollId, optionId: "unknown" } }))).status).toBe(404);
    expect(store.recordPollVote).not.toHaveBeenCalled();
  });
  it("returns a retryable failure without disclosing provider errors", async () => {
    store.recordPollVote.mockRejectedValue(new Error("secret-provider-message"));
    const response = await POST(request("POST"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret-provider-message");
  });
});
describe("fresh results and cookie preparation", () => {
  it("reads cookie-specific state fresh without setting a cookie on a normal GET", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(store.readPollDisplayState).toHaveBeenCalledWith(poll.pollId, token, expect.any(Date));
  });
  it("mints a poll-specific cookie before the first vote and refreshes it on success", async () => {
    const prepared = await GET(request("GET", { cookies: "", prepare: true, query: `?pollId=${poll.pollId}&prepare=1` }));
    const raw = prepared.headers.get("set-cookie")!;
    expect(raw).toContain("HttpOnly"); expect(raw).toContain("Secure"); expect(raw).toContain("Path=/api/poll-vote");
    const response = await POST(request("POST", { cookies: raw.split(";")[0] }));
    expect((await response.json()).status).toBe("recorded");
    expect(response.headers.get("set-cookie")).toContain(raw.split(";")[0]);
  });
  it("forbids simple cross-site cookie preparation and never initializes a closed poll's cookie", async () => {
    expect((await GET(request("GET", { cookies: "", query: `?pollId=${poll.pollId}&prepare=1` }))).status).toBe(403);
    store.readPollDisplayState.mockResolvedValue({ ...poll, closed: true });
    const response = await GET(request("GET", { cookies: "", prepare: true, query: `?pollId=${poll.pollId}&prepare=1` }));
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it.each(["?pollId=one&pollId=two", "?pollId=Bad", "?pollId=one&extra=1", "?pollId=one&prepare=2"])("rejects malformed query %s", async (query) => {
    expect((await GET(request("GET", { query }))).status).toBe(400);
  });
  it("returns 404 for a missing poll and 503 for a failed results read", async () => {
    store.readPollDisplayState.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("provider"));
    expect((await GET(request("GET"))).status).toBe(404);
    expect((await GET(request("GET"))).status).toBe(503);
  });
  it("unwraps quoted cookie values", async () => {
    const response = await POST(request("POST", { cookies: `${pollVoterCookieName(poll.pollId)}="${token}"` }));
    expect(response.status).toBe(200);
    expect(store.recordPollVote).toHaveBeenCalledWith(expect.objectContaining({ visitorToken: token }));
  });
  it("keeps the same token on duplicate retries and concurrent submits", async () => {
    const receipts = new Set<string>();
    store.recordPollVote.mockImplementation(async ({ visitorToken }: { visitorToken: string }) => {
      if (receipts.has(visitorToken)) return false; receipts.add(visitorToken); return true;
    });
    const responses = await Promise.all([POST(request("POST")), POST(request("POST"))]);
    expect(await Promise.all(responses.map(async (r) => (await r.json()).status))).toEqual(["recorded", "already-voted"]);
  });
});
