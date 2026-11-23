# kubectl Debugging

Debugging commands and failure triage for the `kubernetes-patterns` skill.

## Cheatsheet

```bash
# --- Pod status and logs ---
kubectl get pods -n my-namespace
kubectl get pods -n my-namespace -o wide          # Show node assignment
kubectl describe pod <pod-name> -n my-namespace   # Events and state details
kubectl logs <pod-name> -n my-namespace           # Current logs
kubectl logs <pod-name> -n my-namespace --previous  # Logs from crashed container
kubectl logs <pod-name> -n my-namespace -c <container>  # Multi-container pod

# --- Execute into a running container ---
kubectl exec -it <pod-name> -n my-namespace -- sh
kubectl exec -it <pod-name> -n my-namespace -- bash

# --- Check resource usage ---
kubectl top pods -n my-namespace
kubectl top nodes

# --- Deployment operations ---
kubectl rollout status deployment/my-app -n my-namespace
kubectl rollout history deployment/my-app -n my-namespace
kubectl rollout undo deployment/my-app -n my-namespace      # Rollback
kubectl rollout undo deployment/my-app --to-revision=2 -n my-namespace

# --- Scale manually ---
kubectl scale deployment my-app --replicas=5 -n my-namespace

# --- Inspect events (cluster-wide issues) ---
kubectl get events -n my-namespace --sort-by='.lastTimestamp'

# --- Port-forward for local debugging ---
kubectl port-forward pod/<pod-name> 8080:8080 -n my-namespace
kubectl port-forward svc/my-app 8080:80 -n my-namespace

# --- Dry-run to validate YAML ---
kubectl apply -f deployment.yaml --dry-run=client
kubectl apply -f deployment.yaml --dry-run=server   # Validates against live cluster
```

## Diagnosing Common Errors

```bash
# CrashLoopBackOff: container keeps crashing
kubectl logs <pod-name> --previous -n my-namespace  # Check crash logs
kubectl describe pod <pod-name> -n my-namespace     # Check exit code & OOMKilled

# ImagePullBackOff: can't pull image
kubectl describe pod <pod-name> -n my-namespace     # Check Events section
# Causes: wrong image tag, missing imagePullSecret, private registry

# Pending pod: not scheduled
kubectl describe pod <pod-name> -n my-namespace
# Causes: insufficient resources, no matching node selector, taint/toleration mismatch

# OOMKilled: out of memory
# Increase memory limits, check for memory leaks
kubectl describe pod <pod-name> -n my-namespace | grep -A5 "Last State"
```

## Pods Replaced With Zero Restarts (Churn)

A young pod with `RESTARTS 0` may be a new replica or a replacement. Compare its Pod UID and `creationTimestamp` with a prior observation; a changed UID confirms replacement, while the restart count alone does not prove deletion. `kubectl get events` often shows nothing, because events expire after one hour by default and a descheduler without RBAC on `events.k8s.io` emits none. Node-pressure evictions by the kubelet are different: they skip the Eviction API and leave the old pod listed as `Evicted`.

| Signal | Likely cause | Confirm with |
|--------|--------------|--------------|
| New ReplicaSet whose only template change is `kubectl.kubernetes.io/restartedAt` | `kubectl rollout restart` | Audit log: deployment `patch` and who sent it |
| Same ReplicaSet, same nodes | API-initiated eviction (descheduler, `kubectl drain`) | Audit log: `pods/eviction` `create` |
| Same ReplicaSet, a node was added or removed | Node reclaim or replacement (spot/preemptible, autoscaler, upgrade) | `kubectl get nodes` (AGE), cloud provider logs |

```bash
# Who evicted what: API server audit log, objectRef.subresource=eviction, verb=create
# GKE example (Cloud Logging):
gcloud logging read 'protoPayload.methodName="io.k8s.core.v1.pods.eviction.create"' --freshness=4h \
  --format='value(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName)'

# A descheduler CronJob logs the plugin behind each eviction
kubectl logs -n kube-system job/<descheduler-job> | grep "Evicted pod"
```
