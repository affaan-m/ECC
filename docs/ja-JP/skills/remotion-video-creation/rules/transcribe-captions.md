---
name: transcribe-captions
description: Remotion で音声を文字起こししてキャプションを生成する
metadata:
  tags: captions, transcribe, whisper, audio, speech-to-text
---

# 音声の文字起こし

Remotion では、音声からキャプションを生成するための文字起こし手段がいくつか組み込まれています。

- `@remotion/install-whisper-cpp` — Whisper.cpp を使用してサーバー上でローカルに文字起こしを行います。高速かつ無料ですが、サーバーインフラが必要です。
  <https://remotion.dev/docs/install-whisper-cpp>

- `@remotion/whisper-web` — WebAssembly を使用してブラウザ上で文字起こしを行います。サーバー不要で無料ですが、WASM のオーバーヘッドにより処理が遅くなります。
  <https://remotion.dev/docs/whisper-web>

- `@remotion/openai-whisper` — クラウドベースの文字起こしに OpenAI Whisper API を使用します。高速でサーバー不要ですが、費用が発生します。
  <https://remotion.dev/docs/openai-whisper/openai-whisper-api-to-captions>
