---
name: ecc-docker
description: Build and review Dockerfiles and Compose services, container networking, volumes, development images, and isolation.
---

# Docker and Compose

Match the deployment target, runtime, architecture, and existing image policy.
Keep secrets out of layers, limit runtime privileges, handle signals and shutdown,
and distinguish bind mounts from persistent volumes. Check exposed ports and
health checks against the real application behavior.

For build stages, cache behavior, Compose wiring, or container troubleshooting,
read [Docker patterns](references/docker.md).
Validate Compose syntax and build/test the affected services when practical.
Linux containers do not validate native macOS or Windows APIs.
