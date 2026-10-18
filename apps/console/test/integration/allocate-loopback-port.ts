import net from "node:net";

/**
 * Reserves an ephemeral loopback port using the same bind-then-release pattern as
 * `scripts/acceptance/m9-7b/lib/stack-context.js` and adapter integration tests.
 */
export async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(new Error("Could not allocate loopback port."));
        });
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function allocateDistinctLoopbackPorts(
  count: number,
): Promise<readonly number[]> {
  if (count < 1) {
    throw new Error("count must be at least 1");
  }
  const ports = new Set<number>();
  while (ports.size < count) {
    ports.add(await allocateLoopbackPort());
  }
  return [...ports] as readonly number[];
}

export async function allocateWebAndConsolePorts(): Promise<{
  readonly webPort: number;
  readonly consolePort: number;
}> {
  const ports = await allocateDistinctLoopbackPorts(2);
  const webPort = ports[0];
  const consolePort = ports[1];
  if (webPort === undefined || consolePort === undefined) {
    throw new Error("Failed to allocate web and console ports.");
  }
  return { webPort, consolePort };
}

export function loopbackOrigin(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}
