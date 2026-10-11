/** Include installed dependency notices in the separately published Studio build. */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { installedPackagePaths, isNoticeFile, packageNotice, type PackageMetadata } from "./studio-notices.mts";

const studioRoot = fileURLToPath(new URL("../studio/", import.meta.url));
const lock = JSON.parse(await readFile(join(studioRoot, "package-lock.json"), "utf8")) as {
  packages: Record<string, { resolved?: string }>;
};
const sections = [
  "PhotoSite Studio — third-party notices",
  "Includes all installed dependencies, including build tools. Not every package enters the browser bundle.",
  "Packages are unmodified upstream releases except the documented PhotoSite braces fork.",
];
let included = 0;
for (const packagePath of installedPackagePaths(lock.packages)) {
  const entry = lock.packages[packagePath];
  const directory = join(studioRoot, packagePath);
  let metadata: PackageMetadata;
  try {
    metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  } catch (error) {
    // Optional dependencies for another OS/CPU are not installed or redistributed.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw error;
  }
  const noticeFiles = (await readdir(directory)).filter(isNoticeFile).sort();
  const notices: string[] = [];
  for (const file of noticeFiles) {
    const content = await readFile(join(directory, file), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EISDIR") return "";
      throw error;
    });
    if (content) notices.push(`${file}\n${content}`);
  }
  sections.push(packageNotice(metadata, entry.resolved, notices));
  included++;
}
await writeFile(join(studioRoot, "dist/THIRD-PARTY-NOTICES.txt"), sections.join("\n\n====================\n\n") + "\n");
console.log(`Included notices for ${included} installed Studio packages.`);
