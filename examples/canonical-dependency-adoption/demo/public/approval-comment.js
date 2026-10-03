/** @param {string} text */
export function escapeTextareaHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** @param {string} draft @returns {string | undefined} */
export function trimApprovalCommentDraft(draft) {
  const trimmed = String(draft).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
