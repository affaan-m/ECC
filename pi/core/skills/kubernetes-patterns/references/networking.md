# Services and Ingress

Service and Ingress manifests for the `kubernetes-patterns` skill.

## Service Types

```yaml
# ClusterIP (default) - internal-only
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: my-namespace
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
  type: ClusterIP
```

```yaml
# LoadBalancer - external traffic (cloud providers)
# Separate Service, so the ClusterIP service above keeps port 80 for Ingress.
apiVersion: v1
kind: Service
metadata:
  name: my-app-lb
  namespace: my-namespace
spec:
  selector:
    app: my-app
  ports:
    - port: 443
      targetPort: 8080
      protocol: TCP
  type: LoadBalancer
```

Use the LoadBalancer or the Ingress as the external entry point, not both. The
Ingress below routes to the `my-app` ClusterIP Service on port 80.

## Ingress with TLS

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  namespace: my-namespace
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: my-app-tls
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port:
                  number: 80
```
