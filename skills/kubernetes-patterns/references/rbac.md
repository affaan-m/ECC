# RBAC and ServiceAccounts

Least-privilege ServiceAccount, Role, and RoleBinding patterns for the `kubernetes-patterns` skill.

## Principle of Least Privilege

**Two patterns depending on whether the app calls the Kubernetes API:**

### Pattern A - App does NOT need the Kubernetes API (most apps)

Disable token automounting on the ServiceAccount. The Role/RoleBinding are not needed.

```yaml
# ServiceAccount with token disabled - safest default
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
  namespace: my-namespace
automountServiceAccountToken: false   # No K8s API token injected into pods
```

```yaml
# Reference in Deployment - no token, no API access
spec:
  template:
    spec:
      serviceAccountName: my-app-sa
      automountServiceAccountToken: false   # Belt-and-suspenders: also set at pod level
```

### Pattern B - App DOES need the Kubernetes API (operators, controllers, config watchers)

Enable the token and grant only the permissions actually required.

```yaml
# 1. ServiceAccount - enable token for this SA
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
  namespace: my-namespace
automountServiceAccountToken: true    # Token required: app calls K8s API
```

```yaml
# 2. Role - grant only what the app needs (namespace-scoped)
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-app-role
  namespace: my-namespace
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]    # Read-only, specific resource
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["my-app-secrets"]  # Restrict to specific secret by name
    verbs: ["get"]
```

```yaml
# 3. Bind Role to ServiceAccount
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-app-rolebinding
  namespace: my-namespace
subjects:
  - kind: ServiceAccount
    name: my-app-sa
    namespace: my-namespace
roleRef:
  kind: Role
  apiGroup: rbac.authorization.k8s.io
  name: my-app-role
```

```yaml
# 4. Reference SA in Deployment
spec:
  template:
    spec:
      serviceAccountName: my-app-sa
      # automountServiceAccountToken defaults to true from SA - token is injected
```
