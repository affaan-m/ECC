# Requisitos de Teste

## Cobertura Mínima de Teste: 80%

Tipos de Teste (TODOS obrigatórios):
1. **Testes Unitários** - Funções individuais, utilitários, componentes
2. **Testes de Integração** - Endpoints de API, operações de banco de dados
3. **Testes E2E** - Fluxos críticos do usuário (framework escolhido por linguagem)

## Desenvolvimento Orientado a Testes (TDD)

Fluxo de trabalho OBRIGATÓRIO:
1. Escreva o teste primeiro (VERMELHO)
2. Execute o teste - deve FALHAR
3. Escreva a implementação mínima (VERDE)
4. Execute o teste - deve PASSAR
5. Refatore (MELHORE)
6. Verifique cobertura (80%+)

## Resolução de Falhas de Teste

1. Use o agente **tdd-guide**
2. Verifique o isolamento de teste
3. Verifique se os mocks estão corretos
4. Corrija a implementação, não os testes (a menos que os testes estejam errados)

## Suporte de Agentes

- **tdd-guide** - Use PROATIVAMENTE para novos recursos, aplica escrever-testes-primeiro
