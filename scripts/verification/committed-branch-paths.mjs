import { REPO_ROOT, runCommand } from "./environment.mjs";

/**
 * @param {string} stdout
 * @returns {string[]}
 */
export function splitNewlinePaths(stdout) {
  if (!stdout || stdout.length === 0) {
    return [];
  }
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Paths changed in committed history only: merge-base..HEAD (exclusive of unstaged/staged/untracked).
 *
 * @param {{ baseRef?: string, headRef?: string, gitCwd?: string }} [options]
 */
export async function committedBranchChangedPaths(options = {}) {
  const baseRef = options.baseRef ?? "origin/main";
  const headRef = options.headRef ?? "HEAD";
  const gitCwd = options.gitCwd ?? REPO_ROOT;

  const baseResult = await runCommand(
    "git",
    ["rev-parse", "--verify", `${baseRef}^{commit}`],
    { stdio: "pipe", cwd: gitCwd },
  );
  if (baseResult.code !== 0) {
    return {
      ok: false,
      message: [
        `Base reference "${baseRef}" is not a reachable commit.`,
        "Fetch the default branch and retry, for example:",
        "  git fetch origin main",
        `Or pass an explicit base: pnpm verify:pre-push -- --base=origin/main`,
      ].join("\n"),
      baseRef,
    };
  }
  const baseSha = baseResult.stdout.trim();

  const mergeBaseResult = await runCommand(
    "git",
    ["merge-base", headRef, baseSha],
    { stdio: "pipe", cwd: gitCwd },
  );
  if (mergeBaseResult.code !== 0) {
    return {
      ok: false,
      message: `Could not compute merge-base between ${headRef} and ${baseRef}: ${mergeBaseResult.stderr.trim()}`,
      baseRef,
    };
  }
  const mergeBaseSha = mergeBaseResult.stdout.trim();
  if (!mergeBaseSha) {
    return {
      ok: false,
      message: "git merge-base returned an empty SHA.",
      baseRef,
    };
  }

  const diffResult = await runCommand(
    "git",
    ["diff", "--name-only", `${mergeBaseSha}..${headRef}`],
    { stdio: "pipe", cwd: gitCwd },
  );
  if (diffResult.code !== 0) {
    return {
      ok: false,
      message: `git diff --name-only failed: ${diffResult.stderr.trim()}`,
      baseRef,
    };
  }

  const paths = splitNewlinePaths(diffResult.stdout);

  return {
    ok: true,
    baseRef,
    baseSha,
    mergeBaseSha,
    paths,
  };
}
