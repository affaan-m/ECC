# UGC Video Director for Gemini

Extensão do Chrome (Manifest V3) que transforma um briefing em um vídeo UGC ou promocional de ~45 s para TikTok, gerado clipe a clipe no app do Gemini (Gemini 4 Argon + Veo), com a **mesma pessoa, mesma roupa, mesmo cenário** em todos os clipes.

## Como funciona

1. **Briefing** (painel lateral): você descreve o vídeo, escolhe UGC ou Produto, idioma, duração (padrão 45 s = 6 clipes de 8 s) e opcionalmente anexa uma foto ou vídeo de referência (de um vídeo, a extensão extrai um quadro).
2. **Roteiro**: um LLM escreve um JSON com a *bíblia visual* (pessoa, roupa, cabelo, produto, cenário, luz, câmera, cor, áudio) e uma cena por clipe (ação, fala, câmera, som). Você pode editar tudo. A extensão então monta um prompt por clipe, **repetindo a bíblia palavra por palavra** no topo de cada um, mais notas de continuidade e um prompt negativo. Um validador garante que nenhum prompt perdeu uma âncora da bíblia.
3. **Geração**: o service worker abre `gemini.google.com`, e o content script, para cada clipe, inicia a conversa (ou continua a mesma), seleciona a ferramenta de vídeo, anexa a referência, cola o prompt, envia, espera o `<video>` aparecer, captura um quadro (usado como âncora de identidade quando não há referência) e baixa o arquivo.
4. **Publicar**: legenda, hashtags, texto de gancho e capa prontos para o TikTok. Junte os clipes no CapCut em corte seco e publique em 9:16.

Modo alternativo (**API**): em vez de automatizar o app, chama `gemini-omni-1.1-flash` pela Interactions API (cobra créditos da API) com `previous_interaction_id` para manter o contexto entre clipes.

## Instalação

```bash
cd chrome-ugc-video-generator
node scripts/make-icons.mjs
node scripts/check-manifest.mjs
node --test tests/*.test.js
```

1. Abra `chrome://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta `chrome-ugc-video-generator`.
2. Clique no ícone da extensão: o painel lateral abre.
3. Abra as **Configurações** (ícone ⚙) e escolha quem escreve o roteiro.

## Autenticação

### Gemini com OAuth (login com Google)

A API do Gemini aceita token OAuth, mas a conta precisa de um projeto do Google Cloud com a **Generative Language API** ativada, e o ID desse projeto vai no cabeçalho `x-goog-user-project`.

1. No [Google Cloud Console](https://console.cloud.google.com), crie ou escolha um projeto e ative a *Generative Language API*.
2. Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Extensão do Chrome**, informe o ID da extensão (aparece em `chrome://extensions`).
3. Cole o `client_id` em `manifest.json` → `oauth2.client_id` e recarregue a extensão.
4. Nas Configurações, informe o **ID do projeto** e clique em **Entrar com Google**.

Para manter o ID da extensão estável entre máquinas, adicione a chave pública do pacote ao campo `key` do manifest (veja a documentação do Chrome sobre "key" em manifest).

### Gemini com chave de API

Gere uma chave no Google AI Studio e cole em Configurações. É usada automaticamente quando o OAuth não está configurado.

### OpenAI

A OpenAI não disponibiliza login OAuth público com a conta do ChatGPT para aplicativos de terceiros. Use uma **chave de API** da plataforma (`sk-…`). O modelo padrão é `gpt-5`.

## Requisitos para o modo "App do Gemini"

- Assinatura Google AI Pro ou Ultra (a geração de vídeo com Veo e o Gemini 4 Argon fazem parte desses planos).
- Estar logado em `gemini.google.com` na mesma janela.
- Não mexer na aba do Gemini enquanto um clipe está sendo gerado.

Cada clipe leva alguns minutos. O fluxo é orientado a eventos: o service worker despacha um clipe, a página responde na hora, e o resultado chega depois como mensagem, acordando o worker para o próximo clipe. Se o Chrome suspender o worker no meio, o estado fica salvo e a fila continua; se a aba do Gemini for fechada, o clipe em andamento é marcado como erro após o tempo limite e pode ser refeito com **refazer**.

## Quando o Google muda a interface

Toda interação com a página fica em `src/content/gemini-adapter.js`, e os seletores podem ser sobrescritos em Configurações → **Seletores** (JSON). Use **Diagnosticar página do Gemini** no painel para ver o que está sendo encontrado em cada chave (`editor`, `send`, `newChat`, `toolsMenu`, `fileInput`, `video`, `download`…).

## Estrutura

```text
manifest.json
src/
  lib/                pure logic, testável em Node
    plan.js           duração alvo → N clipes com papéis narrativos
    character-bible.js bloco "bíblia" determinístico + âncoras
    prompt-builder.js prompt final por clipe + validador de consistência
    director-prompt.js instruções para o LLM roteirista
    script-schema.js  parse/normalização do JSON do LLM
    gemini-app.js     invólucro do prompt para o app + seletores padrão
    llm/              clientes Gemini, OpenAI, Omni (fetch injetável)
  background/         service worker: estado do job, OAuth, fila, downloads
  content/            adaptador DOM do gemini.google.com
  sidepanel/          interface principal
  options/            configurações
tests/                node --test
scripts/              ícones e checagem estática
```

## Limites conhecidos

- A automação depende do DOM do Gemini, que muda sem aviso. Por isso existem os seletores sobrescrevíveis e o diagnóstico.
- O download do clipe é feito pela própria página (o content script busca o arquivo e salva com o nome `<título>-clip-NN.mp4`); se isso falhar, clica no botão de download do Gemini, e por último o worker tenta baixar a URL `https:` diretamente.
- Os clipes são fixos em 8 s (duração do Veo no app). 45 s viram 6 clipes.
- O texto na tela (gancho, legendas) é pensado para ser adicionado na edição, não renderizado pelo Veo, que erra ortografia.
