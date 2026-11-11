export function dockerInstallRemediation(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return [
      "Install Docker Desktop for Windows (WSL2 backend recommended).",
      "Ensure the Docker engine is running (whale icon in the system tray).",
      "Verify with: docker version && docker compose version",
    ].join(" ");
  }
  if (platform === "darwin") {
    return [
      "Install Docker Desktop for Mac from docker.com or Homebrew (cask docker).",
      "Start Docker Desktop and wait until the engine reports Running.",
      "Verify with: docker version && docker compose version",
    ].join(" ");
  }
  return [
    "Install Docker Engine and the Compose V2 plugin using your distribution packages.",
    "On Ubuntu/Debian: use Docker's official apt repository or docker.io + docker-compose-v2.",
    "Verify with: docker version && docker compose version",
  ].join(" ");
}

export function nodeInstallRemediation(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return `Install Node.js 24+ from https://nodejs.org/ or via nvm-windows, then re-run setup.`;
  }
  if (platform === "darwin") {
    return "Install Node.js 24+ via Homebrew (`brew install node@24`) or https://nodejs.org/, then re-run setup.";
  }
  return "Install Node.js 24+ via your package manager or NodeSource, then re-run setup.";
}

export function registryRemediation(): string {
  return [
    "Ensure outbound HTTPS access to GHCR (ghcr.io) and Docker Hub is available.",
    "Inspect corporate proxy/firewall rules and TLS inspection policies.",
    "Retry after `docker login ghcr.io` when using private mirrors.",
  ].join(" ");
}
