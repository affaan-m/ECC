ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
ARG CODEX_VERSION=0.154.0
WORKDIR /consumer
COPY package.tgz /tmp/ecc-context-package.tgz
RUN npm install --ignore-scripts --omit=dev --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1 /tmp/ecc-context-package.tgz \
    && task_arch=$(node -p process.arch) \
    && npm install --global --ignore-scripts --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1 \
      @openai/codex@${CODEX_VERSION} "@openai/codex-linux-${task_arch}@npm:@openai/codex@${CODEX_VERSION}-linux-${task_arch}" \
    && codex --version
COPY native-probe.js /consumer/node_modules/ecc-universal/docker/context-profiles/native-probe.js
COPY native-switch-probe.js /consumer/node_modules/ecc-universal/docker/context-profiles/native-switch-probe.js
COPY packed-smoke.js /consumer/node_modules/ecc-universal/docker/context-profiles/packed-smoke.js
COPY context-carrier-fixture.js /consumer/node_modules/ecc-universal/tests/lib/helpers/context-carrier-fixture.js
COPY expected-carriers.json /tmp/ecc-expected-carriers.json
ENV ECC_EXPECTED_CARRIERS=/tmp/ecc-expected-carriers.json
ENV PATH="/consumer/node_modules/.bin:${PATH}"
USER node
CMD ["node", "/consumer/node_modules/ecc-universal/docker/context-profiles/packed-smoke.js"]
