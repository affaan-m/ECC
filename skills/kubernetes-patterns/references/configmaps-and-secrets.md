# ConfigMaps and Secrets

Configuration and secret handling for the `kubernetes-patterns` skill.

## ConfigMap - Non-sensitive configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-config
  namespace: my-namespace
data:
  LOG_LEVEL: "info"
  APP_ENV: "production"
  MAX_CONNECTIONS: "100"
  # Mount as a file for complex config
  app.yaml: |
    server:
      port: 8080
      timeout: 30s
```

```yaml
# Mount ConfigMap as a file
volumes:
  - name: config
    configMap:
      name: my-app-config
      items:
        - key: app.yaml
          path: app.yaml
volumeMounts:
  - name: config
    mountPath: /etc/app
    readOnly: true
```

## Secrets - Sensitive data

```bash
# Create secret from literal (CLI, then store in Vault/SOPS)
kubectl create secret generic my-app-secrets \
  --from-literal=db-password='s3cr3t' \
  --namespace=my-namespace \
  --dry-run=client -o yaml | kubectl apply -f -
```

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-app-secrets
  namespace: my-namespace
type: Opaque
# Values are base64-encoded (NOT encrypted - use Sealed Secrets or ESO for real encryption)
data:
  db-password: czNjcjN0  # base64 of 's3cr3t'
```

> **Important:** Raw Kubernetes Secrets are only base64-encoded, not encrypted at rest unless your cluster has encryption configured. Use [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) or [External Secrets Operator](https://external-secrets.io) for production.
