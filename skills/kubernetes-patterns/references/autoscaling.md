# Autoscaling and Disruption Budgets

Horizontal Pod Autoscaler and PodDisruptionBudget configurations for the `kubernetes-patterns` skill.

## Horizontal Pod Autoscaler (HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
  namespace: my-namespace
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2      # Always at least 2 for HA
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70    # Scale up when avg CPU > 70%
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

> HPA requires `resources.requests` to be set on all containers - it calculates utilization as `current / request`.

## PodDisruptionBudget (PDB)

Protect availability during voluntary, eviction-based disruptions such as node drains. A PDB does not constrain rolling updates: the Deployment `strategy.rollingUpdate` fields control availability during a rollout.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
  namespace: my-namespace
spec:
  # HPA can scale down to 2 replicas, so allow one healthy pod to be evicted.
  # maxUnavailable: 1 is equivalent here.
  minAvailable: 1
  selector:
    matchLabels:
      app: my-app
```
