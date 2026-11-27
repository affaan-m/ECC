---
name: homelab-network-setup
description: ホームラボネットワーク基盤設定、デバイス設定、接続性、およびネットワークセグメンテーション。
origin: community
---

# Homelab Network Setup

Use this skill to design a home or small-lab network that can grow without
needing a full rebuild.

## When to Use

- Planning a new home network or redesigning an ISP-router-only setup.
- Choosing gateway, switch, and access point roles.
- Designing IP ranges, DHCP scopes, static reservations, and DNS.
- Preparing for future VLANs, Pi-hole, NAS, lab servers, or VPN access.
- Troubleshooting a new network that has double NAT, unstable Wi-Fi, or changing
  server addresses.

## How It Works

Start by separating device roles:

```text
Internet
  |
Modem or ONT
  |
Gateway or router      NAT, firewall, DHCP, DNS, inter-VLAN routing
  |
Managed switch         wired clients, AP uplinks, optional VLAN trunks
  |
Access points          Wi-Fi only; ideally wired backhaul
Servers and NAS        stable addresses, DNS names, monitoring
Clients and IoT        DHCP pools, isolated later if VLANs are available
```

Pick a gateway that matches the operator, not just the feature checklist:

| Option | Best fit | Notes |
| --- | --- | --- |
| ISP router | Basic internet only | Limited control and often poor VLAN support |
| UniFi gateway | Managed home network | Good UI, ecosystem lock-in |
| OPNsense or pfSense | Flexible homelab | Strong VLAN, firewall, VPN, and DNS control |
| MikroTik | Advanced network users | Powerful, but easy to misconfigure |
| Linux router | Tinkerers | Document rollback before using as primary gateway |

## IP Plan

Avoid the most common default, `192.168.1.0/24`, when you expect to use VPNs.
It often conflicts with hotels, offices, and ISP routers.

```text
Example small homelab plan:

192.168.10.0/24  trusted clients
192.168.20.0/24  IoT and media devices
192.168.30.0/24  servers and NAS
192.168.40.0/24  guest Wi-Fi
192.168.99.0/24  network management

Gateway convention: .1
Infrastructure reservations: .2 through .49
Dynamic DHCP pool: .50 through .240
Spare room: .241 through .254
```

Use `home.arpa` for local names. It is reserved for home networks and avoids the
leakage/conflict problems of ad hoc names like `home.lan`.

```text
nas.home.arpa
pihole.home.arpa
gateway.home.arpa
switch-01.home.arpa
```

## DHCP And DNS

- Use DHCP reservations for anything you SSH into, bookmark, monitor, or expose
  as a service.
- Hand out the gateway as DNS until a local resolver is intentionally deployed.
- If using Pi-hole or another DNS filter, give it a reservation first, then point
  DHCP DNS options at that address.
- Keep a small static/reserved range per subnet so replacements do not collide
  with dynamic leases.

## Cabling And Wi-Fi

- Prefer wired AP backhaul over mesh when you can run Ethernet.
- Use a PoE switch for APs and cameras if the budget allows it.
- Label both ends of each cable and keep a simple port map.
- Put the gateway, switch, DNS server, and NAS on UPS power if outages are common.

## Examples

### Beginner Upgrade

Goal: Keep the ISP router but stabilize a small lab.

1. Set DHCP reservations for NAS, Pi, and any SSH hosts.
2. Move local names to `home.arpa`.
3. Disable duplicate DHCP servers on secondary routers or APs.
4. Wire the main AP instead of relying on wireless backhaul.

### VLAN-Ready Plan

Goal: Prepare for future segmentation without enabling it immediately.

1. Choose non-overlapping /24 ranges for trusted, IoT, servers, guest, and
   management.
2. Reserve .1 for the gateway and .2-.49 for infrastructure on every subnet.
3. Buy a gateway and switch that support VLANs and inter-VLAN firewall rules.
4. Document which SSIDs and switch ports will eventually map to each network.

## Anti-Patterns

- Double NAT without a reason or documentation.
- Using `192.168.1.0/24` when VPN access is planned.
- Dynamic addresses for NAS, Pi-hole, Home Assistant, or other service hosts.
- Consumer routers repurposed as APs while their DHCP servers are still enabled.
- Flat networks with cameras, smart plugs, laptops, and servers all sharing the
  same trust boundary.

## See Also

- Skill: `network-interface-health`
- Skill: `network-config-validation`
