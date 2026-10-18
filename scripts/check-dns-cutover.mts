#!/usr/bin/env node
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { compareDnsCutover } from "./dns-cutover-plan.mts";
async function read(path: string) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOCTTY ?? 0));
  const cap = 4 * 1024 * 1024;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > cap) throw new Error("input-file");
    const buffer = Buffer.alloc(cap + 1); let length = 0;
    while (length < buffer.length) { const result = await file.read(buffer, length, buffer.length - length); if (!result.bytesRead) break; length += result.bytesRead; }
    if (length > cap) throw new Error("limit");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await file.close(); }
}
try {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error("arguments");
  const result = compareDnsCutover(await read(args[0]), await read(args[1]), await read(args[2]));
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === "passed" ? 0 : 1;
} catch { console.error("Invalid DNS input. Usage: check:dns-cutover -- <before.json> <after.json> <web-hosts.json>"); process.exitCode = 2; }
