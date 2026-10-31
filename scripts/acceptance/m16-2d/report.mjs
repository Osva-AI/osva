export class AcceptanceReport {
  /** @type {Map<string, { status: string, detail?: string, evidence?: Record<string, unknown> }>} */
  records = new Map();

  record(id, title, status, options = {}) {
    this.records.set(id, {
      title,
      status,
      ...(options.detail ? { detail: options.detail } : {}),
      ...(options.evidence ? { evidence: options.evidence } : {}),
    });
  }

  summary() {
    const rows = [...this.records.entries()].map(([id, value]) => ({
      id,
      ...value,
    }));
    const counts = { PASS: 0, FAIL: 0, SKIP: 0, NOT_RUN: 0 };
    for (const row of rows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    return { counts, rows };
  }

  /**
   * @param {readonly string[]} childIds
   * @returns {"PASS" | "FAIL" | "NOT_RUN"}
   */
  journeyStatusFromChildIds(childIds) {
    if (childIds.length === 0) {
      return "NOT_RUN";
    }
    const statuses = childIds.map((id) => this.records.get(id)?.status);
    if (statuses.every((status) => status === undefined)) {
      return "NOT_RUN";
    }
    return AcceptanceReport.#aggregateChildStatuses(statuses);
  }

  /**
   * Aggregate parent journey status from child step ids (e.g. `upgrade_` prefix).
   *
   * @param {string} idPrefix
   * @returns {"PASS" | "FAIL" | "NOT_RUN"}
   */
  journeyStatusFromChildren(idPrefix) {
    const statuses = [...this.records.entries()]
      .filter(([id]) => id.startsWith(idPrefix))
      .map(([, row]) => row.status);
    if (statuses.length === 0) {
      return "NOT_RUN";
    }
    return AcceptanceReport.#aggregateChildStatuses(statuses);
  }

  /**
   * @param {readonly (string | undefined)[]} statuses
   * @returns {"PASS" | "FAIL" | "NOT_RUN"}
   */
  static #aggregateChildStatuses(statuses) {
    if (statuses.some((status) => status === undefined)) {
      return "FAIL";
    }
    if (statuses.some((status) => status === "FAIL")) {
      return "FAIL";
    }
    if (statuses.every((status) => status === "PASS" || status === "WARN")) {
      return "PASS";
    }
    return "FAIL";
  }

  assertAllPass() {
    const failed = [...this.records.values()].filter(
      (row) => row.status === "FAIL",
    );
    if (failed.length > 0) {
      throw new Error(
        `Acceptance failures: ${failed.map((row) => row.title).join(", ")}`,
      );
    }
  }
}
