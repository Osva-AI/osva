import {
  escapeTextareaHtml as escapeHtml,
  trimApprovalCommentDraft,
} from "./approval-comment.js";
import {
  approvalOperatorMountKey,
  reportArtifactPreserveKey,
  shouldPreserveApprovalOperatorForm,
  shouldPreserveReportArtifactPanel,
} from "./node-detail-lifecycle.js";

const startForm = document.getElementById("start-form");
const startPanel = document.getElementById("start-panel");
const workflowPanel = document.getElementById("workflow-panel");
const setupBanner = document.getElementById("setup-banner");
const workflowSummary = document.getElementById("workflow-summary");
const pipeline = document.getElementById("pipeline");
const nodeDetail = document.getElementById("node-detail");
const addConstraintButton = document.getElementById("add-constraint");
const constraintsList = document.getElementById("constraints-list");

/** @type {string | undefined} */
let activeWorkflowRunId;
/** @type {string | undefined} */
let selectedNodeKey;
/** @type {number | undefined} */
let pollTimer;
/** @type {unknown} */
let latestModel;
/** @type {string | undefined} */
let operatorError;
let operatorSubmitting = false;
/** @type {string} */
let approvalCommentDraft = "";
/** @type {string | null} */
let mountedApprovalId = null;
/** @type {string | null} */
let mountedReportArtifactKey = null;
/** @type {Map<string, string>} */
const reportPreviewContentByKey = new Map();
/** @type {string | null} */
let reportPreviewInflightKey = null;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function readRunIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("workflowRunId");
  return value && value.length > 0 ? value : undefined;
}

function writeRunIdToUrl(workflowRunId) {
  const url = new URL(window.location.href);
  url.searchParams.set("workflowRunId", workflowRunId);
  window.history.replaceState({}, "", url);
}

function stateClass(presentationStatus) {
  return `state-${presentationStatus.toLowerCase().replace(/_/g, "_")}`;
}

function formatStatusLabel(status) {
  return status.replace(/_/g, " ");
}

async function fetchJson(path, init) {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

async function loadSetupState() {
  try {
    const state = await fetchJson("/api/canonical/state");
    if (!state.ready) {
      const detail =
        typeof state.message === "string" && state.message.length > 0
          ? state.message
          : typeof state.reason === "string" && state.reason.length > 0
            ? `Canonical demo is not ready (${state.reason}).`
            : "Canonical setup is missing or stale. Run pnpm run canonical:setup with OSVA running, then refresh.";
      setupBanner.textContent = detail;
      setupBanner.classList.remove("hidden");
      document.getElementById("start-button").disabled = true;
    } else {
      setupBanner.classList.add("hidden");
    }
  } catch {
    setupBanner.textContent =
      "Could not reach the demo server setup endpoint. Is pnpm canonical:demo running?";
    setupBanner.classList.remove("hidden");
  }
}

function renderSummary(model) {
  workflowSummary.innerHTML = "";
  const cards = [
    ["Package", model.packageName ?? "—"],
    ["Request ID", model.requestId ?? "—"],
    ["Workflow run", model.workflowRunId],
    ["Status", model.workflowStatus],
    ["Started", model.startedAt ?? model.createdAt],
    ["Completed", model.completedAt ?? "—"],
  ];
  for (const [label, value] of cards) {
    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    workflowSummary.appendChild(card);
  }
}

function renderPipeline(model) {
  pipeline.innerHTML = "";
  model.nodes.forEach((node, index) => {
    if (index > 0) {
      const arrow = document.createElement("div");
      arrow.className = "pipeline-arrow";
      arrow.textContent = "↓";
      pipeline.appendChild(arrow);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pipeline-node";
    if (node.key === selectedNodeKey) {
      button.classList.add("active");
    }
    button.dataset.nodeKey = node.key;
    button.innerHTML = `<span>${node.label}</span><span class="state ${stateClass(node.presentationStatus)}">${formatStatusLabel(node.presentationStatus)}</span>`;
    button.addEventListener("click", () => {
      selectedNodeKey = node.key;
      renderPipeline(model);
      syncNodeDetail(node, { force: true });
    });
    pipeline.appendChild(button);
  });

  if (selectedNodeKey === undefined && model.nodes.length > 0) {
    selectedNodeKey = model.nodes[0].key;
    const first = model.nodes[0];
    syncNodeDetail(first, { force: true });
  }
}

function renderSteps(steps) {
  if (!steps || steps.length === 0) {
    return '<p class="muted">No persisted RunSteps yet for the latest RunAttempt.</p>';
  }
  const items = steps
    .map((step) => {
      const kindLabel =
        step.kind === "MODEL"
          ? "Model"
          : step.kind === "TOOL"
            ? "Tool"
            : step.kind === "KNOWLEDGE"
              ? "Knowledge"
              : step.kind;
      const mcp =
        step.toolMcpBacked === true
          ? '<span class="chip">MCP via ToolGateway</span>'
          : "";
      const tokens =
        step.totalTokens !== undefined
          ? `<span class="chip">${step.totalTokens} tokens</span>`
          : "";
      return `<li>
        <div class="step-head">
          <strong>${kindLabel}</strong>
          <code>${step.bindingName}</code>
          <span class="chip">${step.status}</span>
          ${mcp}
          ${tokens}
        </div>
        <div class="muted">${step.startedAt}${step.completedAt ? ` → ${step.completedAt}` : ""}${step.durationMs !== undefined ? ` (${step.durationMs} ms)` : ""}</div>
      </li>`;
    })
    .join("");
  return `<ul class="timeline">${items}</ul>`;
}

function syncApprovalCommentDraftFromDom() {
  const el = document.getElementById("approval-comment");
  if (el instanceof HTMLTextAreaElement) {
    approvalCommentDraft = el.value;
  }
}

function ensureNodeDetailShell() {
  if (nodeDetail.querySelector("#node-detail-status") !== null) {
    return;
  }
  nodeDetail.replaceChildren();
  const status = document.createElement("div");
  status.id = "node-detail-status";
  const operator = document.createElement("div");
  operator.id = "node-detail-operator";
  nodeDetail.appendChild(status);
  nodeDetail.appendChild(operator);
}

function mountApprovalOperatorForm(operatorEl, node) {
  operatorEl.replaceChildren();
  const panel = document.createElement("div");
  panel.className = "operator-panel";
  panel.dataset.operator = "approval";

  const heading = document.createElement("h4");
  heading.textContent = "Operator actions";
  panel.appendChild(heading);

  const label = document.createElement("label");
  label.className = "operator-comment";
  label.append("Comment (optional)");
  const textarea = document.createElement("textarea");
  textarea.id = "approval-comment";
  textarea.rows = 2;
  textarea.maxLength = 4000;
  textarea.placeholder = "Optional decision comment";
  textarea.value = approvalCommentDraft;
  textarea.addEventListener("input", () => {
    approvalCommentDraft = textarea.value;
  });
  label.appendChild(document.createElement("br"));
  label.appendChild(textarea);
  panel.appendChild(label);

  const actions = document.createElement("div");
  actions.className = "operator-actions";
  for (const decision of ["APPROVED", "REJECTED"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.approvalDecision = decision;
    button.className = decision === "APPROVED" ? "primary" : "danger";
    button.textContent = decision === "APPROVED" ? "Approve" : "Reject";
    button.addEventListener("click", () => {
      const current = latestModel?.nodes?.find(
        (item) => item.key === "adoption-approval",
      );
      if (current !== undefined) {
        submitApprovalDecision(current, decision).catch(() => {});
      }
    });
    actions.appendChild(button);
  }
  panel.appendChild(actions);

  const hint = document.createElement("p");
  hint.className = "muted operator-hint";
  hint.innerHTML = `Decides persisted approval <code>${node.approval.id}</code>. Reject fails the workflow with <code>APPROVAL_REJECTED</code> (Report does not run).`;
  panel.appendChild(hint);

  const submitting = document.createElement("p");
  submitting.className = "muted approval-submitting";
  submitting.hidden = true;
  submitting.textContent = "Submitting decision…";
  panel.appendChild(submitting);

  operatorEl.appendChild(panel);
  mountedApprovalId = approvalOperatorMountKey(node);
}

function updateApprovalOperatorChrome(node) {
  const panel = nodeDetail.querySelector('[data-operator="approval"]');
  if (panel === null) {
    return;
  }
  panel.querySelectorAll("[data-approval-decision]").forEach((button) => {
    button.disabled = operatorSubmitting;
  });
  const submitting = panel.querySelector(".approval-submitting");
  if (submitting instanceof HTMLElement) {
    submitting.hidden = !operatorSubmitting;
  }
}

function renderDeliveryOperatorPanel(node) {
  if (
    node.presentationStatus !== "WAITING" ||
    node.deliveryWait === undefined
  ) {
    return "";
  }
  const wait = node.deliveryWait;
  const disabled = operatorSubmitting ? "disabled" : "";
  return `<div class="operator-panel" data-operator="delivery">
    <h4>Operator actions</h4>
    <p class="muted">Emit the canonical delivery event so the orchestrator can resume the Report agent.</p>
    <ul class="meta-list">
      <li><strong>Source</strong> <code>${wait.source}</code></li>
      <li><strong>Event type</strong> <code>${wait.eventType}</code></li>
      <li><strong>Correlation</strong> <code>${wait.correlationValue ?? "—"}</code></li>
    </ul>
    <button type="button" class="primary" data-delivery-event="1" ${disabled}>Emit delivery event</button>
    ${operatorSubmitting ? '<p class="muted">Emitting event…</p>' : ""}
  </div>`;
}

async function submitApprovalDecision(node, decision) {
  if (
    operatorSubmitting ||
    activeWorkflowRunId === undefined ||
    node.approval?.id === undefined
  ) {
    return;
  }
  syncApprovalCommentDraftFromDom();
  const comment = trimApprovalCommentDraft(approvalCommentDraft);
  operatorSubmitting = true;
  operatorError = undefined;
  const selected = selectedNodeKey;
  if (latestModel !== undefined) {
    renderPipeline(latestModel);
    const selected = latestModel.nodes?.find(
      (item) => item.key === selectedNodeKey,
    );
    if (selected !== undefined) {
      syncNodeDetail(selected, { force: false });
    }
  }
  try {
    await fetchJson(
      `/api/canonical/runs/${encodeURIComponent(activeWorkflowRunId)}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: node.approval.id,
          decision,
          ...(comment === undefined ? {} : { comment }),
        }),
      },
    );
    approvalCommentDraft = "";
    mountedApprovalId = null;
    await refreshWorkflow();
  } catch (error) {
    operatorError =
      error instanceof Error ? error.message : "Approval action failed.";
    selectedNodeKey = selected;
    if (latestModel !== undefined) {
      renderPipeline(latestModel);
      const current = latestModel.nodes?.find(
        (item) => item.key === selectedNodeKey,
      );
      if (current !== undefined) {
        syncNodeDetail(current, { force: false });
      }
    }
  } finally {
    operatorSubmitting = false;
  }
}

async function submitDeliveryEvent(node) {
  if (operatorSubmitting || activeWorkflowRunId === undefined) {
    return;
  }
  operatorSubmitting = true;
  operatorError = undefined;
  const selected = selectedNodeKey;
  if (latestModel !== undefined) {
    renderPipeline(latestModel);
    const current = latestModel.nodes?.find(
      (item) => item.key === selectedNodeKey,
    );
    if (current !== undefined) {
      syncNodeDetail(current, { force: false });
    }
  }
  try {
    await fetchJson(
      `/api/canonical/runs/${encodeURIComponent(activeWorkflowRunId)}/delivery-event`,
      { method: "POST" },
    );
    await refreshWorkflow();
  } catch (error) {
    operatorError =
      error instanceof Error ? error.message : "Delivery event failed.";
    selectedNodeKey = selected;
    if (latestModel !== undefined) {
      renderPipeline(latestModel);
    }
  } finally {
    operatorSubmitting = false;
  }
}

function wireDeliveryOperatorActions(node) {
  const deliveryButton = nodeDetail.querySelector("[data-delivery-event]");
  if (deliveryButton !== null) {
    deliveryButton.addEventListener("click", () => {
      submitDeliveryEvent(node).catch(() => {});
    });
  }
}

function renderChildRun(childRun) {
  if (childRun === undefined) {
    return '<p class="muted">Child Run not created yet.</p>';
  }
  const attempt = childRun.latestAttempt;
  return `<ul class="meta-list">
    <li><strong>Child Run</strong> <code>${childRun.runId}</code> (${childRun.runStatus})</li>
    <li><strong>AgentVersion</strong> <code>${childRun.agentVersionId ?? "—"}</code></li>
    <li><strong>RunAttempts</strong> ${childRun.attempts.length}</li>
    ${
      attempt
        ? `<li><strong>Latest attempt</strong> #${attempt.sequence} ${attempt.status}${attempt.error ? ` — ${attempt.error.message}` : ""}</li>`
        : "<li>No RunAttempts persisted yet.</li>"
    }
  </ul>
  <h4>Activity timeline</h4>
  ${renderSteps(childRun.steps)}`;
}

/** @param {any} node */
function buildNodeStatusHtml(node) {
  let html = `<h3>${node.label}</h3>`;
  html += `<p class="muted">Persisted node status: <strong>${node.persistedStatus ?? "not created yet"}</strong> · type ${node.nodeType}</p>`;

  if (
    node.key === "research" ||
    node.key === "analysis" ||
    node.key === "report"
  ) {
    html += renderChildRun(node.childRun);
  }

  if (node.key === "analysis" && node.analysis) {
    html += `<h4>Analysis result</h4>
      <ul class="meta-list">
        <li><strong>Recommendation</strong> ${node.analysis.recommendation}</li>
        <li><strong>Confidence</strong> ${node.analysis.confidence}</li>
        <li><strong>Summary</strong> ${node.analysis.summary}</li>
      </ul>`;
  }

  if (node.key === "adoption-approval") {
    if (node.approval) {
      html += `<h4>Approval</h4>
        <ul class="meta-list">
          <li><strong>Title</strong> ${node.approval.title ?? "—"}</li>
          <li><strong>Status</strong> ${node.approval.status}</li>
          <li><strong>ID</strong> <code>${node.approval.id}</code></li>
          ${node.approval.comment ? `<li><strong>Comment</strong> ${node.approval.comment}</li>` : ""}
          ${node.approval.decidedAt ? `<li><strong>Decided</strong> ${node.approval.decidedAt}</li>` : ""}
        </ul>`;
    } else {
      html += `<p class="muted">Approval request not created yet.</p>`;
    }
  }

  if (node.key === "delivery-wait") {
    if (node.deliveryWait) {
      const wait = node.deliveryWait;
      html += `<h4>Event wait</h4>
        <ul class="meta-list">
          <li><strong>Waiting for</strong> <code>${wait.eventType}</code></li>
          <li><strong>Source</strong> <code>${wait.source}</code></li>
          <li><strong>Correlation</strong> requestId = <code>${wait.correlationValue ?? "—"}</code></li>
          ${wait.timeoutMs !== undefined ? `<li><strong>Timeout</strong> ${wait.timeoutMs} ms</li>` : ""}
        </ul>`;
    } else {
      html += `<p class="muted">Delivery wait metadata unavailable.</p>`;
    }
  }

  if (operatorError !== undefined) {
    html += `<p class="operator-error" role="alert">${operatorError}</p>`;
  }

  if (
    node.key === "report" &&
    node.persistedStatus === "SUCCEEDED" &&
    latestModel?.artifact
  ) {
    const artifact = latestModel.artifact;
    html += `<h4>Artifact</h4>
      <ul class="meta-list">
        <li><strong>Name</strong> ${escapeHtml(artifact.name ?? "—")}</li>
        <li><strong>Type</strong> ${escapeHtml(artifact.mediaType ?? "—")}</li>
        ${
          artifact.sizeBytes !== undefined
            ? `<li><strong>Size</strong> ${artifact.sizeBytes} bytes</li>`
            : ""
        }
        ${
          artifact.digest
            ? `<li><strong>Digest</strong> <code>${escapeHtml(artifact.digest)}</code></li>`
            : ""
        }
        ${
          artifact.producer
            ? `<li><strong>Producer Run</strong> <code>${escapeHtml(artifact.producer.runId)}</code> · attempt <code>${escapeHtml(artifact.producer.runAttemptId)}</code></li>`
            : ""
        }
      </ul>`;
  }

  return html;
}

function clearReportPreviewState() {
  mountedReportArtifactKey = null;
  reportPreviewContentByKey.clear();
  reportPreviewInflightKey = null;
}

function renderReportArtifactPanel(operatorEl, node) {
  if (
    activeWorkflowRunId === undefined ||
    latestModel?.artifact === undefined
  ) {
    return;
  }
  operatorEl.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "report-artifact-panel";
  panel.dataset.reportArtifact = "1";

  const actions = document.createElement("div");
  actions.className = "report-artifact-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "secondary";
  previewButton.textContent = "Preview report";
  previewButton.dataset.reportPreview = "1";

  const downloadLink = document.createElement("a");
  downloadLink.className = "button-link";
  downloadLink.textContent = "Download report";
  downloadLink.href = `/api/canonical/runs/${encodeURIComponent(activeWorkflowRunId)}/report-artifact/download`;
  downloadLink.setAttribute("download", "");

  actions.appendChild(previewButton);
  actions.appendChild(downloadLink);

  const previewWrap = document.createElement("div");
  previewWrap.className = "report-artifact-preview hidden";
  previewWrap.dataset.reportPreviewWrap = "1";

  const previewPre = document.createElement("pre");
  previewPre.className = "report-markdown-preview";
  previewPre.dataset.reportPreviewBody = "1";
  previewWrap.appendChild(previewPre);

  panel.appendChild(actions);
  panel.appendChild(previewWrap);
  operatorEl.appendChild(panel);

  previewButton.addEventListener("click", () => {
    previewWrap.classList.remove("hidden");
    loadReportArtifactPreview(previewPre, node, latestModel.artifact).catch(
      () => {},
    );
  });

  mountedReportArtifactKey = reportArtifactPreserveKey(
    activeWorkflowRunId,
    node,
    latestModel.artifact,
  );
  const cached =
    mountedReportArtifactKey !== null
      ? reportPreviewContentByKey.get(mountedReportArtifactKey)
      : undefined;
  if (cached !== undefined) {
    previewWrap.classList.remove("hidden");
    previewPre.textContent = cached;
  }
}

/**
 * @param {HTMLPreElement} previewPre
 * @param {any} node
 * @param {any} artifact
 */
async function loadReportArtifactPreview(previewPre, node, artifact) {
  if (activeWorkflowRunId === undefined) {
    return;
  }
  const preserveKey = reportArtifactPreserveKey(
    activeWorkflowRunId,
    node,
    artifact,
  );
  if (preserveKey === null) {
    return;
  }
  const cached = reportPreviewContentByKey.get(preserveKey);
  if (cached !== undefined) {
    previewPre.textContent = cached;
    return;
  }
  if (reportPreviewInflightKey === preserveKey) {
    return;
  }
  reportPreviewInflightKey = preserveKey;
  previewPre.textContent = "Loading preview…";
  try {
    const body = await fetchJson(
      `/api/canonical/runs/${encodeURIComponent(activeWorkflowRunId)}/report-artifact`,
    );
    const content = typeof body.content === "string" ? body.content : "";
    reportPreviewContentByKey.set(preserveKey, content);
    previewPre.textContent = content;
  } catch (error) {
    previewPre.textContent =
      error instanceof Error
        ? `Preview unavailable: ${error.message}`
        : "Preview unavailable.";
  } finally {
    if (reportPreviewInflightKey === preserveKey) {
      reportPreviewInflightKey = null;
    }
  }
}

function renderOperatorSection(node) {
  const operatorEl = document.getElementById("node-detail-operator");
  if (!(operatorEl instanceof HTMLElement)) {
    return;
  }
  operatorEl.replaceChildren();
  mountedApprovalId = null;
  mountedReportArtifactKey = null;

  const approvalKey = approvalOperatorMountKey(node);
  if (approvalKey !== null && selectedNodeKey === "adoption-approval") {
    mountApprovalOperatorForm(operatorEl, node);
    return;
  }

  if (node.key === "delivery-wait" && node.deliveryWait !== undefined) {
    operatorEl.innerHTML = renderDeliveryOperatorPanel(node);
    wireDeliveryOperatorActions(node);
    return;
  }

  if (
    node.key === "report" &&
    node.persistedStatus === "SUCCEEDED" &&
    latestModel?.artifact !== undefined
  ) {
    renderReportArtifactPanel(operatorEl, node);
  }
}

/**
 * @param {any} node
 * @param {{ force?: boolean }} [options]
 */
function syncNodeDetail(node, options = {}) {
  if (selectedNodeKey === "adoption-approval") {
    syncApprovalCommentDraftFromDom();
  }
  ensureNodeDetailShell();
  const statusEl = document.getElementById("node-detail-status");
  if (!(statusEl instanceof HTMLElement)) {
    return;
  }
  statusEl.innerHTML = buildNodeStatusHtml(node);

  const preserveApproval =
    options.force !== true &&
    shouldPreserveApprovalOperatorForm(
      selectedNodeKey,
      node,
      mountedApprovalId,
    );

  if (preserveApproval) {
    updateApprovalOperatorChrome(node);
    return;
  }

  const preserveReport =
    options.force !== true &&
    shouldPreserveReportArtifactPanel(
      selectedNodeKey,
      activeWorkflowRunId,
      node,
      latestModel?.artifact,
      mountedReportArtifactKey,
    );

  if (preserveReport) {
    return;
  }

  renderOperatorSection(node);
  if (
    approvalOperatorMountKey(node) !== null &&
    selectedNodeKey === "adoption-approval"
  ) {
    updateApprovalOperatorChrome(node);
  }
}

function schedulePoll(model) {
  if (pollTimer !== undefined) {
    window.clearTimeout(pollTimer);
  }
  const interval = TERMINAL.has(model.workflowStatus) ? 5000 : 1000;
  pollTimer = window.setTimeout(() => {
    refreshWorkflow().catch(() => {
      schedulePoll(model);
    });
  }, interval);
}

async function refreshWorkflow() {
  if (activeWorkflowRunId === undefined) {
    return;
  }
  const model = await fetchJson(
    `/api/canonical/runs/${encodeURIComponent(activeWorkflowRunId)}`,
  );
  latestModel = model;
  renderSummary(model);
  renderPipeline(model);
  if (selectedNodeKey !== undefined) {
    const selected = model.nodes.find((node) => node.key === selectedNodeKey);
    if (selected !== undefined) {
      syncNodeDetail(selected, { force: false });
    }
  }
  schedulePoll(model);
}

startForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const data = new FormData(form);
  const constraints = Array.from(
    form.querySelectorAll('input[name="constraint"]'),
  )
    .map((input) => /** @type {HTMLInputElement} */ (input).value.trim())
    .filter((value) => value.length > 0);

  const payload = {
    packageName: String(data.get("packageName") ?? "").trim(),
    useCase: String(data.get("useCase") ?? "").trim(),
    constraints,
  };

  const startButton = document.getElementById("start-button");
  startButton.disabled = true;
  try {
    const created = await fetchJson("/api/canonical/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    activeWorkflowRunId = created.workflowRunId;
    clearReportPreviewState();
    writeRunIdToUrl(activeWorkflowRunId);
    startPanel.classList.add("hidden");
    workflowPanel.classList.remove("hidden");
    await refreshWorkflow();
  } catch (error) {
    setupBanner.textContent =
      error instanceof Error ? error.message : "Failed to start review.";
    setupBanner.classList.remove("hidden");
  } finally {
    startButton.disabled = false;
  }
});

addConstraintButton?.addEventListener("click", () => {
  const row = document.createElement("div");
  row.className = "constraint-row";
  row.innerHTML = '<input type="text" name="constraint" />';
  constraintsList?.appendChild(row);
});

async function bootstrap() {
  await loadSetupState();
  const fromUrl = readRunIdFromUrl();
  if (fromUrl !== undefined) {
    activeWorkflowRunId = fromUrl;
    clearReportPreviewState();
    startPanel.classList.add("hidden");
    workflowPanel.classList.remove("hidden");
    try {
      await refreshWorkflow();
    } catch (error) {
      setupBanner.textContent =
        error instanceof Error
          ? error.message
          : "Could not load workflow run from URL.";
      setupBanner.classList.remove("hidden");
    }
  }
}

bootstrap();
