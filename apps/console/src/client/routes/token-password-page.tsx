import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";

import { consoleFetch, ConsoleApiError } from "../lib/console-api";

type TokenFlow = "setup" | "recovery";

function readFragmentToken(hashValue: string): string {
  const hash = hashValue.startsWith("#") ? hashValue.slice(1) : hashValue;
  const params = new URLSearchParams(hash);
  return params.get("token")?.trim() ?? "";
}

export function SetupPage() {
  return <TokenPasswordForm flow="setup" title="Complete account setup" />;
}

export function RecoveryPage() {
  return <TokenPasswordForm flow="recovery" title="Reset password" />;
}

function TokenPasswordForm(props: {
  readonly flow: TokenFlow;
  readonly title: string;
}) {
  const location = useLocation();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fromFragment = readFragmentToken(location.hash);
    if (fromFragment.length > 0) {
      setToken(fromFragment);
    }
  }, [location.hash]);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const path =
        props.flow === "setup"
          ? "/api/v1/auth/setup/complete"
          : "/api/v1/auth/recovery/complete";
      await consoleFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      setToken("");
      setPassword("");
      setConfirmPassword("");
      setMessage(
        props.flow === "setup"
          ? "Setup complete. You can sign in with your new password."
          : "Password reset complete. Sign in with your new password.",
      );
    } catch (submitError) {
      if (submitError instanceof ConsoleApiError) {
        setError(
          submitError.status === 400
            ? "This token is invalid, expired, or already used."
            : submitError.message,
        );
      } else {
        setError("Request failed. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-panel">
      <h1>{props.title}</h1>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          One-time token
          <input
            name="token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>
        {error !== undefined ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {message !== undefined ? (
          <p className="form-success" role="status">
            {message}
          </p>
        ) : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
      <p className="auth-links">
        <Link to="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
