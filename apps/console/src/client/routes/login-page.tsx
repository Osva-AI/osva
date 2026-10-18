import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../context/auth-context";
import { consoleFetch, ConsoleApiError } from "../lib/console-api";
import { sanitizeReturnPath } from "../lib/return-path";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const returnTo = sanitizeReturnPath(searchParams.get("returnTo"));

  if (auth.isAuthenticated) {
    if (auth.workspaces.length === 1 && auth.selectedWorkspace === undefined) {
      auth.selectWorkspace(auth.workspaces[0]!.workspaceId);
    }
    if (auth.workspaces.length === 1) {
      return <Navigate to={returnTo ?? "/runs"} replace />;
    }
    if (auth.selectedWorkspace !== undefined) {
      return <Navigate to={returnTo ?? "/runs"} replace />;
    }
    return <Navigate to="/select-workspace" replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await consoleFetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      setPassword("");
      await auth.sessionQuery.refetch();
      const workspaces = await consoleFetch<{
        workspaces: { workspaceId: string }[];
      }>("/api/v1/auth/workspaces");
      if (workspaces.workspaces.length === 0) {
        navigate("/login", { replace: true });
        setError("Your account has no workspace access yet.");
        return;
      }
      if (workspaces.workspaces.length === 1) {
        auth.selectWorkspace(workspaces.workspaces[0]!.workspaceId);
        navigate(returnTo ?? "/runs", { replace: true });
        return;
      }
      navigate(
        returnTo
          ? `/select-workspace?returnTo=${encodeURIComponent(returnTo)}`
          : "/select-workspace",
        { replace: true },
      );
    } catch (submitError) {
      if (submitError instanceof ConsoleApiError) {
        setError(
          submitError.status === 401
            ? "Email or password is incorrect."
            : submitError.message,
        );
      } else {
        setError("Sign-in failed. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-panel">
      <h1>Sign in to OSVA Console</h1>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          Email
          <input
            autoComplete="username"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error !== undefined ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-links">
        <Link to="/setup">Complete first-time setup</Link>
        {" · "}
        <Link to="/recovery">Recovery with operator token</Link>
      </p>
    </main>
  );
}
