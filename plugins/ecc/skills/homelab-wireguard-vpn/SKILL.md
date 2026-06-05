---
name: homelab-wireguard-vpn
description: WireGuard VPN server setup, peer configuration, key generation, split tunneling vs full tunnel routing, and remote access to a home network from mobile and laptop clients.
origin: community
---

# Homelab WireGuard VPN

WireGuard is a fast, modern VPN protocol. It is the right choice for remote access to a
home network — simpler to configure than OpenVPN and faster than most alternatives.

All configuration examples show common setups. Review each command — especially the
iptables forwarding rules and key file permissions — before applying them to your
system, and make changes in a maintenance window.

## When to Use

- Setting up WireGuard server on a Raspberry Pi, Linux host, pfSense, or router
- Generating WireGuard keypairs and writing peer config files
- Configuring remote access from a phone or laptop to a home network
- Explaining split tunneling (route only home traffic) vs full tunnel (route all traffic)
- Troubleshooting WireGuard connections that will not come up
- Automating peer configuration generation for multiple clients

## How WireGuard Works

```
Your phone (WireGuard client)
    │
    │  Encrypted UDP tunnel (port 51820)
    │
Your home router (WireGuard server — needs a public IP or DDNS)
    │
    Your home network (192.168.1.0/24, NAS, Pi, etc.)

Every device has a keypair (public + private key).
The server knows each client's public key.
The client knows the server's public key + endpoint (IP:port).
Traffic is encrypted end-to-end with no central server or certificate authority.
```

## Server Setup (Linux)

```bash
# Install WireGuard
sudo apt update && sudo apt install wireguard -y

# Generate server keypair — create files with private permissions from the start
sudo mkdir -p /etc/wireguard
sudo sh -c 'umask 077; wg genkey > /etc/wireguard/server_private.key'
sudo sh -c 'wg pubkey < /etc/wireguard/server_private.key > /etc/wireguard/server_public.key'

# Write server config — substitute the actual private key value
# Do not store private keys in version control or share them
sudo tee /etc/wireguard/wg0.conf << 'EOF'
[Interface]
Address = 10.8.0.1/24              # VPN subnet — server gets .1
ListenPort = 51820
PrivateKey = <paste_server_private_key_here>

# Scoped forwarding rules: allow VPN traffic in/out, not a blanket FORWARD ACCEPT
PostUp   = iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT
PostUp   = iptables -A FORWARD -i eth0 -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostUp   = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -o eth0 -j ACCEPT
PostDown = iptables -D FORWARD -i eth0 -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
# Phone — replace with the actual phone public key
PublicKey = <phone_public_key>
AllowedIPs = 10.8.0.2/32

[Peer]
# Laptop — replace with the actual laptop public key
PublicKey = <laptop_public_key>
AllowedIPs = 10.8.0.3/32
EOF
sudo chmod 600 /etc/wireguard/wg0.conf

# Replace eth0 with your actual outbound interface name
# Check with: ip route show default

# Enable IP forwarding (required for routing traffic through the server)
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-wireguard.conf
sudo sysctl --system

# Start WireGuard and enable on boot
sudo wg-quick up wg0
sudo systemctl enable wg-quick@wg0
```

## Client Configuration

```bash
# Generate a unique keypair for each client device
# Run on the client, or on the server and transfer the private key securely — never in plaintext
umask 077
wg genkey | tee phone_private.key | wg pubkey > phone_public.key

# Client config file (phone_wg0.conf):
[Interface]
PrivateKey = <phone_private_key>
Address = 10.8.0.2/32
DNS = 192.168.1.2                  # Optional: use Pi-hole for DNS over the tunnel

[Peer]
PublicKey = <server_public_key>
Endpoint = your-home-ip.ddns.net:51820  # Your public IP or DDNS hostname
AllowedIPs = 192.168.1.0/24            # Split tunnel: only home network traffic
# AllowedIPs = 0.0.0.0/0, ::/0        # Full tunnel: all traffic through VPN

PersistentKeepalive = 25              # Keep NAT hole open (required for mobile clients)
```

## Split Tunnel vs Full Tunnel

```
# Split tunnel: AllowedIPs = 192.168.1.0/24
  Only traffic destined for your home network goes through the VPN.
  Internet traffic (YouTube, Spotify) goes directly — better performance on mobile.
  Best for: "I just want to reach my NAS and Pi from anywhere."

# Full tunnel: AllowedIPs = 0.0.0.0/0, ::/0
  ALL traffic goes through your home internet connection.
  Useful for: piggybacking home DNS/Pi-hole ad blocking.
  Downside: home upload speed becomes your bottleneck everywhere.

# Multi-subnet split tunnel (most common homelab use case):
  AllowedIPs = 192.168.10.0/24, 192.168.20.0/24, 192.168.30.0/24, 10.8.0.0/24
  Routes all your VLANs through the tunnel; internet stays direct.
```

## Key Generation and Peer Management

```python
import subprocess

def generate_keypair() -> tuple[str, str]:
    """Generate a WireGuard keypair. Returns (private_key, public_key)."""
    private = subprocess.check_output(["wg", "genkey"]).decode().strip()
    public = subprocess.run(
        ["wg", "pubkey"], input=private.encode(), capture_output=True
    ).stdout.decode().strip()
    return private, public

def generate_preshared_key() -> str:
    return subprocess.check_output(["wg", "genpsk"]).decode().strip()

def build_client_config(
    client_private_key: str,
    client_vpn_ip: str,       # e.g. "10.8.0.3"
    server_public_key: str,
    server_endpoint: str,     # e.g. "home.example.com:51820"
    allowed_ips: str = "192.168.1.0/24",
    dns: str = "",
) -> str:
    dns_line = f"DNS = {dns}\n" if dns else ""
    return f"""[Interface]
PrivateKey = {client_private_key}
Address = {client_vpn_ip}/32
{dns_line}
[Peer]
PublicKey = {server_public_key}
Endpoint = {server_endpoint}
AllowedIPs = {allowed_ips}
PersistentKeepalive = 25
"""

def build_server_peer_block(
    client_public_key: str,
    client_vpn_ip: str,
    comment: str = "",
) -> str:
    comment_line = f"# {comment}\n" if comment else ""
    return f"""
{comment_line}[Peer]
PublicKey = {client_public_key}
AllowedIPs = {client_vpn_ip}/32
"""
```

Keep private keys out of source control. If you use this script, write key material
to files with mode 600 and never log or print it.

## pfSense / OPNsense WireGuard

```
# pfSense: VPN → WireGuard → Add Tunnel
  Interface Keys: Generate (creates keypair automatically)
  Listen Port: 51820
  Interface Address: 10.8.0.1/24

# Add Peer (one per client):
  Public Key: <client public key>
  Allowed IPs: 10.8.0.2/32

# Assign the WireGuard interface:
  Interfaces → Assignments → Add (select wg0)
  Enable interface, no IP needed (it is set in the tunnel config)

# Firewall rules:
  WAN → Allow UDP port 51820 inbound (so clients can reach the server)
  WireGuard interface → Allow traffic to LAN networks you want reachable
```

## DDNS (Dynamic DNS) for Home Servers

Most home internet connections have a dynamic IP. Use DDNS so your VPN endpoint
stays reachable after an IP change.

```bash
# Option 1: Cloudflare DDNS — store credentials in a secrets file, not inline
# docker-compose entry using an env file:
  ddns-updater:
    image: qmcgaw/ddns-updater
    env_file: ./ddns.env   # store zone_id and token here, not in compose
    restart: unless-stopped

# ddns.env (chmod 600, not committed to git):
#   SETTINGS_CLOUDFLARE_ZONE_ID=your_zone_id
#   SETTINGS_CLOUDFLARE_TOKEN=your_api_token

# Option 2: DuckDNS (free, simple)
  Sign up at duckdns.org → get a token and subdomain (myhome.duckdns.org)
  Store token in /etc/ddns.env (mode 600), then use a small root-owned script:

  # /usr/local/bin/update-duckdns
  #!/bin/sh
  set -eu
  . /etc/ddns.env
  curl --fail --silent --show-error --max-time 10 \
    --get "https://www.duckdns.org/update" \
    --data-urlencode "domains=myhome" \
    --data-urlencode "token=${DUCKDNS_TOKEN}" \
    --data-urlencode "ip="

  # Cron job:
  */5 * * * * /usr/local/bin/update-duckdns >/dev/null 2>&1
```

## Troubleshooting

```bash
# Check WireGuard status and last handshake
sudo wg show

# If "latest handshake" is never or very old, the tunnel is not connected.
# Check:
# 1. Is UDP port 51820 open on the router/firewall?
sudo ufw status  # or check pfSense/UniFi firewall rules

# 2. Is the server public key in the client config correct?
sudo wg show wg0 public-key   # Compare to what is in the client config

# 3. Is IP forwarding enabled on the server?
cat /proc/sys/net/ipv4/ip_forward  # Should be 1

# 4. Does the client AllowedIPs cover the IP you are trying to reach?
# If AllowedIPs = 192.168.1.0/24 and you are trying to reach 192.168.3.5, it will not route.

# Check kernel logs for WireGuard errors
dmesg | grep wireguard

# Restart WireGuard
sudo wg-quick down wg0 && sudo wg-quick up wg0
```

## Anti-Patterns

```
# BAD: Storing private keys in version control or sharing them
# Private keys are equivalent to passwords — never commit them to git

# BAD: Using AllowedIPs = 0.0.0.0/0 on mobile without considering the impact
# Full tunnel routes all mobile traffic through your home upload — usually slow

# BAD: Not setting PersistentKeepalive on mobile clients
# Mobile clients behind NAT drop idle tunnels without it

# BAD: Opening port 51820 in the firewall but forgetting IP forwarding on the server
# Tunnel connects but no traffic routes — confusing to debug

# BAD: Sharing a keypair across multiple client devices
# Each device must have its own unique keypair — shared keys break the security model

# BAD: Using a broad "FORWARD ACCEPT" iptables rule
# Scope forwarding rules to the wg0 interface and direction only
```

## Best Practices

- Generate a unique keypair per client device — never reuse keys
- Use split tunneling (`AllowedIPs = <home subnets>`) for mobile
- Set `PersistentKeepalive = 25` on all mobile clients
- Use DDNS if your ISP assigns a dynamic IP; store credentials in env files, not inline
- Use scoped iptables forwarding rules (inbound on wg0 only) rather than a blanket FORWARD ACCEPT
- Add Pi-hole's IP as `DNS =` in client configs to get ad blocking over the VPN
- Rotate the server keypair periodically and update all client configs

## Related Skills

- homelab-network-setup
- homelab-vlan-segmentation
- homelab-pihole-dns
