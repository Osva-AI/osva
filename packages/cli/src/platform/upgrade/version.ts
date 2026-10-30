export interface ParsedPlatformVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly raw: string;
}

export function parsePlatformVersion(raw: string): ParsedPlatformVersion {
  const trimmed = raw.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed);
  if (match === null) {
    throw new Error(`Invalid platform version '${raw}'.`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prereleaseRaw = match[4];
  const prerelease =
    prereleaseRaw === undefined || prereleaseRaw.length === 0
      ? []
      : prereleaseRaw.split(".");
  return { major, minor, patch, prerelease, raw: trimmed };
}

/** Semantic ordering for OSVA platform versions (not lexical string compare). */
export function comparePlatformVersions(
  left: string,
  right: string,
): -1 | 0 | 1 {
  const a = parsePlatformVersion(left);
  const b = parsePlatformVersion(right);
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1;
  }
  const aPre = a.prerelease.length > 0;
  const bPre = b.prerelease.length > 0;
  if (!aPre && !bPre) {
    return 0;
  }
  if (!aPre && bPre) {
    return 1;
  }
  if (aPre && !bPre) {
    return -1;
  }
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < len; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) {
      return -1;
    }
    if (bPart === undefined) {
      return 1;
    }
    const aNum = /^\d+$/.test(aPart) ? Number(aPart) : undefined;
    const bNum = /^\d+$/.test(bPart) ? Number(bPart) : undefined;
    if (aNum !== undefined && bNum !== undefined) {
      if (aNum !== bNum) {
        return aNum < bNum ? -1 : 1;
      }
      continue;
    }
    if (aNum !== undefined) {
      return -1;
    }
    if (bNum !== undefined) {
      return 1;
    }
    if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1;
    }
  }
  return 0;
}
