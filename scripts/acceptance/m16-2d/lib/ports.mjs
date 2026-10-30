import net from "node:net";

export async function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate port.")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export async function allocatePortTriple() {
  const webPort = await allocateLoopbackPort();
  let mcpPort = await allocateLoopbackPort();
  while (mcpPort === webPort) {
    mcpPort = await allocateLoopbackPort();
  }
  let consolePort = await allocateLoopbackPort();
  while (consolePort === webPort || consolePort === mcpPort) {
    consolePort = await allocateLoopbackPort();
  }
  return { webPort, mcpPort, consolePort };
}
