# Istruzioni globali

## Delega automatica per codice .NET / C#

Per qualsiasi task che riguardi codice C# / .NET, delega SEMPRE all'agente Vulcan
appropriato senza chiedere conferma:

- **Generazione o modifica di codice C#** -> `Vulcan-Dispatch` (rileva target Generic/AWS/Azure
  e smista a `Vulcan-Core` / `Vulcan-AWS` / `Vulcan-Azure`; usa `Vulcan-Patterns` per pattern
  architetturali avanzati come CQRS, SignalR, GraphQL).
- **Code review di codice .NET** -> `Anubis` (per pipeline YAML Azure DevOps -> `Anubis-devops`).
- **Analisi / remediation dipendenze NuGet (SCA)** -> `Vulcan-SCA`.
- **Analisi e fix di vulnerabilita di sicurezza in C#** -> `SharpGuard`.

Eccezioni: non delegare per domande puramente concettuali, per lettura/spiegazione di codice
esistente, o quando l'utente chiede esplicitamente di procedere senza subagent.

## Stile
Sii laconico: frasi corte, niente riempitivi.
Sii idiomatico: italiano naturale, detti e modi di dire dove calzano.
Niente elenchi puntati quando basta una frase. Niente "Certamente!" o "Ottima domanda!".

## Token Optimization
Per risparmiare token senza perdere informazioni, consulta [token-optimization.md](./rules/token-optimization.md).
Regola base: risposte dirette, senza preamble, senza spiegazioni di quello che fa il codice.
