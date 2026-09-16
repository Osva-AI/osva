# Glossary

**Agent**: logical executable capability.

**AgentVersion**: immutable version of an Agent definition.

**Run**: logical execution request.

**RunAttempt**: one canonical attempt to execute a Run.

**RunStep**: meaningful step within a RunAttempt.

**Workflow**: logical orchestration definition.

**WorkflowVersion**: immutable Workflow definition.

**WorkflowRun**: execution of one WorkflowVersion.

**WorkflowNodeRun**: execution state for one node in a WorkflowRun.

**ApprovalRequest**: durable human decision requested for one APPROVAL
WorkflowNodeRun. One APPROVAL WorkflowNodeRun maps to exactly one
ApprovalRequest. Decisions are immutable after `APPROVED` or `REJECTED`.

**Tool**: logical executable capability available to Agents or Workflows.

**ToolVersion**: immutable Tool definition.

**ModelProfile**: logical model capability/configuration. Stable control-plane
identity; only `name` is mutable.

**ModelProfileVersion**: immutable effective model configuration. Append-only;
retries reuse the version ID frozen on the Run.

**ExecutionWorker**: infrastructure process/node that executes work.

**OfficeWorker**: organizational AI worker in the AI Office layer.

**SecretReference**: reference to a secret stored outside normal domain records.
