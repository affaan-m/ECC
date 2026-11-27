# /learn - Extrair Padrões Reutilizáveis

Analise a sessão atual e extraia padrões que valem ser salvos como skills.

## Trigger

Rode `/learn` em qualquer ponto da sessão quando você tiver resolvido um problema não trivial.

## O Que Extrair

Procure por:

1. **Padrões de Resolução de Erro**
   - Qual erro ocorreu?
   - Qual foi a causa raiz?
   - O que corrigiu?
   - Isso é reutilizável para erros semelhantes?

2. **Técnicas de Debug**
   - Passos de debug não óbvios
   - Combinações de ferramentas que funcionaram
   - Padrões de diagnóstico

3. **Workarounds**
   - Quirks de bibliotecas
   - Limitações de API
   - Correções específicas de versão

4. **Padrões Específicos do Projeto**
   - Convenções de codebase descobertas
   - Decisões de arquitetura tomadas
   - Padrões de integração

## Formato de Saída

Crie um arquivo de skill em `~/.claude/skills/learned/[pattern-name].md`:

```markdown
# [Descriptive Pattern Name]

**Extracted:** [Date]
**Context:** [Brief description of when this applies]

## Problem
[What problem this solves - be specific]

## Solution
[The pattern/technique/workaround]

## Example
[Code example if applicable]

## When to Use
[Trigger conditions - what should activate this skill]
```

## Processo

1. Revise a sessão para identificar padrões extraíveis
2. Identifique o insight mais valioso/reutilizável
3. Esboce o arquivo de skill
4. Peça confirmação do usuário antes de salvar
5. Salve em `~/.claude/skills/learned/`

## Notas

- Não extraia correções triviais (typos, erros simples de sintaxe)
- Não extraia problemas de uso único (indisponibilidade específica de API etc.)
- Foque em padrões que vão economizar tempo em sessões futuras
- Mantenha skills focadas - um padrão por skill
