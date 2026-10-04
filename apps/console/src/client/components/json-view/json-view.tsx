import { useState } from "react";

import { safeJsonStringify } from "../../lib/formatting";

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
      <div className="toolbar" style={{ marginBottom: 8 }}>
        {label !== undefined ? (
          <strong style={{ fontSize: "0.82rem" }}>{label}</strong>
        ) : null}
        <button type="button" className="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}
