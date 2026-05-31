---
name: homelab-pihole-dns
description: Pi-hole installation, blocklist management, DNS-over-HTTPS setup, DHCP integration, local DNS records, and troubleshooting broken DNS resolution on a home network.
origin: community
---

# Homelab Pi-hole DNS

Pi-hole is a network-wide DNS ad blocker that runs on a Raspberry Pi or any Linux host.
Every device on your network gets ad and malware domain blocking automatically — no browser
extension needed.

## When to Use

- Installing Pi-hole on a Raspberry Pi or Linux host
- Configuring Pi-hole as the DNS server for a home network
- Adding or managing blocklists
- Setting up DNS-over-HTTPS (DoH) upstream resolvers
- Creating local DNS records (e.g. `nas.home.lan`, `pi.home.lan`)
- Troubleshooting devices that lose internet access after Pi-hole is installed
- Running Pi-hole alongside or instead of DHCP

## How Pi-hole Works

```
Normal flow (without Pi-hole):
  Device → requests ads.tracker.com → ISP DNS → real IP → ads load

With Pi-hole:
  Device → requests ads.tracker.com → Pi-hole DNS → blocked (returns 0.0.0.0) → no ad

All DNS queries go through Pi-hole first.
Pi-hole checks against blocklists.
Blocked domains return a null response — the ad/tracker never loads.
Allowed domains get forwarded to your upstream resolver (Cloudflare, Google, etc.).
```

## Installation

### Docker (Recommended)

Docker is the easiest way to install Pi-hole and makes updates and backups
straightforward.

```yaml
# docker-compose.yml
services:
  pihole:
    image: pihole/pihole:<pinned-release-tag>
    container_name: pihole
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "80:80/tcp"          # Web admin
    environment:
      TZ: "America/New_York"
      WEBPASSWORD: "${PIHOLE_WEBPASSWORD}"   # set via .env file or secret
      PIHOLE_DNS_: "1.1.1.1;1.0.0.1"
      DNSMASQ_LISTENING: "all"
    volumes:
      - "./etc-pihole:/etc/pihole"
      - "./etc-dnsmasq.d:/etc/dnsmasq.d"
    restart: unless-stopped
    cap_add:
      - NET_ADMIN              # only needed if Pi-hole will serve DHCP
```

Replace `<pinned-release-tag>` with a current Pi-hole release tag before deploying.
Avoid `latest` for long-lived DNS infrastructure so upgrades are deliberate and
reviewable.

Set `PIHOLE_WEBPASSWORD` in a `.env` file next to `docker-compose.yml`, chmod it to
`600`, and keep it out of git — do not put the password directly in the compose file.

Access web admin at: `http://<pi-ip>/admin`

### Bare-Metal Install (Raspberry Pi OS / Debian / Ubuntu)

Pi-hole requires a static IP before installing.

```bash
# Step 1: Assign a static IP (edit /etc/dhcpcd.conf on Pi OS)
sudo nano /etc/dhcpcd.conf
# Add at the bottom:
interface eth0
static ip_address=192.168.3.2/24
static routers=192.168.3.1
static domain_name_servers=192.168.3.1

# Step 2: Download and inspect the installer before running it.
# Prefer the package or installer path documented by Pi-hole for your OS/version.
curl -sSL https://install.pi-hole.net -o pi-hole-install.sh
less pi-hole-install.sh   # review before proceeding

# Step 3: Run
bash pi-hole-install.sh

# Follow the interactive installer:
#   1. Select network interface (eth0 for wired — recommended)
#   2. Select upstream DNS (Cloudflare or leave default — can change later)
#   3. Confirm static IP
#   4. Install the web admin interface (recommended)
#   5. Note the admin password shown at the end
```

## Pointing Your Network at Pi-hole

```
# Method 1: Change DNS in your router DHCP settings (recommended)
  Router admin UI → DHCP Settings → DNS Server
  Primary DNS: 192.168.3.2  (Pi-hole IP)
  Secondary DNS: leave blank for strict blocking, or use a second Pi-hole.
                 A public fallback such as 1.1.1.1 improves availability during
                 rollout but can bypass blocking because clients may query it.

  All devices get Pi-hole as DNS automatically on next DHCP renewal.
  Force renewal: reconnect Wi-Fi or run 'sudo dhclient -r && sudo dhclient' on Linux

# Method 2: Per-device DNS (useful for testing before network-wide rollout)
  Windows: Control Panel → Network Adapter → IPv4 Properties → set DNS manually
  macOS: System Settings → Network → Details → DNS → set manually
  Linux: /etc/resolv.conf or NetworkManager

# Method 3: Pi-hole as DHCP server (replaces router DHCP)
  Pi-hole admin → Settings → DHCP → Enable
  Disable DHCP on your router first — two DHCP servers on the same network cause conflicts
  Advantage: hostname resolution works automatically (devices register their names)
```

## Blocklist Management

```
# Pi-hole admin → Adlists → Add new adlist

# Recommended blocklists:
  https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts
  # default — 200k+ domains

  https://blocklistproject.github.io/Lists/malware.txt
  # malware domains

  https://blocklistproject.github.io/Lists/tracking.txt
  # tracking/telemetry

# After adding a list:
  Tools → Update Gravity  (downloads and compiles all blocklists)

# If a site is blocked that should not be (false positive):
  Pi-hole admin → Whitelist → Add domain
  Example: api.my-legitimate-service.com

# Check what is being blocked in real time:
  Dashboard → Query Log  (live DNS query stream with block/allow status)
```

## DNS-over-HTTPS Upstream

DNS-over-HTTPS encrypts your DNS queries so your ISP cannot see what sites you resolve.

```bash
# Install cloudflared (Cloudflare's DoH proxy).
# Prefer Cloudflare's package repository for automatic signed package verification.
# If you download a binary directly, pin a release version and verify its checksum.
CLOUDFLARED_VERSION="<pinned-version>"
curl -LO "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-arm64"
# Verify the checksum/signature from Cloudflare's release notes before installing.
sudo mv cloudflared-linux-arm64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# Create cloudflared config
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml << EOF
proxy-dns: true
proxy-dns-port: 5053
proxy-dns-upstream:
  - https://1.1.1.1/dns-query
  - https://1.0.0.1/dns-query
EOF

# Create systemd service
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared

# Now point Pi-hole at the local DoH proxy:
#   Pi-hole admin → Settings → DNS → Custom upstream DNS
#   Set to: 127.0.0.1#5053
#   Uncheck all other upstream resolvers
```

## Local DNS Records

Make your services reachable by name (e.g. `nas.home.lan`, `grafana.home.lan`).

> **Domain name note:** `.home.lan` is widely used in homelabs and works in practice.
> The IETF-reserved suffix for local use is `.home.arpa` (RFC 8375) — use that to
> follow the standard. Avoid `.local` for Pi-hole DNS records as it conflicts with
> mDNS/Bonjour.

```
# Pi-hole admin → Local DNS → DNS Records

  Domain              IP
  nas.home.lan        192.168.30.10
  pi.home.lan         192.168.30.2
  grafana.home.lan    192.168.30.3
  proxmox.home.lan    192.168.30.4

# From any device on your network:
  ping nas.home.lan        → 192.168.30.10
  http://grafana.home.lan  → your Grafana dashboard

# For subdomains, add a CNAME:
  Pi-hole admin → Local DNS → CNAME Records
  Domain: portainer.home.lan → Target: pi.home.lan
```

## Troubleshooting

```bash
# Pi-hole blocking something it should not
pihole -q example.com          # Check if domain is blocked and which list
pihole -w example.com          # Whitelist immediately

# DNS not resolving at all
pihole status                  # Check if pihole-FTL is running
dig @192.168.3.2 google.com   # Test DNS directly against Pi-hole

# Restart Pi-hole DNS
pihole restartdns

# Check query logs for a specific device
pihole -t                      # Live tail of all queries
# Or filter by client in the web admin Query Log

# Pi-hole gravity update (refresh blocklists)
pihole -g
```

## Anti-Patterns

```
# BAD: Depending on one Pi-hole without a recovery path
# If Pi-hole crashes or the Pi loses power, DNS can stop working
# GOOD: Keep a documented router fallback for rollback during setup
# BETTER: Run two Pi-hole instances for redundancy; avoid public fallback DNS for strict blocking

# BAD: Installing Pi-hole without a static IP
# If the Pi gets a new DHCP IP, all devices lose DNS
# GOOD: Set static IP first, then install Pi-hole

# BAD: Enabling Pi-hole DHCP without disabling the router's DHCP first
# Two DHCP servers on the same network hand out conflicting IPs
# GOOD: Disable router DHCP, then enable Pi-hole DHCP

# BAD: Never updating gravity (blocklists)
# New ad and malware domains accumulate — stale lists miss them
# GOOD: Schedule weekly gravity update: pihole -g (or enable in Settings → API)
```

## Best Practices

- Give the Pi a static IP or DHCP reservation before installing Pi-hole
- Use Pi-hole as primary DNS; for redundancy, add a second Pi-hole instead of a
  public resolver if you need strict blocking
- Enable DoH (DNS-over-HTTPS) with cloudflared for encrypted upstream queries
- Set `home.lan` as your local domain and create DNS records for all your services
- Review the Query Log occasionally — blocked queries show you what devices are doing

## Related Skills

- homelab-network-setup
- homelab-vlan-segmentation
- homelab-wireguard-vpn
