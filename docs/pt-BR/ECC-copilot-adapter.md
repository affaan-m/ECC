# ECC Copilot Adapter — Guia rápido (PT-BR)

Resumo
- Esta extensão registra handlers que expõem comandos definidos em agent.yaml como ferramentas do Copilot.
- Por segurança, os handlers chamam o CLI principal (scripts/ecc.js) com `--dry-run` por padrão.
- Para executar ações reais via handler, passe o parâmetro `run: true` quando aplicável (ou remova `--dry-run` em chamadas diretas).

Principais ferramentas expostas
- ecc-help — ajuda mínima do ECC
- ecc-run — executar qualquer comando do ECC e retornar code/stdout/stderr
- ecc-<comando> — wrapper para cada comando listado em agent.yaml (ex.: ecc-plan, ecc-skill-create, ecc-repo-scan)

Fallbacks
- Se o CLI retornar "Unknown command" ou erro, o handler tenta executar um script de fallback em `scripts/<comando>.js` quando existir.

Como usar (exemplos)
- Dry-run (padrão): chame o handler sem `run` ou com `run: false`.
- Execução real (cuidado): chame o handler com `run: true`.

Exemplo (exposição do Copilot runtime)
- Invocar ferramenta `ecc-plan` com argumentos:
  { "args": ["--profile","default"], "run": false }

Verificações e testes
- Um script de verificação está disponível: `scripts/handlers-dryrun.js` — executa `--dry-run` para os comandos listados em `agent.yaml` e imprime resultados.

Notas
- A extensão depende do runtime do Copilot para ser carregada (`@github/copilot-sdk`).
- O script `scripts/ecc.js` é o ponto de entrada do CLI do projeto.

Licença: MIT
