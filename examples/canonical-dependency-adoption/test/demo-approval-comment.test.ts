import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  escapeTextareaHtml,
  trimApprovalCommentDraft,
} from "../demo/public/approval-comment.js";

const appJsSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../demo/public/app.js",
  ),
  "utf8",
);

describe("approval comment draft helpers", () => {
  it("escapes textarea content for safe rerender", () => {
    expect(escapeTextareaHtml("Proceed & ship <today>")).toBe(
      "Proceed &amp; ship &lt;today&gt;",
    );
  });

  it("trims optional comment for API payload", () => {
    expect(trimApprovalCommentDraft("  note  ")).toBe("note");
    expect(trimApprovalCommentDraft("   ")).toBeUndefined();
  });
});

describe("approval comment UI wiring", () => {
  it("preserves mounted approval form across poll refreshes", () => {
    expect(appJsSource).toContain("approvalCommentDraft");
    expect(appJsSource).toContain("syncApprovalCommentDraftFromDom");
    expect(appJsSource).toContain("shouldPreserveApprovalOperatorForm");
    expect(appJsSource).toContain("node-detail-status");
    expect(appJsSource).toContain("node-detail-operator");
    expect(appJsSource).toContain("mountApprovalOperatorForm");
    expect(appJsSource).not.toContain("nodeDetail.innerHTML");
    expect(appJsSource).toContain('approvalCommentDraft = ""');
  });
});
