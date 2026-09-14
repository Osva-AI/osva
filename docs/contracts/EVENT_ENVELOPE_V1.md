# Event Envelope v1

```json
{
  "schemaVersion": "1",
  "eventId": "uuid",
  "eventType": "run.started",
  "occurredAt": "ISO-8601",
  "workspaceId": "uuid",
  "aggregateType": "run",
  "aggregateId": "uuid",
  "correlationId": "uuid",
  "causationId": "uuid-or-null",
  "payload": {}
}
```

## Rules

- event IDs are unique;
- timestamps use UTC;
- payload schema depends on eventType;
- secret values are never placed in events;
- transport-specific metadata remains outside canonical payload.
