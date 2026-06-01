---
name: react-testing
description: React Testing Library、Vitest/Jest、ネットワークモッキング用の MSW、axe によるアクセシビリティアサーション、コンポーネントテストと Playwright/Cypress のエンドツーエンド実行の判断境界を使った React コンポーネントテスト。React コンポーネント、フック、またはページのテストを書く・修正する際に使用する。
origin: ECC
---

# React テスト

振る舞いに焦点を当てたコンポーネントテスト、カスタムフックテスト、アクセシビリティアサーション、ネットワークレベルのモッキングを網羅した包括的な React テストパターン。

## 有効化するタイミング

- React コンポーネント、カスタムフック、またはページのテストを書く時
- テストがないレガシーコンポーネントへのテストカバレッジを追加する時
- Enzyme やクラスコンポーネント時代のパターンから React Testing Library に移行する時
- 新しい React プロジェクトに Vitest または Jest をセットアップする時
- テスト内の HTTP リクエストをモックする時
- アクセシビリティ違反をアサートする時
- RTL vs Playwright Component Testing vs フル E2E のどちらでテストするか判断する時

## コア原則

ユーザーが見ること・行うことをテストし、実装の詳細をテストしない。

テストは:

- コンポーネントを本番と同じプロバイダーでレンダリングする
- アクセシブルなクエリ（ロール、ラベル）と `userEvent` を通じてインタラクションする
- 可視出力と観測可能な副作用（コールバックの呼び出し、リクエストの送信）をアサートする

テストは行ってはいけない:

- コンポーネント state、子コンポーネントに渡されたプロップ、呼ばれたフックを検査する
- React 自体またはフレームワークフックをモックする
- ユーザーに影響を与えない範囲でのレンダリング回数や DOM 構造をアサートする

## ライブラリの選択

| ランナー | 使用場面 | 備考 |
|---|---|---|
| **Vitest** | Vite、Remix、モダンな構成 | 高速、ネイティブ ESM、Jest 互換 API |
| **Jest** | Next.js、CRA、既存のリポジトリ | 多くの React プロジェクトのデフォルト |
| **Playwright Component Testing** | 実際のブラウザエンジンが必要な場合 | JSDOM が必要な機能を持たない時に使用 |
| **Cypress Component Testing** | 実ブラウザ、Cypress が既に導入済みの場合 | Playwright CT の代替 |

1 つだけ選択する。明確なレーン分離がない限り同一リポジトリで RTL + Vitest と Playwright CT を並行して使わない。

## クエリの優先順位

React Testing Library は 3 階層のクエリを提供する — 上から順に使用する:

1. **誰にでもアクセス可能**: `getByRole`、`getByLabelText`、`getByPlaceholderText`、`getByText`、`getByDisplayValue`
2. **セマンティック**: `getByAltText`、`getByTitle`
3. **テスト ID（エスケープハッチ）**: `getByTestId`

```tsx
// 最良
screen.getByRole("button", { name: /save/i });

// 入力には OK
screen.getByLabelText("Email");

// 最終手段
screen.getByTestId("save-btn");
```

バリアント:

- `getBy*` — マッチしない場合にスロー
- `queryBy*` — `null` を返す（「不在をアサート」に使用）
- `findBy*` — 非同期、Promise を返す（非同期処理後に現れる要素に使用）

## `userEvent` によるユーザーインタラクション

```tsx
import userEvent from "@testing-library/user-event";

test("フォームを送信する", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<UserForm onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText("Email"), "user@example.com");
  await user.click(screen.getByRole("button", { name: /save/i }));

  expect(onSubmit).toHaveBeenCalledWith({ email: "user@example.com" });
});
```

- userEvent 呼び出しは常に `await` する
- テストごとに 1 度 `userEvent.setup()` を呼び出し、返された `user` を再利用する
- `userEvent` は実際のブラウザシーケンスをシミュレートする; `fireEvent` は単一の合成イベントをディスパッチする — `userEvent` を優先する

## 非同期パターン

```tsx
// 非同期処理後に現れる要素
expect(await screen.findByText("Loaded")).toBeInTheDocument();

// 副作用のアサーション
await waitFor(() => expect(saveSpy).toHaveBeenCalled());

// 消える要素
await waitForElementToBeRemoved(() => screen.queryByText("Loading"));
```

`setTimeout` + アサーションは絶対に使わない — フレーキーになる。上記のマッチャーを使用する。

## MSW によるネットワークモッキング

Mock Service Worker はネットワーク層でモックする。コンポーネント、フック、フェッチライブラリはすべて本番とまったく同様に動作する。

### セットアップ

```ts
// test/setup.ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/users/:id", ({ params }) =>
    HttpResponse.json({ id: params.id, name: "Alice" }),
  ),
  http.post("/api/users", async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ id: "new-id", ...body }, { status: 201 });
  }),
];

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: "error"` を設定することで、モックされていないリクエストがテストを明確に失敗させる — サイレントなパスよりも赤いほうがまし。

### テストごとのオーバーライド

```tsx
test("500 時にエラーをレンダリングする", async () => {
  server.use(
    http.get("/api/users/:id", () => new HttpResponse(null, { status: 500 })),
  );
  render(<UserPage id="1" />);
  expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
});
```

## プロバイダーのラッピング

プロバイダーを `test-utils.tsx` に一度ラップする:

```tsx
// test-utils.tsx
import { render, RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function renderWithProviders(
  ui: React.ReactElement,
  options?: RenderOptions,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter>{ui}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
    options,
  );
}

export * from "@testing-library/react";
```

すべてのテストファイルで `import { renderWithProviders, screen } from "test-utils"` を使用する。

## カスタムフックのテスト

```tsx
import { renderHook, act } from "@testing-library/react";

test("useCounter がインクリメントとデクリメントをする", () => {
  const { result } = renderHook(() => useCounter(0));

  expect(result.current.count).toBe(0);

  act(() => result.current.increment());
  expect(result.current.count).toBe(1);

  act(() => result.current.decrement());
  expect(result.current.count).toBe(0);
});

test("useCounter が初期値を受け入れる", () => {
  const { result } = renderHook(() => useCounter(10));
  expect(result.current.count).toBe(10);
});

test("useUser がユーザーデータをフェッチする", async () => {
  // ラッパー外で QueryClient を 1 度インスタンス化して再レンダリング間で生存させる。
  // ラッパークロージャ内で作成するとレンダリングごとにキャッシュ state がリセットされフレーキーなテストになる。
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useUser("1"), { wrapper });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual({ id: "1", name: "Alice" });
});
```

- state を変化させる呼び出しは `act` でラップする
- フックのパブリック API を通じてのみテストする
- Context を使用するフックには `wrapper` を渡す

## アクセシビリティアサーション

```tsx
import { axe, toHaveNoViolations } from "jest-axe"; // または vitest-axe
expect.extend(toHaveNoViolations);

test("UserCard にアクセシビリティ違反がない", async () => {
  const { container } = render(<UserCard user={mockUser} />);
  expect(await axe(container)).toHaveNoViolations();
});
```

すべてのインタラクティブなコンポーネントのコンポーネントテストで axe を実行する。検出できるもの:

- フォーム入力のラベル欠落
- ARIA の無効な使用
- 低いカラーコントラスト（限定的 — JSDOM に実際の CSS エンジンがないため、インラインスタイルのみ機能する; 視覚的なコントラストは Playwright で確認する）
- 画像の alt テキスト欠落
- 見出し順序の違反

クロスリンク: より広範な a11y テストプレイブックは [skills/accessibility/SKILL.md](../accessibility/SKILL.md) を参照。

## スナップショットテストを使わない場面

レンダリング出力のスナップショット:

- スタイル変更のたびに壊れる
- レビュー時にゴム印を押される
- 動作ではなく実装の詳細（DOM 構造）をテストする

許容されるスナップショットの使用:

- 純粋なデータシリアライゼーション関数（`formatInvoice(invoice)` → 安定した文字列）
- 生成された設定ファイル（例: webpack 設定の出力）

コンポーネントのビジュアルリグレッションには、Playwright/Cypress のスクリーンショットまたは Percy/Chromatic を使用する — DOM 文字列ではなく実際のビジュアル差分。

## Playwright / Cypress を使う場面

JSDOM（Vitest/Jest が使用）では以下ができない:

- 実際のレイアウトのレンダリング（flexbox、grid、ビューポートクエリ）
- ブラウザネイティブのアニメーション、CSS トランジションの実行
- スクロール動作、ドラッグアンドドロップ、クリップボードからの貼り付けのテスト
- iframe、ポップアップ、ダウンロード、クロスオリジンフローの処理
- 完全な DevTools サポートを持つ制御された環境でのリアルネットワーク実行

これらのいずれかには Playwright Component Testing（実ブラウザでのコンポーネントテスト）またはフル E2E を使用する。[e2e-testing スキル](../e2e-testing/SKILL.md) を参照。

判断境界:

- フック、プレゼンテーショナルコンポーネント、ロジックを持つフォーム -> RTL
- レイアウトが重要なコンポーネントや JSDOM にない ブラウザ API を使用するコンポーネント -> Playwright CT
- 複数ページにまたがる完全なユーザーフロー -> Playwright/Cypress E2E

## カバレッジ目標

| レイヤー | 目標 |
|---|---|
| 純粋なユーティリティ | >=90% |
| カスタムフック | >=85% |
| プレゼンテーショナルコンポーネント | >=80% — 行ではなく動作 |
| コンテナーコンポーネント | >=70% — ゴールデンパス + エラー状態 |
| ページ | E2E で別途カバー; スモークテスト最低限 |

`vitest.config.ts` / `jest.config.js` で設定する:

```ts
// vitest.config.ts
test: {
  coverage: {
    provider: "v8",
    reporter: ["text", "html", "lcov"],
    thresholds: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
}
```

## アンチパターン

- `container.querySelector("...")` — アクセシビリティクエリをバイパスし、実際のユーザーが失敗するケースでテストがパスする
- レンダリング回数のアサート — 実装の詳細
- `jest.mock("react", ...)` — React を絶対にモックしない。代わりにコンポーネントをリファクタリングする
- デフォルトで子コンポーネントをモックする — 分離ではなく統合をテストすることになる。重い副作用がある場合にのみモックする
- `act()` 警告を無視する — 実際のバグを示している（アンマウント後の state 更新、非同期ラッピングの欠如）
- テスト間でミュータブルな state を共有する — テスト順序が変わるとフレーキーになる
- `it.skip()` を外すとパスしてしまうテスト — テストが思っていることを実際にはアサートしていない

## TDD ワークフロー

```
RED     -> 次の要件の失敗するテストを書く
GREEN   -> パスするための最小限のコンポーネントコードを書く
REFACTOR -> コンポーネントを改善し、テストはグリーンを維持する
REPEAT  -> 次の要件
```

新規コンポーネントのために:

1. コンポーネントのプロップ型とシグネチャを定義する
2. 最もシンプルなケースの最初のテストを書く
3. 正しい理由で失敗することを確認する
4. パスするだけの最小限の実装を行う
5. 次のテストケースを追加する
6. 3 つ目の類似テストでパターンが見えたらリファクタリングする

## テストコマンド

```bash
# Vitest
vitest                            # ウォッチモード
vitest run                        # 1 回実行
vitest run --coverage             # カバレッジ付き
vitest run path/to/file.test.tsx  # 単一ファイル

# Jest
jest --watch
jest --coverage
jest path/to/file.test.tsx

# CI モード
CI=true vitest run --coverage
```

## 関連

- ルール: [rules/react/testing.md](../../rules/react/testing.md)
- スキル: [react-patterns](../react-patterns/SKILL.md)、[accessibility](../accessibility/SKILL.md)、[e2e-testing](../e2e-testing/SKILL.md)、[tdd-workflow](../tdd-workflow/SKILL.md)
- エージェント: `react-reviewer`（コードレビュー時にテスト品質をレビュー）、`tdd-guide`（TDD プロセスを強制）
- コマンド: `/react-test`、`/react-review`

## 例

### MSW と userEvent によるフォーム送信

```tsx
test("ユーザーフォームを送信して成功を表示する", async () => {
  server.use(
    http.post("/api/users", () =>
      HttpResponse.json({ id: "1", name: "Alice" }, { status: 201 }),
    ),
  );

  const user = userEvent.setup();
  renderWithProviders(<UserForm />);

  await user.type(screen.getByLabelText("Name"), "Alice");
  await user.type(screen.getByLabelText("Email"), "alice@example.com");
  await user.click(screen.getByRole("button", { name: /save/i }));

  expect(await screen.findByText(/saved successfully/i)).toBeInTheDocument();
});
```

### エラー境界のテスト

```tsx
function Broken() {
  throw new Error("boom");
}

test("エラー境界がフォールバックをレンダリングする", () => {
  // 期待されるスローに対する React の console.error ノイズを抑制し、
  // スパイが他の場所の実際のエラーを隠さないよう後で復元する。
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <ErrorBoundary fallback={<div>Something went wrong</div>}>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  } finally {
    errorSpy.mockRestore();
  }
});
```

### Suspense 境界のテスト

```tsx
test("ローディングを表示してからコンテンツを表示する", async () => {
  renderWithProviders(
    <Suspense fallback={<div>Loading...</div>}>
      <UserDetail id="1" />
    </Suspense>,
  );

  expect(screen.getByText("Loading...")).toBeInTheDocument();
  expect(await screen.findByText("Alice")).toBeInTheDocument();
});
```
