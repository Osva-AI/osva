from __future__ import annotations

from osva.http_client import HTTPClient
from osva.resources.agents import AgentsResource
from osva.resources.approvals import ApprovalsResource
from osva.resources.office import (
    AssignmentsResource,
    GoalsResource,
    OfficeWorkersResource,
    RolesResource,
    TeamsResource,
)
from osva.resources.runs import RunsResource
from osva.resources.schedules import SchedulesResource
from osva.resources.workflow_runs import WorkflowRunsResource
from osva.resources.workflows import WorkflowsResource


class OSVAClient:
    def __init__(
        self,
        *,
        base_url: str,
        workspace_id: str,
        timeout_seconds: float = 30.0,
        client: HTTPClient | None = None,
    ) -> None:
        self.workspace_id = workspace_id
        self._http = client or HTTPClient(base_url, timeout_seconds=timeout_seconds)
        self.agents = AgentsResource(self._http)
        self.runs = RunsResource(self._http, workspace_id)
        self.workflows = WorkflowsResource(self._http)
        self.workflow_runs = WorkflowRunsResource(self._http, workspace_id)
        self.approvals = ApprovalsResource(self._http, workspace_id)
        self.schedules = SchedulesResource(self._http, workspace_id)
        self.office_workers = OfficeWorkersResource(self._http)
        self.roles = RolesResource(self._http)
        self.teams = TeamsResource(self._http)
        self.goals = GoalsResource(self._http)
        self.assignments = AssignmentsResource(self._http)
