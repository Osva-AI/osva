import type { DoctorCheck } from "../doctor/types.js";
import { loadComposeDistribution } from "./distribution.js";

export const REGISTRY_PREFLIGHT_TIMEOUT_MS = 8_000;

export async function registryImagePreflightCheck(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = REGISTRY_PREFLIGHT_TIMEOUT_MS,
): Promise<DoctorCheck> {
  try {
    const distribution = await loadComposeDistribution();
    const imageRef = distribution.manifest.imageRef;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const head = await fetchImpl(registryManifestProbeUrl(imageRef), {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
      if (head.ok || head.status === 405) {
        return {
          id: "registry_image",
          status: "PASS",
          message: `Registry responded for pinned image ${imageRef}.`,
        };
      }
      return {
        id: "registry_image",
        status: "WARN",
        message: `Registry probe for ${imageRef} returned HTTP ${String(head.status)}.`,
        remediation:
          "Verify outbound HTTPS to your container registry or pre-pull images before setup.",
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Registry probe failed.";
    return {
      id: "registry_image",
      status: "WARN",
      message: `Could not verify registry reachability within ${String(timeoutMs)}ms: ${message}`,
      remediation:
        "Check network, proxy, and firewall rules, or retry when registry access is available.",
    };
  }
}

function registryManifestProbeUrl(imageRef: string): string {
  if (!imageRef.includes("/")) {
    return `https://registry-1.docker.io/v2/library/${imageRef}/manifests/latest`;
  }
  const [registryAndRepo, tag = "latest"] = imageRef.split(":");
  if (registryAndRepo === undefined || registryAndRepo.length === 0) {
    return `https://${imageRef}/manifests/latest`;
  }
  if (registryAndRepo.startsWith("ghcr.io/")) {
    return `https://${registryAndRepo}/manifests/${tag}`;
  }
  return `https://${registryAndRepo}/manifests/${tag}`;
}
