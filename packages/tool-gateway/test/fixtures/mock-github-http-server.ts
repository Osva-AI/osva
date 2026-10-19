/** Standalone loopback GitHub mock for ToolGateway CI (mirrored in osva-connectors connector tests). */
import http from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_GITHUB_PAT = "ghp_osva_test_fixture_00000000000000000000";

export const MOCK_REPOSITORY_JSON = {
  name: "osva",
  full_name: "Osva-AI/osva",
  description: "OSVA core repository (mock fixture)",
  html_url: "https://github.com/Osva-AI/osva",
  visibility: "public",
  private: false,
  default_branch: "main",
  archived: false,
  fork: false,
} as const;

export type MockGithubMode =
  "success" | "unauthorized" | "server_error" | "slow";

export interface MockGithubHttpServer {
  readonly apiBaseUrl: string;
  readonly origin: string;
  getLastAuthorization(): string | undefined;
  getRepositoryRequestCount(): number;
  setMode(mode: MockGithubMode): void;
  close(): Promise<void>;
}

export interface StartMockGithubHttpServerOptions {
  readonly expectedToken?: string;
  readonly mode?: MockGithubMode;
  readonly slowDelayMs?: number;
}

function parseRepoPath(
  pathname: string,
): { owner: string; repo: string } | null {
  const match = pathname.match(/\/repos\/([^/]+)\/([^/]+)\/?$/);
  if (match === null) {
    return null;
  }
  return { owner: match[1]!, repo: match[2]! };
}

function readAuthorization(
  header: string | string[] | undefined,
): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  return Array.isArray(header) ? header[0] : header;
}

function tokenMatches(
  authorization: string | undefined,
  expected: string,
): boolean {
  if (authorization === undefined) {
    return false;
  }
  const lower = authorization.toLowerCase();
  return (
    lower === `token ${expected.toLowerCase()}` ||
    lower === `bearer ${expected.toLowerCase()}`
  );
}

export function startMockGithubHttpServer(
  options: StartMockGithubHttpServerOptions = {},
): Promise<MockGithubHttpServer> {
  const expectedToken = options.expectedToken ?? FAKE_GITHUB_PAT;
  let mode: MockGithubMode = options.mode ?? "success";
  const slowDelayMs = options.slowDelayMs ?? 30_000;
  let lastAuthorization: string | undefined;
  let repositoryRequestCount = 0;

  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }

    const parsed = parseRepoPath(
      new URL(req.url ?? "/", "http://127.0.0.1").pathname,
    );
    if (parsed === null) {
      res.statusCode = 404;
      res.end();
      return;
    }

    repositoryRequestCount += 1;
    lastAuthorization = readAuthorization(req.headers.authorization);

    const finish = (status: number, body: string) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(body);
    };

    if (
      mode === "unauthorized" ||
      !tokenMatches(lastAuthorization, expectedToken)
    ) {
      finish(401, JSON.stringify({ message: "Bad credentials" }));
      return;
    }

    if (mode === "server_error") {
      finish(
        500,
        JSON.stringify({
          message: "Internal Server Error",
          debug: "secret_key=DO_NOT_LEAK_IN_TOOL_OUTPUT",
        }),
      );
      return;
    }

    if (mode === "slow") {
      setTimeout(() => {
        finish(200, JSON.stringify(MOCK_REPOSITORY_JSON));
      }, slowDelayMs);
      return;
    }

    finish(200, JSON.stringify(MOCK_REPOSITORY_JSON));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Mock GitHub server failed to bind."));
        return;
      }
      const port = (address as AddressInfo).port;
      const origin = `http://127.0.0.1:${String(port)}`;
      const apiBaseUrl = `${origin}/api/v3`;

      resolve({
        apiBaseUrl,
        origin,
        getLastAuthorization: () => lastAuthorization,
        getRepositoryRequestCount: () => repositoryRequestCount,
        setMode(next: MockGithubMode) {
          mode = next;
        },
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error !== undefined) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}
