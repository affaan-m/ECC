---
name: kubernetes-patterns
description: Kubernetes workload patterns, resource management, RBAC, probes, autoscaling, ConfigMap/Secret handling, and kubectl debugging for production-grade deployments. Use when writing or reviewing Kubernetes manifests, or debugging probes, RBAC, autoscaling, resource limits, or pods that keep getting evicted.
metadata:
  origin: ECC
---

# Kubernetes Patterns

Production-grade Kubernetes patterns for deploying, managing, and debugging workloads reliably.

Long manifests and command lists live in `references/`, so this file stays under the 500-line skill limit. Read only the reference you need:

- [references/deployment-template.md](references/deployment-template.md) - full production Deployment manifest
- [references/rbac.md](references/rbac.md) - least-privilege ServiceAccount, Role, and RoleBinding
- [references/autoscaling.md](references/autoscaling.md) - HPA and PodDisruptionBudget
- [references/networking.md](references/networking.md) - Service types and TLS Ingress
- [references/configmaps-and-secrets.md](references/configmaps-and-secrets.md) - ConfigMap, Secret, and external secret handling
- [references/kubectl-debugging.md](references/kubectl-debugging.md) - kubectl cheatsheet, common errors, pod churn triage

## When to Activate

- Writing Kubernetes manifests (Deployments, Services, Ingress, Jobs)
- Configuring resource requests/limits, liveness/readiness probes
- Setting up RBAC, namespaces, or ServiceAccounts
- Managing configuration and secrets in K8s
- Debugging CrashLoopBackOff, OOMKilled, pending pods, or image pull errors
- Investigating pods that keep getting replaced with zero restarts (evictions, descheduler churn)
- Configuring HPA (Horizontal Pod Autoscaler) or PodDisruptionBudgets
- Reviewing K8s YAML for security or correctness

## When to Use

> Same as **When to Activate** above. This alias satisfies repo skill-format conventions. Use this skill any time you are writing, reviewing, or debugging Kubernetes YAML and workloads.

## How It Works

This skill provides **copy-pasteable, production-grade YAML patterns** and **kubectl debugging commands** organized by task:

1. **Deployment skeleton** - A minimal production `Deployment` with security context, rolling update strategy, all three probe types, resource limits, and environment injection from ConfigMap/Secret. The full manifest is in `references/deployment-template.md`.
2. **Probes** - Decision table for startup vs liveness vs readiness, with correct `failureThreshold × periodSeconds` math.
3. **Services & Ingress** - ClusterIP, LoadBalancer, and TLS Ingress patterns with cert-manager annotations (`references/networking.md`).
4. **ConfigMaps & Secrets** - `envFrom`, file-mount, and external secrets guidance (`references/configmaps-and-secrets.md`).
5. **Resource management** - Requests vs limits rules of thumb by workload type (web API, JVM, worker, sidecar).
6. **RBAC** - Least-privilege ServiceAccount → Role → RoleBinding chain (`references/rbac.md`).
7. **HPA & PDB** - Autoscaling and node-drain safety configurations (`references/autoscaling.md`).
8. **Jobs & CronJobs** - One-off and scheduled workload patterns with correct `restartPolicy`.
9. **kubectl cheatsheet** - Logs, exec, rollback, port-forward, dry-run, common error diagnosis, and pod churn (eviction) triage (`references/kubectl-debugging.md`).
10. **Anti-patterns & checklist** - What NOT to do, and a security/reliability/observability checklist.

## Examples

See the sections below for complete, runnable examples. Quick references:

| Task | Jump to |
|------|---------|
| Minimal production Deployment | [Core Workload Patterns](#core-workload-patterns) |
| Full production Deployment manifest | [deployment-template.md](references/deployment-template.md) |
| Probe configuration | [Probes](#probes--liveness-readiness-startup) |
| Service and Ingress manifests | [networking.md](references/networking.md) |
| ConfigMaps and Secrets | [configmaps-and-secrets.md](references/configmaps-and-secrets.md) |
| RBAC least-privilege setup | [rbac.md](references/rbac.md) |
| Autoscaling and PDBs | [autoscaling.md](references/autoscaling.md) |
| Debug a CrashLoopBackOff | [kubectl-debugging.md](references/kubectl-debugging.md) |
| Pods replaced with zero restarts | [kubectl-debugging.md](references/kubectl-debugging.md#pods-replaced-with-zero-restarts-churn) |

---

## Core Workload Patterns

### Deployment - Production Skeleton

Minimum production shape. The full manifest, with every section commented, is in
[references/deployment-template.md](references/deployment-template.md).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: my-namespace
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      serviceAccountName: my-app-sa
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      terminationGracePeriodSeconds: 30
      containers:
        - name: my-app
          image: ghcr.io/org/my-app:1.0.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
          startupProbe:
            httpGet:
              path: /health
              port: 8080
            failureThreshold: 30
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            periodSeconds: 30
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 10
            failureThreshold: 2
          envFrom:
            - configMapRef:
                name: my-app-config
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

---

## Probes — Liveness, Readiness, Startup

Understanding when to use each probe is critical:

| Probe | Failure Action | Use For |
|-------|---------------|---------|
| `startupProbe` | Kills container if slow to start | Slow-starting apps (JVM, Python) |
| `livenessProbe` | Restarts container | Deadlock / hung process detection |
| `readinessProbe` | Removes from Service endpoints | Temporary unavailability (DB reconnect) |

```yaml
# Correct pattern: startupProbe covers slow startup,
# then liveness/readiness take over
startupProbe:
  httpGet:
    path: /health
    port: 8080
  failureThreshold: 30  # 30 * 5s = 150s max startup time
  periodSeconds: 5

livenessProbe:
  httpGet:
    path: /health
    port: 8080
  periodSeconds: 30
  failureThreshold: 3   # 3 * 30s = 90s before restart

readinessProbe:
  httpGet:
    path: /ready         # Separate endpoint: checks DB, cache, etc.
    port: 8080
  periodSeconds: 10
  failureThreshold: 2
```

```yaml
# WRONG: initialDelaySeconds without startupProbe
# If the app takes 60s to start, set a startupProbe instead
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 60   # BAD: Arbitrary wait, race condition
```

---

## Services and Ingress

**ClusterIP** is the default and stays internal. **LoadBalancer** exposes the service externally on cloud providers. **Ingress** terminates TLS and routes by host and path, so set `ingressClassName` and point `cert-manager.io/cluster-issuer` at your issuer.

Field-level manifests for all three are in [references/networking.md](references/networking.md).

---

## ConfigMaps and Secrets

Use `envFrom` or a file mount for non-sensitive configuration. Raw `Secret` values are only base64-encoded, not encrypted, so production clusters should use Sealed Secrets or the External Secrets Operator.

Manifests and CLI examples are in [references/configmaps-and-secrets.md](references/configmaps-and-secrets.md).

---

## Resource Requests and Limits

```yaml
resources:
  requests:       # Scheduler uses this to place the pod
    cpu: "100m"   # 100 millicores = 0.1 CPU
    memory: "128Mi"
  limits:         # Container is killed/throttled above this
    cpu: "500m"
    memory: "256Mi"
```

**Rules of thumb:**

| Workload Type | CPU Request | Memory Request | Notes |
|---------------|-------------|----------------|-------|
| Web API | 100–250m | 128–256Mi | Set limits 2-4x requests |
| Worker/consumer | 250–500m | 256–512Mi | Memory limit = request for predictability |
| JVM app | 500m–1 | 512Mi–2Gi | Allow headroom above `-Xmx` for JVM overhead |
| Sidecar | 10–50m | 32–64Mi | Keep minimal |

```yaml
# WRONG: No requests or limits — unpredictable scheduling, OOM evictions
containers:
  - name: app
    image: myapp:latest
    # Missing resources: {} — this is dangerous in production

# WRONG: Limits without requests — requests default to limits, over-reserves capacity
resources:
  limits:
    cpu: "2"
    memory: "1Gi"
  # requests missing — will default to limits values
```

---

## RBAC - Roles and ServiceAccounts

Most apps should run under a dedicated ServiceAccount with `automountServiceAccountToken: false` and no Role at all. When the app does call the Kubernetes API, bind a namespace-scoped `Role` that grants only the required verbs, and restrict Secret access with `resourceNames`.

The full least-privilege chain is in [references/rbac.md](references/rbac.md).

---

## Autoscaling (HPA and PDB)

HPA scales on the utilization of `resources.requests`, so requests must be set on every container. Use `minReplicas: 2` or higher for production. A PodDisruptionBudget keeps enough replicas available during node drains; never set `minAvailable: 0`.

Both configurations are in [references/autoscaling.md](references/autoscaling.md).

---

## Namespaces and Multi-Tenancy

```bash
# Create namespace with resource quotas
kubectl create namespace my-namespace

# Apply ResourceQuota to limit namespace consumption
kubectl apply -f - <<EOF
apiVersion: v1
kind: ResourceQuota
metadata:
  name: my-namespace-quota
  namespace: my-namespace
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 4Gi
    limits.cpu: "8"
    limits.memory: 8Gi
    pods: "20"
EOF
```

---

## Jobs and CronJobs

```yaml
# One-off Job (DB migration, data processing)
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  namespace: my-namespace
spec:
  backoffLimit: 3          # Retry up to 3 times on failure
  ttlSecondsAfterFinished: 3600   # Auto-delete after 1h
  template:
    spec:
      restartPolicy: OnFailure    # Never for Jobs (not Always)
      containers:
        - name: migrate
          image: ghcr.io/org/my-app:1.0.0
          command: ["python", "manage.py", "migrate"]
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
```

```yaml
# CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cleanup-job
  namespace: my-namespace
spec:
  schedule: "0 2 * * *"         # 2am daily
  concurrencyPolicy: Forbid      # Don't run if previous still running
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: cleanup
              image: ghcr.io/org/cleanup:1.0.0
              resources:
                requests:
                  cpu: "50m"
                  memory: "64Mi"
```

---

## Debugging

Start with `kubectl describe pod` and `kubectl logs --previous`, then check `kubectl get events`. CrashLoopBackOff, ImagePullBackOff, pending pods, and OOMKilled each have a distinct signature, listed with the exact commands in [references/kubectl-debugging.md](references/kubectl-debugging.md).

Pods replaced with zero restarts are a separate failure class: compare Pod UID and `creationTimestamp`, then confirm with the audit log or node age. The triage table and log queries are in the same reference file.

---

## Anti-Patterns

```yaml
# BAD: Using :latest tag — non-deterministic deployments
image: myapp:latest

# GOOD: Pin to a specific immutable tag (SHA or semver)
image: ghcr.io/org/myapp:1.4.2
# or
image: ghcr.io/org/myapp@sha256:abc123...

# ---

# BAD: Running as root
securityContext: {}    # Defaults to root

# GOOD: Non-root with explicit UID
securityContext:
  runAsNonRoot: true
  runAsUser: 1001

# ---

# BAD: No resource limits — one pod can starve the entire node
containers:
  - name: app
    image: myapp:1.0.0
    # No resources defined

# GOOD: Always set requests and limits
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"

# ---

# BAD: Storing plaintext secrets in ConfigMaps
apiVersion: v1
kind: ConfigMap
data:
  DB_PASSWORD: "mysecretpassword"   # NEVER — use Secret or external secrets manager

# ---

# BAD: ClusterAdmin for application service accounts
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
roleRef:
  kind: ClusterRole
  name: cluster-admin    # Grants god-mode to your app

# ---

# BAD: minAvailable: 0 in PDB — defeats the purpose
spec:
  minAvailable: 0

# ---

# BAD: Descheduler enforcing a soft spread the scheduler cannot satisfy
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway   # The scheduler only scores this
# ...plus a descheduler RemovePodsViolatingTopologySpreadConstraint with
# constraints: [DoNotSchedule, ScheduleAnyway], replicas close to the node count,
# and nodes near full on requests: every run evicts a pod, the replacement lands
# on a busy node again, and the next run evicts it. Pods churn all day.
# GOOD: let the descheduler enforce only DoNotSchedule (its default),
# or raise maxSkew / keep spare capacity so the spread is satisfiable

# ---

# BAD: restartPolicy: Always in a Job (causes infinite restart loop)
spec:
  restartPolicy: Always   # Use OnFailure or Never for Jobs
```

---

## Best Practices Checklist

### Security
- [ ] Container runs as non-root (`runAsNonRoot: true`, `runAsUser` set)
- [ ] `readOnlyRootFilesystem: true` with `emptyDir` for writable paths
- [ ] `allowPrivilegeEscalation: false`
- [ ] All capabilities dropped (`capabilities.drop: [ALL]`)
- [ ] Dedicated ServiceAccount per app, not `default`
- [ ] `automountServiceAccountToken: false` unless needed
- [ ] RBAC follows least privilege (use `Role`, not `ClusterRole` unless needed)
- [ ] Secrets managed via Sealed Secrets or External Secrets Operator

### Reliability
- [ ] All 3 probe types configured (startup + liveness + readiness)
- [ ] Resource requests AND limits set on every container
- [ ] `minReplicas: 2+` for any production workload
- [ ] PodDisruptionBudget defined for stateful or critical services
- [ ] `RollingUpdate` strategy with `maxUnavailable: 0`
- [ ] HPA configured for variable-load services

### Observability
- [ ] App exposes `/health` (liveness) and `/ready` (readiness) endpoints
- [ ] Structured JSON logging (no PII in logs)
- [ ] Resource labels: `app`, `version`, `environment`

---

## Related Skills

- `docker-patterns` — Multi-stage Dockerfiles and image security
- `deployment-patterns` — CI/CD pipelines, rollback strategy, health check endpoints
- `security-review` — Broader security hardening context
- `git-workflow` — GitOps integration with K8s (ArgoCD / Flux patterns)
