/**
 * Decisions for `npm run task:start` (AB#381): AGENTS.md "Branch publication
 * and VS Code worktrees", as pure functions. The IO is in `start-task.mts`.
 */
import path from "node:path";

export type TaskBranch = { branch: string; workItemId?: number };

const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
const withId = new RegExp(`^(feature|fix)/(\\d+)-${slug}$`);
const optionalId = new RegExp(`^(chore|codex)/(?:(\\d+)-)?${slug}$`);

/** The branch naming rule in AGENTS.md "Git workflow"; anything else is refused. */
export function parseTaskBranch(name: string): TaskBranch | null {
  const match = withId.exec(name) ?? optionalId.exec(name);
  if (!match) return null;
  return match[2] ? { branch: name, workItemId: Number(match[2]) } : { branch: name };
}

/** `<primary>/temp/worktrees/<complete branch name with / replaced by ->`. */
export function worktreePath(primaryRoot: string, branch: string): string {
  return path.join(primaryRoot, "temp", "worktrees", branch.replaceAll("/", "-"));
}

/**
 * The primary checkout is the parent of the shared `.git` directory. Only that
 * ordinary layout is supported: a bare repository or a separate git dir has no
 * primary checkout for `temp/worktrees/` to live in.
 */
export function primaryRootFromCommonDir(commonDir: string): string | null {
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : null;
}

/** Repository-local settings, applied with `--local` and never `--global`. */
export const requiredLocalConfig: ReadonlyArray<readonly [string, string]> = [
  ["branch.autoSetupMerge", "simple"],
  ["push.default", "simple"],
  ["push.autoSetupRemote", "true"],
  ["remote.pushDefault", "origin"],
];

/** `git worktree list --porcelain`: the registered paths and their branches. */
export function parseWorktreeList(porcelain: string): { path: string; branch?: string }[] {
  const entries: { path: string; branch?: string }[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) entries.push({ path: line.slice("worktree ".length) });
    else if (line.startsWith("branch refs/heads/") && entries.length) {
      entries[entries.length - 1].branch = line.slice("branch refs/heads/".length);
    }
  }
  return entries;
}

export type Preflight = {
  branch: string;
  directory: string;
  directoryExists: boolean;
  localBranchExists: boolean;
  worktrees: { path: string; branch?: string }[];
};

/** Local refusals, checked before the command changes anything at all. */
export function localCollisions(input: Preflight): string[] {
  const problems: string[] = [];
  if (input.localBranchExists) problems.push(`local branch ${input.branch} already exists`);
  if (input.directoryExists) problems.push(`${input.directory} already exists`);
  for (const entry of input.worktrees) {
    if (entry.branch === input.branch) problems.push(`${input.branch} is already checked out at ${entry.path}`);
    else if (path.resolve(entry.path) === path.resolve(input.directory)) problems.push(`a worktree is already registered at ${entry.path}`);
  }
  return problems;
}

/**
 * `git ls-remote --exit-code --heads origin refs/heads/<branch>` exits 2 when
 * the ref is absent. Any other failure (authentication, network) is not
 * evidence of absence, so it refuses rather than guessing.
 */
export function remoteBranchState(exitCode: number, stdout: string, branch: string): "absent" | "exists" | "unknown" {
  if (exitCode === 2 && stdout.trim() === "") return "absent";
  if (exitCode === 0 && stdout.split("\n").some(line => line.endsWith(`\trefs/heads/${branch}`))) return "exists";
  return "unknown";
}

/**
 * The publication command. `--force-with-lease=<ref>:` with an empty expected
 * value is git's create-only condition: the push is refused unless the remote
 * ref is still absent, so a branch created on origin after the preflight
 * check can be neither fast-forwarded nor overwritten. It is the opposite of
 * a force push, which AGENTS.md forbids.
 */
export function publishArguments(branch: string): string[] {
  const ref = `refs/heads/${branch}`;
  return ["push", "--no-follow-tags", `--force-with-lease=${ref}:`, "--set-upstream", "origin", `${ref}:${ref}`];
}

/** The existence checks query the fetch URL, so publication must go to that same URL. */
export function pushDestinationProblem(fetchUrl: string, pushUrls: readonly string[]): string | null {
  if (pushUrls.length === 1 && pushUrls[0] === fetchUrl) return null;
  return `origin pushes to ${pushUrls.join(", ") || "(none)"} but fetches from ${fetchUrl}; the remote-branch check would look at the wrong repository. Refused.`;
}

export type Publication = {
  branch: string;
  expectedDirectory: string;
  topLevel: string;
  currentBranch: string;
  upstream: string;
  dryRunExitCode: number;
  dryRunPorcelain: string;
};

/**
 * Step 5 of the AGENTS.md workflow. Every ref update a plain `git push` would
 * make has to be this branch to its same-named remote branch: one matching
 * line is not enough when a `remote.<name>.push` setting adds others.
 */
export function verifyPublication(input: Publication): string[] {
  const problems: string[] = [];
  const expectedRef = `refs/heads/${input.branch}`;
  if (path.resolve(input.topLevel) !== path.resolve(input.expectedDirectory)) problems.push(`top level is ${input.topLevel}, expected ${input.expectedDirectory}`);
  if (input.currentBranch !== input.branch) problems.push(`current branch is ${input.currentBranch || "(detached)"}, expected ${input.branch}`);
  if (input.upstream !== `origin/${input.branch}`) problems.push(`upstream is ${input.upstream || "(unset)"}, expected origin/${input.branch}`);
  if (input.dryRunExitCode !== 0) problems.push(`git push --dry-run exited ${input.dryRunExitCode}`);
  const updates = input.dryRunPorcelain.split("\n").filter(line => /^[ +\-*=!]\t/.test(line));
  if (updates.length === 0) problems.push("git push --dry-run reported no ref update");
  for (const line of updates) {
    const refspec = line.split("\t")[1] ?? "";
    if (refspec !== `${expectedRef}:${expectedRef}`) problems.push(`git push would update ${refspec}`);
  }
  return problems;
}

/** A JSON-with-comments reader for VS Code settings: comments and trailing commas. */
export function parseSettings(text: string): Record<string, unknown> | null {
  let out = "", inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") { out += next ?? ""; i++; } else if (c === "\"") inString = false;
    } else if (c === "\"") { inString = true; out += c; }
    else if (c === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; }
    else if (c === "/" && next === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; }
    else out += c;
  }
  try {
    const value: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/**
 * What can be said from the primary checkout's local settings alone. User or
 * profile settings may also enable detection, so absence is "cannot verify",
 * never "disabled".
 */
export function worktreeVisibility(registered: number, settingsText: string | null): string[] {
  const unverifiable = "VS Code worktree visibility cannot be verified from the repository-local .vscode/settings.json";
  if (settingsText === null) return [`${unverifiable} (file absent).`];
  const settings = parseSettings(settingsText);
  if (settings === null) return [`${unverifiable} (file is not readable JSON).`];
  const notes: string[] = [];
  if (settings["git.detectWorktrees"] !== true) notes.push(`${unverifiable}: git.detectWorktrees is not true there.`);
  if (settings["scm.alwaysShowRepositories"] !== true) notes.push(`${unverifiable}: scm.alwaysShowRepositories is not true there.`);
  const limit = settings["git.detectWorktreesLimit"];
  if (typeof limit === "number" && registered > limit) notes.push(`${registered} registered worktrees exceed git.detectWorktreesLimit ${limit}.`);
  return notes;
}
