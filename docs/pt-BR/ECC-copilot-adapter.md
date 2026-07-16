# ECC Copilot Adapter — Guia Completo (PT-BR)

## Visão Geral

Esta extensão Copilot expõe os comandos do ECC (Everything Claude Code) como ferramentas nativas do GitHub Copilot Chat. Os handlers são gerados dinamicamente a partir de `agent.yaml` e executam no modo seguro `--dry-run` por padrão.

## Instalação

### 1. Pré-requisitos
- GitHub Copilot Chat instalado no VS Code ou IDE compatível
- Node.js 18+
- npm (ou yarn/bun)

### 2. Passos de Instalação

```bash
# Clone o repositório
git clone https://github.com/affaan-m/ECC.git
cd ECC

# Instale as dependências
npm install

# Ative a extensão (no ambiente de desenvolvimento do Copilot)
# A extensão em .github/extensions/ecc-copilot-adapter/ será carregada automaticamente
```

### 3. Verificação
```bash
# Valide os handlers com dry-run
node scripts/handlers-dryrun.js

# Execute testes críticos
node scripts/test-handlers-ci.js
```

## Uso

### Ferramentas Disponíveis

Após instalar, as seguintes ferramentas estarão disponíveis no Copilot:

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `ecc-help` | Exibe ajuda do ECC | Invocar sem argumentos |
| `ecc-run` | Executar qualquer comando | `{ "args": ["plan", "--list-profiles"] }` |
| `ecc-plan` | Inspecionar planos de instalação | `{ "args": ["--list-profiles"] }` |
| `ecc-sessions` | Listar sessões ativas | Invocar sem argumentos |
| `ecc-status` | Status do ECC | Invocar sem argumentos |
| `ecc-skill-create` | Gerar scaffold de skill | `{ "name": "meu-skill" }` |
| `ecc-skill-health` | Verificar saúde dos skills | Invocar sem argumentos |
| `ecc-loop-status` | Status dos loops | Invocar sem argumentos |
| `ecc-repo-scan` | Varredura do repositório | Invocar sem argumentos |
| Outras... | (95+ comandos) | Veja agent.yaml para lista completa |

### Modo Seguro (padrão)

Todos os handlers executam com `--dry-run` por padrão:
```javascript
// Modo seguro — não altera estado
const resultado = await ecc_plan({ args: ["--list-profiles"] });
```

### Modo Execução Real

Para executar ações reais, passe `run: true`:
```javascript
// Cuidado: modifica estado do repositório/sistema
const resultado = await ecc_plan({ args: ["--list-profiles"], run: true });
```

## Arquitetura

### Fluxo de Execução

```
Copilot Chat
    ↓
Tool Invocation (ecc-<comando>)
    ↓
Extension Handler (.github/extensions/ecc-copilot-adapter/extension.mjs)
    ↓
scripts/ecc.js --dry-run (ou --run)
    ↓
Fallback (scripts/<comando>.js) se Unknown command
    ↓
Resultado retornado ao Copilot
```

### Fallback Automático

Quando um comando não está exposto pelo CLI principal:
1. A extensão procura por um script em `scripts/<comando>.js`
2. Busca por variações: sufixos (-output), underscores, pluralização
3. Executa o script ou retorna erro se nenhum for encontrado

### Handlers Dinâmicos

O arquivo `extension.mjs` lê `agent.yaml` e gera handlers automaticamente para cada comando listado. Novos comandos adicionados ao `agent.yaml` ficam imediatamente disponíveis.

## Comandos Implementados

### Totalmente Funcionais (4/95)
- ✅ `plan` — plano de instalação
- ✅ `sessions` — gerenciamento de sessões
- ✅ `loop-status` — status de loops autônomos
- ✅ `auto-update` — atualização automática

### Com Fallback (6/95)
- ⚠️ `skill-create` → scripts/skill-create-output.js
- ⚠️ `skill-health` → scripts/skills-health.js
- ⚠️ `repo-scan` → scripts/repo-scan.js
- ⚠️ `plan-canvas` → scripts/plan-canvas.js
- ⚠️ `update-docs` → scripts/update-docs.js
- ⚠️ `security-scan` → scripts/security-scan.js

### Não Implementados (85/95)
Comandos que retornam "Unknown command" e aguardam implementação ou wrapper específico. Exemplos:
- code-review, refactor-clean, test-coverage
- Comandos de linguagem: go-*, rust-*, python-*, etc.
- Comandos de orquestração: orch-*, multi-*, epic-*

## Testes

### Teste Local
```bash
# Varredura completa com dry-run (95 comandos)
node scripts/handlers-dryrun.js

# Suite de testes críticos (12 comandos)
node scripts/test-handlers-ci.js
```

### CI/CD
Workflow: `.github/workflows/handlers-ci.yml`
- Roda em: pull requests (paths: scripts/**, .github/extensions/**, agent.yaml)
- Executa: `scripts/test-handlers-ci.js`
- Status: Verde quando todos os handlers testados passam

## Segurança

- **Modo seguro padrão**: `--dry-run` em todos os handlers por padrão
- **Sem execução de código arbitrário**: Apenas subcomandos mapeados em agent.yaml
- **Validação de entrada**: Use `run: true` apenas para ações deliberadas
- **Logs**: Todas as chamadas são registradas via Copilot (verifique logs do VS Code)

## Troubleshooting

### Handler não aparece no Copilot
1. Recarregue a extensão: paleta de comandos → "Recarregar janelas"
2. Verifique se `@github/copilot-sdk` está instalado
3. Consulte logs: VS Code → Output → "Copilot"

### Comando retorna "Unknown command"
1. Verifique se o comando existe em `agent.yaml`
2. Se há script de fallback em `scripts/`
3. Execute `node scripts/test-handlers-ci.js` localmente para diagnosticar

### Dependência ausente
```bash
npm install --save ajv # exemplo: dependência para validação
npm install # reinstale tudo
```

## Referências

- Documentação oficial: https://ecc.tools
- Repositório: https://github.com/affaan-m/ECC
- PR de integração: https://github.com/affaan-m/ECC/pull/2524

## Licença

MIT

