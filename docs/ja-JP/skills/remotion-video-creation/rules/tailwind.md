---
name: tailwind
description: Remotion で TailwindCSS を使用する。
metadata:
---

プロジェクトに TailwindCSS がインストールされている場合は、Remotion でも積極的に使用してください。

`transition-*` や `animate-*` クラスは使用しないでください。アニメーションは常に `useCurrentFrame()` フックを使って実装します。

Tailwind を使用するには、Remotion プロジェクトで事前にインストールと有効化が必要です。設定手順については <https://www.remotion.dev/docs/tailwind> を WebFetch で取得してください。
