import { describe, expect, it } from "vitest";

import {
  CONTACT_HONEYPOT_FIELD,
  CONTACT_REQUEST_MAX_BYTES,
  CONTACT_SUBMISSION_ID_FIELD,
  readContactRequest,
} from "@/lib/contact-request";

const ENDPOINT = "https://studio.example/api/contact";
const SUBMISSION_ID = "3f1d2b8c-6a4e-4c2f-9b7a-1d0e5c8f2a41";

const validBody = {
  name: "Jane Example",
  email: "jane@example.com",
  message: "Are you available in June?",
  [CONTACT_SUBMISSION_ID_FIELD]: SUBMISSION_ID,
};

function contactRequest({
  body = JSON.stringify(validBody),
  headers = {},
}: {
  body?: BodyInit | null;
  headers?: Record<string, string>;
} = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://studio.example",
      "x-forwarded-host": "studio.example",
      ...headers,
    },
    body,
  });
}

describe("readContactRequest", () => {
  it("accepts a same-origin JSON submission and returns the normalized message", async () => {
    const result = await readContactRequest(contactRequest());

    expect(result).toEqual({
      outcome: "accepted",
      submissionId: SUBMISSION_ID,
      message: {
        name: "Jane Example",
        email: "jane@example.com",
        message: "Are you available in June?",
      },
    });
  });

  it.each([
    ["application/x-www-form-urlencoded", "a form post"],
    ["text/plain", "a preflight-free text post"],
    ["multipart/form-data; boundary=x", "an upload"],
  ])("refuses %s, the content type used by %s", async (contentType) => {
    const result = await readContactRequest(
      contactRequest({ headers: { "content-type": contentType } }),
    );

    expect(result).toEqual({
      outcome: "rejected",
      reason: "unsupported-media-type",
    });
  });

  it("accepts a charset parameter on the media type", async () => {
    const result = await readContactRequest(
      contactRequest({
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    );

    expect(result.outcome).toBe("accepted");
  });

  it("refuses a request whose Origin is another site", async () => {
    const result = await readContactRequest(
      contactRequest({ headers: { origin: "https://attacker.example" } }),
    );

    expect(result).toEqual({ outcome: "rejected", reason: "cross-origin" });
  });

  it("refuses a request with no Origin at all", async () => {
    const request = contactRequest();
    request.headers.delete("origin");

    expect(await readContactRequest(request)).toEqual({
      outcome: "rejected",
      reason: "cross-origin",
    });
  });

  it("refuses a request the browser itself classified as cross-site", async () => {
    const result = await readContactRequest(
      contactRequest({ headers: { "sec-fetch-site": "cross-site" } }),
    );

    expect(result).toEqual({ outcome: "rejected", reason: "cross-origin" });
  });

  it("accepts a request the browser classified as same-origin", async () => {
    const result = await readContactRequest(
      contactRequest({ headers: { "sec-fetch-site": "same-origin" } }),
    );

    expect(result.outcome).toBe("accepted");
  });

  it("compares the Origin against the host the browser addressed", async () => {
    const result = await readContactRequest(
      contactRequest({
        headers: {
          origin: "https://preview.example",
          "x-forwarded-host": "preview.example",
        },
      }),
    );

    expect(result.outcome).toBe("accepted");
  });

  it("refuses a body larger than the endpoint's own limit", async () => {
    const result = await readContactRequest(
      contactRequest({
        body: JSON.stringify({
          ...validBody,
          message: "x".repeat(CONTACT_REQUEST_MAX_BYTES),
        }),
      }),
    );

    expect(result).toEqual({ outcome: "rejected", reason: "payload-too-large" });
  });

  it("stops reading an oversized body that declared no length", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Far past the limit, so a handler that buffered first would notice
        // only after accepting many times the bytes it allows.
        if (sent >= 64) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });

    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://studio.example",
        "x-forwarded-host": "studio.example",
      },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(await readContactRequest(request)).toEqual({
      outcome: "rejected",
      reason: "payload-too-large",
    });
    expect(sent).toBeLessThan(64);
  });

  it("refuses a body that is not JSON", async () => {
    const result = await readContactRequest(contactRequest({ body: "{" }));

    expect(result).toEqual({ outcome: "rejected", reason: "malformed-body" });
  });

  it.each([
    ["an array", JSON.stringify([validBody])],
    ["a bare string", JSON.stringify("hello")],
    ["null", JSON.stringify(null)],
  ])("refuses %s in place of an envelope", async (_label, body) => {
    expect(await readContactRequest(contactRequest({ body }))).toEqual({
      outcome: "rejected",
      reason: "malformed-body",
    });
  });

  it("refuses an envelope carrying a field the endpoint does not accept", async () => {
    const result = await readContactRequest(
      contactRequest({
        body: JSON.stringify({ ...validBody, attachment: "payload" }),
      }),
    );

    expect(result).toEqual({ outcome: "rejected", reason: "malformed-body" });
  });

  it("refuses a non-string value, so no field can arrive as an object", async () => {
    const result = await readContactRequest(
      contactRequest({ body: JSON.stringify({ ...validBody, name: { $ne: "" } }) }),
    );

    expect(result).toEqual({ outcome: "rejected", reason: "malformed-body" });
  });

  it.each([["missing", undefined], ["not a UUID", "retry-1"]])(
    "refuses a submission identifier that is %s",
    async (_label, submissionId) => {
      const body: Record<string, unknown> = { ...validBody };
      if (submissionId === undefined) {
        delete body[CONTACT_SUBMISSION_ID_FIELD];
      } else {
        body[CONTACT_SUBMISSION_ID_FIELD] = submissionId;
      }

      expect(
        await readContactRequest(
          contactRequest({ body: JSON.stringify(body) }),
        ),
      ).toEqual({ outcome: "rejected", reason: "malformed-body" });
    },
  );

  it("discards a submission that filled the hidden field", async () => {
    const result = await readContactRequest(
      contactRequest({
        body: JSON.stringify({
          ...validBody,
          [CONTACT_HONEYPOT_FIELD]: "Acme Oy",
        }),
      }),
    );

    expect(result).toEqual({ outcome: "discarded" });
  });

  it("accepts a submission whose hidden field is present but empty", async () => {
    const result = await readContactRequest(
      contactRequest({
        body: JSON.stringify({ ...validBody, [CONTACT_HONEYPOT_FIELD]: "" }),
      }),
    );

    expect(result.outcome).toBe("accepted");
  });

  it("discards before validating, so an automated client learns nothing", async () => {
    const result = await readContactRequest(
      contactRequest({
        body: JSON.stringify({
          ...validBody,
          email: "not-an-address",
          [CONTACT_HONEYPOT_FIELD]: "Acme Oy",
        }),
      }),
    );

    expect(result).toEqual({ outcome: "discarded" });
  });

  it("reports field issues as codes rather than sentences", async () => {
    const result = await readContactRequest(
      contactRequest({
        body: JSON.stringify({
          ...validBody,
          name: "",
          email: "not-an-address",
        }),
      }),
    );

    expect(result).toEqual({
      outcome: "rejected",
      reason: "invalid-fields",
      issues: [
        { field: "name", code: "required" },
        { field: "email", code: "invalid-email" },
      ],
    });
  });
});
