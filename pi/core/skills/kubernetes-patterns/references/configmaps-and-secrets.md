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
# Dummy-only example. Never put a real password in a command argument: it stays
# in shell history and process listings. For production, pull the value from a
# secret manager or a mounted file and pass it on stdin.
kubectl create secret generic my-app-secrets \
  --from-file=db-password=./db-password.txt \
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
# Placeholder value only. Base64 is NOT encryption.
data:
  db-password: PHJlcGxhY2Utd2l0aC1yZWFsLXNlY3JldD4=  # base64 of a placeholder
```

> **Important:** Raw Kubernetes Secrets are only base64-encoded, not encrypted.
> Sealed Secrets and the External Secrets Operator protect the source manifest:
> they still produce a standard Secret, which is stored unencrypted at rest
> unless the cluster has encryption at rest configured on the API server.
> Prefer [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)
> or [External Secrets Operator](https://external-secrets.io) for production,
> and turn on at-rest encryption for the cluster.
