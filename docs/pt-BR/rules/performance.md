# Otimização de Desempenho

## Estratégia de Seleção de Modelo

**Haiku 4.5** (90% da capacidade do Sonnet, 3x economia de custo):
- Agentes leves com invocação frequente
- Programação em par e geração de código
- Agentes worker em sistemas multi-agente

**Sonnet 4.6** (Melhor modelo para codificação):
- Trabalho principal de desenvolvimento
- Orquestrando fluxos de trabalho multi-agente
- Tarefas de codificação complexas

**Opus 4.6** (Raciocínio mais profundo):
- Decisões arquiteturais complexas
- Requisitos máximos de raciocínio
- Pesquisa e análise

## Gerenciamento da Janela de Contexto

Evite os últimos 20% da janela de contexto para:
- Refatoração em grande escala
- Implementação de recursos abrangendo múltiplos arquivos
- Depuração de interações complexas

Tarefas com menor sensibilidade ao contexto:
- Edições de arquivo único
- Criação de utilitários independentes
- Atualizações de documentação
- Correções de bugs simples

## Pensamento Estendido + Modo de Plano

O pensamento estendido está habilitado por padrão, reservando até 31.999 tokens para raciocínio interno.

Controle o pensamento estendido via:
- **Toggle**: Option+T (macOS) / Alt+T (Windows/Linux)
- **Config**: Defina `alwaysThinkingEnabled` em `~/.claude/settings.json`
- **Limite de orçamento**: `export MAX_THINKING_TOKENS=10000` (bash) ou `$env:MAX_THINKING_TOKENS = "10000"` (PowerShell)
- **Modo verbose**: Ctrl+O para ver a saída de pensamento

Para tarefas complexas que requerem raciocínio profundo:
1. Garantir que o pensamento estendido esteja habilitado (habilitado por padrão)
2. Habilitar **Modo de Plano** para abordagem estruturada
3. Usar múltiplas rodadas de crítica para análise minuciosa
4. Usar subagentes com papéis divididos para perspectivas diversas

## Resolução de Problemas de Build

Se o build falhar:
1. Use o agente **build-error-resolver**
2. Analise mensagens de erro
3. Corrija incrementalmente
4. Verifique após cada correção
