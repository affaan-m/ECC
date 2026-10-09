---
name: agent-runtime-gateway-smoke-test
description: Verify a local agent API, temporary gateway tunnel, and remote sandbox callback with a tool-free task, then restore the original app connection.
metadata:
  origin: ECC
---

# Agent Runtime Gateway Smoke Test

Use this workflow when an agent task runs in a remote sandbox that calls back to a local API through a gateway. It verifies the whole path without relying on connected tools or private production data.

## When to Activate

- A local agent API needs an end-to-end runtime check.
- A task stalls after dispatch and the gateway or tunnel may be unreachable.
- A web app is temporarily pointed at a local API for agent testing.
- A previous test left the web app pointing at a stopped API.

## Required Inputs

- Repository-relative instructions for starting the API and web app.
- The gateway route path and its expected anonymous response.
- An isolated test agent, a tool-free prompt, and its exact expected answer.
- A way to inspect task status and confirm a callback reached the local API.
- Provider credentials, supplied through the project's normal secret store. Name the providers in shared documentation; never copy credential values into the skill or test report.

If these inputs are unavailable, report the missing input instead of guessing an endpoint or using a real account.

## Smoke Test

1. **Record and check the original route.** Note the web app's current API target and verify it is healthy. Keep this value locally for restoration. Confirm the test agent and data are isolated from real users.
2. **Start the local API and tunnel.** Use a process manager that will keep both alive for the full test. Verify API health. Probe the gateway route anonymously and confirm the documented authentication response, usually `401` or `403`. Confirm the probe appears in the local API log; an edge response alone does not prove the API was reached.
3. **Switch the web app only after both checks pass.** Verify a request from the web app reaches the local API. Check the route again after any web server restart or configuration reload.
4. **Run one tool-free task.** Use a short prompt with an exact expected answer. Confirm the remote sandbox called the local gateway, the task reached a terminal state, and the returned answer matches. A queued or running task is not a pass.
5. **Restore the original route.** Set the web app back to its recorded API target, verify that target and a representative page load, then stop the test API and tunnel. If restoration fails, report the broken route immediately.

Example checks, with values supplied by the project:

```sh
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "$LOCAL_API_HEALTH_URL"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "$PUBLIC_GATEWAY_PROBE_URL"
```

The first command should return the project's healthy status. The second should return the documented anonymous authentication status **and** appear in the local API log. Do not put a credential in either URL.

## Connected Tool Follow-up

Run a separate test only after the tool-free task passes. Use an explicit test connection and grants. Report connection presence and actions granted as different facts. Do not infer that an empty action search means no app is connected. Do not execute a write action against a real account as a smoke test.

## Failure Handling

| Observation | Next check |
| --- | --- |
| Web page loads but API requests fail | Compare the configured API target with the listening process and restore the original route. |
| Gateway probe gets a connection error or `404` | Check tunnel lifetime, route path, and local API health before dispatching a task. |
| Gateway probe gets `401` or `403`, but no local log entry | The response may come from the tunnel edge; verify the callback path. |
| Task stays queued or running | Check whether another dispatcher claimed it and whether the sandbox reached the local gateway. |
| Task finishes with the wrong answer | Capture the task status and redacted error; do not call the smoke test successful. |

## Output Contract

Return a short report with:

- Local API healthy: yes or no
- Gateway probe status and local log confirmation
- Remote callback observed: yes or no
- Tool-free task terminal status and whether the exact answer matched
- Original web API route restored and healthy: yes or no
- One unresolved blocker or next action, if any

Keep account details, credential values, personal paths, public tunnel URLs, and raw private logs out of the report. Keep the source operator notes local.

## Related Skills

- `hermes-imports` for sanitizing a local workflow before sharing it.
- `agent-introspection-debugging` when an agent run fails repeatedly.
- `verification-loop` after changing runtime code.
