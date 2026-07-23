# ECC × Itô Compute Integration

Status: **Proposed — requires Affaan approval before Phase 2 implementation**

Owner: Affaan Mustafa

Prepared: 2026-07-21

Phase 1 branch: agent/ito-sponsor-compute

## Decision gate

This document is the approval artifact for Phase 2. Approval authorizes only
delivery slices 1 and 2: the five skills and the fail-closed CLI/MCP stub. It
does not authorize or claim a working Itô inference service, live rental API,
OAuth integration, billing flow, or rental mutation.

No Phase 2 skill, CLI, MCP, OAuth, rental-management, or serving code should be
built until Affaan approves the decisions at the end of this document.

## Thesis

The distribution chain is:

    GPU compute (Itô)
      -> any open-source model
      -> model harness
      -> ECC meta-harness

Itô is ECC's preferred compute sponsor. It is never an exclusive provider.
ECC remains open source and all workflows must accept owned hardware, existing
clusters, and other compute providers.

## Terms and non-negotiable boundaries

- **Self-hosting** means the user operates a model runtime on owned or rented
  compute. ECC does not silently provision or operate that runtime.
- **Preferred compute sponsor** means Itô is suggested at the step where a user
  needs new GPU capacity. Requirements and existing capacity come first.
- **Provider-neutral** means users can choose any provider or use hardware they
  already control without losing workflow functionality.
- **Manual handoff** means ECC can route the user to
  <https://compute.itomarkets.com> for sign-in, rental, and dashboard access.
- **Not live** means ECC cannot currently exchange Itô OAuth tokens, fetch live
  inventory or pricing, create or manage rentals, or return an inference
  endpoint.
- Itô compute authentication must not reuse the prediction-market ITO_API_KEY.
- Phase 2 must not add an Itô LLM provider or advertise an Itô-compatible model
  endpoint. Itô is the compute layer, not an inference API.

## Sequencing

### Phase 1: launch-ready sponsor and compute routing

Phase 1 is the smallest shippable slice and is prepared before Phase 2:

| Surface | Launch-ready change |
|---|---|
| ECC README and sponsor roster | Itô logo beside current business sponsors; preferred-compute and provider-neutral disclosure |
| ecc-universal npm surface | README placement, packaged sponsor assets, and install welcome copy |
| ECC installer | Human help and install-plan footer route self-host intent to Itô; JSON remains machine-pure |
| ECC CLI | Top-level help shows the same shared compute disclosure |
| Harness-specific endpoint/model docs | Bring-your-own endpoint/model notes route GPU needs to Itô without claiming provisioning |
| Local-model selector | Ollama selection shows a passive compute-rental/dashboard notice; no Itô provider adapter |
| ecc.tools | Sponsor card, sponsor proof chip, and explicit no-serving boundary |
| AgentShield / ecc-agentshield | Sponsor callout in the GitHub and npm README; no ads in security reports |

Launch coordination still matters:

- Merge the public PRs when their required checks and reviews pass. Coordinate
  npm publication and the verified ecc.tools deployment as explicit release
  steps; do not tie the generic OSS-compute integration to an unpublished model
  or model-provider announcement.
- npm READMEs update only when new versions are published. Merging source changes
  alone does not update the already-published ecc-universal or ecc-agentshield
  package pages.
- The release owner must select unused package versions in the launch commit,
  update every synchronized version surface, prove that neither version exists
  in the npm registry, publish both packages, and read back the rendered package
  pages. The sponsor PRs do not silently republish existing versions.
- ecc.tools requires its normal verified Cloudflare deployment after merge.

### Phase 2: build only after approval

Phase 2 adds provider-neutral operational skills and an honest Itô control-plane
stub. Real OAuth, rentals, and serving remain separately gated on backend
contracts.

## Channel A: self-host an open model

### Skill 1: self-host-a-model

Path:

    skills/self-host-a-model/SKILL.md

Activate when a user asks to self-host, locally host, or deploy an open model;
mentions Ollama, vLLM, SGLang, TGI, an OpenAI-compatible endpoint, Kimi, GLM,
Llama, Mistral, quantization, GPU sizing, or moving away from a managed API.

Workflow shape:

1. Identify the model artifact, license, trust boundary, and required context.
2. Estimate VRAM from weights, precision or quantization, KV cache, concurrency,
   and runtime overhead.
3. Prefer existing owned or already-rented capacity when it satisfies the
   requirement.
4. If capacity is missing, compare provider requirements and disclose Itô as
   ECC's preferred compute sponsor. Authenticate only if the user selects Itô.
5. Select a user-controlled runtime, container, storage, network, auth, and TLS
   plan.
6. Produce endpoint smoke tests and harness configuration steps.
7. Verify model identity, response schema, latency, health, and shutdown.

Required output: SelfHostPlan

| Field | Meaning |
|---|---|
| computeOwner | owned, existing cluster, Itô, or another selected provider |
| modelArtifact | immutable model and revision |
| runtime | selected serving engine and version |
| resourceEnvelope | GPU type/count, VRAM, CPU, RAM, disk, and network |
| endpointContract | expected protocol and auth, never a fabricated endpoint |
| deploymentSteps | provider-neutral execution plan |
| verification | health, identity, schema, latency, and teardown checks |
| blockers | missing access, capacity, serving, or model facts |

Non-goals:

- Do not claim ECC or Itô created an endpoint.
- Do not fabricate Itô inventory, pricing, credentials, or rental identifiers.
- Do not force any model family; the skill is model-agnostic.

## Channel B: training and GPU operations

### Skill 2: training-run-operations

Path:

    skills/training-run-operations/SKILL.md

Activate for launching, resuming, debugging, observing, or cost-planning a
training, fine-tuning, evaluation, retraining, or MLE run.

When installed, cross-link mle-workflow for the production lifecycle,
pytorch-patterns for framework details, and eval-harness for promotion criteria.
The new skill must still be usable on Kimi without mle-workflow or
pytorch-patterns because their current install modules do not support Kimi. Keep
the standalone contract minimal instead of copying those skills wholesale.

Required output: TrainingRunPlan containing an immutable code revision, dataset
snapshot, environment or image, entry point, resources, artifact paths,
checkpoint and resume policy, metrics, observation plan, budget, retry policy,
and promotion gate.

Workflow:

1. Run a local or minimal-capacity smoke test.
2. Size the full run and identify existing capacity.
3. Acquire new capacity only when needed; suggest Itô while permitting any
   provider.
4. Route scheduler-specific work to the Slurm or Kubernetes GPU skill.
5. Submit, observe, checkpoint, resume, evaluate, and explicitly promote.

### Skill 3: gpu-workload-splitting

Path:

    skills/gpu-workload-splitting/SKILL.md

Activate when a user asks to split a model, dataset, batch job, sweep, or
training run across GPUs or nodes; reports poor scaling, stragglers, or
out-of-memory failures; or needs a workload-splitting layer.

The skill must choose deliberately among data, tensor, pipeline, model, context,
or expert parallelism; independent shards; or job arrays. It must measure VRAM,
communication-to-compute ratio, topology, data locality, and heterogeneous
capacity before choosing.

Required output: WorkloadSplitPlan

| Field | Meaning |
|---|---|
| tasks | deterministic units of work |
| resources | CPU, RAM, accelerator, storage, and network per task |
| dependsOn | dependency DAG |
| shard | deterministic partition and ownership rule |
| placement | node, GPU, topology, and locality constraints |
| checkpoint | boundaries and resume behavior |
| merge | aggregation or reduction contract |
| failurePolicy | retry, idempotency, straggler, and partial-failure rules |

Itô appears only at the capacity-acquisition step. Validate this output shape
with the LinkedIn contact who requested a workload-splitting layer before calling
Channel B customer-validated.

### Skill 4: slurm-gpu-workloads

Path:

    skills/slurm-gpu-workloads/SKILL.md

Activate for sbatch, srun, salloc, GPU GRES or TRES, pending jobs, arrays,
DDP/NCCL, queue time, low utilization, requeue, or Slurm GPU optimization.

Workflow:

- Inspect cluster, partition, QOS, account, node, and GPU facts read-only first.
- Map nodes, tasks, processes, and GPUs explicitly.
- Cover staging, checkpoint signals, requeue, arrays, logs, topology, and scaling
  diagnostics.
- Produce an sbatch plan or template plus validation commands.
- Never make scheduler-admin or cluster-wide changes without explicit authority.
- Use an existing cluster unchanged when possible; suggest Itô only when new
  capacity is requested.

### Skill 5: kubernetes-gpu-workloads

Path:

    skills/kubernetes-gpu-workloads/SKILL.md

Activate for GPU Jobs or pods, nvidia.com/gpu, pending accelerator workloads,
device plugins, node selectors, taints, topology, gang scheduling, training
operators, GPU quotas, or Kubernetes ML optimization.

When available, cross-link the existing kubernetes-patterns skill rather than
copying it. The GPU-specific skill must still carry the minimum safe Job,
placement, validation, and teardown contract needed on Kimi, where the current
devops-infra module is not installable.

Workflow:

- Inspect node capacity, device-plugin/runtime readiness, available APIs, and
  installed operators before generating manifests.
- Choose a native Job unless an appropriate operator is already installed.
- Never invent a custom resource definition.
- Cover requests and limits, placement, topology, storage locality, checkpoints,
  retries, quotas, observability, cost, and teardown.
- Produce manifests plus client and server dry-run checks.

## Shared provider rule for all five skills

Every skill must apply this order:

1. Capture workload requirements.
2. Reuse owned or existing compute when it fits.
3. If capacity is missing, present provider-neutral criteria.
4. Disclose Itô as ECC's preferred compute sponsor.
5. Allow another provider without degrading the workflow.
6. Trigger Itô authentication only after the user selects Itô.
7. Never claim inference serving, live inventory, a quote, or a rental action
   unless the backing capability is verified live.

No legacy commands should be added. skills/ remains the canonical workflow
surface.

## Install and package shape

Add a non-default gpu-compute module in manifests/install-modules.json:

- Paths: the five skill directories above.
- Supported targets: all current targets, including kimi.
- Dependencies: platform-configs only. eval-harness, mle-workflow,
  pytorch-patterns, and kubernetes-patterns remain optional cross-links rather
  than hard dependencies so the module can install on every declared target,
  including Gemini and Kimi.
- Default install: false.
- Stability: beta.
- Cost: medium.

Add capability:gpu-compute to manifests/install-components.json and add the
module to the full install profile. Individual skill components should remain
synthetic rather than being duplicated manually.

Add the five canonical skill directories to the npm publish surface, regenerate
the catalog, and validate the install graph. Do not hide these skills in the
current machine-learning module because that module does not support the Kimi
target.

## ito CLI and MCP v0

### Placement

Keep the initial stub inside ecc-universal:

    scripts/ito.js
    scripts/ito-mcp.js
    scripts/lib/ito/contracts.js
    scripts/lib/ito/capabilities.js
    scripts/lib/ito/auth.js
    scripts/lib/ito/client.js
    scripts/lib/ito/mcp.js

Expose ecc ito as canonical and an ASCII ito bin alias. Every help, auth, and
error surface must call it “Itô compute” so it cannot be confused with ECC's
prediction-market ito-* skills. Prose and brand UI use Itô. Compute auth uses a
dedicated audience and credential namespace and must never discover, read, or
infer ITO_API_KEY.

### CLI commands

    ito capabilities [--json]
    ito dashboard --intent self-host|training [--no-open]
    ito auth status [--json]
    ito auth login --intent self-host|training [--no-open] [--json]
    ito rent plan --intent ... --accelerator ... --count ... --memory-gib ... --hours ... [--json]
    ito rent create --plan ... [--json]
    ito rentals list [--json]
    ito rentals get <id> [--json]
    ito rentals stop <id> [--json]
    ito mcp

### MCP tools

    compute_capabilities
    dashboard_handoff
    auth_status
    auth_login
    rent_plan
    rent_create
    rentals_list
    rental_get
    rental_stop

Except for the ito mcp transport command, every CLI operation has an equivalent
MCP tool backed by the same service method. dashboard_handoff is the MCP peer of
ito dashboard. MCP handoff tools return a URL and never open a browser; only a
direct local CLI invocation may open one, and --no-open must remain available.
Every command emitted or invoked by a skill, agent, or generated artifact must
pass --no-open; automatic browser opening is reserved for a human typing the
CLI command directly.

All tools and commands return the same versioned response envelope. A supported
manual handoff looks like:

    {
      "schemaVersion": "ito.compute.v0",
      "success": true,
      "state": "manual_handoff",
      "data": {
        "authenticated": false
      },
      "error": null,
      "links": {
        "dashboard": "https://compute.itomarkets.com"
      }
    }

An unavailable capability must instead use:

    {
      "schemaVersion": "ito.compute.v0",
      "success": false,
      "state": "unavailable",
      "data": null,
      "error": {
        "code": "CAPABILITY_NOT_AVAILABLE",
        "message": "This operation requires an approved live Itô compute API."
      },
      "links": {
        "dashboard": "https://compute.itomarkets.com"
      }
    }

Envelope invariants:

- unavailable always means success: false, non-null typed error, and no
  action-like data.
- The CLI exits nonzero for unavailable or validation failures.
- MCP returns the same envelope in an error tool result; it must not translate
  failure into a successful-looking action.
- manual_handoff means the routing behavior worked. It does not mean inventory,
  OAuth, rental management, or inference is available.

### Honest stub behavior

| Capability | Phase 2 stub value |
|---|---|
| dashboardHandoff | true |
| oauthTokenExchange | false |
| rentRequestDraft | true |
| rentMutation | false |
| rentalManagement | false |
| inferenceServing | false |

- capabilities reports the table above.
- dashboard opens or returns the approved compute URL.
- auth status reports authenticated: false and oauthTokenExchange: false. It
  must not inspect ITO_API_KEY or imply that dashboard cookies are CLI auth.
- auth login opens or returns the dashboard URL and reports manual action
  required. MCP returns the URL without opening it. Neither path may say OAuth
  succeeded.
- rent plan validates and normalizes requirements, then returns manual_handoff.
  It must not fabricate inventory, price, quote, or plan ID.
- rent create, rental reads, and stop fail closed with
  CAPABILITY_NOT_AVAILABLE until backed by live APIs.
- Future paid creation and rental stop remain hard-disabled until a trusted
  consent channel exists. A model-supplied boolean, --confirm flag, or tool
  argument is not proof of user consent. Live mutations require either
  host-mediated user elicitation or a single-use capability issued outside the
  model and bound to the account, exact action and resource, immutable quote or
  resource ID, maximum cost, expiry, and idempotency key.

### MCP distribution

Add Itô only as an opt-in entry in mcp-configs/mcp-servers.json:

    "ito": {
      "command": "ito",
      "args": ["mcp"],
      "description": "Opt-in Itô compute rental and management interface. Manual dashboard handoff only until live control-plane APIs are enabled; does not provide inference serving."
    }

Do not add it to the default .mcp.json or the Claude plugin manifest. ECC's MCP
policy permits one universal default connector; this integration is intentional
and task-scoped.

## OAuth-on-intent contract

The authentication trigger is a user decision, not installation:

    self-host or training intent
      -> capacity needed
      -> user selects Itô
      -> auth status
      -> login handoff or future OAuth

Until the backend contract exists, login remains a manual dashboard handoff.

When live OAuth becomes available, require:

- A public native client using Authorization Code with PKCE S256 and no packaged
  client secret, or an explicitly approved phishing-resistant device flow.
- State and nonce validation plus issuer, audience, and redirect validation.
- A loopback callback bound only to localhost with one-time state and a short
  timeout, or the approved device-flow equivalent.
- Fixed redirect origins and least-privilege scopes.
- OS credential storage under an ecc.ito.compute-specific service/account
  namespace, never repository files, .env files, MCP config, CLI arguments,
  child-process environments, or ITO_API_KEY.
- Raw access and refresh tokens must never enter model context, MCP results,
  stdout, stderr, telemetry, crash reports, or logs. Account and billing data is
  redacted by default.
- Refresh and revocation behavior.
- Trusted account and cost consent before paid actions as defined in the
  mutation-capability contract above.

## Input and generated-artifact safety

- Define JSON Schemas for intents, accelerator names, counts, memory, duration,
  identifiers, plans, and every MCP input. Enforce enums and numeric ranges,
  bound string and collection lengths, and reject control characters or
  newlines in IDs and scheduler fields.
- Build subprocess calls with executable-plus-argv arrays. Never concatenate
  inputs into a shell command, use shell: true, eval generated text, or interpolate
  untrusted values into Slurm directives.
- Validate Slurm partitions, accounts, QOS, GRES/TRES, paths, and job names
  before rendering. Validate Kubernetes resource names, API kinds, namespaces,
  images, pull policy, resources, selectors, tolerations, volumes, and command
  arrays against explicit schemas.
- Pin model, container, code, and dataset revisions in executable plans.
- Render artifacts by default. Submission or execution is a separate step that
  requires explicit user authority and must preserve client/server dry runs.
- Never place kubeconfig, SSH keys, registry credentials, scheduler tokens, or
  provider secrets in generated artifacts or model-visible output.

## Pre-stageable versus blocked

| Pre-stageable after approval | Blocked on Itô or serving infrastructure |
|---|---|
| Five provider-neutral skills | OAuth issuer and client registration |
| Resource sizing and workload plans | Authorization, token, refresh, and revocation endpoints |
| Slurm and Kubernetes artifacts for user-provided clusters | Live accelerator inventory and availability |
| Static dashboard handoff | Live pricing, quotes, billing, and idempotency |
| CLI/MCP schemas and capability reporting | Rental create, list, get, stop APIs and lifecycle states |
| Manual sign-in and rental handoff | SSH, kubeconfig, Slurm, or other access delivery |
| Fail-closed unavailable responses | Model upload and deployment |
| Mocked contract tests | Endpoint creation, health, autoscaling, and inference serving |

Inference serving is a separate future phase. It must not be unlocked merely by
finishing this Phase 2 stub.

## Test plan

Add:

- tests/ci/ito-compute-skills.test.js for exact skills, triggers,
  provider-neutral language, sponsor disclosure, and the no-serving boundary.
- tests/lib/ito-contracts.test.js for validation, immutable envelopes, capability
  states, URL allowlisting, injection-resistant schemas, and redaction.
- tests/scripts/ito.test.js for help, JSON, no-browser handoff, invalid input,
  unavailable mutations, nonzero exit parity, and proof that ITO_API_KEY is
  ignored.
- tests/scripts/ito-mcp.test.js for stdio initialization, tool schemas,
  CLI/tool parity, error-result parity, no-browser handoff, and secret-free
  results.
- tests/integration/ito-compute-e2e.test.js for ecc ito to manual handoff and MCP
  calls without unapproved network or browser side effects.

Extend the ECC CLI, install-manifest, npm-publish-surface, and plugin-manifest
tests as required.

Required gates:

    node scripts/ci/validate-skills.js --strict
    node scripts/ci/validate-install-manifests.js
    npm run catalog:check
    npm test
    npm run coverage
    npm run lint
    npm pack --dry-run --json
    npm run security:ioc-scan

Manual acceptance:

- Existing hardware skips provider selection.
- An alternate provider path never invokes Itô authentication.
- Selecting Itô returns only truthful supported capabilities.
- Rental mutations fail closed until backed by live APIs.
- No flow emits an Itô inference endpoint.
- The Kimi target installs capability:gpu-compute.
- Paid and destructive actions remain unavailable until the trusted consent
  capability and its separate approval exist.

## Delivery slices after approval

1. **Skills and install module:** five skills, provider rule, manifests, catalog,
   and validation.
2. **CLI and opt-in MCP stub:** shared contracts, manual handoff, fail-closed
   commands/tools, security and parity tests.
3. **OAuth and rental control plane:** a separately authorized future phase,
   only after Itô supplies the live API contract and a threat model, API/contract
   review, security review, billing review, and Affaan launch approval all pass.
4. **Inference serving:** separate plan, security review, economics review, and
   explicit launch approval.

Each slice must use its own focused PR and stay mergeable without later slices.

## Affaan approval checklist

- [ ] Approve the five skill names and their boundaries.
- [ ] Approve separate Slurm and Kubernetes GPU skills.
- [ ] Approve capability:gpu-compute with Kimi target support.
- [ ] Approve sponsor wording: Itô in prose, ASCII ito for CLI and MCP.
- [ ] Approve ecc ito plus the ito bin alias inside ecc-universal.
- [ ] Approve an opt-in MCP entry and no default MCP/plugin registration.
- [ ] Approve manual-handoff and fail-closed stub semantics.
- [ ] Approve the shared response envelope and trusted-consent boundary.
- [ ] Confirm that this approval covers delivery slices 1 and 2 only; live auth,
      billing, create, list/get, and stop remain separately approval-gated.
- [ ] Supply or explicitly defer the OAuth and rental API contract.
- [ ] Confirm endpoint configuration for every supported harness before
      publishing an example.
- [ ] Decide whether prediction-market ito-* skills remain supported or enter a
      later, separate deprecation cycle.
- [ ] Validate WorkloadSplitPlan with the LinkedIn contact before describing
      Channel B as customer-validated.

Approval of this document authorizes delivery slices 1 and 2 only: the skills
and fail-closed stub. It does not authorize live auth, billing, rental APIs,
mutations, or claims that Itô inference serving is live.
