# Estilo de Código

## Imutabilidade (CRÍTICO)

SEMPRE crie novos objetos, NUNCA modifique os existentes:

```
// Pseudocódigo
ERRADO:  modificar(original, campo, valor) → altera o original in-place
CORRETO: atualizar(original, campo, valor) → retorna nova cópia com a alteração
```

Justificativa: Dados imutáveis previnem efeitos colaterais ocultos, facilita a depuração e permite concorrência segura.

## Organização de Arquivos

MUITOS ARQUIVOS PEQUENOS > POUCOS ARQUIVOS GRANDES:
- Alta coesão, baixo acoplamento
- 200-400 linhas típico, 800 máximo
- Extrair utilitários de módulos grandes
- Organizar por recurso/domínio, não por tipo

## Tratamento de Erros

SEMPRE trate erros de forma abrangente:
- Trate erros explicitamente em cada nível
- Forneça mensagens de erro amigáveis no código voltado para UI
- Registre contexto detalhado de erro no lado do servidor
- Nunca engula erros silenciosamente

## Validação de Entrada

SEMPRE valide nas fronteiras do sistema:
- Valide toda entrada do usuário antes de processar
- Use validação baseada em schema onde disponível
- Falhe rapidamente com mensagens de erro claras
- Nunca confie em dados externos (respostas de API, entrada do usuário, conteúdo de arquivo)

## Checklist de Qualidade de Código

Antes de marcar o trabalho como concluído:
- [ ] O código é legível e bem nomeado
- [ ] Funções são pequenas (< 50 linhas)
- [ ] Arquivos são focados (< 800 linhas)
- [ ] Sem aninhamento profundo (> 4 níveis)
- [ ] Tratamento adequado de erros
- [ ] Sem valores hardcoded (use constantes ou config)
- [ ] Sem mutação (padrões imutáveis usados)
