---
name: network-bgp-diagnostics
description: Diagnostics-only BGP troubleshooting patterns for neighbor state, route exchange, prefix policy, AS path inspection, and safe evidence collection.
origin: community
---

# Network BGP Diagnostics

Use this skill when a BGP session is down, flapping, established with missing
routes, or advertising unexpected prefixes. The default workflow is read-only
evidence collection; policy and reset actions belong in a reviewed change
window.

## When to Use

- BGP neighbors are stuck in Idle, Connect, Active, OpenSent, or OpenConfirm.
- A session is Established but expected prefixes are missing.
- A route-map, prefix-list, max-prefix limit, or AS path policy may be filtering
  routes.
- You need before/after evidence for a BGP change.
- You are reviewing automation that parses BGP summary output.

## Read-Only Triage Flow

1. Identify the exact neighbor, address family, VRF, and local/remote ASNs.
2. Capture summary state and last reset reason.
3. Prove reachability to the peer source address.
4. Check route policy references before assuming transport failure.
5. Compare advertised, received, and installed routes where the platform
   supports those commands.

```text
show bgp summary
show bgp neighbors <peer>
show ip route <peer>
show tcp brief | include <peer>|:179
show logging | include BGP|<peer>
show running-config | section router bgp
show ip prefix-list
show route-map
```

Use platform-specific address-family commands when the device uses VRFs, IPv6,
VPNv4, or EVPN. Do not assume global IPv4 unicast.

## State Interpretation

| State | First checks |
| --- | --- |
| Established with prefix count | Route exchange is up; inspect policy and table selection |
| Established with zero prefixes | Check inbound policy, max-prefix, advertised routes, and AFI/SAFI |
| Active | TCP session is not completing; check routing, source, ACLs, and peer reachability |
| Connect | TCP connection is in progress; check path and remote listener |
| OpenSent/OpenConfirm | TCP works; check ASN, authentication, timers, capabilities, and logs |
| Idle | Neighbor may be disabled, missing config, blocked by policy, or backoff timer |

## Transport Checks

```text
ping <peer> source <local-source>
traceroute <peer> source <local-source>
show ip route <peer>
show bgp neighbors <peer> | include BGP state|Last reset|Local host|Foreign host
```

If the peer is sourced from a loopback, confirm both directions route to the
loopback addresses and that the neighbor config uses the expected update source.

Avoid disabling ACLs or firewall policy as a diagnostic shortcut. Read hit
counters, logs, and path state first.

## Route Policy Checks

```text
show bgp neighbors <peer> advertised-routes
show bgp neighbors <peer> routes
show ip prefix-list <name>
show route-map <name>
show bgp <prefix>
```

Some platforms require additional configuration before `received-routes` is
available. Do not add that configuration during incident triage unless the
operator approves the change.

## AS Path And Prefix Review

```text
show bgp regexp _65001_
show bgp regexp ^65001$
show bgp <prefix>
show bgp neighbors <peer> advertised-routes | include Network|Path|<prefix>
```

Use AS-path regex carefully. `_65001_` matches AS 65001 as a token. Plain
`65001` can match longer ASNs or unrelated text.

## Parser Pattern

```python
import re
from typing import Any

BGP_SUMMARY_RE = re.compile(
    r"^(?P<neighbor>\d{1,3}(?:\.\d{1,3}){3})\s+"
    r"(?P<version>\d+)\s+"
    r"(?P<remote_as>\d+)\s+"
    r"(?P<msg_rcvd>\d+)\s+"
    r"(?P<msg_sent>\d+)\s+"
    r"(?P<table_version>\d+)\s+"
    r"(?P<input_queue>\d+)\s+"
    r"(?P<output_queue>\d+)\s+"
    r"(?P<uptime>\S+)\s+"
    r"(?P<state_or_prefixes>\S+)$",
    re.M,
)

def parse_bgp_summary(raw: str) -> list[dict[str, Any]]:
    rows = []
    for match in BGP_SUMMARY_RE.finditer(raw):
        state_or_prefixes = match.group("state_or_prefixes")
        if state_or_prefixes.isdigit():
            state = "Established"
            prefixes_received = int(state_or_prefixes)
        else:
            state = state_or_prefixes
            prefixes_received = None
        rows.append({
            "neighbor": match.group("neighbor"),
            "remote_as": int(match.group("remote_as")),
            "state": state,
            "prefixes_received": prefixes_received,
            "uptime": match.group("uptime"),
        })
    return rows
```

Prefer structured parser output when available, but store raw output with the
incident record because BGP summary formats vary by platform and address family.

## Change-Window Only

These actions can affect routing and should not be suggested as automatic
diagnostics:

- Clearing a BGP session.
- Changing neighbor authentication, timers, update source, route-maps, or
  prefix-lists.
- Enabling additional received-route storage.
- Relaxing firewall, ACL, or control-plane policy.

If a reset is approved, prefer the least disruptive soft or route-refresh option
supported by the platform and document exactly why it is safe.

## Anti-Patterns

- Assuming `Active` always means the remote side is down.
- Ignoring VRF, address family, or update-source differences.
- Using broad AS-path regex without token boundaries.
- Hard-resetting a peer before reading last reset reason and logs.
- Treating missing `received-routes` output as proof that no routes arrived.

## See Also

- Skill: `cisco-ios-patterns`
- Skill: `network-config-validation`
- Skill: `network-interface-health`
