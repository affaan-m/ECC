---
description: Configure seu package manager preferido (npm/pnpm/yarn/bun)
disable-model-invocation: true
---

# Configuração de Package Manager

Configure seu package manager preferido para este projeto ou globalmente.

## Uso

```bash
# Detect current package manager
node scripts/setup-package-manager.js --detect

# Set global preference
node scripts/setup-package-manager.js --global pnpm

# Set project preference
node scripts/setup-package-manager.js --project bun

# List available package managers
node scripts/setup-package-manager.js --list
```

## Prioridade de Detecção

Ao determinar qual package manager usar, esta ordem é verificada:

1. **Environment variable**: `CLAUDE_PACKAGE_MANAGER`
2. **Project config**: `.claude/package-manager.json`
3. **package.json**: `packageManager` field
4. **Lock file**: Presence of package-lock.json, yarn.lock, pnpm-lock.yaml, or bun.lockb
5. **Global config**: `~/.claude/package-manager.json`
6. **Fallback**: First available package manager (pnpm > bun > yarn > npm)

## Arquivos de Configuração

### Configuração Global
```json
// ~/.claude/package-manager.json
{
  "packageManager": "pnpm"
}
```

### Configuração do Projeto
```json
// .claude/package-manager.json
{
  "packageManager": "bun"
}
```

### package.json
```json
{
  "packageManager": "pnpm@8.6.0"
}
```

## Variável de Ambiente

Defina `CLAUDE_PACKAGE_MANAGER` para sobrescrever todos os outros métodos de detecção:

```bash
# Windows (PowerShell)
$env:CLAUDE_PACKAGE_MANAGER = "pnpm"

# macOS/Linux
export CLAUDE_PACKAGE_MANAGER=pnpm
```

## Rodar a Detecção

Para ver os resultados atuais da detecção de package manager, rode:

```bash
node scripts/setup-package-manager.js --detect
```
