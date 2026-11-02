import { useState } from "react";

import { safeJsonStringify } from "../../lib/formatting";
import { Button } from "../ui/button";

interface JsonViewProps {
  readonly value: unknown;
  readonly label?: string;
}

export function JsonView({ value, label }: JsonViewProps) {
  const [copied, setCopied] = useState(false);
  const text = safeJsonStringify(value);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <div className="json-view">
      <div className="json-view-toolbar">
        {label !== undefined ? (
          <strong className="json-view-label">{label}</strong>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}
