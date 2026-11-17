---
name: terraform-patterns
description: Terraform and OpenTofu infrastructure-as-code patterns for project layout, remote state, modules, variables, secrets, safe plan/apply workflows, and CI. Use when writing or reviewing .tf files, structuring modules or environments, configuring backends and state locking, or debugging plan drift, state, and provider errors.
metadata:
  origin: ECC
---

# Terraform Patterns

Production-grade Terraform (and OpenTofu) patterns for writing infrastructure code that is reviewable, repeatable, and safe to apply.

## When to Activate

- Writing or reviewing `.tf` or `.tfvars` files
- Structuring a repo into modules and environments
- Configuring a remote backend, state locking, or state migration
- Passing variables and handling secrets in infrastructure code
- Setting up plan/apply automation in CI
- Debugging a failed plan, state drift, a lock error, or a provider version conflict
- Refactoring resources without destroying them (`moved`, `import`)

## When to Use

> Same as **When to Activate** above. This alias satisfies repo skill-format conventions. Use this skill any time you are writing, reviewing, or debugging Terraform or OpenTofu configuration.

## How It Works

This skill gives **copy-pasteable patterns** and a **safe command workflow**, organized by task:

1. **Project layout** - Environments as thin roots that call reusable modules.
2. **Versions and providers** - Pin Terraform and provider versions; commit the lock file.
3. **Remote state** - Encrypted, locked, per-environment state.
4. **Variables and outputs** - Typed, validated inputs and minimal outputs.
5. **Secrets** - Keep values out of code, state exposure in mind.
6. **Resources** - `for_each` over `count`, `lifecycle`, and tagging.
7. **Modules** - Small, single-purpose, versioned.
8. **Refactoring** - `moved` and `import` blocks instead of destroy/recreate.
9. **Safe workflow and CI** - Plan is saved, reviewed, then applied.
10. **Debugging and anti-patterns** - Common errors and what to avoid.

Examples use AWS for concreteness. The structure applies to any provider.

## Examples

| Task | Jump to |
|------|---------|
| Layout for dev/staging/prod | [Project Layout](#project-layout) |
| Remote state with locking | [Remote State](#remote-state) |
| Validated variables | [Variables and Outputs](#variables-and-outputs) |
| Avoid secrets in state and code | [Secrets](#secrets) |
| Rename a resource without destroying it | [Refactoring Without Destroying](#refactoring-without-destroying) |
| Plan/apply in CI | [Safe Workflow and CI](#safe-workflow-and-ci) |
| Lock or drift errors | [Debugging](#debugging) |

---

## Project Layout

Keep environments as thin root modules. Put logic in reusable modules.

```text
infra/
├── modules/
│   └── network/
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── versions.tf
└── envs/
    ├── dev/
    │   ├── main.tf
    │   ├── backend.tf
    │   ├── providers.tf
    │   └── terraform.tfvars
    └── prod/
        ├── main.tf
        ├── backend.tf
        ├── providers.tf
        └── terraform.tfvars
```

Rules of thumb:

- One state per environment and per blast-radius boundary (network, data, apps). A single giant state makes every plan slow and every mistake large.
- Environments differ by **inputs** (`terraform.tfvars`), not by copy-pasted resources.
- Do not use workspaces as a substitute for separate production and non-production state with separate credentials.

## Versions and Providers

Pin everything. Unpinned providers change behavior between runs.

```hcl
# versions.tf
terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}
```

```hcl
# providers.tf
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = var.owner
    }
  }
}
```

- Commit `.terraform.lock.hcl`. It records provider checksums so CI and teammates install identical providers.
- Do **not** commit the `.terraform/` directory or any `*.tfstate` file.
- Upgrade deliberately: `terraform init -upgrade`, review the lock file diff, then plan.

## Remote State

Local state does not work for teams and is easy to lose. Use a remote backend with encryption and locking.

```hcl
# backend.tf
terraform {
  backend "s3" {
    bucket       = "example-org-tfstate-prod"
    key          = "network/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true # S3-native locking (Terraform >= 1.10)
  }
}
```

Older Terraform versions use a DynamoDB table for locking instead. Replace
`use_lockfile = true` with:

```hcl
dynamodb_table = "example-org-tfstate-lock"
```

Backend rules:

- Backend blocks cannot reference variables. Pass values with `-backend-config` or a partial config file when you need per-environment values.
- Enable bucket versioning so a bad state write can be recovered.
- Block public access on the state bucket and restrict who can read it. State often contains sensitive values.
- Never use `-lock=false` to get past a lock error. See [Debugging](#debugging).

## Variables and Outputs

Type and validate inputs so mistakes fail at plan time.

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "instance_count" {
  type        = number
  description = "Number of application instances."
  default     = 2

  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 20
    error_message = "instance_count must be between 1 and 20."
  }
}

variable "allowed_cidrs" {
  type        = list(string)
  description = "CIDR blocks allowed to reach the service."
  default     = []
}
```

```hcl
output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
}

output "db_password" {
  description = "Generated database password."
  value       = random_password.db.result
  sensitive   = true
}
```

- Every variable and output gets a `description`. Modules are read far more often than written.
- Give a `default` only when one is safe in every environment. Required inputs force the caller to decide.
- Mark outputs that carry credentials `sensitive = true`. Note this only hides them from CLI output; they are still stored in state.

## Secrets

Terraform state stores resource attributes in plain text, including passwords and keys that you pass in or that the provider generates.

Do:

- Keep secrets out of `.tf` and committed `.tfvars` files. Supply them at runtime with `TF_VAR_*` environment variables or your CI secret store.
- Reference secrets that already exist in a secret manager instead of creating the value in Terraform.
- Use ephemeral values and write-only attributes where your Terraform and provider versions support them, so the value never lands in state.
- Encrypt state at rest and restrict read access to it.
- Authenticate with short-lived credentials (OIDC from CI, assumed roles) rather than long-lived access keys.

```hcl
# Read an existing secret instead of defining its value in code
data "aws_secretsmanager_secret_version" "db" {
  secret_id = "prod/app/db-password"
}

resource "aws_db_instance" "app" {
  identifier = "app-${var.environment}"
  # ...
  password = data.aws_secretsmanager_secret_version.db.secret_string
}
```

> Reading a secret through a data source still places the value in state. Treat the state file as sensitive in every case.

Do not:

- Hardcode credentials in `provider` blocks.
- Commit `terraform.tfvars` files that contain secrets. Add them to `.gitignore`.
- Print secrets with `terraform output -json` in shared CI logs.

## Resources

### Prefer `for_each` over `count`

`count` identifies resources by index. Removing an item from the middle of a list shifts every later item down one index, so Terraform plans to modify or replace the resources after it (and destroy the last one) instead of just removing the one you meant to.

```hcl
# Fragile: removing "b" shifts "c" into b's slot and destroys the last index
resource "aws_iam_user" "bad" {
  count = length(var.users)
  name  = var.users[count.index]
}

# Stable: each resource is keyed by its name; removing "b" destroys only "b"
resource "aws_iam_user" "good" {
  for_each = toset(var.users)
  name     = each.key
}
```

Use `count` only for a simple on/off toggle:

```hcl
resource "aws_cloudwatch_log_group" "app" {
  count = var.enable_logging ? 1 : 0
  name  = "/app/${var.environment}"
}
```

### Lifecycle guards

```hcl
resource "aws_s3_bucket" "data" {
  bucket = "example-org-data-${var.environment}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_launch_template" "app" {
  # ...
  lifecycle {
    create_before_destroy = true
  }
}
```

- `prevent_destroy` on stateful resources (databases, buckets, encryption keys) turns an accidental destroy into a plan error.
- `prevent_destroy` only protects a resource that is still in the configuration. If you delete the resource block, Terraform no longer sees the setting and will plan to destroy the real resource. To stop managing a resource **without** destroying it, use a `removed` block (Terraform >= 1.7):

```hcl
removed {
  from = aws_s3_bucket.data

  lifecycle {
    destroy = false
  }
}
```
- `ignore_changes` hides drift. Use it narrowly and add a comment saying why.

### Secure defaults

```hcl
resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

Avoid `0.0.0.0/0` ingress rules except for deliberately public endpoints, and keep IAM policies to the specific actions and resources needed.

## Modules

A good module does one thing, exposes a small interface, and is versioned.

```hcl
module "network" {
  source = "../../modules/network"

  environment = var.environment
  cidr_block  = "10.20.0.0/16"
}

# Registry or git modules: pin a version or ref
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"
}
```

- Pin registry modules with `version` and git modules with `?ref=<tag>`. Never track a moving branch.
- Do not configure `provider` blocks inside child modules. Declare `required_providers` and let the root pass providers in.
- Prefer composition: a module takes IDs as inputs rather than creating everything itself.
- Do not wrap a single resource in a module that only forwards its arguments.

## Refactoring Without Destroying

Renaming a resource or moving it into a module looks like a destroy plus a create. Tell Terraform it is the same object.

```hcl
# Resource renamed in code: keep the existing object
moved {
  from = aws_instance.web
  to   = aws_instance.app
}

# Adopt an existing resource into state (Terraform >= 1.5)
import {
  to = aws_s3_bucket.legacy
  id = "example-org-legacy-bucket"
}
```

Always read the plan after a refactor. A correct `moved` block shows as "has moved" with no destroy.

Use `terraform state` commands only as a last resort, take a backup first, and never edit the state file by hand.

## Safe Workflow and CI

Format and validate locally, then plan, review, and apply the **same** plan.

```bash
terraform fmt -recursive
terraform init
terraform validate
terraform plan -out=tfplan
terraform show tfplan          # review before applying
# STOP: get explicit human approval of the reviewed plan before the next command
terraform apply tfplan         # applies exactly what was reviewed
```

An AI agent must not run `terraform apply` or `terraform destroy` on its own. Show the plan summary, wait for the user to approve it, and only then apply the saved plan.

Why `-out`: a bare `terraform apply` re-plans, so what runs can differ from what you reviewed.

Read the plan for:

- `-/+` (replace) and `-` (destroy) lines on stateful resources
- Changes you did not make, which indicate drift or a provider upgrade
- Unexpected counts in the summary line

### CI pipeline shape

```yaml
# .github/workflows/terraform.yml (shape only)
name: terraform
on:
  pull_request:
    paths: ["infra/**"]

permissions:
  id-token: write   # OIDC to the cloud provider, no stored keys
  contents: read
  pull-requests: write

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      # Pin third-party actions to full commit SHAs, not movable tags
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e # v4.0.1
        with:
          terraform_version: 1.10.5 # must satisfy required_version and use_lockfile (>= 1.10)
      - run: terraform fmt -check -recursive
        working-directory: infra/envs/dev
      - run: terraform init -input=false
        working-directory: infra/envs/dev
      - run: terraform validate
        working-directory: infra/envs/dev
      - run: terraform plan -input=false -out=tfplan
        working-directory: infra/envs/dev
```

- Run `plan` on pull requests and post it for review. Run `apply` only from the main branch, after approval, using the saved plan.
- Use `-input=false` in automation so a missing variable fails instead of hanging.
- Give the plan job read-only credentials where the provider allows it, and keep the apply role separate.
- Consider a policy or static-analysis step (for example `tflint`, `checkov`, or `trivy config`) before apply.

## Debugging

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| `Error acquiring the state lock` | Another run holds the lock, or a run crashed | Confirm no run is active, then `terraform force-unlock <LOCK_ID>`. Do not disable locking. |
| Plan shows changes you did not make | Drift, a provider upgrade, or a changed default | `terraform plan -refresh-only` to see drift. Check the lock file diff. |
| `Provider produced inconsistent result` | Provider bug or version mismatch | Pin and upgrade the provider; check its issue tracker. |
| `Cycle` error | Two resources depend on each other | Break the loop with an intermediate resource or remove the redundant reference. |
| Resource already exists | It was created outside Terraform | Add an `import` block, then plan. |
| `for_each` value depends on unknown values | Keys come from an attribute known only after apply | Key by a static value, or apply in two steps with `-target` as a one-time exception. |
| Destroy and recreate on rename | Missing `moved` block | Add a `moved` block, re-plan. |

Useful commands:

```bash
terraform state list                    # what is tracked
terraform state show aws_instance.app   # inspect one resource
terraform plan -refresh-only            # detect drift without proposing changes
terraform providers                     # which providers and versions are in use
TF_LOG=DEBUG terraform plan 2> debug.log   # verbose logs; may contain secrets
```

> `TF_LOG` output can contain credentials. Do not paste it into issues or CI logs without scrubbing it.

## Anti-Patterns

| Anti-pattern | Why it hurts | Instead |
|--------------|--------------|---------|
| `terraform apply` without a saved plan | Applies something other than what was reviewed | `plan -out`, review, `apply tfplan` |
| `-auto-approve` on a human workflow | Removes the last safety check | Reserve it for pipelines that apply a reviewed plan |
| Local state for shared infrastructure | Lost state, no locking | Remote backend with locking |
| One huge state for everything | Slow plans, large blast radius | Split by environment and domain |
| Secrets in `.tf` or committed `.tfvars` | Leaked credentials | Runtime variables or a secret manager |
| Unpinned providers or modules | Surprise changes between runs | Version constraints plus the lock file |
| `count` over a list of named things | Index shift causes destroys | `for_each` with stable keys |
| `-target` as routine practice | Skips dependencies, leaves state inconsistent | Fix the root cause; use only as a one-time exception |
| Editing state by hand | Corrupts state | `moved`, `import`, or `terraform state` with a backup |
| Disabling locking to bypass a stuck lock | Concurrent writes corrupt state | Verify and `force-unlock` the specific lock |

## Checklist

Before opening a PR:

- [ ] `terraform fmt -recursive` and `terraform validate` pass
- [ ] Terraform and provider versions are pinned; `.terraform.lock.hcl` is committed
- [ ] State is remote, encrypted, and locked
- [ ] No secrets in code, `.tfvars`, or outputs that are not `sensitive`
- [ ] Variables have types, descriptions, and validation where a bad value is plausible
- [ ] Stateful resources have `prevent_destroy` or an explicit reason they do not (and removals use a `removed` block with `destroy = false`)
- [ ] A human approved the saved plan before it was applied
- [ ] The plan was read: no unexpected destroys or replacements
- [ ] Refactors use `moved` or `import`, not destroy and recreate
- [ ] CI applies the saved, reviewed plan

## Related Skills

- `kubernetes-patterns` - cluster workloads once the infrastructure exists
- `docker-patterns` - container images that Terraform-managed infrastructure runs
- `deployment-patterns` - release and rollout strategies
- `security-review` - broader security checklist
- `database-migrations` - schema changes, distinct from infrastructure changes
