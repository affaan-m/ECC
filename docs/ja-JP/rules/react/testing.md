---
paths:
  - "**/*.test.tsx"
  - "**/*.test.jsx"
  - "**/*.spec.tsx"
  - "**/*.spec.jsx"
  - "**/__tests__/**/*.ts"
  - "**/__tests__/**/*.tsx"
---
# React テスト

> このファイルは [typescript/testing.md](../typescript/testing.md) および [common/testing.md](../common/testing.md) を React 固有の内容で拡張します。

## ライブラリの選択

- **React Testing Library（RTL）** — コンポーネントテストの標準。レンダリングされた DOM を通じて動作をテストする。
- **Vitest** — 新しい Vite ベースのプロジェクトに推奨するテストランナー。Jest より高速、ネイティブ ESM、同じ API。
- **Jest** — Next.js / CRA プロジェクトでは依然としてデフォルト。RTL は同一に動作する。
- **Playwright Component Testing** — コンポーネントテストに実際のブラウザエンジンが必要な場合（アニメーション、レイアウト、複雑なイベント）
- **Cypress Component Testing** — 代替の実ブラウザコンポーネントランナー

1 つのプロジェクトにつきコンポーネントテストランナーを 1 つだけ選択する — 同一リポジトリに RTL + Playwright CT を混在させない。

## コア原則

ユーザーが見ること・行うことをテストし、実装の詳細をテストしない。

- まずアクセシブルなロールでクエリし、次にラベル、次にテキスト — 他に該当するものがない場合のみ `data-testid` にフォールバックする
- 内部 state、子コンポーネントに渡されたプロップ、呼ばれたフックをアサートしない
- リファクタリングしてもテストが壊れない = テストが動作をテストしていた証拠; それが目標

## クエリの優先順位

RTL は 3 つのファミリーのクエリを提供する。上から順にこの優先順位を使用する:

1. **誰にでもアクセス可能**
   - `getByRole(role, { name })` — 第一選択
   - `getByLabelText` — フォーム入力用
   - `getByPlaceholderText` — ラベルがない場合（そしてラベルを追加する）
   - `getByText` — インタラクティブでないテキスト用
   - `getByDisplayValue` — 現在の値を持つフォームフィールド用

2. **セマンティッククエリ**
   - `getByAltText` — 画像用
   - `getByTitle` — 最終手段、アクセシビリティ価値が低い

3. **テスト ID**
   - `getByTestId("some-id")` — 上記のいずれも機能しない場合のエスケープハッチのみ

`getBy*` はマッチしない場合にスローする。`queryBy*` は null を返す（不在のアサートに使用）。`findBy*` はプロミスを返す（非同期に使用）。

## ユーザーインタラクション

`fireEvent` より `userEvent` を優先する。`userEvent` は実際のブラウザシーケンス（focus、keydown、beforeinput、input、keyup）をシミュレートする — `fireEvent` は単一の合成イベントをディスパッチする。

```tsx
import userEvent from "@testing-library/user-event";

test("フォームを送信する", async () => {
  const user = userEvent.setup();
  render(<UserForm onSubmit={handleSubmit} />);

  await user.type(screen.getByLabelText("Email"), "user@example.com");
  await user.click(screen.getByRole("button", { name: /save/i }));

  expect(handleSubmit).toHaveBeenCalledWith({ email: "user@example.com" });
});
```

- `userEvent` 呼び出しは常に `await` する — 非同期である
- 各テストの先頭で `userEvent.setup()` を 1 度呼び出し、返された `user` を再利用する

## 非同期アサーション

```tsx
// 誤り: 非同期でレンダリングされたコンテンツへの同期クエリ
expect(screen.getByText("Loaded")).toBeInTheDocument();   // スロー — まだ DOM にない

// 正しい: findBy*（プロミスを返し、リトライする）
expect(await screen.findByText("Loaded")).toBeInTheDocument();

// 正しい: 要素以外のアサートには waitFor
await waitFor(() => expect(saveSpy).toHaveBeenCalled());
```

- 非同期な要素の出現には `findBy*`
- 副作用や他のマッチャーの非同期な期待には `waitFor`
- `setTimeout` + アサーションは使わない — フレーキーになる

## MSW によるネットワークモッキング

ネットワーク境界にアクセスするテストには Mock Service Worker を使用する。MSW はネットワーク層で動作するため、コンポーネント、フック、フェッチライブラリはすべて本番と同様に動作する。

```tsx
// テストセットアップ
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer(
  http.get("/api/users/:id", ({ params }) =>
    HttpResponse.json({ id: params.id, name: "Alice" }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

テストごとのオーバーライド:

```tsx
test("500 時にエラーをレンダリングする", async () => {
  server.use(http.get("/api/users/:id", () => new HttpResponse(null, { status: 500 })));
  render(<UserPage id="1" />);
  expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
});
```

## コンポーネントテストでのスナップショットを避ける

レンダリング出力のスナップショットは壊れやすく、レビューが困難で、レビュアーにゴム印を押される。使用が許容されるのは以下のみ:

- 純粋なデータシリアライゼーション（安定した文字列を生成するトランスフォーマーなど）
- 非視覚的な出力の意図しないリグレッションのキャッチ

コンポーネントのビジュアルリグレッションには Playwright / Cypress / Percy のスクリーンショットを使用する — DOM ダフではなく実際のビジュアル差分。

## テストセットアップヘルパー

プロバイダーを一度ラップする:

```tsx
function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider theme={lightTheme}>
        <Router>{ui}</Router>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
```

`test-utils.tsx` からエクスポートし、全体で使用する。

## カスタムフックのテスト

RTL の `renderHook` を使用する:

```tsx
import { renderHook, act } from "@testing-library/react";

test("useCounter がインクリメントする", () => {
  const { result } = renderHook(() => useCounter());
  act(() => result.current.increment());
  expect(result.current.count).toBe(1);
});
```

- state を変化させる呼び出しは常に `act` でラップする
- パブリックなフック API を通じてのみテストする（内部実装ではない）

## アクセシビリティアサーション

```tsx
import { axe } from "vitest-axe";   // または jest-axe

test("UserCard にアクセシビリティ違反がない", async () => {
  const { container } = render(<UserCard user={mockUser} />);
  expect(await axe(container)).toHaveNoViolations();
});
```

コンポーネントテストで axe アサーションを実行する — 欠落したラベル、ARIA の誤用、カラーコントラスト（限定的）を検出する。

## Playwright / Cypress を使う場面

RTL + JSDOM によるコンポーネントテストでは以下ができない:

- 実際のレイアウトのテスト（flexbox、grid、ビューポート依存のレンダリング）
- スクロール、ドラッグアンドドロップ、クリップボードからの貼り付けのテスト
- ブラウザネイティブのアニメーション、CSS トランジションのテスト
- クロスフレームのインタラクション（iframe、ポップアップ）のテスト

これらには Playwright Component Testing またはエンドツーエンドの Playwright / Cypress 実行を使用する。[e2e-testing スキル](../../skills/e2e-testing/SKILL.md) を参照。

## カバレッジ目標

| レイヤー | 目標 |
|---|---|
| 純粋なユーティリティ関数 | ≥90% |
| カスタムフック | ≥85% |
| コンポーネント（プレゼンテーショナル） | ≥80% — 行ではなく動作 |
| コンテナーコンポーネント | ≥70% — ゴールデンパス + エラー状態 |
| ページ（E2E で別途カバー） | ルートごとのスモークテスト最低限 |

## アンチパターン

- `container.querySelector` によるアサート — アクセシビリティクエリをバイパスする
- レンダリング回数のアサート — 実装の詳細
- React フックをモックする（`jest.mock("react", ...)`）— 代わりにコンポーネントをリファクタリングする
- デフォルトで子コンポーネントをモックする — 親の分離ではなく統合をテストすることになる
- 手動の `act()` 警告を無視する — 実際のバグを示している

## スキルリファレンス

エンドツーエンドのテスト例、MSW パターン、アクセシビリティテストのスキャフォールディングについては `skills/react-testing/SKILL.md` を参照。
