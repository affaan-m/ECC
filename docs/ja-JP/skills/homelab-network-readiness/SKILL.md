---
name: homelab-network-readiness
description: ホームラボネットワーク準備、セキュリティ評価、パフォーマンステスト、および展開準備。
origin: community
---

# Homelab Network Readiness

Use this skill before changing a home or small-lab network that mixes VLANs,
Pi-hole or another local DNS resolver, firewall rules, and remote VPN access.

This is a planning and review skill. Do not turn it into copy-paste router,
firewall, or VPN configuration unless the target platform, current topology,
rollback path, console access, and maintenance window are all known.

## When to Use

- Preparing to split a flat network into trusted, IoT, guest, server, or
  management VLANs.
- Moving DHCP clients to Pi-hole, AdGuard Home, Unbound, or another local DNS
  resolver.
- Adding WireGuard, Tailscale, ZeroTier, OpenVPN, or router-native VPN access.
- Reviewing whether a homelab change can lock the operator out of the gateway,
  switch, access point, DNS server, or VPN server.
- Turning an informal home-network idea into a staged migration plan with
  validation evidence.

## Safety Rules

- Keep the first answer read-only: inventory, risks, staged plan, validation,
  and rollback.
- Do not expose gateway admin panels, DNS resolvers, SSH, NAS consoles, or VPN
  management UIs directly to the public internet.
- Do not provide firewall, NAT, VLAN, DHCP, or VPN commands without a confirmed
  platform and a rollback procedure.
- Require out-of-band or same-room console access before changing management
  VLANs, trunk ports, firewall default policies, or DHCP/DNS settings.
- Keep a working path back to the internet before pointing the whole network at
  a new DNS resolver or VPN route.
- Treat IoT, guest, camera, and lab-server networks as different trust zones
  until the operator explicitly chooses otherwise.

## Required Inventory

Collect this before giving implementation steps:

| Area | Questions |
| --- | --- |
| Internet edge | What is the modem or ONT? Is the ISP router bridged or still routing? |
| Gateway | What routes, firewalls, handles DHCP, and terminates VPNs? |
| Switching | Which switch ports are uplinks, access ports, trunks, or unmanaged? |
| Wi-Fi | Which SSIDs map to which networks, and are APs wired or mesh? |
| Addressing | What subnets exist today, and which ranges conflict with VPN sites? |
| DNS/DHCP | Which service currently hands out leases and resolver addresses? |
| Management | How will the operator reach the gateway, switch, and AP after changes? |
| Recovery | What can be reverted locally if DNS, DHCP, VLANs, or VPN routes break? |

## VLAN And Trust-Zone Plan

Start with intent rather than vendor syntax.

| Zone | Typical contents | Default policy |
| --- | --- | --- |
| Trusted | Laptops, phones, admin workstations | Can reach shared services and management only when needed |
| Servers | NAS, Home Assistant, lab hosts, DNS resolver | Accepts narrow inbound flows from trusted clients |
| IoT | TVs, smart plugs, cameras, speakers | Internet access plus explicit exceptions only |
| Guest | Visitor devices | Internet-only, no LAN reachability |
| Management | Gateway, switches, APs, controllers | Reachable only from trusted admin devices |
| VPN | Remote clients | Same or narrower access than trusted clients |

Before recommending VLAN IDs or subnets, confirm:

1. The gateway supports inter-VLAN routing and firewall rules.
2. The switch supports the required tagged and untagged port behavior.
3. The APs can map SSIDs to VLANs.
4. The operator knows which port they are connected through during the change.
5. The management network remains reachable after trunk and SSID changes.

## DNS Filtering Readiness

Pi-hole or another local resolver should be introduced as a dependency, not as a
single point of failure.

1. Give the resolver a reserved address before using it in DHCP options.
2. Confirm it can resolve public DNS and local `home.arpa` names.
3. Keep the gateway or a second resolver available as a temporary fallback.
4. Test one client or one VLAN before changing every DHCP scope.
5. Document which networks may bypass filtering and why.
6. Check that blocking rules do not break captive portals, work VPNs, firmware
   updates, or medical/security devices.

Useful validation evidence:

```text
Client gets expected DHCP lease
Client receives expected DNS resolver
Public DNS lookup succeeds
Local home.arpa lookup succeeds
Blocked test domain is blocked only where intended
Gateway and DNS admin interfaces are not reachable from guest or IoT networks
```

## Remote Access Readiness

For WireGuard-style access, decide what the VPN is allowed to reach before
generating keys or opening ports.

| Mode | Use when | Risk notes |
| --- | --- | --- |
| Split tunnel to one subnet | Remote admin for NAS or lab hosts | Keep route list narrow |
| Split tunnel to trusted services | Access selected apps by IP or DNS | Requires precise firewall rules |
| Full tunnel | Untrusted networks or travel | More bandwidth and DNS responsibility |
| Overlay VPN | Simpler remote access with identity controls | Still needs ACL review |

Do not recommend port forwarding until the operator confirms:

- The VPN endpoint is patched and actively maintained.
- The forwarded port goes only to the VPN service, not an admin UI.
- Dynamic DNS, public IP behavior, and ISP CGNAT status are understood.
- Peer keys can be revoked without rebuilding the whole network.
- Logs or connection status can verify who connected and when.

## Change Sequence

Prefer small, reversible changes:

1. Snapshot the current topology, IP plan, DHCP settings, DNS settings, and
   firewall rules.
2. Reserve infrastructure addresses for gateway, DNS, controller, APs, NAS, and
   VPN endpoint.
3. Create the new zone or VLAN without moving critical devices.
4. Move one test client and validate DHCP, DNS, routing, internet, and block
   behavior.
5. Add narrow firewall exceptions for required flows.
6. Move one low-risk device group.
7. Add VPN access with the narrowest route and firewall policy that satisfies
   the use case.
8. Document final state, known exceptions, and rollback commands or UI steps.

## Review Checklist

- Each network has a reason to exist and a clear trust boundary.
- No management interface is reachable from guest, IoT, or the public internet.
- DNS failure does not take down the operator's ability to recover locally.
- DHCP scope changes were tested on one client before broad rollout.
- VPN clients receive only the routes and DNS settings they need.
- Firewall rules are default-deny between zones, with named exceptions.
- The operator can still reach gateway, switch, AP, DNS, and VPN admin surfaces.
- Rollback is documented in the same vocabulary as the chosen platform UI or
  CLI.

## Anti-Patterns

- Segmenting networks before knowing which switch ports and SSIDs carry which
  VLANs.
- Moving the admin workstation off the only reachable management network.
- Pointing all DHCP scopes at a Pi-hole before testing fallback DNS.
- Publishing NAS, DNS, router, or hypervisor management directly to the
  internet.
- Treating VPN access as equivalent to full trusted-LAN access.
- Adding allow-all firewall rules temporarily and forgetting to remove them.
- Copying commands from another vendor or firmware version without checking the
  exact platform syntax.

## See Also

- Skill: `homelab-network-setup`
- Skill: `network-config-validation`
- Skill: `network-interface-health`
