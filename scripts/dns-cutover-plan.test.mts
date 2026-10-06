import { describe, expect, it } from "vitest";
import { compareDnsCutover } from "./dns-cutover-plan.mts";
const web = { name: "@", type: "A", value: "192.0.2.1", ttl: 300 };
const mail = { name: "@", type: "MX", value: "mail.example.test.", ttl: 3600, priority: 10 };
const txt = { name: "selector._domainkey", type: "TXT", value: " exact secret bytes ", ttl: 3600 };
const zone = (records = [web, mail, txt]) => ({ zone: "example.test", records });
describe("offline web-only DNS changes", () => {
  it("allows only explicitly named web records and never outputs TXT", () => {
    const result = compareDnsCutover(zone(), zone([{ ...web, value: "192.0.2.2" }, mail, txt]), ["@"]);
    expect(result.status).toBe("passed"); expect(JSON.stringify(result)).not.toContain(txt.value);
  });
  it.each(["ttl", "value", "priority"])("protects MX %s", (field) => {
    expect(compareDnsCutover(zone(), zone([web, { ...mail, [field]: field === "value" ? "other" : 20 }, txt]), ["@"]).status).toBe("failed");
  });
  it("preserves duplicate occurrences, TXT spaces and unlisted web hosts", () => {
    expect(compareDnsCutover(zone([web, txt, txt]), zone([web, txt]), ["@"]).protectedChanges).toBe(1);
    expect(compareDnsCutover(zone(), zone([web, mail, { ...txt, value: txt.value.trim() }]), ["@"]).status).toBe("failed");
    expect(compareDnsCutover(zone([{ ...web, name: "mail" }]), zone([{ ...web, name: "mail", ttl: 50 }]), ["@"]).status).toBe("failed");
  });
  it("normalizes explicit absolute owners while retaining all record attributes", () => {
    expect(compareDnsCutover(zone(), zone([{ ...web, name: "EXAMPLE.TEST." }, mail, txt]), ["@"]).status).toBe("passed");
  });
  it("refuses apex aliases, coexistence and two targets", () => {
    const alias = { name: "www", type: "CNAME", value: "target.example.test.", ttl: 300 };
    for (const records of [[{ ...alias, name: "@" }], [alias, { ...web, name: "www" }], [alias, { ...alias, value: "other.example.test." }]]) expect(compareDnsCutover(zone([]), zone(records), ["www", "@"]).cnameConflict).toBe(true);
    expect(compareDnsCutover(zone([]), zone([alias, { ...txt, name: "www", type: "RRSIG" }]), ["www"]).cnameConflict).toBe(false);
  });
  it.each(["evil.test.", "@ ", "*", "-bad", "a..b"])("refuses ambiguous web owner %s", (owner) => expect(() => compareDnsCutover(zone(), zone(), [owner])).toThrow("invalid-dns-input"));
  it("rejects malformed IP, unknown keys and changed zones", () => {
    expect(() => compareDnsCutover(zone(), zone([{ ...web, value: "999.0.0.1" }]), ["@"]).status).toThrow();
    expect(() => compareDnsCutover({ ...zone(), secret: "x" }, zone(), ["@"]).status).toThrow();
    expect(() => compareDnsCutover(zone(), { ...zone(), zone: "other.test" }, ["@"]).status).toThrow();
  });
});
