import { useState } from "react";

import { Button } from "../ui/button";

export function ConnectorSetupCopyableCommand(props: {
  readonly label: string;
  readonly command: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(props.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="connector-setup-copyable"
      data-testid="connector-setup-copyable-command"
    >
      <p className="muted">{props.label}</p>
      <pre className="connector-setup-copyable-pre">
        <code className="mono">{props.command}</code>
      </pre>
      <Button type="button" variant="secondary" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy command"}
      </Button>
    </div>
  );
}
