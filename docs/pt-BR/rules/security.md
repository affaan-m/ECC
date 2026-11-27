# Diretrizes de Segurança

## Verificações de Segurança Obrigatórias

Antes de QUALQUER commit:
- [ ] Sem segredos hardcoded (chaves de API, senhas, tokens)
- [ ] Todas as entradas do usuário validadas
- [ ] Prevenção de injeção SQL (queries parametrizadas)
- [ ] Prevenção de XSS (HTML sanitizado)
- [ ] Proteção CSRF habilitada
- [ ] Autenticação/autorização verificada
- [ ] Rate limiting em todos os endpoints
- [ ] Mensagens de erro não vazam dados sensíveis

## Gerenciamento de Segredos

- NUNCA hardcode segredos no código-fonte
- SEMPRE use variáveis de ambiente ou um gerenciador de segredos
- Valide que os segredos necessários estão presentes na inicialização
- Rotacione quaisquer segredos que possam ter sido expostos

## Protocolo de Resposta a Segurança

Se um problema de segurança for encontrado:
1. PARE imediatamente
2. Use o agente **security-reviewer**
3. Corrija problemas CRÍTICOS antes de continuar
4. Rotacione quaisquer segredos expostos
5. Revise toda a base de código por problemas similares
