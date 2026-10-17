#!/usr/bin/env node
/** Read explicit saved inputs only; no dependency installation or registry call. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { AUDIT_TRIAGE_LIMITS, triageSavedAudit } from "./npm-audit-triage.mts";

async function read(path: string, limit: number) {
  // Nonblocking open prevents a supplied FIFO from waiting for a writer.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error();
    const buffer = Buffer.alloc(limit + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error();
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}
try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error();
  const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await read(args[0], AUDIT_TRIAGE_LIMITS.envelopeBytes)));
  const result = triageSavedAudit(envelope, await read(args[1], AUDIT_TRIAGE_LIMITS.lockfileBytes));
  console.log(JSON.stringify(result));
  process.exitCode = result.status === "clean" ? 0 : 1;
} catch {
  console.error("Invalid audit triage input. Usage: triage:audit -- <paired-audit.json> <package-lock.json>");
  process.exitCode = 2;
}
