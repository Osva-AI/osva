import { NavLink, Outlet } from "react-router-dom";

import { useAuthContextQuery } from "../../hooks/use-auth-context";
import { ErrorState } from "../error-state/error-state";
import { LoadingBlock } from "../loading/loading-block";

const navItems = [
  { label: "Overview", disabled: true },
  { label: "Agents", to: "/agents", disabled: false },
  { label: "Runs", to: "/runs", disabled: false },
  { label: "Workflows", to: "/workflows", disabled: false },
  { label: "WorkflowRuns", to: "/workflow-runs", disabled: false },
  { label: "Artifacts", disabled: true },
  { label: "Knowledge", disabled: true },
  { label: "Tools", disabled: true },
  { label: "Models", disabled: true },
  { label: "Settings", disabled: true },
] as const;

export function AppShell() {
  const authQuery = useAuthContextQuery();

  if (authQuery.isLoading) {
    return <LoadingBlock label="Connecting to OSVA…" />;
  }

  if (authQuery.isError) {
    return (
      <main className="main-panel">
        <ErrorState
          title="Console authentication failed"
          error={authQuery.error}
        />
      </main>
    );
  }

  const auth = authQuery.data!;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-title">OSVA Console</div>
          <div className="brand-subtitle">Operator control plane</div>
        </div>
        <div className="workspace-meta">
          <div>
            Workspace <span className="mono">{auth.workspaceId}</span>
          </div>
          <div>
            Subject <span className="mono">{auth.subjectId}</span>
          </div>
          <div>
            Role <span className="mono">{auth.role}</span>
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
          </ul>
        </nav>
      </aside>
      <main className="main-panel">
        <Outlet />
      </main>
    </div>
  );
}
