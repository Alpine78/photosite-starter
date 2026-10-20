/**
 * `npm run task:start -- <branch> [--no-install]` (AB#381): create, publish and
 * verify a new linked task worktree exactly as AGENTS.md "Branch publication
 * and VS Code worktrees" describes. A new worktree only: an existing local or
 * remote branch, directory or checkout is refused, never reused or repaired.
 *
 * Every git and npm call takes an argument array, never a shell string. Azure
 * Boards is left alone: the work item still moves to Active before the first
 * edit, by whoever starts the task.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  localCollisions, parseTaskBranch, parseWorktreeList, primaryRootFromCommonDir, publishArguments,
  pushDestinationProblem, remoteBranchState, requiredLocalConfig, verifyPublication, worktreePath, worktreeVisibility,
} from "./task-worktree.mts";

class StopError extends Error {}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function tryGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function stop(message: string): never { throw new StopError(message); }

function main(argv: string[]): void {
  const flags = argv.filter(value => value.startsWith("--"));
  const names = argv.filter(value => !value.startsWith("--"));
  if (names.length !== 1 || flags.some(flag => flag !== "--no-install")) {
    stop("Usage: npm run task:start -- <feature|fix>/<id>-<slug> | <chore|codex>/[<id>-]<slug> [--no-install]");
  }
  const parsed = parseTaskBranch(names[0]) ?? stop(`"${names[0]}" does not follow the AGENTS.md branch naming rule.`);
  const branch = parsed.branch, install = !flags.includes("--no-install");

  // 1. Inspect, change nothing.
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], process.cwd());
  const primaryRoot = primaryRootFromCommonDir(commonDir) ?? stop(`Unsupported repository layout: ${commonDir} is not a primary checkout's .git directory.`);
  const directory = worktreePath(primaryRoot, branch);
  console.log(`Primary checkout: ${primaryRoot}`);
  console.log(git(["status", "--short", "--branch"], primaryRoot).split("\n")[0]);
  const worktrees = parseWorktreeList(git(["worktree", "list", "--porcelain"], primaryRoot));
  const collisions = localCollisions({
    branch, directory, worktrees, directoryExists: existsSync(directory),
    localBranchExists: tryGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], primaryRoot).status === 0,
  });
  if (collisions.length) stop(`Refused before any change:\n  - ${collisions.join("\n  - ")}`);
  const fetchUrl = git(["remote", "get-url", "origin"], primaryRoot);
  const destination = pushDestinationProblem(fetchUrl, git(["remote", "get-url", "--push", "--all", "origin"], primaryRoot).split("\n").filter(Boolean));
  if (destination) stop(destination);
  console.log(`origin: ${fetchUrl}`);

  // 2. Fetch (updates only remote-tracking refs) and check the start and destination.
  git(["fetch", "origin"], primaryRoot);
  const start = tryGit(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"], primaryRoot);
  if (start.status !== 0) stop("origin/main does not resolve to a commit after fetch.");
  const startCommit = start.stdout.trim();
  const remote = tryGit(["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`], primaryRoot);
  const state = remoteBranchState(remote.status, remote.stdout, branch);
  if (state === "exists") stop(`origin already has ${branch}; refused, nothing changed except the fetch.`);
  if (state === "unknown") stop(`Could not establish whether origin has ${branch} (git ls-remote exited ${remote.status}); refused.`);

  // 3. Repository-local defaults, then the worktree.
  for (const [key, value] of requiredLocalConfig) git(["config", "--local", key, value], primaryRoot);
  git(["worktree", "add", "--no-track", "-b", branch, directory, startCommit], primaryRoot);
  git(["config", "--local", `branch.${branch}.pushRemote`, "origin"], directory);

  // 4. Publish with the explicit same-name refspec, create-only: a branch
  // created on origin since the check is refused, never advanced.
  const push = tryGit(publishArguments(branch), directory);
  if (push.status !== 0) {
    // A failed push sets no upstream; clear one anyway so none is left behind.
    tryGit(["branch", "--unset-upstream", branch], directory);
    const upstreamNow = tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], directory);
    stop([
      `Publication failed (git push exited ${push.status}). The worktree is kept at ${directory}.`,
      push.stderr.trim(),
      upstreamNow.status === 0 ? `Upstream could NOT be cleared (still ${upstreamNow.stdout.trim()}); unset it before working.` : "Upstream is unset; publish explicitly once the cause is fixed:",
      // The same create-only arguments: a branch that appeared meanwhile stays refused.
      `  git -C "${directory}" ${publishArguments(branch).map(arg => `"${arg}"`).join(" ")}`,
    ].filter(Boolean).join("\n"));
  }
  const published = tryGit(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], directory).stdout.split("\t")[0]?.trim();
  if (published !== startCommit) stop(`origin/${branch} is ${published || "(unreadable)"}, not the start commit ${startCommit}: it existed or changed during setup. Inspect before working.`);

  // 5. Verify in the actual working directory.
  // Tags follow the operator's own push.followTags; this checks the branch destination.
  const dryRun = tryGit(["push", "--dry-run", "--porcelain", "--no-follow-tags"], directory);
  const upstream = tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], directory);
  const problems = verifyPublication({
    branch, expectedDirectory: directory,
    topLevel: git(["rev-parse", "--show-toplevel"], directory),
    currentBranch: tryGit(["symbolic-ref", "--short", "-q", "HEAD"], directory).stdout.trim(),
    upstream: upstream.status === 0 ? upstream.stdout.trim() : "",
    dryRunExitCode: dryRun.status, dryRunPorcelain: dryRun.stdout,
  });
  if (problems.length) stop(`Published, but verification failed in ${directory}:\n  - ${problems.join("\n  - ")}`);
  console.log(`\nWorktree:  ${directory}\nBranch:    ${branch} (from origin/main ${startCommit.slice(0, 12)})\nUpstream:  origin/${branch}\nPush:      refs/heads/${branch} → origin, verified`);

  // 6. Dependencies. Failure here leaves a published, verified worktree.
  if (install) {
    const steps: [string, string[]][] = [["root", ["ci"]]];
    if (existsSync(path.join(directory, "studio", "package-lock.json"))) steps.push(["Studio", ["ci", "--prefix", "studio"]]);
    for (const [label, args] of steps) {
      console.log(`\nInstalling ${label} dependencies (npm ${args.join(" ")})…`);
      // `npm run` exports npm's own JavaScript entry point; running it with this
      // Node avoids the shell-only `npm.cmd` launcher on native Windows.
      const npmCli = process.env.npm_execpath;
      const result = npmCli
        ? spawnSync(process.execPath, [npmCli, ...args], { cwd: directory, stdio: "inherit" })
        : spawnSync("npm", args, { cwd: directory, stdio: "inherit" });
      if (result.error || result.status !== 0) {
        const cause = result.error ? `could not start npm (${result.error.message})` : `npm exited ${result.status}`;
        stop(`The worktree is published and verified, but the ${label} install failed: ${cause}. Resume in place:\n  cd "${directory}" && npm ${args.join(" ")}`);
      }
    }
  }

  // 7. Editor visibility: report only what the local settings can show.
  const settingsFile = path.join(primaryRoot, ".vscode", "settings.json");
  const notes = worktreeVisibility(worktrees.length + 1, existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : null);
  console.log([
    "",
    ...notes,
    "VS Code Source Control visibility was not verified by this command. If the worktree is missing:",
    "  Developer: Reload Window, then Source Control: Focus on Repositories View (or Git: Open Repository...).",
    parsed.workItemId ? `Azure Boards: AB#${parsed.workItemId} has not been changed — move it to Active before the first edit.` : "Azure Boards: nothing was changed.",
  ].join("\n"));
}

try { main(process.argv.slice(2)); } catch (error) {
  console.error(error instanceof StopError ? error.message : `[task:start] ${(error as Error).message}`);
  process.exitCode = 1;
}
