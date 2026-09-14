# Policy, Security, and Governance

Policy enforcement points include:

- Run creation;
- Agent activation;
- model call;
- Tool call;
- knowledge access;
- approval;
- budget threshold.

Stable interface:

```text
authorize(subject, action, resource, context)
```

Early implementations may use simple grants.

Later implementations may use richer policy engines without changing callers.
