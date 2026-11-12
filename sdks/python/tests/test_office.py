from __future__ import annotations

import httpx

from osva.client import OSVAClient
from osva.http_client import HTTPClient

API_KEY = "osva_ak_test_key"


def test_office_resources_use_canonical_v1_office_paths() -> None:
    captured: list[tuple[str, str, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.content.decode("utf-8") if request.content else None
        captured.append((request.method, request.url.path, body))
        return httpx.Response(200, json={"items": []})

    transport = httpx.MockTransport(handler)
    http = HTTPClient(
        "http://127.0.0.1:9",
        api_key=API_KEY,
        client=httpx.Client(transport=transport),
    )
    client = OSVAClient(base_url="http://127.0.0.1:9", api_key=API_KEY, client=http)

    client.office_workers.list()
    client.office_workers.get("worker-1")
    client.roles.list()
    client.roles.get("role-1")
    client.teams.list()
    client.teams.get("team-1")
    client.teams.list_memberships("team-1")
    client.goals.list()
    client.goals.get("goal-1")
    client.assignments.list()
    client.assignments.get("asn-1")
    client.assignments.launch("asn-1")
    client.assignments.cancel("asn-1")
    client.office_threads.list()
    client.office_threads.get("thread-1")
    client.office_threads.list_messages("thread-1")
    client.office_threads.post_message("thread-1", {"body": "hi"})
    client.office_inbox.list()
    client.office_inbox.update_read_state(
        {"threadId": "thread-1", "lastReadSequence": 1},
    )

    paths = [path for _method, path, _body in captured]
    assert paths == [
        "/v1/office/workers",
        "/v1/office/workers/worker-1",
        "/v1/office/roles",
        "/v1/office/roles/role-1",
        "/v1/office/teams",
        "/v1/office/teams/team-1",
        "/v1/office/teams/team-1/memberships",
        "/v1/office/goals",
        "/v1/office/goals/goal-1",
        "/v1/office/assignments",
        "/v1/office/assignments/asn-1",
        "/v1/office/assignments/asn-1/launch",
        "/v1/office/assignments/asn-1/cancel",
        "/v1/office/threads",
        "/v1/office/threads/thread-1",
        "/v1/office/threads/thread-1/messages",
        "/v1/office/threads/thread-1/messages",
        "/v1/office/inbox",
        "/v1/office/inbox/read-state",
    ]
