---
name: network-interface-health
description: Diagnose interface errors, drops, CRCs, duplex mismatches, flapping, speed negotiation issues, and counter trends on routers, switches, and Linux hosts.
origin: community
---

# Network Interface Health

Use this skill when a network symptom might be caused by a physical link, switch
port, cable, transceiver, duplex setting, or congested interface.

## When to Use

- A host or VLAN has packet loss, latency spikes, or intermittent reachability.
- A switch or router interface shows CRCs, runts, giants, drops, resets, or flaps.
- You need to compare both ends of a link before replacing hardware.
- A change window needs before/after interface counter evidence.
- Monitoring reports rising `ifInErrors`, `ifOutErrors`, or `ifOutDiscards`.

## How It Works

Interface counters are evidence, but the trend matters more than the absolute
number. Capture a baseline, wait a measurement interval, capture again, then
compare increments.

```text
show interfaces <interface>
show interfaces <interface> status
show logging | include <interface>|changed state|line protocol
```

On Linux hosts:

```text
ip -s link show <interface>
ethtool <interface>
ethtool -S <interface>
```

## Counter Reference

| Counter | Meaning | Common cause |
| --- | --- | --- |
| CRC | Received frame checksum failed | Bad cable, dirty fiber, bad optic, duplex mismatch |
| input errors | Aggregate receive-side errors | Check sub-counters before concluding |
| runts | Frames below minimum Ethernet size | Duplex mismatch, collision domain, faulty NIC |
| giants | Frames larger than expected MTU | MTU mismatch or jumbo-frame boundary |
| input drops | Device could not accept inbound packets | Burst, oversubscription, CPU path, queue pressure |
| output drops | Egress queue discarded packets | Congestion, QoS policy, undersized uplink |
| resets | Interface hardware reset | Flapping, keepalive, driver, optic, power |
| collisions | Ethernet collision counter | Half duplex or negotiation mismatch |

## Diagnosis Flow

### CRCs Or Input Errors

1. Confirm counters are incrementing, not just historical.
2. Check both ends of the link. Receive-side errors usually point to the signal
   arriving on that side, not necessarily the port reporting the error.
3. Replace patch cable or clean/replace fiber and optics.
4. Confirm speed/duplex settings match on both sides.
5. Check logs for flap events around the same timestamp.

### Drops

1. Separate input drops from output drops.
2. Compare interface rate against capacity.
3. Check QoS policy, queue counters, and whether the link is an oversubscribed
   uplink.
4. Treat queue tuning as secondary. First prove whether the link is congested.

### Duplex And Speed

Prefer auto-negotiation on modern Ethernet links when both sides support it. If
one side must be fixed, configure both sides explicitly and document why. Never
mix fixed speed/duplex on one side with auto on the other.

```text
show interfaces <interface> | include duplex|speed
```

## Safe Parser Example

Slice each interface block from one header to the next. Do not use an arbitrary
character window; large interface blocks can cause counters to be missed or
assigned to the wrong port.

```python
import re
from typing import Any

HEADER_RE = re.compile(
    r"^(?P<name>\S+) is (?P<status>(?:administratively )?down|up), "
    r"line protocol is (?P<protocol>up|down)",
    re.I | re.M,
)
ERROR_RE = re.compile(r"(?P<input>\d+) input errors, (?P<crc>\d+) CRC", re.I)
DROP_RE = re.compile(r"(?P<output>\d+) output errors", re.I)
DUPLEX_RE = re.compile(r"(?P<duplex>Full|Half|Auto)-duplex,\s+(?P<speed>[^,]+)", re.I)

def parse_show_interfaces(raw: str) -> list[dict[str, Any]]:
    headers = list(HEADER_RE.finditer(raw))
    interfaces = []
    for index, header in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(raw)
        block = raw[header.start():end]
        errors = ERROR_RE.search(block)
        drops = DROP_RE.search(block)
        duplex = DUPLEX_RE.search(block)
        interfaces.append({
            "name": header.group("name"),
            "status": header.group("status"),
            "protocol": header.group("protocol"),
            "duplex": duplex.group("duplex") if duplex else "unknown",
            "speed": duplex.group("speed").strip() if duplex else "unknown",
            "input_errors": int(errors.group("input")) if errors else 0,
            "crc_errors": int(errors.group("crc")) if errors else 0,
            "output_errors": int(drops.group("output")) if drops else 0,
        })
    return interfaces
```

## Examples

### CRCs On One Switch Port

1. Capture counters on the local port.
2. Capture counters on the connected remote port.
3. Replace the cable or optic before changing routing or firewall rules.
4. Clear counters only after recording the baseline.
5. Recheck after a fixed interval.

### Internet Slow But LAN Is Fine

1. Check WAN interface drops/errors.
2. Check LAN uplink utilization and output drops.
3. Check gateway CPU if the WAN link is clean but throughput is still low.
4. Compare wired and wireless tests before blaming upstream service.

## Anti-Patterns

- Clearing counters before saving a baseline.
- Looking at only one side of a link.
- Assuming all historical CRCs are active problems without a time window.
- Mixing auto-negotiation on one side with fixed speed/duplex on the other.
- Treating output drops as a cable problem before checking congestion.

## See Also

- Agent: `network-troubleshooter`
- Skill: `network-config-validation`
- Skill: `homelab-network-setup`
