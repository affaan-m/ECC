# ECC Tools GitHub App Permissions

To report PR review results natively in the GitHub **Checks** tab rather than only via email notifications, the GitHub App manifest requires:

- **Checks**: `Read and write` (`checks: write`)
- **Metadata**: `Read-only`
- **Contents / Issues / Pull requests**: `Read and write`

See `manifests/github-app-permissions.json` for the machine-readable permission set.
