# Padrões Comuns

## Projetos Skeleton

Ao implementar novas funcionalidades:
1. Buscar projetos skeleton bem testados
2. Usar agentes paralelos para avaliar opções:
   - Avaliação de segurança
   - Análise de extensibilidade
   - Pontuação de relevância
   - Planejamento de implementação
3. Clonar a melhor opção como fundação
4. Iterar dentro da estrutura comprovada

## Padrões de Design

### Padrão Repository

Encapsular acesso a dados atrás de uma interface consistente:
- Definir operações padrão: findAll, findById, create, update, delete
- Implementações concretas lidam com detalhes de armazenamento (banco de dados, API, arquivo, etc.)
- A lógica de negócios depende da interface abstrata, não do mecanismo de armazenamento
- Habilita troca fácil de fontes de dados e simplifica testes com mocks

### Formato de Resposta da API

Use um envelope consistente para todas as respostas de API:
- Incluir indicador de sucesso/status
- Incluir o payload de dados (nullable em caso de erro)
- Incluir campo de mensagem de erro (nullable em caso de sucesso)
- Incluir metadados para respostas paginadas (total, página, limite)
