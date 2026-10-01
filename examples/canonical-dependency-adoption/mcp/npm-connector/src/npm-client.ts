import { ConnectorSdkError, rateLimitError } from "@osva-ai/connector-sdk";

import {
  NPM_DOWNLOADS_PERIOD_LAST_MONTH,
  type NormalizedNpmDownloads,
  type NormalizedNpmPackageMetadata,
  type NpmDownloadsPeriod,
} from "./schemas.js";

export const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";
export const NPM_DOWNLOADS_ORIGIN = "https://api.npmjs.org";

export const DEFAULT_NPM_HTTP_TIMEOUT_MS = 10_000;

export const DEFAULT_NPM_USER_AGENT =
  "@osva/example-canonical-dependency-adoption npm-connector/1.0.0";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface NpmClient {
  fetchPackageMetadata(
    packageName: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<NormalizedNpmPackageMetadata>;
  fetchDownloads(
    packageName: string,
    period: NpmDownloadsPeriod,
    options?: { readonly signal?: AbortSignal },
  ): Promise<NormalizedNpmDownloads>;
}

export interface CreateNpmClientOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

export function createNpmClient(
  options: CreateNpmClientOptions = {},
): NpmClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_NPM_HTTP_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_NPM_USER_AGENT;

  return {
    fetchPackageMetadata: (packageName, callOptions) =>
      fetchPackageMetadata(fetchImpl, {
        packageName,
        timeoutMs,
        userAgent,
        signal: callOptions?.signal,
      }),
    fetchDownloads: (packageName, period, callOptions) =>
      fetchDownloads(fetchImpl, {
        packageName,
        period,
        timeoutMs,
        userAgent,
        signal: callOptions?.signal,
      }),
  };
}

function registryPackageUrl(packageName: string): URL {
  return new URL(
    `/${encodeURIComponent(packageName)}`,
    `${NPM_REGISTRY_ORIGIN}/`,
  );
}

function downloadsPointUrl(
  packageName: string,
  period: NpmDownloadsPeriod,
): URL {
  return new URL(
    `/downloads/point/${period}/${encodeURIComponent(packageName)}`,
    `${NPM_DOWNLOADS_ORIGIN}/`,
  );
}

async function fetchPackageMetadata(
  fetchImpl: FetchLike,
  params: {
    readonly packageName: string;
    readonly timeoutMs: number;
    readonly userAgent: string;
    readonly signal?: AbortSignal;
  },
): Promise<NormalizedNpmPackageMetadata> {
  const url = registryPackageUrl(params.packageName);
  const payload = await fetchNpmJson(fetchImpl, url, {
    packageName: params.packageName,
    timeoutMs: params.timeoutMs,
    userAgent: params.userAgent,
    signal: params.signal,
    serviceLabel: "npm registry",
  });

  return normalizeRegistryDocument(params.packageName, payload);
}

async function fetchDownloads(
  fetchImpl: FetchLike,
  params: {
    readonly packageName: string;
    readonly period: NpmDownloadsPeriod;
    readonly timeoutMs: number;
    readonly userAgent: string;
    readonly signal?: AbortSignal;
  },
): Promise<NormalizedNpmDownloads> {
  if (params.period !== NPM_DOWNLOADS_PERIOD_LAST_MONTH) {
    throw new ConnectorSdkError(
      "INVALID_INPUT",
      `Unsupported downloads period '${params.period}'.`,
    );
  }

  const url = downloadsPointUrl(params.packageName, params.period);
  const payload = await fetchNpmJson(fetchImpl, url, {
    packageName: params.packageName,
    timeoutMs: params.timeoutMs,
    userAgent: params.userAgent,
    signal: params.signal,
    serviceLabel: "npm downloads API",
  });

  return normalizeDownloadsDocument(params.packageName, params.period, payload);
}

async function fetchNpmJson(
  fetchImpl: FetchLike,
  url: URL,
  params: {
    readonly packageName: string;
    readonly timeoutMs: number;
    readonly userAgent: string;
    readonly signal?: AbortSignal;
    readonly serviceLabel: string;
  },
): Promise<unknown> {
  assertAllowedNpmUrl(url);

  const timeoutSignal = AbortSignal.timeout(params.timeoutMs);
  const signal = params.signal
    ? AbortSignal.any([params.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": params.userAgent,
      },
      signal,
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw upstreamUnavailable(
        `${params.serviceLabel} request timed out after ${params.timeoutMs}ms.`,
        error,
      );
    }
    throw upstreamUnavailable(`${params.serviceLabel} is unavailable.`, error);
  }

  if (response.status === 404) {
    throw new ConnectorSdkError(
      "PACKAGE_NOT_FOUND",
      `npm package "${params.packageName}" was not found.`,
    );
  }

  if (response.status === 429) {
    throw rateLimitError(
      `npm rate limit exceeded while fetching "${params.packageName}".`,
    );
  }

  if (response.status >= 500) {
    throw upstreamUnavailable(
      `${params.serviceLabel} returned HTTP ${response.status}.`,
    );
  }

  if (!response.ok) {
    throw upstreamUnavailable(
      `${params.serviceLabel} returned HTTP ${response.status}.`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw invalidUpstream(`${params.serviceLabel} returned non-JSON content.`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw invalidUpstream(
      `${params.serviceLabel} returned invalid JSON.`,
      error,
    );
  }
}

function assertAllowedNpmUrl(url: URL): void {
  const allowedOrigins = new Set([NPM_REGISTRY_ORIGIN, NPM_DOWNLOADS_ORIGIN]);
  const origin = `${url.protocol}//${url.host}`;
  if (!allowedOrigins.has(origin)) {
    throw new ConnectorSdkError(
      "FORBIDDEN_DESTINATION",
      "Outbound npm connector requests must target official npm hosts only.",
    );
  }
}

export function normalizeRegistryDocument(
  requestedPackageName: string,
  payload: unknown,
): NormalizedNpmPackageMetadata {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw invalidUpstream("npm registry returned an unexpected payload shape.");
  }

  const record = payload as Record<string, unknown>;
  const name =
    typeof record.name === "string" && record.name.length > 0
      ? record.name
      : requestedPackageName;

  const distTags = record["dist-tags"];
  if (
    distTags === null ||
    typeof distTags !== "object" ||
    Array.isArray(distTags)
  ) {
    throw invalidUpstream(
      "npm registry payload is missing dist-tags for the package.",
    );
  }

  const latestVersion = (distTags as Record<string, unknown>).latest;
  if (typeof latestVersion !== "string" || latestVersion.length === 0) {
    throw invalidUpstream(
      "npm registry payload is missing dist-tags.latest for the package.",
    );
  }

  const license = normalizeLicense(record.license);
  const repositoryUrl = normalizeRepositoryUrl(record.repository);
  const modifiedAt = normalizeModifiedAt(record.time, latestVersion);
  const deprecated = normalizeDeprecated(record.versions, latestVersion);
  const maintainersCount = normalizeMaintainersCount(record.maintainers);

  return {
    name,
    latestVersion,
    ...(license !== undefined ? { license } : {}),
    ...(repositoryUrl !== undefined ? { repositoryUrl } : {}),
    ...(modifiedAt !== undefined ? { modifiedAt } : {}),
    ...(deprecated !== undefined ? { deprecated } : {}),
    ...(maintainersCount !== undefined ? { maintainersCount } : {}),
  };
}

export function normalizeDownloadsDocument(
  requestedPackageName: string,
  period: NpmDownloadsPeriod,
  payload: unknown,
): NormalizedNpmDownloads {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw invalidUpstream(
      "npm downloads API returned an unexpected payload shape.",
    );
  }

  const record = payload as Record<string, unknown>;
  const downloads = record.downloads;
  if (
    typeof downloads !== "number" ||
    !Number.isFinite(downloads) ||
    downloads < 0
  ) {
    throw invalidUpstream(
      "npm downloads API payload is missing a valid downloads count.",
    );
  }

  const start = record.start;
  const end = record.end;
  if (typeof start !== "string" || start.length === 0) {
    throw invalidUpstream("npm downloads API payload is missing start.");
  }
  if (typeof end !== "string" || end.length === 0) {
    throw invalidUpstream("npm downloads API payload is missing end.");
  }

  const packageName =
    typeof record.package === "string" && record.package.length > 0
      ? record.package
      : requestedPackageName;

  return {
    packageName,
    period,
    downloads: Math.trunc(downloads),
    start,
    end,
  };
}

function normalizeLicense(license: unknown): string | undefined {
  if (typeof license === "string" && license.trim().length > 0) {
    return license.trim();
  }
  if (
    license !== null &&
    typeof license === "object" &&
    !Array.isArray(license) &&
    typeof (license as { type?: unknown }).type === "string"
  ) {
    const typed = (license as { type: string }).type.trim();
    return typed.length > 0 ? typed : undefined;
  }
  return undefined;
}

function normalizeRepositoryUrl(repository: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof repository === "string") {
    raw = repository;
  } else if (
    repository !== null &&
    typeof repository === "object" &&
    !Array.isArray(repository) &&
    typeof (repository as { url?: unknown }).url === "string"
  ) {
    raw = (repository as { url: string }).url;
  }

  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed
    .replace(/^git\+/i, "")
    .replace(/^git:\/\//i, "https://")
    .replace(/\.git$/i, "");
}

function normalizeModifiedAt(
  time: unknown,
  latestVersion: string,
): string | undefined {
  if (time === null || typeof time !== "object" || Array.isArray(time)) {
    return undefined;
  }

  const versionTime = (time as Record<string, unknown>)[latestVersion];
  if (typeof versionTime === "string" && versionTime.length > 0) {
    return versionTime;
  }

  const modified = (time as Record<string, unknown>).modified;
  if (typeof modified === "string" && modified.length > 0) {
    return modified;
  }

  return undefined;
}

function normalizeDeprecated(
  versions: unknown,
  latestVersion: string,
): string | undefined {
  if (
    versions === null ||
    typeof versions !== "object" ||
    Array.isArray(versions)
  ) {
    return undefined;
  }

  const latest = (versions as Record<string, unknown>)[latestVersion];
  if (latest === null || typeof latest !== "object" || Array.isArray(latest)) {
    return undefined;
  }

  const deprecated = (latest as { deprecated?: unknown }).deprecated;
  if (typeof deprecated === "string" && deprecated.trim().length > 0) {
    return deprecated.trim();
  }

  return undefined;
}

function normalizeMaintainersCount(maintainers: unknown): number | undefined {
  if (!Array.isArray(maintainers)) {
    return undefined;
  }

  return maintainers.length;
}

function upstreamUnavailable(
  message: string,
  cause?: unknown,
): ConnectorSdkError {
  return new ConnectorSdkError("UPSTREAM_UNAVAILABLE", message, {
    retryable: true,
    cause,
  });
}

function invalidUpstream(message: string, cause?: unknown): ConnectorSdkError {
  return new ConnectorSdkError("INVALID_UPSTREAM", message, { cause });
}
