# Production Deployment Template

Full production `Deployment` manifest for the `kubernetes-patterns` skill. It includes the pod and container security contexts, rolling update strategy, all three probes, resource requests and limits, and environment injection from a ConfigMap and Secret.

Copy it and adjust names, namespaces, images, ports, and resource values.

The manifest uses the dedicated `my-app-sa` ServiceAccount with token
automounting disabled. Create it first with Pattern A in [rbac.md](rbac.md); a
workload that calls the Kubernetes API needs Pattern B instead.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: my-namespace
  labels:
    app: my-app
    version: "1.0.0"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # Allow 1 extra pod during update
      maxUnavailable: 0    # Never reduce below desired count
  template:
    metadata:
      labels:
        app: my-app
        version: "1.0.0"
    spec:
      # Dedicated ServiceAccount without an API token (see rbac.md, Pattern A)
      serviceAccountName: my-app-sa
      automountServiceAccountToken: false

      # Security context at pod level
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001

      # Graceful shutdown
      terminationGracePeriodSeconds: 30

      containers:
        - name: my-app
          image: ghcr.io/org/my-app:1.0.0   # Never use :latest
          imagePullPolicy: IfNotPresent

          ports:
            - containerPort: 8080
              protocol: TCP

          # Resource requests AND limits are both required
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"

          # Container security context
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL

          # Probes (see the Probes section of SKILL.md)
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
            initialDelaySeconds: 0
            periodSeconds: 30
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 2

          # Environment from ConfigMap and Secret
          envFrom:
            - configMapRef:
                name: my-app-config
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: my-app-secrets
                  key: db-password

          # Writable tmp directory when readOnlyRootFilesystem: true
          volumeMounts:
            - name: tmp
              mountPath: /tmp

      volumes:
        - name: tmp
          emptyDir: {}
```
