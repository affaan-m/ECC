ARG NODE_IMAGE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
ARG OS_IMAGE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

FROM ${NODE_IMAGE} AS node-runtime
FROM ${OS_IMAGE}

ARG DISTRO=debian
ARG CLAUDE_CODE_VERSION=2.1.220

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      bash \
      ca-certificates \
      git \
      libatomic1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/ /usr/local/

RUN getent passwd 1000 >/dev/null \
    && getent group 1000 >/dev/null

RUN npm install --global --include=optional --ignore-scripts \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@iarna/toml@2.2.5" \
      "ajv@8.20.0" \
      "sql.js@1.14.1" \
    && global_node_modules="$(npm root --global)" \
    && node "${global_node_modules}/@anthropic-ai/claude-code/install.cjs" \
    && npm cache clean --force \
    && claude --version

RUN mkdir -p /workspace \
    && chown 1000:1000 /workspace

ENV CLAUDE_CONFIG_DIR=/tmp/ecc-claude-config
ENV DISABLE_AUTOUPDATER=1
ENV HOME=/tmp/ecc-home
ENV NODE_PATH=/usr/local/lib/node_modules

WORKDIR /workspace
USER 1000:1000

LABEL org.opencontainers.image.title="ECC plugin setup test (${DISTRO})"
