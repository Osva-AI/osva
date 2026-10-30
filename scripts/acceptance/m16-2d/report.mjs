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
