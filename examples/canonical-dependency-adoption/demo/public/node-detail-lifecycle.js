/** @param {any} node */
export function approvalOperatorMountKey(node) {
  if (node === null || node === undefined || node.key !== "adoption-approval") {
    return null;
  }
  if (node.presentationStatus !== "WAITING") {
    return null;
  }
  if (node.approval === undefined || node.approval.status !== "PENDING") {
    return null;
  }
  const id = node.approval.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * @param {string | undefined} selectedNodeKey
 * @param {any} node
 * @param {string | null | undefined} mountedApprovalId
 */
export function shouldPreserveApprovalOperatorForm(
  selectedNodeKey,
  node,
  mountedApprovalId,
) {
  if (selectedNodeKey !== "adoption-approval") {
    return false;
  }
  const key = approvalOperatorMountKey(node);
  if (key === null) {
    return false;
  }
  if (
    mountedApprovalId === null ||
    mountedApprovalId === undefined ||
    mountedApprovalId.length === 0
  ) {
    return false;
  }
  return key === mountedApprovalId;
}

/**
 * Minimal DOM simulation for regression testing: status HTML may be replaced on
 * poll, but the textarea instance must stay the same while preserve is true.
 *
 * @param {{ statusEl: { innerHTML: string }, operatorEl: { replaceChildren: (n: unknown) => void, firstChild: unknown | null }, textarea: object | null, mountedApprovalId: string | null }} state
 * @param {string | undefined} selectedNodeKey
 * @param {any} node
 */
/** @param {any} node @param {any} artifact */
export function reportArtifactMountKey(node, artifact) {
  if (node === null || node === undefined || node.key !== "report") {
    return null;
  }
  if (node.persistedStatus !== "SUCCEEDED") {
    return null;
  }
  if (artifact === null || artifact === undefined) {
    return null;
  }
  const id = artifact.artifactId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * @param {string | undefined} workflowRunId
 * @param {any} node
 * @param {any} artifact
 */
export function reportArtifactPreserveKey(workflowRunId, node, artifact) {
  const artifactId = reportArtifactMountKey(node, artifact);
  if (artifactId === null) {
    return null;
  }
  if (
    workflowRunId === undefined ||
    workflowRunId === null ||
    workflowRunId.length === 0
  ) {
    return null;
  }
  return `${workflowRunId}:${artifactId}`;
}

/**
 * @param {string | undefined} selectedNodeKey
 * @param {string | undefined} workflowRunId
 * @param {any} node
 * @param {any} artifact
 * @param {string | null | undefined} mountedPreserveKey
 */
export function shouldPreserveReportArtifactPanel(
  selectedNodeKey,
  workflowRunId,
  node,
  artifact,
  mountedPreserveKey,
) {
  if (selectedNodeKey !== "report") {
    return false;
  }
  const key = reportArtifactPreserveKey(workflowRunId, node, artifact);
  if (key === null) {
    return false;
  }
  if (
    mountedPreserveKey === null ||
    mountedPreserveKey === undefined ||
    mountedPreserveKey.length === 0
  ) {
    return false;
  }
  return key === mountedPreserveKey;
}

/**
 * Minimal DOM simulation for report preview preservation across poll ticks.
 *
 * @param {{
 *   statusEl: { innerHTML: string },
 *   operatorEl: { replaceChildren: (n: unknown) => void, firstChild: unknown | null },
 *   previewPre: object | null,
 *   mountedReportArtifactKey: string | null,
 *   fetchCount: number,
 * }} state
 * @param {string | undefined} selectedNodeKey
 * @param {string | undefined} workflowRunId
 * @param {any} node
 * @param {any} artifact
 */
export function simulatePollReportArtifactUpdate(
  state,
  selectedNodeKey,
  workflowRunId,
  node,
  artifact,
) {
  state.statusEl.innerHTML = "<p>status updated</p>";
  const preserve = shouldPreserveReportArtifactPanel(
    selectedNodeKey,
    workflowRunId,
    node,
    artifact,
    state.mountedReportArtifactKey,
  );
  if (preserve && state.previewPre !== null) {
    return {
      preserved: true,
      previewPre: state.previewPre,
      fetchCount: state.fetchCount,
    };
  }
  state.fetchCount += 1;
  const previewPre = {
    tagName: "PRE",
    textContent: "",
  };
  state.operatorEl.replaceChildren(previewPre);
  state.previewPre = previewPre;
  state.mountedReportArtifactKey = reportArtifactPreserveKey(
    workflowRunId,
    node,
    artifact,
  );
  return {
    preserved: false,
    previewPre,
    fetchCount: state.fetchCount,
  };
}

/**
 * @param {{ statusEl: { innerHTML: string }, operatorEl: { replaceChildren: (n: unknown) => void, firstChild: unknown | null }, textarea: object | null, mountedApprovalId: string | null }} state
 * @param {string | undefined} selectedNodeKey
 * @param {any} node
 */
export function simulatePollNodeDetailUpdate(state, selectedNodeKey, node) {
  state.statusEl.innerHTML = "<p>status updated</p>";
  const preserve = shouldPreserveApprovalOperatorForm(
    selectedNodeKey,
    node,
    state.mountedApprovalId,
  );
  if (preserve && state.textarea !== null) {
    return { preserved: true, textarea: state.textarea };
  }
  const textarea = {
    tagName: "TEXTAREA",
    id: "approval-comment",
    value: "",
  };
  state.operatorEl.replaceChildren(textarea);
  state.textarea = textarea;
  state.mountedApprovalId = approvalOperatorMountKey(node);
  return { preserved: false, textarea };
}
