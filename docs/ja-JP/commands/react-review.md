---
description: フックの正確性、レンダリングパフォーマンス、サーバー/クライアントコンポーネント境界、アクセシビリティ、React 固有のセキュリティを対象とした包括的な React/JSX コードレビュー。react-reviewer エージェントを呼び出します（TSX/JSX の変更では typescript-reviewer と並行して実行）。
---

# React コードレビュー

このコマンドは React 固有のコードレビューのために **react-reviewer** エージェントを呼び出します。`.tsx`/`.jsx` ファイルに触れるプルリクエストでは、`react-reviewer` と `typescript-reviewer` の両方を実行してください — それぞれが独立したレーンを担当します。

## このコマンドが行うこと

1. **React の変更を特定**: `git diff` で変更された `.tsx`/`.jsx` ファイル（および React を含む `.ts`/`.js` ファイル）を探す
2. **リントを実行**: `eslint-plugin-react-hooks` と `eslint-plugin-jsx-a11y` で `eslint` を実行
3. **型チェック**: `tsc --noEmit` またはプロジェクトの標準型チェックコマンドを実行
4. **React レーンのみをレビュー**: フックルール、RSC 境界、アクセシビリティ、レンダリングパフォーマンス、React 固有のセキュリティ
5. **レポートを生成**: 重大度（CRITICAL / HIGH / MEDIUM）で問題を分類

## 使用タイミング

以下の場合に `/react-review` を使用する:

- PR またはコミットが `.tsx`/`.jsx` ファイルに触れる
- React コンポーネント、カスタムフック、またはページを記述または変更した後
- React コードをマージする前
- UI コンポーネントのアクセシビリティを監査する
- rules-of-hooks と依存関係の正確性のために新しいフックをレビューする
- Next.js App Router のサーバー/クライアントコンポーネント境界を監査する

React インポートのない純粋な `.ts`/`.js` の変更には、`/code-review`（汎用）を使用するか `typescript-reviewer` を直接呼び出してください。

## `/code-review` と TypeScript レビューとのスコープ比較

| ツール | スコープ |
|---|---|
| `react-reviewer`（このコマンド） | フックルール、JSX、RSC、a11y、React 固有のセキュリティ、レンダリングパフォーマンス |
| `typescript-reviewer` | 汎用 TS/JS — `any` の乱用、async の正確性、Node セキュリティ |
| `security-reviewer` | プロジェクト全体のセキュリティ監査 |
| `/code-review` | 汎用の未コミット変更または PR レビュー |

TSX/JSX の PR では `react-reviewer` と `typescript-reviewer` の両方を呼び出してください。それぞれの指摘事項は設計上重複しません。

## レビューカテゴリー

### CRITICAL（必ず修正）

- サニタイズされていない入力での `dangerouslySetInnerHTML`
- 未検証のユーザー URL を含む `href`/`src`（`javascript:`、`data:`）
- 入力バリデーションのないサーバーアクション
- クライアントバンドル内のシークレット（`NEXT_PUBLIC_*`、`VITE_*`、`REACT_APP_*`）
- セッショントークンに `localStorage`/`sessionStorage`
- 条件付きフック呼び出し（Rules of Hooks 違反）
- state の直接変更
- コンポーネントまたはカスタムフックの外部でのフック呼び出し

### HIGH（修正すべき）

- `useEffect`/`useMemo`/`useCallback` の依存配列の欠落（正当化なしに `exhaustive-deps` を無効化）
- 派生 state のためのエフェクト
- クリーンアップのないエフェクト
- ハンドラー/インターバルのステールクロージャ
- クライアントコンポーネント内のサーバー専用インポート
- クライアントコンポーネントへの props 経由での機密データ漏洩
- 認証チェックのないサーバーアクション
- アクセシビリティ違反（ラベルの欠落、非セマンティックなインタラクティブ要素、ARIA の誤用）
- 動的リストの `key={index}`
- 重複した state、useEffect チェーン

### MEDIUM（検討）

- 測定されたメリットのない過剰メモ化
- メモ化された子への prop としてインラインで新しいオブジェクト/関数
- ルートのみの Suspense（段階的な表示なし）
- 仮想化のない長いリスト
- `useContext` による高頻度値
- 非自明なフォームでの独自バリデーション
- 3 レベルを超える prop のバケツリレー
- 200 行を超えるコンポーネント
- 新しいコードのクラスコンポーネント

## 実行される自動チェック

```bash
# リント（意味のあるレビューに必須）
npx eslint . --ext .tsx,.jsx,.ts,.js

# 型チェック（JS のみのプロジェクトはスキップ）
npm run typecheck --if-present
[ -f tsconfig.json ] && tsc --noEmit -p tsconfig.json

# 対象を絞った a11y ルール
npx eslint . --rule 'jsx-a11y/alt-text: error' \
              --rule 'jsx-a11y/anchor-is-valid: error' \
              --rule 'jsx-a11y/click-events-have-key-events: error'

# サプライチェーン
npm audit
```

`eslint-plugin-react-hooks` または `eslint-plugin-jsx-a11y` が設定されていない場合、レビューはそのギャップを HIGH の設定問題としてフラグを立てて継続します。

## 使用例

````text
User: /react-review

Agent:
# React コードレビューレポート

## レビューしたファイル
- src/components/UserCard.tsx（変更済み）
- src/hooks/useUser.ts（新規）

## リント結果
PASS: eslint クリーン
PASS: 型チェック クリーン

## 見つかった問題

[CRITICAL] サニタイズされていない dangerouslySetInnerHTML
File: src/components/UserCard.tsx:42
Issue: ユーザーが制御する bio が生の HTML としてレンダリングされている。
Why: ユーザー入力内のストアドスクリプトタグによる XSS。
Fix: DOMPurify でサニタイズするかテキストとしてレンダリングする:
```tsx
import DOMPurify from "isomorphic-dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(user.bio) }} />
```

[HIGH] エフェクトのクリーンアップが欠落
File: src/hooks/useUser.ts:18
Issue: AbortController なしの `fetch` 呼び出し。アンマウントされたコンポーネントへの setState の可能性がある。
Fix: AbortController とクリーンアップを追加:
```ts
useEffect(() => {
  const ac = new AbortController();
  fetch(`/api/users/${id}`, { signal: ac.signal })
    .then(r => r.json())
    .then(setUser);
  return () => ac.abort();
}, [id]);
```

## サマリー
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

推奨: FAIL: CRITICAL な問題が修正されるまでマージをブロック
````

## 承認基準

| ステータス | 条件 |
|---|---|
| PASS: 承認 | CRITICAL または HIGH の問題がない |
| WARNING: 警告 | MEDIUM の問題のみ（注意してマージ） |
| FAIL: ブロック | CRITICAL または HIGH の問題が見つかった |

## 他のコマンドとの統合

- ビルドが壊れている場合は先に `/react-build` を実行
- `/react-test` でコンポーネントテストが通ることを確認
- マージ前に `/react-review` を実行
- 同じ PR の React 以外の懸念事項には `/code-review` を使用

## 関連

- エージェント: `agents/react-reviewer.md`
- 補完エージェント: `agents/typescript-reviewer.md`（TSX/JSX の PR では並行して実行）
- スキル: `skills/react-patterns/`、`skills/react-testing/`、`skills/accessibility/`
- ルール: `rules/react/`
