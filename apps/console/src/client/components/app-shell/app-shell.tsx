import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import {
  roleCanManageMembers,
  roleCanReadAuditEvents,
} from "../../lib/permissions";

const navItems = [
  { label: "Overview", disabled: true },
  { label: "Agents", to: "/agents", disabled: false },
  { label: "Runs", to: "/runs", disabled: false },
  { label: "Workflows", to: "/workflows", disabled: false },
  { label: "WorkflowRuns", to: "/workflow-runs", disabled: false },
  { label: "Artifacts", disabled: true },
  { label: "Knowledge", disabled: true },
  { label: "Tools", disabled: true },
  { label: "Models", to: "/models", disabled: false },
  { label: "Settings", disabled: true },
] as const;

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const workspace = auth.selectedWorkspace;
  const role = workspace?.role ?? "—";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-title">OSVA Console</div>
          <div className="brand-subtitle">Human control plane</div>
        </div>
        <div className="workspace-meta">
          <label>
            Workspace
            <select
              aria-label="Workspace switcher"
              value={workspace?.workspaceId ?? ""}
              onChange={(event) => {
                auth.selectWorkspace(event.target.value);
                navigate(window.location.pathname, { replace: true });
              }}
            >
              {auth.workspaces.map((item) => (
                <option key={item.workspaceId} value={item.workspaceId}>
                  {item.name} ({item.role})
                </option>
              ))}
            </select>
          </label>
          <div>
            User{" "}
            <span className="mono">
              {auth.user?.email ?? auth.session?.userId ?? "—"}
            </span>
          </div>
          <div>
            Role <span className="mono">{role}</span>
          </div>
        </div>
        <nav aria-label="Primary">
          <ul className="nav-list">
            {navItems.map((item) => (
              <li key={item.label}>
                {"to" in item && !item.disabled ? (
                  <NavLink
                    className={({ isActive }) =>
                      `nav-link${isActive ? " active" : ""}`
                    }
                    to={item.to}
                  >
                    {item.label}
                  </NavLink>
                ) : (
                  <span className="nav-link disabled">{item.label}</span>
                )}
              </li>
            ))}
            {roleCanManageMembers(role) ? (
              <li>
                <NavLink className="nav-link" to="/workspace/access">
                  Workspace access
                </NavLink>
              </li>
            ) : null}
            {roleCanReadAuditEvents(role) ? (
              <li>
                <NavLink className="nav-link" to="/workspace/security">
                  Security activity
                </NavLink>
              </li>
            ) : null}
          </ul>
        </nav>
        <button
          type="button"
          className="logout-button"
          onClick={() => {
            void auth.logout().finally(() => {
              navigate("/login", { replace: true });
            });
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="main-panel">
        <Outlet />
      </main>
    </div>
  );
}
