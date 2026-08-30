import { describe, expect, it } from "vitest";

import {
  buildContactDeliveryAdapter,
  buildContactEmail,
  buildEnquiryEmail,
  ContactDeliveryConfigurationError,
  DELIVERY_FAILURE_STATUS,
} from "@/lib/contact-delivery";
import type { ResolvedEnquiryTarget } from "@/lib/enquiry-media";
import { getBuiltInLabels } from "@/lib/deployment-config";

const labels = getBuiltInLabels("en-GB");

const message = {
  name: "Jane Example",
  email: "jane@example.com",
  message: "Are you available in June?\n\nWe are planning a June wedding.",
};

const resendEnvironment = {
  CONTACT_DELIVERY_ADAPTER: "resend",
  CONTACT_DELIVERY_FROM: "Studio Example <contact@studio.example>",
  CONTACT_DELIVERY_TO: "hello@studio.example",
  RESEND_API_KEY: "re_test_key",
};

describe("buildContactEmail", () => {
  const email = buildContactEmail(message, {
    siteName: "Studio Example",
    labels,
  });

  it("names the site in the subject and nothing the visitor wrote", () => {
    expect(email.subject).toBe("New contact message — Studio Example");
    expect(email.subject).not.toContain(message.name);
    expect(email.subject).not.toContain(message.email);
  });

  it("carries the enquiry, its author, and the labels of the site's own locale", () => {
    expect(email.text).toBe(
      [
        "Name: Jane Example",
        "Email: jane@example.com",
        "",
        "Message:",
        "Are you available in June?",
        "",
        "We are planning a June wedding.",
      ].join("\n"),
    );
  });

  it("replies to the visitor rather than to the site", () => {
    expect(email.replyTo).toBe(message.email);
  });

  it("labels the email in the deployment's own locale", () => {
    const finnish = buildContactEmail(message, {
      siteName: "Studio Example",
      labels: getBuiltInLabels("fi"),
    });

    expect(finnish.subject).toBe("Uusi yhteydenotto — Studio Example");
    expect(finnish.text).toContain("Nimi: Jane Example");
  });
});

describe("buildEnquiryEmail", () => {
  const curatedTarget: ResolvedEnquiryTarget = {
    kind: "curated",
    mediaId: "coastal-landscape",
    placementId: "selected-work-coastal-landscape",
    contentId: "content-selected-work",
    sectionId: "leads",
    archiveLocator: "/Volumes/Archive/2019/coast/DSCF1042.RAF",
    caption: "Quiet coast",
    credit: "Placeholder credit",
  };

  it("keeps the subject free of visitor text and carries the project-minted mediaId", () => {
    const email = buildEnquiryEmail(message, curatedTarget, {
      siteName: "Studio Example",
      labels,
    });
    expect(email.subject).toBe(
      "Gallery enquiry: coastal-landscape — Studio Example",
    );
    expect(email.subject).not.toContain(message.name);
    expect(email.subject).not.toContain(message.email);
    expect(email.replyTo).toBe(message.email);
  });

  it("puts the resolved item context and the private archive locator in the body", () => {
    const email = buildEnquiryEmail(message, curatedTarget, {
      siteName: "Studio Example",
      labels,
    });
    expect(email.text).toBe(
      [
        "Name: Jane Example",
        "Email: jane@example.com",
        "",
        "Photograph: coastal-landscape",
        "Caption: Quiet coast",
        "Credit: Placeholder credit",
        "Gallery: content-selected-work / leads",
        "Placement: selected-work-coastal-landscape",
        "Archive location: /Volumes/Archive/2019/coast/DSCF1042.RAF",
        "",
        "Message:",
        message.message,
      ].join("\n"),
    );
  });

  it("names the occurrence so a repeated photograph's two enquiries differ", () => {
    const first = buildEnquiryEmail(
      message,
      { ...curatedTarget, placementId: "selected-work-lead-a" },
      { siteName: "Studio Example", labels },
    );
    const second = buildEnquiryEmail(
      message,
      { ...curatedTarget, placementId: "selected-work-lead-b" },
      { siteName: "Studio Example", labels },
    );
    expect(first.text).toContain("Placement: selected-work-lead-a");
    expect(second.text).toContain("Placement: selected-work-lead-b");
    expect(first.text).not.toBe(second.text);
  });

  it("omits the archive line when the target recorded none", () => {
    const { archiveLocator: _drop, ...withoutLocator } = curatedTarget;
    void _drop;
    const email = buildEnquiryEmail(message, withoutLocator, {
      siteName: "Studio Example",
      labels,
    });
    expect(email.text).not.toContain("Archive location");
  });

  it("omits the gallery line for a dynamic target and carries no placement", () => {
    const dynamicTarget: ResolvedEnquiryTarget = {
      kind: "dynamic",
      mediaId: "forest-stream",
      caption: "Forest stream",
    };
    const email = buildEnquiryEmail(message, dynamicTarget, {
      siteName: "Studio Example",
      labels,
    });
    expect(email.text).not.toContain("Gallery:");
    expect(email.text).not.toContain("Placement:");
    expect(email.text).toContain("Photograph: forest-stream");
  });
});

describe("DELIVERY_FAILURE_STATUS", () => {
  it("maps a spent quota to 502, not 503, because a retry cannot help", () => {
    expect(DELIVERY_FAILURE_STATUS["provider-quota-exceeded"]).toBe(502);
    expect(DELIVERY_FAILURE_STATUS["provider-unavailable"]).toBe(503);
    expect(DELIVERY_FAILURE_STATUS.timeout).toBe(503);
    expect(DELIVERY_FAILURE_STATUS.configuration).toBe(500);
  });
});

describe("buildContactDeliveryAdapter", () => {
  it("builds the sink adapter, which accepts a message and sends nothing", async () => {
    const adapter = buildContactDeliveryAdapter({
      CONTACT_DELIVERY_ADAPTER: "sink",
      SITE_DEPLOYMENT_STAGE: "development",
    });

    expect(adapter.name).toBe("sink");
    await expect(
      adapter.deliver({
        subject: "s",
        text: "t",
        replyTo: "jane@example.com",
        idempotencyKey: "key",
      }),
    ).resolves.toEqual({ status: "delivered" });
  });

  it("builds the configured provider adapter", () => {
    expect(buildContactDeliveryAdapter(resendEnvironment).name).toBe("resend");
  });

  it.each(["development", "preview"])(
    "allows the sink adapter in a %s deployment",
    (stage) => {
      expect(
        buildContactDeliveryAdapter({
          CONTACT_DELIVERY_ADAPTER: "sink",
          SITE_DEPLOYMENT_STAGE: stage,
        }).name,
      ).toBe("sink");
    },
  );

  it("refuses the sink adapter in a production deployment", () => {
    expect(() =>
      buildContactDeliveryAdapter({
        CONTACT_DELIVERY_ADAPTER: "sink",
        SITE_DEPLOYMENT_STAGE: "production",
      }),
    ).toThrow(/must not run in a production deployment/);
  });

  it("treats an undeclared stage as production, so the guard fails closed", () => {
    expect(() =>
      buildContactDeliveryAdapter({ CONTACT_DELIVERY_ADAPTER: "sink" }),
    ).toThrow(ContactDeliveryConfigurationError);
  });

  it("refuses a stage it does not recognize rather than guessing", () => {
    expect(() =>
      buildContactDeliveryAdapter({
        CONTACT_DELIVERY_ADAPTER: "sink",
        SITE_DEPLOYMENT_STAGE: "staging",
      }),
    ).toThrow(/SITE_DEPLOYMENT_STAGE/);
  });

  it("builds the provider adapter in production, which is the point", () => {
    expect(
      buildContactDeliveryAdapter({
        ...resendEnvironment,
        SITE_DEPLOYMENT_STAGE: "production",
      }).name,
    ).toBe("resend");
  });

  it("refuses an unset adapter rather than choosing one", () => {
    expect(() => buildContactDeliveryAdapter({})).toThrow(
      ContactDeliveryConfigurationError,
    );
  });

  it("refuses an adapter name it does not implement", () => {
    expect(() =>
      buildContactDeliveryAdapter({ CONTACT_DELIVERY_ADAPTER: "smtp" }),
    ).toThrow(/expected "resend" or "sink"/);
  });

  it.each(["CONTACT_DELIVERY_FROM", "CONTACT_DELIVERY_TO", "RESEND_API_KEY"])(
    "refuses to build a provider adapter without %s",
    (settingName) => {
      const environment = { ...resendEnvironment, [settingName]: "" };

      expect(() => buildContactDeliveryAdapter(environment)).toThrow(
        new RegExp(settingName),
      );
    },
  );
});
