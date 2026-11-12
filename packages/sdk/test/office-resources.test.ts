import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";

const TEST_API_KEY = "osva_ak_test.secret";

const servers: http.Server[] = [];

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected bound port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function startEchoServer(): Promise<{
  readonly port: number;
  readonly paths: string[];
}> {
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [] }));
  });
  const port = await listen(server);
  servers.push(server);
  return { port, paths };
}

describe("OsvaClient office resources", () => {
  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
    servers.length = 0;
  });

  it("calls canonical /v1/office/* paths", async () => {
    const { port, paths } = await startEchoServer();
    const client = new OsvaClient({
      baseUrl: `http://127.0.0.1:${String(port)}/`,
      apiKey: TEST_API_KEY,
    });

    await client.officeWorkers.list();
    await client.officeWorkers.get("worker-1" as never);
    await client.roles.list();
    await client.roles.get("role-1" as never);
    await client.teams.list();
    await client.teams.get("team-1" as never);
    await client.teams.listMemberships("team-1" as never);
    await client.goals.list();
    await client.goals.get("goal-1" as never);
    await client.assignments.list();
    await client.assignments.get("asn-1" as never);
    await client.assignments.launch("asn-1" as never);
    await client.assignments.cancel("asn-1" as never);
    await client.officeThreads.list();
    await client.officeThreads.get("thread-1" as never);
    await client.officeThreads.listMessages("thread-1" as never);
    await client.officeThreads.postMessage("thread-1" as never, { body: "hi" });
    await client.officeInbox.list();
    await client.officeInbox.updateReadState({
      threadId: "thread-1" as never,
      lastReadSequence: 1,
    });

    expect(paths).toEqual([
      "/v1/office/workers",
      "/v1/office/workers/worker-1",
      "/v1/office/roles",
      "/v1/office/roles/role-1",
      "/v1/office/teams",
      "/v1/office/teams/team-1",
      "/v1/office/teams/team-1/memberships",
      "/v1/office/goals",
      "/v1/office/goals/goal-1",
      "/v1/office/assignments",
      "/v1/office/assignments/asn-1",
      "/v1/office/assignments/asn-1/launch",
      "/v1/office/assignments/asn-1/cancel",
      "/v1/office/threads",
      "/v1/office/threads/thread-1",
      "/v1/office/threads/thread-1/messages",
      "/v1/office/threads/thread-1/messages",
      "/v1/office/inbox",
      "/v1/office/inbox/read-state",
    ]);
  });
});
