import type { HelloEnv } from "./env.js";
import { HelloConfigurationError } from "./env.js";

export async function assertControlPlaneReady(env: HelloEnv): Promise<void> {
  const readyUrl = new URL("/ready", env.baseUrl).toString();
  let response: Response;
  try {
    response = await fetch(readyUrl, {
      headers: { authorization: `Bearer ${env.apiKey}` },
    });
  } catch {
    throw new HelloConfigurationError(
      `Control plane is unreachable at ${env.baseUrl}. Start web (Compose or pnpm dev:web) and verify OSVA_BASE_URL.`,
    );
  }

  if (response.status !== 200) {
    throw new HelloConfigurationError(
      `Control plane /ready returned ${String(response.status)}. Ensure PostgreSQL and Valkey are reachable.`,
    );
  }
}
