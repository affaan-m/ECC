# Contribuindo para o ECC

Obrigado por querer contribuir! Este repositório é um recurso comunitário para usuários do Claude Code.

## Índice

- [O Que Estamos Buscando](#o-que-estamos-buscando)
- [Início Rápido](#início-rápido)
- [Contribuindo com Skills](#contribuindo-com-skills)
- [Contribuindo com Agentes](#contribuindo-com-agentes)
- [Contribuindo com Hooks](#contribuindo-com-hooks)
- [Contribuindo com Comandos](#contribuindo-com-comandos)
- [MCP e Documentação (ex: Context7)](#mcp-e-documentação-ex-context7)
- [Multiplataforma e Traduções](#multiplataforma-e-traduções)
- [Processo de Pull Request](#processo-de-pull-request)

---

## O Que Estamos Buscando

### Agentes
Novos agentes que lidam bem com tarefas específicas:
- Revisores específicos de linguagem (Python, Go, Rust)
- Especialistas em frameworks (Django, Rails, Laravel, Spring)
- Especialistas em DevOps (Kubernetes, Terraform, CI/CD)
- Especialistas de domínio (pipelines de ML, engenharia de dados, mobile)

### Skills
Definições de fluxo de trabalho e conhecimento de domínio:
- Melhores práticas de linguagem
- Padrões de frameworks
- Estratégias de testes
- Guias de arquitetura

### Hooks
Automações úteis:
- Hooks de lint/formatação
- Verificações de segurança
- Hooks de validação
- Hooks de notificação

### Comandos
Comandos slash que invocam fluxos de trabalho úteis:
- Comandos de implantação
- Comandos de teste
- Comandos de geração de código

---

## Início Rápido

```bash
# 1. Fork e clone
gh repo fork affaan-m/ECC --clone
cd ECC

# 2. Criar uma branch
git checkout -b feat/minha-contribuicao

# 3. Adicionar sua contribuição (veja as seções abaixo)

# 4. Testar localmente
cp -r skills/minha-skill ~/.claude/skills/  # para skills
# Em seguida teste com o Claude Code

# 5. Enviar PR
git add . && git commit -m "feat: adicionar minha-skill" && git push -u origin feat/minha-contribuicao
```

---

## Contribuindo com Skills

Skills são módulos de conhecimento que o Claude Code carrega baseado no contexto.

### Estrutura de Diretório

```
skills/
└── nome-da-sua-skill/
    └── SKILL.md
```

### Template SKILL.md

```markdown
---
name: nome-da-sua-skill
description: Breve descrição mostrada na lista de skills
origin: ECC
---

# Título da Sua Skill

Breve visão geral do que esta skill cobre.

## Conceitos Principais

Explique padrões e diretrizes chave.

## Exemplos de Código

\`\`\`typescript
// Inclua exemplos práticos e testados
function exemplo() {
  // Código bem comentado
}
\`\`\`

## Melhores Práticas

- Diretrizes acionáveis
- O que fazer e o que não fazer
- Armadilhas comuns a evitar

## Quando Usar

Descreva cenários onde esta skill se aplica.
```

### Checklist de Skill

- [ ] Focada em um domínio/tecnologia
- [ ] Inclui exemplos práticos de código
- [ ] Abaixo de 500 linhas
- [ ] Usa cabeçalhos de seção claros
- [ ] Testada com o Claude Code

### Exemplos de Skills

| Skill | Propósito |
|-------|-----------|
| `coding-standards/` | Padrões TypeScript/JavaScript |
| `frontend-patterns/` | Melhores práticas React e Next.js |
| `backend-patterns/` | Padrões de API e banco de dados |
| `security-review/` | Checklist de segurança |

---

## Contribuindo com Agentes

Agentes são assistentes especializados invocados via a ferramenta Task.

### Localização do Arquivo

```
agents/nome-do-seu-agente.md
```

### Template de Agente

```markdown
---
name: nome-do-seu-agente
description: O que este agente faz e quando o Claude deve invocá-lo. Seja específico!
tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
---

Você é um especialista em [função].

## Seu Papel

- Responsabilidade principal
- Responsabilidade secundária
- O que você NÃO faz (limites)

## Fluxo de Trabalho

### Passo 1: Entender
Como você aborda a tarefa.

### Passo 2: Executar
Como você realiza o trabalho.

### Passo 3: Verificar
Como você valida os resultados.

## Formato de Saída

O que você retorna ao usuário.

## Exemplos

### Exemplo: [Cenário]
Entrada: [o que o usuário fornece]
Ação: [o que você faz]
Saída: [o que você retorna]
```

### Campos do Agente

| Campo | Descrição | Opções |
|-------|-----------|--------|
| `name` | Minúsculas, com hifens | `code-reviewer` |
| `description` | Usado para decidir quando invocar | Seja específico! |
| `tools` | Apenas o que é necessário | `Read, Write, Edit, Bash, Grep, Glob, WebFetch, Task` |
| `model` | Nível de complexidade | `haiku` (simples), `sonnet` (codificação), `opus` (complexo) |

### Agentes de Exemplo

| Agente | Propósito |
|--------|-----------|
| `tdd-guide.md` | Desenvolvimento orientado a testes |
| `code-reviewer.md` | Revisão de código |
| `security-reviewer.md` | Varredura de segurança |
| `build-error-resolver.md` | Correção de erros de build |

---

## Contribuindo com Hooks

Hooks são comportamentos automáticos disparados por eventos do Claude Code.

### Localização do Arquivo

```
hooks/hooks.json
```

### Tipos de Hooks

| Tipo | Gatilho | Caso de Uso |
|------|---------|-------------|
| `PreToolUse` | Antes da execução da ferramenta | Validar, avisar, bloquear |
| `PostToolUse` | Após a execução da ferramenta | Formatar, verificar, notificar |
| `SessionStart` | Sessão começa | Carregar contexto |
| `Stop` | Sessão termina | Limpeza, auditoria |

### Formato de Hook

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"rm -rf /\"",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Hook] BLOQUEADO: Comando perigoso' && exit 1"
          }
        ],
        "description": "Bloquear comandos rm perigosos"
      }
    ]
  }
}
```

### Sintaxe de Matcher

```javascript
// Corresponder ferramentas específicas
tool == "Bash"
tool == "Edit"
tool == "Write"

// Corresponder padrões de entrada
tool_input.command matches "npm install"
tool_input.file_path matches "\\.tsx?$"

// Combinar condições
tool == "Bash" && tool_input.command matches "git push"
```

### Checklist de Hook

- [ ] O matcher é específico (não excessivamente abrangente)
- [ ] Inclui mensagens de erro/informação claras
- [ ] Usa códigos de saída corretos (`exit 1` bloqueia, `exit 0` permite)
- [ ] Testado exaustivamente
- [ ] Tem descrição

---

## Contribuindo com Comandos

Comandos são ações invocadas pelo usuário com `/nome-do-comando`.

### Localização do Arquivo

```
commands/seu-comando.md
```

### Template de Comando

```markdown
---
description: Breve descrição mostrada em /help
---

# Nome do Comando

## Propósito

O que este comando faz.

## Uso

\`\`\`
/seu-comando [args]
\`\`\`

## Fluxo de Trabalho

1. Primeiro passo
2. Segundo passo
3. Passo final

## Saída

O que o usuário recebe.
```

---

## MCP e Documentação (ex: Context7)

Skills e agentes podem usar ferramentas **MCP (Model Context Protocol)** para obter dados atualizados em vez de depender apenas de dados de treinamento. Isso é especialmente útil para documentação.

- **Context7** é um servidor MCP que expõe `resolve-library-id` e `query-docs`. Use quando o usuário perguntar sobre bibliotecas, frameworks ou APIs para que as respostas reflitam a documentação atual.
- Ao contribuir com **skills** que dependem de docs em tempo real, descreva como usar as ferramentas MCP relevantes.
- Ao contribuir com **agentes** que respondem perguntas sobre docs/API, inclua os nomes das ferramentas MCP do Context7 nas ferramentas do agente.

---

## Multiplataforma e Traduções

### Subconjuntos de Skills (Codex e Cursor)

O ECC vem com subconjuntos de skills para outros harnesses:

- **Codex:** `.agents/skills/` — skills listadas em `agents/openai.yaml` são carregadas pelo Codex.
- **Cursor:** `.cursor/skills/` — um subconjunto de skills é incluído para Cursor.

Ao **adicionar uma nova skill** que deve estar disponível no Codex ou Cursor:

1. Adicione a skill em `skills/nome-da-sua-skill/` como de costume.
2. Se deve estar disponível no **Codex**, adicione-a em `.agents/skills/` e garanta que seja referenciada em `agents/openai.yaml` se necessário.
3. Se deve estar disponível no **Cursor**, adicione-a em `.cursor/skills/`.

### Traduções

Traduções ficam em `docs/` (ex: `docs/zh-CN`, `docs/zh-TW`, `docs/ja-JP`, `docs/ko-KR`, `docs/pt-BR`). Se você alterar agentes, comandos ou skills que são traduzidos, considere atualizar os arquivos de tradução correspondentes ou abrir uma issue.

---

## Processo de Pull Request

### 1. Formato do Título do PR

```
feat(skills): adicionar skill rust-patterns
feat(agents): adicionar agente api-designer
feat(hooks): adicionar hook auto-format
fix(skills): atualizar padrões React
docs: melhorar guia de contribuição
docs(pt-BR): adicionar tradução para português brasileiro
```

### 2. Descrição do PR

```markdown
## Resumo
O que você está adicionando e por quê.

## Tipo
- [ ] Skill
- [ ] Agente
- [ ] Hook
- [ ] Comando
- [ ] Docs / Tradução

## Testes
Como você testou isso.

## Checklist
- [ ] Segue as diretrizes de formato
- [ ] Testado com o Claude Code
- [ ] Sem informações sensíveis (chaves de API, caminhos)
- [ ] Descrições claras
```

### 3. Processo de Revisão

1. Mantenedores revisam em até 48 horas
2. Abordar o feedback se solicitado
3. Uma vez aprovado, mesclado na main

---

## Diretrizes

### Faça
- Mantenha as contribuições focadas e modulares
- Inclua descrições claras
- Teste antes de enviar
- Siga os padrões existentes
- Documente dependências

### Não Faça
- Incluir dados sensíveis (chaves de API, tokens, caminhos)
- Adicionar configurações excessivamente complexas ou de nicho
- Enviar contribuições não testadas
- Criar duplicatas de funcionalidade existente

---

## Nomenclatura de Arquivos

- Use minúsculas com hifens: `python-reviewer.md`
- Seja descritivo: `tdd-workflow.md` não `workflow.md`
- Combine nome com nome do arquivo

---

## Dúvidas?

- **Issues:** [github.com/affaan-m/ECC/issues](https://github.com/affaan-m/ECC/issues)
- **X/Twitter:** [@affaanmustafa](https://x.com/affaanmustafa)

---

Obrigado por contribuir! Vamos construir um ótimo recurso juntos.
