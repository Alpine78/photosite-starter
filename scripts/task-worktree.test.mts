import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  localCollisions, parseSettings, parseTaskBranch, parseWorktreeList, primaryRootFromCommonDir, publishArguments,
  pushDestinationProblem, remoteBranchState, verifyPublication, worktreePath, worktreeVisibility,
} from "./task-worktree.mts";

describe("task branch names (AGENTS.md Git workflow)", () => {
  it("accepts the documented prefixes and extracts a work item id", () => {
    expect(parseTaskBranch("feature/6-responsive-header")).toEqual({ branch: "feature/6-responsive-header", workItemId: 6 });
    expect(parseTaskBranch("fix/377-header-focus-scroll")).toEqual({ branch: "fix/377-header-focus-scroll", workItemId: 377 });
    expect(parseTaskBranch("chore/381-task-bootstrap")?.workItemId).toBe(381);
    expect(parseTaskBranch("chore/bump-deps")).toEqual({ branch: "chore/bump-deps" });
    expect(parseTaskBranch("codex/review-notes")).toEqual({ branch: "codex/review-notes" });
  });
  it("refuses everything else", () => {
    for (const name of ["feature/no-id", "fix/12", "main", "feat/1-x", "chore/Upper", "chore/a--b", "chore/-a",
      "chore/a/b", "refs/heads/chore/a", "chore/a ", "chore/../a", "chore/a.", "feature/1-x/", ""]) {
      expect(parseTaskBranch(name), name).toBeNull();
    }
  });
  it("derives the canonical worktree path from the complete branch name", () => {
    expect(worktreePath("/repo", "fix/377-header-focus-scroll")).toBe(path.join("/repo", "temp", "worktrees", "fix-377-header-focus-scroll"));
  });
  it("supports only an ordinary .git directory as the common dir", () => {
    expect(primaryRootFromCommonDir("/repo/.git")).toBe("/repo");
    expect(primaryRootFromCommonDir("/srv/repo.git")).toBeNull();
  });
});

describe("preflight and verification decisions", () => {
  const worktrees = parseWorktreeList("worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/temp/worktrees/chore-a\nHEAD def\nbranch refs/heads/chore/a\n\nworktree /repo/temp/worktrees/detached\nHEAD 123\ndetached\n");
  it("parses registered worktrees and their branches", () => {
    expect(worktrees).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo/temp/worktrees/chore-a", branch: "chore/a" },
      { path: "/repo/temp/worktrees/detached" },
    ]);
  });
  it("refuses an existing branch, directory or checkout and allows a fresh one", () => {
    const base = { worktrees, directoryExists: false, localBranchExists: false };
    expect(localCollisions({ ...base, branch: "chore/b", directory: "/repo/temp/worktrees/chore-b" })).toEqual([]);
    expect(localCollisions({ ...base, branch: "chore/a", directory: "/repo/temp/worktrees/chore-a" })).toHaveLength(1);
    expect(localCollisions({ ...base, branch: "chore/c", directory: "/repo/temp/worktrees/detached" })).toHaveLength(1);
    expect(localCollisions({ ...base, branch: "chore/b", directory: "/x", directoryExists: true, localBranchExists: true })).toHaveLength(2);
  });
  it("treats only exit 2 as absence of the remote branch", () => {
    expect(remoteBranchState(2, "", "chore/b")).toBe("absent");
    expect(remoteBranchState(0, "abc\trefs/heads/chore/b\n", "chore/b")).toBe("exists");
    expect(remoteBranchState(128, "", "chore/b")).toBe("unknown");
    expect(remoteBranchState(0, "abc\trefs/heads/chore/bb\n", "chore/b")).toBe("unknown");
  });
  const good = {
    branch: "chore/b", expectedDirectory: "/repo/temp/worktrees/chore-b", topLevel: "/repo/temp/worktrees/chore-b",
    currentBranch: "chore/b", upstream: "origin/chore/b", dryRunExitCode: 0,
    dryRunPorcelain: "To origin\n=\trefs/heads/chore/b:refs/heads/chore/b\t[up to date]\nDone\n",
  };
  it("passes only an exact same-name publication", () => {
    expect(verifyPublication(good)).toEqual([]);
    expect(verifyPublication({ ...good, upstream: "origin/main" })).toHaveLength(1);
    expect(verifyPublication({ ...good, currentBranch: "" })).toHaveLength(1);
    expect(verifyPublication({ ...good, topLevel: "/repo" })).toHaveLength(1);
    expect(verifyPublication({ ...good, dryRunExitCode: 1 })).toHaveLength(1);
    expect(verifyPublication({ ...good, dryRunPorcelain: "Done\n" })).toHaveLength(1);
  });
  it("rejects any additional or different ref update a plain push would make", () => {
    const extra = good.dryRunPorcelain.replace("Done", "=\trefs/heads/main:refs/heads/main\t[up to date]\nDone");
    expect(verifyPublication({ ...good, dryRunPorcelain: extra })).toEqual(["git push would update refs/heads/main:refs/heads/main"]);
    expect(verifyPublication({ ...good, dryRunPorcelain: " \trefs/heads/chore/b:refs/heads/main\tabc..def\nDone\n" })).toHaveLength(1);
  });
});

describe("publication destination", () => {
  it("is create-only and same-name", () => {
    expect(publishArguments("chore/b")).toEqual(["push", "--no-follow-tags", "--force-with-lease=refs/heads/chore/b:", "--set-upstream", "origin", "refs/heads/chore/b:refs/heads/chore/b"]);
  });
  it("accepts only a single push URL equal to the fetch URL", () => {
    expect(pushDestinationProblem("u", ["u"])).toBeNull();
    expect(pushDestinationProblem("u", ["v"])).toMatch(/Refused/);
    expect(pushDestinationProblem("u", ["u", "v"])).toMatch(/Refused/);
  });
});

describe("VS Code visibility notes", () => {
  it("reads comments and trailing commas", () => {
    expect(parseSettings('{\n  // c\n  "a": "http://x", /* b */ "b": [1,],\n}')).toEqual({ a: "http://x", b: [1] });
    expect(parseSettings("{ nope")).toBeNull();
  });
  it("says only what the local file can show", () => {
    expect(worktreeVisibility(3, null)[0]).toMatch(/cannot be verified.*absent/);
    expect(worktreeVisibility(3, "{")[0]).toMatch(/not readable JSON/);
    expect(worktreeVisibility(3, '{"git.detectWorktrees": true, "scm.alwaysShowRepositories": true, "git.detectWorktreesLimit": 50}')).toEqual([]);
    expect(worktreeVisibility(51, '{"git.detectWorktrees": true, "scm.alwaysShowRepositories": true, "git.detectWorktreesLimit": 50}')).toEqual(["51 registered worktrees exceed git.detectWorktreesLimit 50."]);
    expect(worktreeVisibility(3, '{"git.detectWorktrees": false}')).toHaveLength(2);
  });
});

// The real command against a real, local git: an isolated bare origin and a
// primary clone, without the operator's global/system configuration or hooks.
describe("npm run task:start against a local origin", () => {
  const script = fileURLToPath(new URL("./start-task.mts", import.meta.url));
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function setup() {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "task start ")));
    roots.push(root);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "", NODE_ENV: "test", HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
    };
    const git = (args: string[], cwd: string) => {
      const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
      return result.stdout.trim();
    };
    const origin = path.join(root, "origin.git"), primary = path.join(root, "primary");
    git(["init", "--quiet", "--bare", "--initial-branch=main", origin], root);
    git(["clone", "--quiet", origin, primary], root);
    git(["commit", "--quiet", "--allow-empty", "-m", "init"], primary);
    git(["push", "--quiet", "origin", "HEAD:refs/heads/main"], primary);
    const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [script, ...args, "--no-install"], { cwd, env, encoding: "utf8" });
    return { root, origin, primary, git, run, main: git(["rev-parse", "HEAD"], primary) };
  }

  it("creates, publishes and verifies a new worktree, also when started from a linked one", () => {
    const { primary, git, run, main } = setup();
    const first = run(primary, "chore/12-first-task");
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    const directory = path.join(primary, "temp", "worktrees", "chore-12-first-task");
    expect(git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], directory)).toBe("origin/chore/12-first-task");
    expect(git(["ls-remote", "--heads", "origin", "refs/heads/chore/12-first-task"], primary).split("\t")[0]).toBe(main);
    expect(git(["config", "--local", "push.autoSetupRemote"], primary)).toBe("true");
    expect(git(["config", "--local", "branch.chore/12-first-task.pushRemote"], primary)).toBe("origin");
    expect(first.stdout).toContain("AB#12 has not been changed");

    const second = run(directory, "fix/13-second-task");
    expect(second.status).toBe(0);
    expect(existsSync(path.join(primary, "temp", "worktrees", "fix-13-second-task"))).toBe(true);
  });

  it("does not publish annotated tags when push.followTags is enabled", () => {
    const { primary, git, run, main } = setup();
    git(["config", "--local", "push.followTags", "true"], primary);
    git(["tag", "--annotate", "start-tag", "--message", "start", main], primary);
    const result = run(primary, "chore/no-tags");
    expect(git(["ls-remote", "--tags", "origin"], primary)).toBe("");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("refuses an existing remote branch or directory before changing configuration", () => {
    const { primary, git, run } = setup();
    git(["push", "--quiet", "origin", "HEAD:refs/heads/chore/taken"], primary);
    const taken = run(primary, "chore/taken");
    expect(taken.status).toBe(1);
    expect(taken.stderr).toContain("origin already has chore/taken");
    expect(existsSync(path.join(primary, "temp", "worktrees", "chore-taken"))).toBe(false);

    mkdirSync(path.join(primary, "temp", "worktrees", "chore-busy"), { recursive: true });
    const busy = run(primary, "chore/busy");
    expect(busy.status).toBe(1);
    expect(busy.stderr).toContain("Refused before any change");
    expect(spawnSync("git", ["config", "--local", "push.autoSetupRemote"], { cwd: primary }).status).not.toBe(0);
  });

  it("fails verification when a push setting would update another ref", () => {
    const { primary, git, run } = setup();
    git(["config", "--local", "remote.origin.push", "refs/heads/main:refs/heads/main"], primary);
    const result = run(primary, "chore/extra-ref");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("git push would update refs/heads/main:refs/heads/main");
  });

  it("keeps the worktree and leaves no upstream when publication is rejected", () => {
    const { origin, primary, git, run } = setup();
    const hook = path.join(origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho rejected by test >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const result = run(primary, "chore/rejected");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Publication failed");
    expect(result.stderr).toContain("Upstream is unset");
    expect(result.stderr).toContain('"--force-with-lease=refs/heads/chore/rejected:"');
    const directory = path.join(primary, "temp", "worktrees", "chore-rejected");
    expect(existsSync(directory)).toBe(true);
    expect(spawnSync("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: directory }).status).not.toBe(0);
    expect(git(["ls-remote", "--heads", "origin"], primary)).not.toContain("chore/rejected");
  });

  it("refuses a push URL that differs from the fetch URL", () => {
    const { root, primary, git, run } = setup();
    git(["init", "--quiet", "--bare", path.join(root, "elsewhere.git")], root);
    git(["remote", "set-url", "--push", "origin", path.join(root, "elsewhere.git")], primary);
    const result = run(primary, "chore/split-remote");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("but fetches from");
    expect(existsSync(path.join(primary, "temp", "worktrees", "chore-split-remote"))).toBe(false);
  });

  it("publishes create-only: a branch that appeared on origin is not advanced", () => {
    const { primary, git, main } = setup();
    // The race the preflight cannot close: the branch appears at an ancestor
    // after the check. A plain push would fast-forward it; this one refuses.
    git(["switch", "--quiet", "-c", "chore/raced"], primary);
    git(["push", "--quiet", "origin", `${main}:refs/heads/chore/raced`], primary);
    git(["commit", "--quiet", "--allow-empty", "-m", "local"], primary);
    git(["fetch", "--quiet", "origin"], primary);
    git(["update-ref", "-d", "refs/remotes/origin/chore/raced"], primary);
    const push = spawnSync("git", publishArguments("chore/raced"), { cwd: primary, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("stale info");
    expect(git(["ls-remote", "--heads", "origin", "refs/heads/chore/raced"], primary).split("\t")[0]).toBe(main);
  });

  it("refuses names outside the AGENTS.md rule", () => {
    const { primary, run } = setup();
    expect(run(primary, "my-branch").status).toBe(1);
    expect(run(primary, "feature/no-id").stderr).toContain("naming rule");
  });
});
