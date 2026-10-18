import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../context/auth-context";
import { sanitizeReturnPath } from "../lib/return-path";

export function SelectWorkspacePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = sanitizeReturnPath(searchParams.get("returnTo")) ?? "/runs";

  return (
    <main className="auth-panel">
      <h1>Select a workspace</h1>
      <p>
        Choose which workspace the Console should use for control-plane actions.
      </p>
      <ul className="workspace-select-list">
        {auth.workspaces.map((workspace) => (
          <li key={workspace.workspaceId}>
            <button
              type="button"
              onClick={() => {
                auth.selectWorkspace(workspace.workspaceId);
                navigate(returnTo, { replace: true });
              }}
            >
              <span className="workspace-select-name">{workspace.name}</span>
              <span className="mono">{workspace.workspaceId}</span>
              <span className="workspace-select-role">{workspace.role}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
