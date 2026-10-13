#!/usr/bin/env node
/** AB#117 operator command. Default is plan-only; --send sends exactly one test. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { contactSmokePlan, sendContactSmoke } from "./contact-delivery-smoke.mts";

async function main() {
  const args = process.argv.slice(2), values = new Map<string, string>();
  const send = args.at(-1) === "--send";
  if (send) args.pop();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--origin", "--out", "--submission-id"].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error("ARGUMENTS");
    values.set(args[i], args[i + 1]);
  }
  if (!values.has("--origin") || !values.has("--out")) throw new Error("ARGUMENTS");
  const submissionId = values.get("--submission-id") ?? randomUUID(), plan = contactSmokePlan(values.get("--origin")!, submissionId);
  const out = path.resolve(values.get("--out")!), parent = await lstat(path.dirname(out));
  if (process.getuid === undefined || !parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700 ||
    await realpath(path.dirname(out)) !== path.dirname(out)) throw new Error("PRIVATE_OUTPUT");
  const fd = await open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    // Persist identity before sending: an ambiguous failure must not erase the attempt.
    const prepared = { version: 1, status: send ? "prepared" : "plan-only", origin: plan.origin, submissionId,
      mailboxArrivalVerified: false, replyToVerified: false, automaticRetry: false };
    await fd.writeFile(JSON.stringify(prepared, null, 2) + "\n"); await fd.sync();
    const report = send ? await sendContactSmoke(plan.origin, submissionId) : prepared;
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
    const written = await fd.write(bytes, 0, bytes.length, 0);
    if (written.bytesWritten !== bytes.length) throw new Error("INCOMPLETE_RECEIPT");
    await fd.truncate(bytes.length); await fd.sync();
    console.log(JSON.stringify(report));
    if (send && report.status !== "provider-accepted") process.exitCode = 1;
  } finally { await fd.close(); }
}
main().catch(() => { console.error("Contact smoke failed; no automatic retry. Inspect the private receipt; a message may already have been sent. Details withheld."); process.exitCode = 1; });
