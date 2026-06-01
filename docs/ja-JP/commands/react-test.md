---
description: React に TDD ワークフローを適用します。React Testing Library のテストをビヘイビア重視・アクセシビリティ優先で先に記述してからコンポーネントを実装します。Vitest または Jest を検出してカバレッジ目標を検証します。
---

# React TDD コマンド

このコマンドは、実行時に検出した React Testing Library と Vitest または Jest を使って React のテスト駆動開発を強制します。

## このコマンドが行うこと

1. **コンポーネントシグネチャを定義**: コンポーネント、prop の型、エクスポートをスキャフォールド
2. **先にビヘイビアテストを記述**: RTL クエリ（ロール優先）、`userEvent`、ネットワーク用 MSW — RED
3. **テストを実行**: 正しい理由で失敗することを確認
4. **最小限のコードを実装**: 通過するのに必要なだけ — GREEN
5. **リファクタリング**: テストをグリーンに保ちながら改善
6. **カバレッジを確認**: [rules/react/testing.md](../rules/react/testing.md) の目標値を達成

## 使用タイミング

以下の場合に `/react-test` を使用する:

- 新しい React コンポーネントまたはカスタムフックを実装する
- テストされていないコンポーネントにテストカバレッジを追加する
- バグを修正する（最初にそれを再現する失敗テストを記述する）
- フォーム、ステートマシン、またはアクセシビリティが重要な UI を構築する
- RTL + Vitest/Jest ワークフローにオンボーディングする

## TDD サイクル

```
RED      -> 次のビヘイビアのための失敗テストを記述
GREEN    -> テストを通過させるための最小限のコンポーネントコードを実装
REFACTOR -> コンポーネントを改善し、テストをグリーンに保つ
REPEAT   -> 次のビヘイビアへ
```

## ランナー検出

```bash
test -f vitest.config.ts -o -f vitest.config.js -o -f vite.config.ts   # Vitest
grep -l '"jest"' package.json                                          # Jest
```

新しい Vite ベースのプロジェクトには Vitest を優先する。既存のセットアップでは Jest を尊重する。

## セッション例

````text
User: /react-test デバウンス検索機能を持つ SearchInput コンポーネントが必要です

Agent:
# TDD セッション: SearchInput

## ステップ 1: シグネチャを定義

```tsx
// src/components/SearchInput.tsx
type Props = {
  onSearch: (query: string) => void;
  placeholder?: string;
  debounceMs?: number;
};

export function SearchInput({ onSearch, placeholder, debounceMs }: Props) {
  throw new Error("not implemented");
}
```

## ステップ 2: ビヘイビアテストを記述（RED）

```tsx
// src/components/SearchInput.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  test("プレースホルダー付きでレンダリングされる", () => {
    render(<SearchInput onSearch={() => {}} placeholder="Search users" />);
    expect(screen.getByPlaceholderText("Search users")).toBeInTheDocument();
  });

  test("入力後に onSearch が呼ばれる", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} debounceMs={300} />);

    await user.type(screen.getByRole("textbox"), "alice");

    expect(onSearch).not.toHaveBeenCalled();        // デバウンス前
    vi.advanceTimersByTime(300);
    expect(onSearch).toHaveBeenCalledWith("alice"); // デバウンス後

    vi.useRealTimers();
  });

  test("入力が一時停止して続いた場合に onSearch が呼ばれない", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} debounceMs={300} />);

    await user.type(screen.getByRole("textbox"), "ali");
    vi.advanceTimersByTime(200);                    // デバウンス途中
    await user.type(screen.getByRole("textbox"), "ce");
    vi.advanceTimersByTime(300);

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("alice");

    vi.useRealTimers();
  });

  test("キーボードで到達可能でアクセシブルである", () => {
    render(<SearchInput onSearch={() => {}} />);
    const input = screen.getByRole("textbox");
    input.focus();
    expect(input).toHaveFocus();
  });
});
```

## ステップ 3: テストを実行 — FAIL を確認

```bash
$ vitest run src/components/SearchInput.test.tsx

× src/components/SearchInput.test.tsx (4 tests) ✘ Error: not implemented
```

✓ テストが期待通りに失敗している。

## ステップ 4: 最小限のコードを実装（GREEN）

```tsx
import { useEffect, useState } from "react";

export function SearchInput({ onSearch, placeholder, debounceMs = 300 }: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => onSearch(query), debounceMs);
    return () => clearTimeout(id);
  }, [query, onSearch, debounceMs]);

  return (
    <input
      type="text"
      value={query}
      placeholder={placeholder}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
}
```

## ステップ 5: テストを実行 — PASS を確認

```bash
$ vitest run src/components/SearchInput.test.tsx

✓ src/components/SearchInput.test.tsx (4 tests) 47ms
```

## ステップ 6: カバレッジ

```bash
$ vitest run --coverage src/components/SearchInput.test.tsx

% Stmts: 100  % Branch: 100  % Funcs: 100  % Lines: 100
```

## TDD 完了!
````

## テストパターン

### 実装ではなくビヘイビア

`getByRole`、`getByLabelText`、`getByText` を使用する。`container.querySelector` やコンポーネント状態のアサーションは避ける。

### テストごとに `userEvent.setup()`

```tsx
const user = userEvent.setup();
await user.click(screen.getByRole("button", { name: /save/i }));
```

### ネットワークには MSW

```tsx
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

server.use(http.post("/api/users", () => HttpResponse.json({ id: "1" }, { status: 201 })));
```

### カスタムフック

```tsx
const { result } = renderHook(() => useCounter(0));
act(() => result.current.increment());
expect(result.current.count).toBe(1);
```

### アクセシビリティ

```tsx
import { axe } from "vitest-axe";
expect(await axe(container)).toHaveNoViolations();
```

## カバレッジ目標

| 層 | 目標 |
|---|---|
| 純粋なユーティリティ | >=90% |
| カスタムフック | >=85% |
| プレゼンテーショナルコンポーネント | >=80% |
| コンテナコンポーネント | >=70% |
| ページ | E2E で個別に対応 |

CI でしきい値を強制するために `vitest.config.ts` / `jest.config.js` で設定する。

## 避けるべきアンチパターン

- `container.querySelector(...)` — アクセシビリティクエリをバイパスする
- レンダリング数のアサーション
- `react` 自体のモック（`jest.mock("react", ...)`）
- デフォルトで子コンポーネントをモック（重い副作用がある場合のみモックする）
- `act()` の警告を無視する — 実際のバグを示している
- レンダリングされたコンポーネントのスナップショットテスト（壊れやすく、形式的な承認になる）— 代わりに Playwright/Cypress のビジュアル差分を使用する

## テストコマンド

```bash
# Vitest
vitest                              # ウォッチ
vitest run                          # 一回実行
vitest run --coverage               # カバレッジ付き
vitest run path/to/file.test.tsx    # 単一ファイル

# Jest
jest --watch
jest --coverage
jest path/to/file.test.tsx

# CI モード
CI=true vitest run --coverage
```

## 関連コマンド

- `/react-build` — テストを実行する前にビルドエラーを修正
- `/react-review` — 実装後にレビュー
- `verification-loop` スキル — 完全な検証ループ

## 関連

- スキル: `skills/react-testing/`、`skills/tdd-workflow/`、`skills/accessibility/`、`skills/e2e-testing/`
- ルール: `rules/react/testing.md`
- エージェント: `react-reviewer`（テスト品質をレビュー）、`tdd-guide`（TDD プロセスを強制）
