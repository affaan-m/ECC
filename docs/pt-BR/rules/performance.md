# Otimização de Desempenho

## Estratégia de Seleção de Modelo

**Haiku 4.5** (90% da capacidade do Sonnet, 3x economia de custo):
- Agentes leves com invocação frequente
- Programação em par e geração de código
- Agentes worker em sistemas multi-agente

**Sonnet 5** (Melhor modelo para codificação):
- Trabalho principal de desenvolvimento
- Orquestrando fluxos de trabalho multi-agente
- Tarefas de codificação complexas

**Opus 5** (Raciocínio mais profundo):
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

No Claude Code, o raciocínio adaptativo permite que o modelo decida quanto pensar em cada tarefa. Para modelos Fable, Sonnet 5 e posteriores, e Opus 4.7 e posteriores, use effort para controlar o raciocínio em vez de um orçamento fixo de tokens. Os níveis disponíveis dependem do modelo.

Controle o pensamento via:
- **Effort**: Use `/effort` na sessão, `--effort <level>` na inicialização ou `CLAUDE_CODE_EFFORT_LEVEL`; a variável de ambiente tem prioridade sobre os dois, então remova-a de onde está definida e também do shell que inicia o Claude Code (ou abra um novo shell), depois reinicie o Claude Code antes de usar outro controle. Salve um nível por modelo em `modelSettings`, dentro de `~/.claude/settings.json`; a chave antiga de usuário `effortLevel` não se aplica ao Opus 5.5 nem a modelos mais novos.
- **Toggle**: Option+T (macOS) / Alt+T (Windows/Linux), ou `alwaysThinkingEnabled` nas configurações. Essas opções não desativam o pensamento em Opus 5.5, Sonnet 5.5 ou modelos Fable.
- **Orçamento fixo**: O Claude Code ignora valores positivos de `MAX_THINKING_TOKENS` em modelos com raciocínio adaptativo. Em Opus 4.6 ou Sonnet 4.6, defina `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` para usar um orçamento fixo com `MAX_THINKING_TOKENS`.
- **Modo verbose**: Ctrl+O para ver a saída de pensamento

Consulte a [configuração de modelos do Claude Code](https://code.claude.com/docs/en/model-config#adjust-effort-level) e as [variáveis de ambiente](https://code.claude.com/docs/en/env-vars) para os controles suportados.

Para tarefas complexas que exigem raciocínio profundo:
1. Verifique o nível atual e escolha um nível mais alto suportado com `/effort`; o Opus 4.7 já começa em `xhigh`, então `high` reduziria o nível
2. Habilite o **Modo de Plano** para uma abordagem estruturada
3. Use várias rodadas de crítica para uma análise minuciosa
4. Use subagentes com papéis divididos para perspectivas diversas

## Resolução de Problemas de Build

Se o build falhar:
1. Use o agente **build-error-resolver**
2. Analise mensagens de erro
3. Corrija incrementalmente
4. Verifique após cada correção
