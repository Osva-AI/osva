import path from "node:path";

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/;

export function isSafeProjectRelativePath(relativePath: string): boolean {
  if (relativePath.length === 0) {
    return false;
  }
  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    WINDOWS_DRIVE_PATTERN.test(relativePath)
  ) {
    return false;
  }
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "..") {
      return false;
    }
  }
  return true;
}

export function resolvePathInsideRoot(
  rootDir: string,
  ...segments: string[]
): string {
  const target = path.resolve(rootDir, ...segments);
  const relative = path.relative(rootDir, target);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Path escapes the project directory.");
  }
  return target;
}

export function isInsideRoot(rootReal: string, targetReal: string): boolean {
  const relative = path.relative(rootReal, targetReal);
  if (relative.length === 0) {
    return true;
  }
  if (path.isAbsolute(relative)) {
    return false;
  }
  const parentTraversal = `..${path.sep}`;
  return relative !== ".." && !relative.startsWith(parentTraversal);
}
