import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import {
  roleCanManageMembers,
  roleCanReadAuditEvents,
} from "../../lib/permissions";

interface NavLinkItem {
  readonly label: string;
  readonly to: string;
}

interface NavSection {
  readonly title: string;
  readonly items: readonly NavLinkItem[];
}

const navSections: readonly NavSection[] = [
  {
    title: "Workspace",
    items: [
      { label: "Overview", to: "/overview" },
      { label: "Getting started", to: "/onboarding" },
    ],
  },
  {
    title: "Build",
    items: [
      { label: "Agents", to: "/agents" },
      { label: "Workflows", to: "/workflows" },
      { label: "Models", to: "/models" },
      { label: "Tools / Connectors", to: "/tools" },
      { label: "Knowledge", to: "/knowledge" },
      { label: "Memory", to: "/memory" },
    ],
  },
  {
    title: "Operate",
    items: [
      { label: "Runs", to: "/runs" },
      { label: "Workflow Runs", to: "/workflow-runs" },
    ],
  },
];

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const workspace = auth.selectedWorkspace;
  const role = workspace?.role;

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
            Role <span className="mono">{role ?? "—"}</span>
          </div>
        </div>
        <nav aria-label="Primary">
          {navSections.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-section-title">{section.title}</div>
              <ul className="nav-list">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      className={({ isActive }) =>
                        `nav-link${isActive ? " active" : ""}`
                      }
                      to={item.to}
                      end={item.to === "/overview"}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {role !== undefined &&
          (roleCanManageMembers(role) || roleCanReadAuditEvents(role)) ? (
            <div className="nav-section">
              <div className="nav-section-title">Administration</div>
              <ul className="nav-list">
                {roleCanManageMembers(role) ? (
                  <li>
                    <NavLink className="nav-link" to="/workspace/access">
                      Workspace Access
                    </NavLink>
                  </li>
                ) : null}
                {roleCanReadAuditEvents(role) ? (
                  <li>
                    <NavLink className="nav-link" to="/workspace/security">
                      Security Activity
                    </NavLink>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
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
