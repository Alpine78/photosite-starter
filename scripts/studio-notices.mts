export function installedPackagePaths(packages: Record<string, unknown>): string[] {
  return Object.keys(packages).filter(Boolean).sort().map((path) => {
    if (!/^node_modules\/(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+(?:\/node_modules\/(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+)*$/.test(path)
      || path.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Invalid Studio dependency path");
    }
    return path;
  });
}

export function isNoticeFile(name: string): boolean {
  return /^(licen[sc]e|notice|copying)([._-].*)?$/i.test(name);
}

export type PackageMetadata = {
  name: string;
  version: string;
  license?: string | { type?: string };
  repository?: string | { url?: string };
};

export function packageNotice(metadata: PackageMetadata, resolved: string | undefined, notices: string[]): string {
  const license = typeof metadata.license === "string" ? metadata.license : metadata.license?.type;
  const repository = typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url;
  return [
    `${metadata.name}@${metadata.version}`,
    `License: ${license ?? "See upstream license text below"}`,
    `Upstream artifact: ${resolved ?? "See the committed Studio lockfile"}`,
    ...(repository ? [`Upstream source: ${repository}`] : []),
    ...notices,
  ].join("\n\n");
}
