import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findStudioOnlyImports, packageNameOf } from "./root-typecheck-boundary.mts";

const REPOSITORY = resolve(import.meta.dirname, "..");

function readIfFile(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

function fixture(files: Record<string, string>) {
  return (path: string) => files[path];
}

describe("findStudioOnlyImports", () => {
  it("finds a Studio-only package through a type-only import chain", () => {
    expect(findStudioOnlyImports({
      rootFiles: ["/r/e2e/a.spec.ts"],
      studioRoot: "/r/studio",
      rootPackages: new Set(["react"]),
      read: fixture({
        "/r/e2e/a.spec.ts": 'import type { P } from "../studio/dialog";',
        "/r/studio/dialog.tsx": 'import { Card } from "@sanity/ui/theme"; import React from "react"; import "./copy";',
        "/r/studio/copy.ts": 'import { readFileSync } from "node:fs"; import { join } from "path";',
      }),
    })).toEqual([{ file: "/r/studio/dialog.tsx", packageName: "@sanity/ui" }]);
  });

  it("leaves a root file's own packages to the compiler", () => {
    expect(findStudioOnlyImports({
      rootFiles: ["/r/src/a.ts"],
      studioRoot: "/r/studio",
      rootPackages: new Set(),
      read: fixture({ "/r/src/a.ts": 'import { b } from "some-root-package";' }),
    })).toEqual([]);
  });

  it("names scoped and unscoped packages", () => {
    expect(packageNameOf("@sanity/ui/theme")).toBe("@sanity/ui");
    expect(packageNameOf("sanity/structure")).toBe("sanity");
  });
});

describe("the root type check of this repository", () => {
  it("reaches no package that only Studio installs", () => {
    const parsed = ts.parseJsonConfigFileContent(
      ts.readConfigFile(resolve(REPOSITORY, "tsconfig.json"), ts.sys.readFile).config,
      ts.sys,
      REPOSITORY,
    );
    const manifest = JSON.parse(readFileSync(resolve(REPOSITORY, "package.json"), "utf8"));
    expect(findStudioOnlyImports({
      rootFiles: parsed.fileNames,
      studioRoot: resolve(REPOSITORY, "studio"),
      rootPackages: new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })),
      read: readIfFile,
    })).toEqual([]);
  });

  it("checks the excluded Studio journey specs in Verify", () => {
    const pipeline = readFileSync(resolve(REPOSITORY, "azure-pipelines.yml"), "utf8");
    expect(pipeline).toContain("npm run typecheck:studio-journeys");
  });
});
