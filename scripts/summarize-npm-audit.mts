#!/usr/bin/env node
import { open } from "node:fs/promises";
import { summarizeNpmAudit } from "./npm-audit-summary.mts";
async function read(path: string) {
  const file = await open(path, "r"), cap = 4 * 1024 * 1024;
  try {
    const buffer = Buffer.alloc(cap + 1); let length = 0;
    while (length < buffer.length) { const result = await file.read(buffer, length, buffer.length - length); if (!result.bytesRead) break; length += result.bytesRead; }
    if (length > cap) throw new Error("limit");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await file.close(); }
}
try {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error("arguments");
  const result = summarizeNpmAudit(await read(args[0]));
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === "clean" ? 0 : 1;
} catch { console.error("Invalid audit report. Usage: summarize:audit -- <saved-audit.json>"); process.exitCode = 2; }
