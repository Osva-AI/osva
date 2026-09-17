from __future__ import annotations

from typing import Any

from osva.http_client import HTTPClient


class OfficeWorkersResource:
    def __init__(self, client: HTTPClient) -> None:
        self._client = client

    def list(self, workspace_id: str) -> dict[str, Any]:
        return self._client.request(
            "GET",
            "/v1/office-workers",
            query={"workspaceId": workspace_id},
        )

    def get(self, office_worker_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/office-workers/{office_worker_id}")

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("POST", "/v1/office-workers", body=payload)

    def update(self, office_worker_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request(
            "PATCH",
            f"/v1/office-workers/{office_worker_id}",
            body=payload,
        )


class RolesResource:
    def __init__(self, client: HTTPClient) -> None:
        self._client = client

    def list(self, workspace_id: str) -> dict[str, Any]:
        return self._client.request(
            "GET",
            "/v1/roles",
            query={"workspaceId": workspace_id},
        )

    def get(self, role_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/roles/{role_id}")

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("POST", "/v1/roles", body=payload)

    def update(self, role_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("PATCH", f"/v1/roles/{role_id}", body=payload)


class TeamsResource:
    def __init__(self, client: HTTPClient) -> None:
        self._client = client

    def list(self, workspace_id: str) -> dict[str, Any]:
        return self._client.request(
            "GET",
            "/v1/teams",
            query={"workspaceId": workspace_id},
        )

    def get(self, team_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/teams/{team_id}")

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("POST", "/v1/teams", body=payload)

    def update(self, team_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("PATCH", f"/v1/teams/{team_id}", body=payload)

    def list_memberships(self, team_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/teams/{team_id}/memberships")

    def add_membership(self, team_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request(
            "POST",
            f"/v1/teams/{team_id}/memberships",
            body=payload,
        )


class GoalsResource:
    def __init__(self, client: HTTPClient) -> None:
        self._client = client

    def list(self, workspace_id: str) -> dict[str, Any]:
        return self._client.request(
            "GET",
            "/v1/goals",
            query={"workspaceId": workspace_id},
        )

    def get(self, goal_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/goals/{goal_id}")

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("POST", "/v1/goals", body=payload)

    def update(self, goal_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("PATCH", f"/v1/goals/{goal_id}", body=payload)


class AssignmentsResource:
    def __init__(self, client: HTTPClient) -> None:
        self._client = client

    def list(self, workspace_id: str) -> dict[str, Any]:
        return self._client.request(
            "GET",
            "/v1/assignments",
            query={"workspaceId": workspace_id},
        )

    def get(self, assignment_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/assignments/{assignment_id}")

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("POST", "/v1/assignments", body=payload)

    def update(self, assignment_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request(
            "PATCH",
            f"/v1/assignments/{assignment_id}",
            body=payload,
        )

    def launch(self, assignment_id: str) -> dict[str, Any]:
        return self._client.request(
            "POST",
            f"/v1/assignments/{assignment_id}/launch",
        )

    def cancel(self, assignment_id: str) -> dict[str, Any]:
        return self._client.request(
            "POST",
            f"/v1/assignments/{assignment_id}/cancel",
        )
