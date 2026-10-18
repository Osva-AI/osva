import type { WorkspaceId } from "@osva-ai/contracts";

export interface BootstrapCliArgs {
  readonly email: string;
  readonly name: string;
  readonly organizationName: string;
  readonly workspaceIds: readonly WorkspaceId[];
  readonly allUnlinkedWorkspaces: boolean;
}

export interface RecoverCliArgs {
  readonly email: string;
}

export function parseBootstrapCliArgs(
  argv: readonly string[],
): BootstrapCliArgs {
  let email = "";
  let name = "Initial Owner";
  let organizationName = "Default Organization";
  const workspaceIds: WorkspaceId[] = [];
  let allUnlinkedWorkspaces = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--all-unlinked-workspaces") {
      allUnlinkedWorkspaces = true;
      continue;
    }
    if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length);
      continue;
    }
    if (arg === "--email") {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        email = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }
    if (arg === "--name") {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        name = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--organization-name=")) {
      organizationName = arg.slice("--organization-name=".length);
      continue;
    }
    if (arg === "--organization-name") {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        organizationName = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--workspace-id=")) {
      workspaceIds.push(arg.slice("--workspace-id=".length) as WorkspaceId);
      continue;
    }
    if (arg === "--workspace-id") {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        workspaceIds.push(next as WorkspaceId);
        index += 1;
      }
      continue;
    }
  }

  return {
    email,
    name,
    organizationName,
    workspaceIds,
    allUnlinkedWorkspaces,
  };
}

export function parseRecoverCliArgs(argv: readonly string[]): RecoverCliArgs {
  let email = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length);
      continue;
    }
    if (arg === "--email") {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        email = next;
        index += 1;
      }
    }
  }

  return { email };
}
