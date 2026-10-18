import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import { sanitizeReturnPath } from "../../lib/return-path";
import { LoadingBlock } from "../loading/loading-block";

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.sessionQuery.isLoading) {
    return <LoadingBlock label="Checking session…" />;
  }

  if (auth.sessionQuery.isError || !auth.isAuthenticated) {
    const returnTo = sanitizeReturnPath(
      `${location.pathname}${location.search}`,
    );
    const search =
      returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
    return <Navigate to={`/login${search}`} replace />;
  }

  return <Outlet />;
}

export function RequireWorkspace() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.workspaces.length === 0) {
    return (
      <main className="main-panel">
        <h1>No workspace access</h1>
        <p>
          Your account is active but has no workspace memberships. Ask a
          workspace owner to provision access.
        </p>
      </main>
    );
  }

  if (auth.selectedWorkspace === undefined) {
    const returnTo = sanitizeReturnPath(
      `${location.pathname}${location.search}`,
    );
    const search =
      returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
    return <Navigate to={`/select-workspace${search}`} replace />;
  }

  return <Outlet />;
}
