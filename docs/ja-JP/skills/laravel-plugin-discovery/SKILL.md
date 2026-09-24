---
name: laravel-plugin-discovery
description: Laravel プラグイン検出、パッケージ管理、依存関係解決、およびサービスプロバイダ統合。
origin: ECC
---

# Laravel Plugin Discovery

Find, evaluate, and choose healthy Laravel packages using the LaraPlugins.io MCP server.

## When to Use

- User wants to find Laravel packages for a specific feature (e.g. "auth", "permissions", "admin panel")
- User asks "what package should I use for..." or "is there a Laravel package for..."
- User wants to check if a package is actively maintained
- User needs to verify Laravel version compatibility
- User wants to assess package health before adding to a project

## MCP Requirement

LaraPlugins MCP server must be configured. Add to your `~/.claude.json` mcpServers:

```json
"laraplugins": {
  "type": "http",
  "url": "https://laraplugins.io/mcp/plugins"
}
```

No API key required — the server is free for the Laravel community.

## MCP Tools

The LaraPlugins MCP provides two primary tools:

### SearchPluginTool

Search packages by keyword, health score, vendor, and version compatibility.

**Parameters:**
- `text_search` (string, optional): Keyword to search (e.g. "permission", "admin", "api")
- `health_score` (string, optional): Filter by health band — `Healthy`, `Medium`, `Unhealthy`, or `Unrated`
- `laravel_compatibility` (string, optional): Filter by Laravel version — `"5"`, `"6"`, `"7"`, `"8"`, `"9"`, `"10"`, `"11"`, `"12"`, `"13"`
- `php_compatibility` (string, optional): Filter by PHP version — `"7.4"`, `"8.0"`, `"8.1"`, `"8.2"`, `"8.3"`, `"8.4"`, `"8.5"`
- `vendor_filter` (string, optional): Filter by vendor name (e.g. "spatie", "laravel")
- `page` (number, optional): Page number for pagination

### GetPluginDetailsTool

Fetch detailed metrics, readme content, and version history for a specific package.

**Parameters:**
- `package` (string, required): Full Composer package name (e.g. "spatie/laravel-permission")
- `include_versions` (boolean, optional): Include version history in response

---

## How It Works

### Finding Packages

When the user wants to discover packages for a feature:

1. Use `SearchPluginTool` with relevant keywords
2. Apply filters for health score, Laravel version, or PHP version
3. Review the results with package names, descriptions, and health indicators

### Evaluating Packages

When the user wants to assess a specific package:

1. Use `GetPluginDetailsTool` with the package name
2. Review health score, last updated date, Laravel version support
3. Check vendor reputation and risk indicators

### Checking Compatibility

When the user needs Laravel or PHP version compatibility:

1. Search with `laravel_compatibility` filter set to their version
2. Or get details on a specific package to see its supported versions

---

## Examples

### Example: Find Authentication Packages

```
SearchPluginTool({
  text_search: "authentication",
  health_score: "Healthy"
})
```

Returns packages matching "authentication" with healthy status:
- spatie/laravel-permission
- laravel/breeze
- laravel/passport
- etc.

### Example: Find Laravel 12 Compatible Packages

```
SearchPluginTool({
  text_search: "admin panel",
  laravel_compatibility: "12"
})
```

Returns packages compatible with Laravel 12.

### Example: Get Package Details

```
GetPluginDetailsTool({
  package: "spatie/laravel-permission",
  include_versions: true
})
```

Returns:
- Health score and last activity
- Laravel/PHP version support
- Vendor reputation (risk score)
- Version history
- Brief description

### Example: Find Packages by Vendor

```
SearchPluginTool({
  vendor_filter: "spatie",
  health_score: "Healthy"
})
```

Returns all healthy packages from vendor "spatie".

---

## Filtering Best Practices

### By Health Score

| Health Band | Meaning |
|-------------|---------|
| `Healthy` | Active maintenance, recent updates |
| `Medium` | Occasional updates, may need attention |
| `Unhealthy` | Abandoned or infrequently maintained |
| `Unrated` | Not yet assessed |

**Recommendation**: Prefer `Healthy` packages for production applications.

### By Laravel Version

| Version | Notes |
|---------|-------|
| `13` | Latest Laravel |
| `12` | Current stable |
| `11` | Still widely used |
| `10` | Legacy but common |
| `5`-`9` | Deprecated |

**Recommendation**: Match the target project's Laravel version.

### Combining Filters

```typescript
// Find healthy, Laravel 12 compatible packages for permissions
SearchPluginTool({
  text_search: "permission",
  health_score: "Healthy",
  laravel_compatibility: "12"
})
```

---

## Response Interpretation

### Search Results

Each result includes:
- Package name (e.g. `spatie/laravel-permission`)
- Brief description
- Health status indicator
- Laravel version support badges

### Package Details

The detailed response includes:
- **Health Score**: Numeric or band indicator
- **Last Activity**: When the package was last updated
- **Laravel Support**: Version compatibility matrix
- **PHP Support**: PHP version compatibility
- **Risk Score**: Vendor trust indicators
- **Version History**: Recent release timeline

---

## Common Use Cases

| Scenario | Recommended Approach |
|----------|---------------------|
| "What package for auth?" | Search "auth" with healthy filter |
| "Is spatie/package still maintained?" | Get details, check health score |
| "Need Laravel 12 packages" | Search with laravel_compatibility: "12" |
| "Find admin panel packages" | Search "admin panel", review results |
| "Check vendor reputation" | Search by vendor, check details |

---

## Best Practices

1. **Always filter by health** — Use `health_score: "Healthy"` for production projects
2. **Match Laravel version** — Always check `laravel_compatibility` matches the target project
3. **Check vendor reputation** — Prefer packages from known vendors (spatie, laravel, etc.)
4. **Review before recommending** — Use GetPluginDetailsTool for a comprehensive assessment
5. **No API key needed** — The MCP is free, no authentication required

---

## Related Skills

- `laravel-patterns` — Laravel architecture and patterns
- `laravel-tdd` — Test-driven development for Laravel
- `laravel-security` — Laravel security best practices
- `documentation-lookup` — General library documentation lookup (Context7)
