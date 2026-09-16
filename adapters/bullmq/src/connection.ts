import { Redis } from "ioredis";

export type ValkeyConnection = Redis;

export function createValkeyConnection(url: string): ValkeyConnection {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export async function pingValkeyConnection(
  connection: Pick<ValkeyConnection, "ping">,
): Promise<void> {
  const response = await connection.ping();
  if (response !== "PONG") {
    throw new Error("Valkey ping did not return PONG.");
  }
}
