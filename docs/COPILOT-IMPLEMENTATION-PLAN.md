# ECC4CopilotCLI — Piano di implementazione del porting

Data: 3 novembre 2026, Europe/Rome. Stato: piano proposto, sottoposto a revisione; nessuna implementazione o pubblicazione eseguita con questo documento.

## 1. Obiettivo e definizione di completamento

Completare il porting delle capacità ECC per GitHub Copilot CLI mantenendo un solo nucleo di algoritmi canonici e adattando gli aspetti propri dell'host: eventi, tool, permessi, storage, discovery e distribuzione.

«Completo» significa che ogni capacità dell'inventario di riferimento ha una destinazione documentata: implementata e verificata; equivalente funzionale con differenze esplicite; oppure non applicabile per un limite dimostrato dell'host. Una funzione mancante non diventa non applicabile per chiudere il progetto. Non si dichiarerà parità letterale con Claude Code dove Copilot ha semantiche diverse.

Due traguardi distinti:

- **M1, porting funzionale del perimetro certificato:** installer per progetto, automazioni, agent, catalogo, memoria e integrazioni effettivamente provate sulle piattaforme dichiarate; plugin nativo non necessario per usare M1. Le integrazioni esterne non provate figurano in un elenco chiuso di esclusioni dalla certificazione. Se una di esse è richiesta dal perimetro concordato, M1 resta parziale finché non viene verificata o la variazione di scope viene accettata esplicitamente.
- **M2, distribuzione completa:** M1 più plugin nativo, coesistenza con l'installer, aggiornamento/disinstallazione e documentazione di rilascio verificati.

L'intero progetto termina con M2. Una beta Windows può uscire prima, purché Linux/macOS restino esplicitamente non certificati fino alle relative prove.

## 2. Baseline verificata e limiti dell'analisi

Repository: `manuel-albanesee/ECC`. Branch: `feat/copilot-memory-commands`. HEAD verificato: `a64711b70660e6f53e6f4066762a5bf3a67f4485`. Al confronto svolto il branch era avanti di 3 commit e indietro di 0 rispetto a `affaan-m/ECC:main`, con base `b38be6a7f6350964d59328b52f0624e1d1d552d1`. Questi valori sono una fotografia, non una garanzia per la prossima sessione.

Sono stati letti i quattro documenti Copilot, l'adattatore del target, le trasformazioni di agent/skill/comandi, il registro delle policy Copilot, gli hook canonici e i relativi metadati/dispatcher, la skill continuous-learning-v2, unified-memory e gli script di test/package pertinenti. Non è stato auditato integralmente ogni file del catalogo.

Esistono già:

| Capacità | Evidenza attuale | Limite da mantenere esplicito |
| --- | --- | --- |
| Comandi | Inventario documentato: 12 canonical, 43 portable, 43 copilot-native, 0 blocked | 98 entry point non equivalgono a 98 integrazioni provate con account reali |
| Hook | Quattro policy in `scripts/lib/copilot-hooks.js`, lifecycle dedicato e Hookify | Molti hook canonici non sono collegati al target Copilot |
| Sessioni | Checkpoint per workspace/sessione, richiamo e osservazioni transcript opzionali | Non è il Memory Vault e non è un observer di apprendimento |
| Learning | Launcher e comandi instinct/evolve/promote/prune | Non installano l'osservazione automatica in background |
| Orchestration/epic/tool | Helper e test dedicati, backends/configurazione espliciti | Alcune funzioni richiedono checkout ECC fissato, Python, gh o modelli autenticati |
| Agent | Frontmatter proiettato a `name`/`description` | La trasformazione elimina anche `tools`; occorre una decisione esplicita sui limiti nativi |
| Installer | Ownership, consenso hook, repair/uninstall | Non configura MCP e non produce il plugin Copilot nativo |

Il README contiene ancora una riga obsoleta secondo cui il target non installerebbe hook e command shim. Va corretta nella prima PR documentale.

Nell'ambiente di pianificazione sono presenti Git, Node e Python, ma non `gh` o `copilot` nel PATH. È stata usata la connessione GitHub per letture; non è stato clonato né modificato il repository. Non sono stati eseguiti test del progetto o sessioni Copilot. Le proposte seguenti non costituiscono risultati di test. Sul commit ispezionato la query GitHub check-runs restituiva zero controlli.

## 3. Metodo ECC applicato

Il piano applica `blueprint` per passi da PR, dipendenze, contesti autosufficienti, rollback e revisione avversaria; `agentic-engineering` per criteri di uscita prima del codice, baseline, verifiche e decomposizione. Ogni PR dovrà applicare gli strumenti ECC più pertinenti al suo rischio, senza caricare l'intero catalogo.

| Strumento ECC | Impiego nelle PR |
| --- | --- |
| agent-harness-construction | Contratto eventi/tool, capacità dell'host e feedback agli agent |
| agent-security-hardening | Confini fra eventi non fidati, eseguibili, file e permessi |
| api-design | Formati versionati dei record e interfacce interne; non richiede creare API HTTP |
| ai-regression-testing | Errori sintetici, regressioni fra host e separazione fra stub e prove native |
| agent-eval | Confronto comportamentale su task ripetibili e costi degli esperimenti |
| benchmark / benchmark-optimization-loop | Budget di latenza per hook, observer e controlli qualità, dopo la baseline |
| agent-self-evaluation | Controllo finale di accuratezza, completezza, chiarezza e verificabilità |

I nomi corrispondono a strumenti ECC; disponibilità e contenuto vanno ricontrollati nella sessione di implementazione. Non si presume che siano tutti installati in ogni host futuro.

## 4. Regole architetturali

1. Gli algoritmi restano nei moduli canonici. Gli adattatori Copilot convertono dati e invocano entry point espliciti: nessuna esecuzione dei bootstrap shell Claude.
2. Il contratto interno distingue almeno sessione, workspace canonico, evento, tool, argomenti, esito e identità della chiamata quando disponibile. Campi non disponibili restano sconosciuti, non vengono inventati.
3. Gli hook non concedono permessi aggiuntivi. Un errore pre-tool su un'operazione soggetta a controllo non deve diventare un'approvazione; la policy di errore è documentata per ciascun evento.
4. Distinguere configurazione controllata dall'operatore, contenuto del repository ed eventi/memorie. I dati non selezionano eseguibili arbitrari o radici runtime.
5. Separare checkpoint, osservazioni, instinct candidati e Memory Vault. Nessuna promozione automatica da transcript a regole attive o memoria condivisa.
6. State privato sotto la radice Copilot risolta, con isolamento per progetto/sessione, limiti, locking e scritture atomiche. Le identità di progetto dei diversi sottosistemi possono differire: stabilire un mapping esplicito, senza cambiare silenziosamente gli hash esistenti.
7. Ogni capacità opzionale ha una modalità disabilitata verificabile. Repair/uninstall rispettano ownership, modifiche dell'utente e dati privati.
8. I profili `minimal`, `standard`, `strict` rimangono espliciti: evitare regressioni di significato e attivazioni involontarie.
9. Plugin e installer condividono generazione e runtime; non diventano due implementazioni indipendenti.
10. Compatibilità dichiarata per versione CLI, sistema operativo e modalità di installazione. Un test con payload sintetico non certifica l'host.

## 5. Backlog, dipendenze e milestone

Le dimensioni S/M/L esprimono complessità relativa, non giorni garantiti. Se un passo supera una PR revisionabile, dividerlo preservando le dipendenze e aggiornare il registro del piano.

| ID | PR / risultato | Dipende da | Priorità | Dimensione |
| --- | --- | --- | --- | --- |
| P00 | Inventario di parità, baseline e smoke nativo iniziale | — | P0 | M |
| P01 | Contratto eventi, registry e chiusura delle dipendenze runtime | P00 | P0 | M |
| P02 | GateGuard, Bash/PowerShell e controlli shell | P01 | P0 | L |
| P03 | Automazioni di qualità a fine risposta | P01 | P0 | L |
| P04 | Telemetria skill, metriche e contesto | P01 | P1 | M |
| P05 | Raccolta osservazioni per continuous learning | P01 | P1 | M |
| P06 | Analisi osservazioni e observer gestito | P05, P09 | P1 | L |
| P07 | Configurazione MCP selettiva e diagnostica | P01 | P1 | M |
| P08 | Integrazione Memory Vault e handoff | P07 | P1 | M |
| P09 | Tool e limiti dei custom agent | P01 | P0 | M |
| P10 | Audit completo delle integrazioni del catalogo | P00, P06, P08, P09 | P1 | L |
| P11 | Plan Canvas, notifiche e automazioni accessorie | P01, P04 | P2 | M |
| P12 | Prove native complete e funzioni avanzate | P02–P11 | P0 | L |
| P13 | Plugin nativo e coesistenza con installer | P12 | P1 | L |
| P14 | Certificazione piattaforme e release | P12, P13 | P0 | M |

Il censimento di P10 parte in P00; le sue correzioni vengono concluse solo quando i runtime richiesti sono disponibili. P12 è una validazione cumulativa, mentre smoke nativi e test mirati iniziano già nelle singole PR.

Dopo P01, P02/P03/P04/P05/P07/P09 sono logicamente indipendenti. Condividono però alcuni file di installazione e registry: realizzare i moduli separatamente, poi integrare in sequenza gli aggiornamenti di `copilot-hooks.js`, del target e dei manifest. Non assumere che indipendenza funzionale significhi assenza di conflitti Git. P06 segue P05 e P09; P08 segue P07. P11 può progredire dopo P04. P13 segue la chiusura della prima verifica funzionale M1 in P12; P14 chiude M2.

## 6. Schede eseguibili per PR

I file indicati come «nuovi» sono proposte, non file già presenti. Ogni agente deve leggere il codice attuale prima di scegliere i nomi definitivi. Per ogni passo: branch proposto `feat/copilot-pNN-<tema>`, partendo dall'ultimo branch di integrazione verificato. Il proprietario logico è un implementatore, con reviewer distinto per gli invarianti critici.

### P00 — Baseline, inventario e prova nativa iniziale

**Contesto.** Partire dal commit fissato della sezione 2 e dai documenti `docs/COPILOT-*.md`. Il branch esistente contiene già gli helper dei 98 comandi: non ricominciare il porting da zero.

**Interventi.** Registrare SHA upstream/fork, versioni Node/Python/CLI, sistema operativo e mode di installazione. Confrontare `hooks/hooks.metadata.json`, i dispatcher Bash/PostToolUse e i moduli di installazione con quanto il target Copilot emette davvero. Creare un inventario machine-readable proposto in `manifests/copilot-capabilities.json` e un report umano in `docs/COPILOT-PARITY.md`. Per ciascuna capacità: ID canonico, sorgente, evento/tool richiesto, stato, prerequisiti, differenze, test automatico, evidenza nativa e PR responsabile. Includere tutte le policy annidate nei dispatcher, non solo le voci del manifest. Correggere la riga obsoleta del README.

**Verifica.** Eseguire la suite Copilot esistente e registrare separatamente fail preesistenti. In un progetto temporaneo su Windows installare il target, verificare discovery di una skill/un agent, una negazione pre-tool, feedback post-tool e checkpoint→riavvio→recall. Raccogliere eventi redatti e forma effettiva dei tool, soprattutto PowerShell/apply_patch. Se l'host non è disponibile, mantenere lo stato `native-unverified` e assegnare la prova al primo host disponibile; nessun avanzamento a M1 prima della prova.

**Uscita.** Ogni elemento del perimetro ha una riga e una destinazione; versioni e risultati sono riproducibili. **Rollback:** rimuovere solo fixture/installazione nel progetto temporaneo; nessun dato personale toccato. **Rischio:** scambiare file presenti per funzioni operative.

Assegnare ID stabili ai casi del corpus e identificare un responsabile tecnico dei gate. P00 produce la baseline; P01 fissa i budget e le soglie prima di implementare P02–P11. Zero falsi negativi sul corpus delle negazioni obbligatorie; ogni falso positivo nei casi benigni obbligatori va risolto o dichiarato come limite prima del rilascio. Le soglie di latenza dipendono dalla piattaforma misurata e non si cambiano retroattivamente senza motivazione e nuova baseline.

### P01 — Contratto eventi, registry e dipendenze

**Contesto.** Leggere `scripts/hooks/copilot-hook-adapter.js`, `scripts/lib/copilot-native-events.js`, `scripts/lib/copilot-hooks.js`, `scripts/lib/install/copilot-hooks.js` e `scripts/lib/install-targets/copilot-project.js`. Conservare gli helper esistenti funzionanti.

**Interventi.** Definire un envelope versionato e parser condivisi per eventi/tool, mantenendo semantiche distinte per pre/post/stop/compact. Rendere espliciti payload, output consentiti e politica sugli errori. Centralizzare il registro delle capacità e la dipendenza di file da distribuire. Mantenere limiti di input/output/timeout ed evitare che un evento esegua una policy più volte. Non deduplicare usando solo hash del contenuto: chiamate uguali possono essere azioni distinte.

**Verifica.** Fixture native redatte più casi malformed, campi mancanti, alias in conflitto, eventi/tool ignoti, output malformato, processi terminati e timeout. Testare più hook sullo stesso evento e priorità dei deny. Installare il pacchetto in directory temporanea priva del checkout sorgente e provare il runtime da lì.

**Uscita.** Contratto documentato e vecchi comportamenti preservati; nessuna dipendenza nascosta dal checkout o da Claude. **Rollback:** mantenere la vecchia allowlist attivabile fino alla migrazione completata. **Rischio:** creare un normalizzatore tanto generico da cancellare differenze dell'host.

Definire anche il contratto di evoluzione degli store: fixture dei record creati dalla versione attuale, lettura compatibile ove possibile, backup prima di conversioni, migrazioni esplicite e atomiche, rifiuto delle versioni future sconosciute. Il rollback deve mantenere leggibili i dati precedenti e non reinterpretare cursori o mapping con significato diverso. Il responsabile tecnico approva e versiona qui le soglie dei gate, prima degli interventi funzionali.

### P02 — GateGuard e controlli shell, con priorità Windows

**Contesto.** L'adattatore attuale offre `block-no-verify` per Bash, mentre il canonico include `gateguard-fact-force.js` e controlli preflight Bash. Leggere `bash-hook-dispatcher.js`, gli scanner shell e gli hook GateGuard prima di adattarli.

**Interventi.** Collegare progressivamente GateGuard su file e shell; riusare gli algoritmi canonici e introdurre parsing PowerShell dedicato dove la grammatica diverge. Portare i controlli commit/push/dev-server applicabili e marcare tmux come dipendenza opzionale sui sistemi pertinenti. Stabilire come le evidenze richieste da GateGuard si ottengono in Copilot e come scadono per turno/sessione. Se il dato nativo manca, non simulare evidenze: progettare un equivalente verificabile e dichiararne il limite.

**Verifica.** Corpus sintetico per cancellazioni distruttive, reset/clean/force push, quoting, alias, pipeline e sottocomandi Bash/PowerShell. File sensibili, move/rename/apply_patch, più target, symlink/hardlink e scritture shell. Comandi benigni simili per misurare i falsi positivi. Eseguire i casi distruttivi solo in fixture isolate o intercettando la richiesta prima dell'esecuzione.

**Uscita.** Ogni policy del gruppo ha prove positive/negative e una ragione leggibile nell'host reale; PowerShell non eredita per supposizione la copertura Bash. **Rollback:** disabilitare i nuovi ID tramite i controlli ECC e tornare al sottoinsieme precedente. **Rischio:** negazioni aggirabili oppure blocchi ripetuti senza possibilità di fornire evidenza.

### P03 — Formattazione e verifiche automatiche

**Contesto.** Esiste il comando manuale quality-gate, ma il canonico accumula modifiche ed esegue `stop-format-typecheck.js`. Leggere anche `post-edit-accumulator.js`, `quality-gate.js`, `design-quality-check.js` e `check-console-log.js`.

**Interventi.** Accumulare i target modificati con esito osservato e conservarli per workspace/sessione/turno quando il contratto lo permette. Eseguire formatter/typecheck una volta per insieme di modifiche a fine turno; rieseguire se intervengono nuovi edit. Usare toolchain locali del progetto e processi senza interpolazione shell. Definire modalità check/fix: la correzione automatica richiede la configurazione prevista, mentre check-only è il default proposto. Integrare controlli design e console senza duplicare l'avviso post-edit già presente.

**Verifica.** Progetti fixture JS/TS con e senza formatter, errori tsc, file cancellati, edit falliti, cambi concorrenti e più turni/sessioni. Arresto del processo, chiamate ripetute ad agentStop, ricorsione e timeout. Una toolchain assente deve risultare non disponibile, non successo. Stabilire un budget di latenza dalla baseline prima di imporre soglie in CI.

**Uscita.** Un edit osservabile produce esattamente il controllo previsto; nessun loop infinito di blocco/stop e nessuna formattazione di file estranei. **Rollback:** disabilitare i nuovi hook lasciando disponibile il comando manuale. **Rischio:** modifiche tardive ai file e stop bloccati indefinitamente.

Registrare nella matrice la differenza fra check-only proposto e autoformat canonico. La capacità di formattazione automatica è completata solo quando anche la modalità fix, la configurazione che la abilita e le prove native di entrambe le modalità sono disponibili. Check-only non chiude da solo la voce autoformat.

### P04 — Telemetria, skill-health, contesto e governance

**Contesto.** Il canonico dispone di skill-run-tracker, metrics bridge, context monitor e governance capture. Un comando health senza raccolta dati non fornisce misurazioni significative.

**Interventi.** Modellare discovery, selezione, invocazione osservata, completamento ed errore come fatti diversi. Verificare quali sono identificabili nel CLI: nessuna deduzione di utilizzo dal solo fatto che una skill sia installata o citata nel testo. Collegare i segnali dimostrabili al backend health con identità e deduplica robuste. Registrare metriche di latenza e stato dei nuovi hook. Riutilizzare cost-report senza inventare USD o token mancanti. Rendere governance e raccolta dettagliata opt-in, con minimizzazione e retention.

**Verifica.** Invocazioni duplicate, skill omonime, sessioni concorrenti, errori e segnali assenti. Store vuoto = assenza di osservazioni. Campi economici cumulativi non sommati più volte. Redazione di credenziali e log limitati. Il monitor contesto usa dati nativi se disponibili; altrimenti resta non disponibile o segnala chiaramente una stima.

**Uscita.** Ogni contatore ha una definizione, fonte e limite verificabile. **Rollback:** spegnere raccolta preservando i dati già creati. **Rischio:** statistiche plausibili ma non fondate e raccolta eccessiva.

### P05 — Raccolta delle osservazioni di apprendimento

**Contesto.** `scripts/copilot-learning.py` gestisce gli instinct; `copilot-sessions.js` non deve essere trasformato in un archivio di transcript. Leggere observe-runner e il formato canonico delle osservazioni.

**Interventi.** Creare un sink Copilot compatibile con gli algoritmi canonici, usando il mapping di progetto esplicito. Osservazione disabilitata di default; configurazione separata da transcript-summary. Salvare solo campi ammessi, esito disponibile, identificatori e prove minimizzate; escludere reasoning, credenziali e output grezzi non necessari. Gestire rotazione, quota, concorrenza e backpressure. Nessuna chiamata LLM in questo passo.

**Verifica.** Eventi ripetuti, chiamate distinte uguali, eventi fuori ordine, record interrotti, disk full, lock conteso e schema sconosciuto. Test sentinella con segreti sintetici. Disattivazione = nessuna nuova osservazione. L'errore del sink non deve dichiarare riuscita un'azione del tool.

**Uscita.** Osservazioni consumabili dal learning backend, separate dai checkpoint e con una policy dati documentata. **Rollback:** disattivare il sink e preservare lo storico. **Rischio:** contaminazione fra progetti o trascrizioni salvate implicitamente.

### P06 — Observer e generazione di instinct candidati

**Contesto.** Il continuous-learning-v2 canonico ha un observer con vincoli di piattaforma; non basta avviare in background lo script Bash su Windows. Riutilizzare clustering/evolution esistenti, non duplicarli.

**Interventi.** Prima introdurre un job one-shot riproducibile: osservazioni → analisi → candidati. Poi aggiungere un worker gestito con start/status/stop, PID/lock, limiti di durata/costo e backend scelto esplicitamente dall'operatore. Verificare sopravvivenza e arresto del processo su Windows; scegliere un supervisore adeguato tramite ADR. Nessun daemon né task schedulato attivato durante installazione. Classificare output LLM e osservazioni come non fidati. Nessuna attivazione automatica di skill/hook/policy.

**Verifica.** Replay di correzioni utente, pattern ripetuti e dati irrilevanti; backend stub per schema/errori e backend reale opt-in per qualità. Processi orfani, doppio worker, retry limitati, crash fra lettura e scrittura, cursore di avanzamento e riavvio. Candidati duplicati non devono moltiplicarsi. Parametri di confidenza non presentati come probabilità calibrate.

**Uscita.** One-shot e worker provati sui sistemi dichiarati; revisione umana prima della promozione. **Rollback:** stop worker, spegnimento esplicito, nessuna cancellazione degli instinct. **Rischio:** processi invisibili, costi illimitati e apprendimento di istruzioni malevole.

Il backend di analisi non eredita tool o privilegi dell'agente principale: niente shell, rete arbitraria o strumenti di scrittura. Riceve dati minimizzati e restituisce un risultato strutturato; il solo writer controllato dal runtime valida e salva i candidati. P09 precede P06 per verificare tali limiti se si riutilizzano custom agent; un backend con interfaccia propria deve superare gli stessi test di mancata esecuzione di istruzioni presenti nelle osservazioni.

### P07 — MCP selettivo e diagnostica

**Contesto.** ECC ha `mcp-configs/mcp-servers.json` e health check canonici, ma il target Copilot non configura server. La CLI ha un GitHub MCP incorporato: non aggiungerne una copia automaticamente.

**Interventi.** Definire selezione di server e scope, con preview della configurazione prima dell'applicazione. Preferire scope di progetto dove supportato dalla versione fissata; lo scope utente rimane scelta esplicita. Mappare schema/env/command/args al contratto Copilot, mantenere proprietà e server dell'utente, rilevare collisioni e non memorizzare credenziali nel repository. Health check entro i timeout, errori e reconnect limitato solo se il contratto nativo lo permette. Non assumere i nomi tool `mcp__` di Claude.

**Verifica.** Server stdio fittizio per handshake, timeout, auth mancante, risposta errata e morte del processo. Config preesistente, alias di server, install/repair/uninstall e config-dir personalizzata. Testare che health failure non comporti retry automatico di un tool con possibili effetti già avvenuti.

**Uscita.** Solo i server selezionati vengono aggiunti, con diff e diagnostica; nessuna auto-approvazione dei tool. **Rollback:** rimuovere solo entry ancora gestite da ECC, preservando le modifiche utente. **Rischio:** sovrascrittura della configurazione o ripetizione di azioni remote.

### P08 — Memory Vault e handoff durevoli

**Contesto.** `skills/unified-memory/SKILL.md`, `scripts/memory.js` e `scripts/memory-mcp.mjs` sono già il nucleo condiviso. Il runtime separato ecc-universal va rilevato/verificato, non riscritto né installato silenziosamente da un hook.

**Interventi.** Aggiungere diagnosi prerequisiti e percorso guidato per CLI/MCP, con `ECC_MEMORY_HARNESS=copilot`. Preservare separazione degli scope project/team/user, filtri del destinatario e stato non revisionato. Introdurre un workflow esplicito checkpoint → proposta handoff → salvataggio, senza importare transcript o promuovere record automaticamente. Mantenere storage checkpoint esistente e rollback indipendente dal Vault.

**Verifica.** Save/search/read/doctor da CLI e MCP in repository temporaneo; Copilot→altro harness e ritorno con radici coerenti. Record malformed, scan incompleta, memoria superseded, scope user disabilitato, cwd/worktree differenti e segreti sintetici. Verificare creazione protettiva della gitignore canonica e assenza di sovrascrittura delle memorie.

**Uscita.** Handoff durevole recuperabile con scope corretti; errore/incompletezza distinti da memoria assente. **Rollback:** rimuovere configurazione MCP gestita, conservando il Vault. **Rischio:** confondere richiamo di contesto con autorità o permesso.

### P09 — Custom agent e restrizioni sui tool

**Contesto.** `scripts/lib/install/copilot-agent.js` oggi ammette solo name/description. La documentazione Copilot consente tools e model: eliminare una lista restrittiva senza sostituirla può allargare i tool disponibili all'agent.

**Interventi.** Inventariare i tool canonici per agent e definire mapping verso quelli nativi osservati. Conservare limiti equivalenti quando il mapping è completo; se non lo è, emettere stato incompatibile/avviso esplicito, senza assumere accesso completo. Reviewer senza scrittura, agente di implementazione con sole capacità necessarie. Continuare a rimuovere model ID Claude; consentire un override Copilot solo se configurato e verificato. Allineare agent proiettati e ruoli dell'orchestratore, senza confondere disponibilità dei tool con auto-approvazione.

**Verifica.** Mapping dei tool, wildcard, nomi MCP, metadati sconosciuti e agent con istruzioni contraddittorie. Nel CLI reale selezionare il reviewer e provare che la modifica richiesta non gli sia disponibile. Verificare invocazione diretta e delegata separatamente.

**Uscita.** Nessuna restrizione dichiarata da ECC viene persa senza una diagnosi. **Rollback:** escludere l'agent non mappabile dal profilo verificato, senza ripristinare accesso più ampio. **Rischio:** reviewer presentato come read-only con strumenti di modifica disponibili.

### P10 — Audit e correzione dell'intero catalogo

**Contesto.** I 98 comandi hanno proiezioni dedicate o canoniche; le skill canoniche mantengono gran parte del corpo originale. Leggere content-transform e copilot-command: i controlli dei legacy comandi non certificano tutto il catalogo skill/agent.

**Interventi.** Estendere il censimento di P00 a ogni skill, agent, comando, regola, script referenziato e asset richiesto. Cercare percorsi Claude, variabili CLAUDE_*, Task/Skill API specifiche, shell/interpreti, prerequisiti esterni e riferimenti a comandi rinominati. Distinguere citazioni storiche innocue da dipendenze eseguibili: evitare sostituzioni globali «Claude→Copilot». Per ogni contenuto: portabile; adattamento necessario; integrazione esterna documentata; incompatibile con spiegazione. Proiettare istruzioni Copilot per continuous-learning-v2 e le skill runtime-bearing. Lo scanner propone casi; la compatibilità richiede revisione semantica.

**Verifica.** Coverage inventario al 100% rispetto allo snapshot fissato, zero riferimenti eseguibili non risolti nel profilo dichiarato completo. Eseguire gli entry point sicuri e fixture delle famiglie runtime-bearing. Verificare il pacchetto pubblicabile separatamente dal checkout: solo le dipendenze esterne dichiarate possono richiedere un runtime separato.

**Uscita.** Ogni esclusione è visibile nell'installer/report; la suite impedisce che nuovi comandi sconosciuti diventino eseguibili implicitamente. Se emergono decine di adattamenti, dividere per famiglia in P10a/P10b conservando il gate finale. **Rollback:** declassare la singola capacità, non spegnere l'intero catalogo. **Rischio:** ottenere discovery corretta ma workflow che richiama file inesistenti.

### P11 — Plan Canvas e automazioni accessorie

**Contesto.** Gli hook canonici includono plan-canvas-sessions/pending e desktop-notify, oltre a suggerimenti compact, eventi build/PR e log comandi. Non sono tutti inclusi nell'allowlist Copilot.

**Interventi.** Riprendere ogni riga residua dell'inventario. Per Plan Canvas, collegare feedback e sessione tramite identità verificabile, senza usare contenuti browser come permessi o istruzioni privilegiate. Adapter notifiche per piattaforma opt-in; testo breve e privo di dati sensibili. Collegare suggerimenti compact e segnali build/PR quando gli eventi nativi li dimostrano. Le funzioni tmux restano opzionali e non simulano capacità su Windows nativo.

**Verifica.** Feedback ritardato, duplicato o riferito ad altra sessione; browser/desktop assente; script notifica fallito; riavvio CLI e disattivazione delle notifiche. Il fallimento accessorio non blocca il lavoro principale.

**Uscita.** Tutte le automazioni accessorie hanno adattamento o limite motivato nell'inventario. **Rollback:** disabilitare solo le integrazioni accessorie. **Rischio:** iniezione di contesto da sessioni sbagliate e dipendenze GUI che bloccano il CLI.

### P12 — Verifica funzionale nativa e comandi avanzati: M1

**Contesto.** Chiudere le evidenze mancanti dei gruppi precedenti e dei runtime già esistenti: epic, Astra, PM2, orchestration, cost-report, loop e auto-update. Le loro implementazioni non vanno riscritte se i test ne confermano la correttezza.

**Interventi.** Creare un percorso riproducibile Windows-first, poi Linux/macOS. Testare core senza credenziali con backend fittizi e, separatamente, scenari opt-in autenticati. Per epic usare repository sandbox; per orchestration backends realmente disponibili, budget e review indipendente. Per PM2 verificare generazione e, solo nello scenario esplicito, avvio di un servizio fixture. Conservare comportamento fetch-only di auto-update e checkout fissato.

**Verifica.** Installazione vuota→discovery→task con edit→controlli→checkpoint→compaction→resume→handoff. Hook block visibile, tool riuscito senza escalation, eventi/sessioni concorrenti e uninstall. Task comportamentali con criteri deterministici dove possibile; confronto Claude/Copilot su stessi repository fixture, con più esecuzioni e costi registrati. Discovery dei 98 entry point e prova per ogni implementazione distinta; live test separati per ogni integrazione esterna dichiarata verificata. Nessuna copertura per analogia fra modelli/backend non provati.

**Uscita M1.** Core verificato su tutti i sistemi dichiarati; integrazioni esterne hanno stato verified/unverified distinto; inventario senza capacità richiesta genericamente «da fare». Budget di latenza e tasso di falsi positivi misurati e approvati prima del gate. **Rollback:** profilo stabile precedente o esclusione della capacità fallita. **Rischio:** dichiarare integrazioni certificate sulla base di stub.

Applicare le soglie fissate in P01, senza adattarle al risultato del run. Allegare l'elenco nominativo delle integrazioni non certificate: quelle richieste mantengono il traguardo parziale e non possono essere riclassificate come completate perché il backend fittizio funziona.

### P13 — Plugin nativo, distribuzione e coesistenza

**Contesto.** Il target per progetto usa `.github/ecc/`; un plugin vive in altra directory. La documentazione Copilot supporta manifest legacy e Agent Plugins: scegliere un formato tramite ADR sulla versione CLI realmente provata.

**Interventi.** Generare un artifact plugin dagli stessi moduli verificati, senza copiare segreti/store privati o importare manifest Claude come se fossero già compatibili. Introdurre risoluzione della radice plugin distinta dalla cwd del progetto e sostituire i percorsi `.github/ecc/` dove il runtime lo richiede. Definire discovery, alias dei comandi e ownership. Impedire doppia registrazione di hook/skill/MCP quando installer e plugin coesistono; prevedere migrazione con preview e rimozione dei soli file gestiti. Preparare artifact locale e istruzioni marketplace, senza pubblicare automaticamente.

**Verifica.** Installare plugin da artifact locale, eseguire gli stessi casi core di M1, disable/enable, aggiornamento, uninstall e reinstall. Coesistenza con installer in entrambi gli ordini, plugin con root contenente spazi, cwd diversa e config-dir personalizzata. Verificare che la disabilitazione di un plugin non lasci worker attivi o raddoppi l'observer.

**Uscita.** Una sola esecuzione per policy/evento e dati privati conservati; artifact include la chiusura completa delle dipendenze dichiarate. **Rollback:** disattivare plugin e mantenere il target progetto verificato. **Rischio:** percorsi relativi errati e automazioni duplicate.

### P14 — Release, documentazione e mantenimento: M2

**Contesto.** M1 dimostra il comportamento funzionale; P13 aggiunge un nuovo percorso di caricamento che deve essere certificato separatamente.

**Interventi.** Eseguire matrice OS×installer/plugin sulle versioni fissate. Dichiarare versione minima solo dopo averla provata, più una versione corrente verificata. Aggiornare README, documenti Copilot, troubleshooting e migrazione. Generare matrice capacità dal registry e predisporre CI senza credenziali più job nativi opt-in protetti. Preparare release notes e checklist upstream. Definire monitoraggio delle variazioni dei contratti CLI e dei nuovi hook/skill canonici.

**Verifica.** `npm test` e controlli obbligatori di repository; test Python pertinenti con l'interprete disponibile; pacchetto reale installato in fixture; regressioni sugli altri target coinvolti dalle librerie condivise. Verificare assenza di percorsi personali e segreti nelle evidenze. Controllare aggiornamento da versione precedente e rollback.

**Uscita M2.** Evidenze riferite a SHA/versioni/OS, inventario completo, nessun P0 aperto e limitazioni pubblicate. Preparare PR/release; push, merge, pubblicazione npm/marketplace restano azioni distinte dal presente incarico di pianificazione. **Rollback:** versione precedente dell'artifact, feature flags e nessuna cancellazione degli store.

Verificare inoltre upgrade dai record checkpoint/instinct già creati dal commit di baseline, conservazione dei cursori e compatibilità di lettura dopo rollback. La presenza di esclusioni richieste non accettate impedisce di dichiarare il porting completo anche quando il pacchetto plugin è installabile.

## 7. Piano di verifica e comandi

Comandi già presenti nel checkout di riferimento, da eseguire dalla sua root dopo installazione delle dipendenze con il package manager dichiarato e lockfile rispettato:

```bash
node tests/run-all.js copilot
node tests/hooks/copilot-hook-adapter.test.js
node tests/hooks/copilot-lifecycle.test.js
node tests/lib/copilot-hooks-install.test.js
node tests/lib/copilot-commands.test.js
npm run test:validators
npm run harness:adapters
```

La suite Copilot è una selezione per nome dei test, non un CLI test end-to-end. I test nuovi devono essere inclusi nel runner o chiamati esplicitamente. Per la release eseguire i controlli completi previsti dal repository, incluso `npm test`. Su Windows usare l'interprete Python effettivamente installato invece di assumere l'alias `python3`.

Esempio attuale di installazione nel progetto temporaneo, usando un percorso assoluto al checkout verificato:

```text
node /absolute/path/ECC/scripts/install-apply.js --target copilot --profile full --enable-hooks
```

Non eseguirlo nella root di lavoro personale per produrre le fixture. `--no-hooks` deve restare una variante verificata. La generazione plugin futura avrà comandi definiti in P13: non sono già disponibili per il solo fatto che questo piano li prevede.

| Livello | Cosa dimostra | Cosa non dimostra |
| --- | --- | --- |
| Unit/fixture | Parsing, decisioni, isolamento, errori e algoritmi | Discovery o semantica del CLI reale |
| Installer/subprocess | File distribuiti, esecuzione helper, ownership e repair | Evento consegnato dall'host |
| Native core | Comandi/eventi/output nel CLI e OS indicati | Tutte le integrazioni esterne |
| Native integration | Workflow col servizio/modello realmente configurato | Funzionamento di altri backend/account |
| Behavioral eval | Risultato misurato sui task e run registrati | Correttezza universale o parità assoluta |

Scenari obbligatori: negazione operazione distruttiva; modifica innocua consentita; errore tool distinto da successo; reviewer senza scrittura; formatter fallito; checkpoint separati per workspace; compact/resume; observer off/on/stop; candidato non attivo; handoff cross-harness; MCP guasto; plugin+installer senza duplicazioni; uninstall senza perdita di dati. Per schemi non esposti da una versione CLI, registrare il limite e verificare l'equivalente disponibile.

## 8. Gestione esecuzione, review e cambi di piano

Stati per passo: `planned`, `ready`, `in-progress`, `blocked`, `review`, `verified`, `merged`. Stato iniziale di tutti i passi: `planned`. Il piano non dichiara completate le attività descritte.

Ogni PR include: problema concreto, comportamento prima/dopo, capacità/ID coinvolti, dipendenze, test eseguiti con risultato, test non eseguiti con motivo, limiti e rollback. Review critica separata per P01, P02, P06, P07, P08, P09 e P13. Il reviewer deve cercare bypass, promesse non dimostrate, dipendenze mancanti e regressioni degli altri target; deve poter respingere una dichiarazione di parità anche se i test stub passano.

Per modificare il piano: registrare data, evidenza nuova, passi coinvolti, impatto su scope/dipendenze, decisione e revisore. Un limite dell'host diventa un ADR con fonte e prova nativa; una funzione richiesta esclusa rimane un gap dichiarato finché non viene accettata una variazione di scope. Non cancellare dal denominatore le capacità difficili per migliorare la percentuale di avanzamento.

Metriche: capacità inventariate; implementate; verificate per OS/versione/mode; esterne non verificate; falsi positivi/negativi sui corpus; latenza p50/p95 e timeout; costo dei live eval; regressioni; dati raccolti/retention. Non combinare queste misure in una singola percentuale che nasconda i limiti.

Scelta agent/modello per esecuzione futura: implementazione ordinaria con modello bilanciato disponibile, architettura e review degli invarianti con modello a ragionamento più elevato effettivamente disponibile. Non fissare nomi Claude in Copilot né inventare prezzi. Le sotto-attività meccaniche seguono unità brevi verificabili; una PR resta il contenitore di un risultato coerente.

## 9. Primo incremento da realizzare

Avviare P00: congelare SHA e inventario, eseguire la suite esistente, predisporre progetto Windows temporaneo e raccogliere i primi payload nativi. È il lavoro che rende concreto P01 e impedisce di costruire nuove automazioni su tool/eventi soltanto presunti. In parallelo logico è possibile censire le dipendenze del catalogo, senza modificarlo fino al contratto condiviso.

Non serve iniziare dai 98 comandi, già implementati a livello di entry point. La priorità è consolidare contratto, controlli e prove, poi collegare apprendimento e integrazioni.

## 10. Fonti e punti di partenza

Fonti repository fissate al commit esaminato:

- [Documentazione hook](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/docs/COPILOT-HOOKS.md)
- [Lifecycle e checkpoint](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/docs/COPILOT-LIFECYCLE.md)
- [Inventario comandi](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/docs/COPILOT-COMMANDS.md)
- [Implementazioni estese e prerequisiti](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/docs/COPILOT-EXTENDED-COMMANDS.md)
- [Registry hook Copilot](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/scripts/lib/copilot-hooks.js)
- [Metadati hook canonici](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/hooks/hooks.metadata.json)
- [Target installer](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/scripts/lib/install-targets/copilot-project.js)
- [Trasformazione agent](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/scripts/lib/install/copilot-agent.js)
- [Continuous learning v2](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/skills/continuous-learning-v2/SKILL.md)
- [Unified Memory](https://github.com/manuel-albanesee/ECC/blob/a64711b70660e6f53e6f4066762a5bf3a67f4485/skills/unified-memory/SKILL.md)

Contratti ufficiali consultati il 3 novembre 2026, da ricontrollare quando cambia la versione CLI:

- [Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [MCP per Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- [Plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Creazione plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)

Le specifiche future di file/script contenute nel piano sono proposte di progetto; i link al repository descrivono soltanto lo stato del commit fissato.
