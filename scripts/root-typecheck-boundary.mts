/**
 * AB#415: `next build` type-checks the root project on a root-only install, both in
 * DeployPreview and on Vercel. `tsconfig.json`'s `exclude` does not stop TypeScript
 * following an import into `studio/`, and a Studio file reached that way needs its
 * packages at the root too. Verify cannot see the failure, because it also installs
 * Studio. This walks the same import graph and names each package that would be missing.
 */
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export type StudioOnlyImport = { file: string; packageName: string };

const SUFFIXES = ["", ".ts", ".tsx", ".mts", ".d.ts", "/index.ts", "/index.tsx"];

export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || builtinModules.includes(packageNameOf(specifier));
}

/**
 * Every package a root-checked file reaches through `studio/` that the root does not
 * declare. `read` answers `undefined` for a path that is not a file.
 */
export function findStudioOnlyImports(input: {
  rootFiles: readonly string[];
  studioRoot: string;
  rootPackages: ReadonlySet<string>;
  read: (path: string) => string | undefined;
}): StudioOnlyImport[] {
  const { rootFiles, studioRoot, rootPackages, read } = input;
  const seen = new Set<string>();
  const queue = [...rootFiles];
  const found: StudioOnlyImport[] = [];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (text === undefined) continue;
    for (const { fileName: specifier } of ts.preProcessFile(text, true, true).importedFiles) {
      if (specifier.startsWith(".")) {
        const base = resolve(dirname(file), specifier);
        const target = SUFFIXES.map(suffix => base + suffix).find(path => read(path) !== undefined);
        if (target !== undefined) queue.push(target);
      } else if (
        file.startsWith(`${studioRoot}/`) && !isBuiltin(specifier) && !specifier.startsWith("@/") &&
        !rootPackages.has(packageNameOf(specifier))
      ) {
        found.push({ file, packageName: packageNameOf(specifier) });
      }
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.packageName.localeCompare(b.packageName));
}
