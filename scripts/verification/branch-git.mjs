import { mergeChangedPathGroups } from "./changed-files.mjs";
import { REPO_ROOT, runCommand } from "./environment.mjs";

/**
 * @param {string} stdout
 * @returns {string[]}
 */
export function splitNullDelimitedPaths(stdout) {
  if (!stdout || stdout.length === 0) {
    return [];
  }
  return stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * @param {readonly string[]} args
 * @param {string} [cwd]
 * @returns {Promise<string[]>}
 */
export async function gitNullDelimitedPaths(args, cwd = REPO_ROOT) {
  const result = await runCommand("git", [...args, "-z"], {
    stdio: "pipe",
    cwd,
  });
  if (result.code !== 0) {
    throw new Error(
      `git ${[...args, "-z"].join(" ")} failed (${String(result.code)}): ${result.stderr.trim()}`,
    );
  }
  return splitNullDelimitedPaths(result.stdout);
}

/**
 * @param {string} baseRef
 * @param {string} [cwd]
 * @returns {Promise<{ ok: true, sha: string } | { ok: false, message: string }>}
 */
export async function resolveBaseCommit(baseRef, cwd = REPO_ROOT) {
  const result = await runCommand(
    "git",
    ["rev-parse", "--verify", `${baseRef}^{commit}`],
    { stdio: "pipe", cwd },
  );
  if (result.code !== 0) {
    return {
      ok: false,
      message: [
        `Base reference "${baseRef}" is not a reachable commit.`,
        "Fetch the default branch and retry, for example:",
        "  git fetch origin main",
        `Or pass an explicit base: pnpm verify:branch -- --base=origin/main`,
      ].join("\n"),
    };
  }
  return { ok: true, sha: result.stdout.trim() };
}

/**
 * @param {string} baseSha
 * @param {string} [headRef]
 * @param {string} [cwd]
 */
export async function resolveMergeBase(
  baseSha,
  headRef = "HEAD",
  cwd = REPO_ROOT,
) {
  const result = await runCommand("git", ["merge-base", headRef, baseSha], {
    stdio: "pipe",
    cwd,
  });
  if (result.code !== 0) {
    throw new Error(
      `git merge-base failed (${String(result.code)}): ${result.stderr.trim()}`,
    );
  }
  const sha = result.stdout.trim();
  if (!sha) {
    throw new Error("git merge-base returned an empty SHA.");
  }
  return sha;
}

/**
 * Paths changed on the branch since merge-base (committed), plus working tree.
 *
 * @param {{ baseRef?: string, headRef?: string, gitCwd?: string }} [options]
 */
export async function branchChangedPaths(options = {}) {
  const baseRef = options.baseRef ?? "origin/main";
  const headRef = options.headRef ?? "HEAD";
  const gitCwd = options.gitCwd ?? REPO_ROOT;
  const base = await resolveBaseCommit(baseRef, gitCwd);
  if (!base.ok) {
    return { ok: false, message: base.message, baseRef };
  }
  const mergeBase = await resolveMergeBase(base.sha, headRef, gitCwd);

  const [
    committed,
    unstaged,
    staged,
    untracked,
    deletedUnstaged,
    deletedStaged,
  ] = await Promise.all([
    gitNullDelimitedPaths(
      ["diff", "--name-only", `${mergeBase}..${headRef}`],
      gitCwd,
    ),
    gitNullDelimitedPaths(
      ["diff", "--name-only", "--diff-filter=ACMR"],
      gitCwd,
    ),
    gitNullDelimitedPaths(
      ["diff", "--name-only", "--cached", "--diff-filter=ACMR"],
      gitCwd,
    ),
    gitNullDelimitedPaths(
      ["ls-files", "--others", "--exclude-standard"],
      gitCwd,
    ),
    gitNullDelimitedPaths(["diff", "--name-only", "--diff-filter=D"], gitCwd),
    gitNullDelimitedPaths(
      ["diff", "--name-only", "--cached", "--diff-filter=D"],
      gitCwd,
    ),
  ]);

  const paths = mergeChangedPathGroups(
    committed,
    unstaged,
    staged,
    untracked,
    deletedUnstaged,
    deletedStaged,
  );

  return {
    ok: true,
    baseRef,
    baseSha: base.sha,
    mergeBaseSha: mergeBase,
    paths,
  };
}
