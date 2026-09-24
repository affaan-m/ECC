---
name: homelab-vlan-segmentation
description: ホームラボVLANセグメンテーション、ネットワーク分離、アクセス制御、およびトラフィック管理。
origin: community
---

# Homelab VLAN Segmentation

How to split a home network into isolated VLANs so IoT devices, guests, and your main
PCs cannot talk to each other. The most impactful security upgrade for a home network.

All firewall rules shown here add isolation between segments — they do not remove
existing protections. Apply changes in a maintenance window and verify connectivity
between segments after each step before moving on.

## When to Use

- Setting up VLANs on a home network for the first time
- Isolating IoT devices (smart bulbs, cameras, TVs) from trusted devices
- Creating a guest Wi-Fi network that cannot reach home devices
- Explaining how VLANs work to someone unfamiliar with the concept
- Configuring trunk ports, access ports, and SSID-to-VLAN mapping
- Troubleshooting inter-VLAN routing or firewall rule issues on pfSense/OPNsense/UniFi

## How It Works

```
Without VLANs — flat network:
  All devices on 192.168.1.0/24
  Smart TV (potential malware) → can reach your NAS, PCs, everything

With VLANs:
  VLAN 10 — Trusted    192.168.10.0/24  (PCs, phones, laptops)
  VLAN 20 — IoT        192.168.20.0/24  (smart TV, bulbs, cameras)
  VLAN 30 — Servers    192.168.30.0/24  (NAS, Pi, VMs)
  VLAN 40 — Guest      192.168.40.0/24  (visitor Wi-Fi)
  VLAN 99 — Management 192.168.99.0/24  (switch/AP web UIs)

  Smart TV → blocked from reaching 192.168.10.0/24 and 192.168.30.0/24
  Guests → internet only, cannot see any home devices
```

## VLAN Design Template

```
VLAN  Name        Subnet              Gateway         Purpose
10    trusted     192.168.10.0/24     192.168.10.1    PCs, phones, laptops
20    iot         192.168.20.0/24     192.168.20.1    Smart home devices
30    servers     192.168.30.0/24     192.168.30.1    NAS, Pi, self-hosted
40    guest       192.168.40.0/24     192.168.40.1    Visitor Wi-Fi
99    management  192.168.99.0/24     192.168.99.1    Network gear web UIs
```

## Examples

**Typical homelab with UniFi AP and managed switch:**

```
Scenario: 3-bedroom house, UniFi Dream Machine + UniFi 8-port switch + 2 APs

VLAN 10 — Trusted    192.168.10.0/24   MacBook, iPhones, iPad
VLAN 20 — IoT        192.168.20.0/24   Nest thermostat, Philips Hue, Ring doorbell, smart TVs
VLAN 30 — Servers    192.168.30.0/24   Synology NAS (192.168.30.10), Pi-hole (192.168.30.2)
VLAN 40 — Guest      192.168.40.0/24   Visitor Wi-Fi — internet only

SSID → VLAN mapping:
  "Home"      → VLAN 10 (WPA2, strong password, trusted devices only)
  "IoT"       → VLAN 20 (WPA2, separate password, printed on router for setup)
  "Guest"     → VLAN 40 (WPA2, simple password you can share freely)

Switch port behavior:
  Port 1  → trunk to router (tagged VLANs 10,20,30,40,99)
  Port 2  → trunk to APs (tagged VLANs 10,20,40; AP handles per-SSID tagging)
  Port 3  → access VLAN 30 (NAS — untagged, no VLAN awareness needed)
  Port 4  → access VLAN 30 (Pi-hole — untagged)
  Port 5–8 → access VLAN 10 (wired workstations)

Firewall rules applied (all rules add isolation, none remove existing protections):
  IoT → Trusted: BLOCK
  IoT → Servers: BLOCK except 192.168.30.2:53 (Pi-hole DNS allowed)
  IoT → Internet: ALLOW
  Guest → Local networks: BLOCK
  Guest → Internet: ALLOW
  Trusted → everywhere: ALLOW
```

## UniFi Configuration

### Create Networks in UniFi Controller

```
Settings → Networks → Create New Network

For each VLAN:
  Name: IoT
  Purpose: Corporate  (gives DHCP + routing)
  VLAN ID: 20
  Network: 192.168.20.0/24
  Gateway IP: 192.168.20.1
  DHCP: Enable
  DHCP Range: 192.168.20.100 – 192.168.20.254
```

### Map SSIDs to VLANs (UniFi)

```
Settings → WiFi → Create New WiFi

  Name: IoT-Network
  Password: <separate password>
  Network: IoT  ← select your VLAN here
  # All devices connecting to this SSID land in VLAN 20

  Name: Guest
  Password: <guest password>
  Network: Guest
  Guest Policy: Enable  ← isolates guests from each other too
```

### UniFi Firewall Rules (Traffic Rules)

```
Settings → Traffic & Security → Traffic Rules

# Block IoT from reaching Trusted VLAN
  Action: Block
  Category: Local Network
  Source: IoT (192.168.20.0/24)
  Destination: Trusted (192.168.10.0/24)

# Allow IoT to reach internet only
  Action: Allow
  Source: IoT
  Destination: Internet

# Block Guest from all local networks
  Action: Block
  Source: Guest
  Destination: Local Networks
```

## pfSense / OPNsense Configuration

### Create VLANs

```
Interfaces → Assignments → VLANs → Add

  Parent Interface: em1  (your LAN NIC)
  VLAN Tag: 20
  Description: IoT

# Repeat for each VLAN, then assign each VLAN to an interface:
Interfaces → Assignments → Add
  Select the VLAN you created → click Add
  Enable the interface, set IP to gateway address (192.168.20.1/24)
```

### DHCP for Each VLAN

```
Services → DHCP Server → Select your VLAN interface

  Enable DHCP
  Range: 192.168.20.100 to 192.168.20.254
  DNS Servers: 192.168.30.2  ← Pi-hole IP if you have one
```

### Firewall Rules (pfSense/OPNsense)

```
# Rules are processed top-to-bottom, first match wins.

# On the IoT interface (VLAN 20):
  Rule 1: Allow IoT → Pi-hole DNS  ← MUST come before the RFC1918 block rule
    Protocol: UDP/TCP
    Source: IoT net
    Destination: 192.168.30.2 port 53
    Action: Allow

  Rule 2: Block IoT → RFC1918 (all private IP ranges)
    Protocol: any
    Source: IoT net
    Destination: RFC1918  (192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12)
    Action: Block

  Rule 3: Allow IoT → internet
    Protocol: any
    Source: IoT net
    Destination: any
    Action: Allow

# On the Trusted interface (VLAN 10):
  Allow all (trusted devices can reach everything)
    Source: Trusted net
    Destination: any
    Action: Allow

# Additional exceptions for IoT devices that need specific local services:
  Insert before Rule 2 (the RFC1918 block):
    Protocol: TCP
    Source: IoT net
    Destination: 192.168.30.x port 8123  ← Home Assistant
    Action: Allow
```

## MikroTik Configuration

```
# Step 1: Create a bridge with VLAN filtering enabled
/interface bridge
add name=bridge vlan-filtering=yes

# Step 2: Add physical ports to the bridge
# Trunk port to router/uplink (tagged for all VLANs)
/interface bridge port
add bridge=bridge interface=ether1 frame-types=admit-only-vlan-tagged

# Access port for trusted devices (untagged VLAN 10)
/interface bridge port
add bridge=bridge interface=ether2 pvid=10 frame-types=admit-only-untagged-and-priority-tagged

# Access port for IoT devices (untagged VLAN 20)
/interface bridge port
add bridge=bridge interface=ether3 pvid=20 frame-types=admit-only-untagged-and-priority-tagged

# Step 3: Define which VLANs are allowed on which ports
/interface bridge vlan
add bridge=bridge tagged=ether1 untagged=ether2 vlan-ids=10
add bridge=bridge tagged=ether1 untagged=ether3 vlan-ids=20

# Step 4: Create VLAN interfaces on the bridge (gateway IPs)
/interface vlan
add interface=bridge name=vlan10 vlan-id=10
add interface=bridge name=vlan20 vlan-id=20

# Step 5: Assign gateway IPs
/ip address
add interface=vlan10 address=192.168.10.1/24
add interface=vlan20 address=192.168.20.1/24

# Step 6: DHCP pools and servers
/ip pool
add name=pool-trusted ranges=192.168.10.100-192.168.10.254
add name=pool-iot ranges=192.168.20.100-192.168.20.254

/ip dhcp-server
add interface=vlan10 address-pool=pool-trusted name=dhcp-trusted
add interface=vlan20 address-pool=pool-iot name=dhcp-iot

/ip dhcp-server network
add address=192.168.10.0/24 gateway=192.168.10.1
add address=192.168.20.0/24 gateway=192.168.20.1

# Step 7: Firewall — block IoT from reaching trusted VLAN
/ip firewall filter
add chain=forward src-address=192.168.20.0/24 dst-address=192.168.10.0/24 \
    action=drop comment="Block IoT to Trusted"
```

## Switch Trunk vs Access Ports

```
# Trunk port: carries multiple VLANs (tagged) — connects switch-to-switch, switch-to-router, switch-to-AP
# Access port: carries one VLAN (untagged) — connects to end devices (PC, camera, NAS)

# A managed switch port connected to your router should be a trunk:
  Allowed VLANs: 10, 20, 30, 40, 99

# A port connecting to a PC should be an access port:
  VLAN: 10 (trusted)
  No tagging — the PC does not know or care about VLANs

# A port connecting to an AP must be a trunk:
  The AP tags traffic from each SSID with the right VLAN ID
  Allowed VLANs: 10, 20, 40  (whichever SSIDs the AP serves)
```

## Anti-Patterns

```
# BAD: Creating VLANs without adding firewall rules
# VLANs without firewall rules do not provide security — inter-VLAN routing is open by default
# GOOD: Add explicit block rules immediately after creating VLANs

# BAD: Putting the Pi-hole in the IoT VLAN
# IoT devices can reach it but trusted devices cannot (without extra rules)
# GOOD: Pi-hole in the Servers VLAN with a rule allowing all VLANs to reach port 53

# BAD: Native VLAN equals management VLAN
# Untagged traffic landing in your management VLAN enables VLAN hopping attacks
# GOOD: Use a dedicated unused VLAN as native (e.g. VLAN 999), keep management traffic tagged

# BAD: Same Wi-Fi password for IoT SSID and trusted SSID
# Anyone who learns the password can connect IoT devices to the wrong segment
```

## Best Practices

- Start with 4 VLANs: Trusted, IoT, Servers, Guest — add more as needed
- Put Pi-hole in the Servers VLAN (192.168.30.x)
- Add a firewall rule allowing DNS (port 53) from all VLANs to the Pi-hole IP — before any RFC1918 block rule
- Test isolation after every rule change: from the IoT VLAN, try to ping a trusted device — it should fail
- Use a management VLAN for switch and AP web UIs and restrict access to the Trusted VLAN only
- Document your VLAN design in a table (VLAN ID, name, subnet, purpose)

## Related Skills

- homelab-network-setup
- homelab-pihole-dns
- homelab-wireguard-vpn
