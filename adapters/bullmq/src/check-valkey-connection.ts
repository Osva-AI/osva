import { Redis } from "ioredis";

import { ValkeyUnavailableError } from "./errors.js";

/**
 * Host-side Valkey connectivity check. Connection details are not included
 * in the thrown error.
 */
export async function checkValkeyConnection(url: string): Promise<void> {
  const connection = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  connection.on("error", () => {
    // Connectivity failures are returned by ping/connect.
  });

  try {
    await connection.connect();
    const response = await connection.ping();
    if (response !== "PONG") {
      throw new ValkeyUnavailableError();
    }
  } catch (error) {
    if (error instanceof ValkeyUnavailableError) {
      throw error;
    }
    throw new ValkeyUnavailableError();
  } finally {
    try {
      await connection.quit();
    } catch {
      connection.disconnect();
    }
  }
}
