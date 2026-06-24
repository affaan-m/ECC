---
paths:
  - "**/*.ets"
  - "**/*.ts"
  - "**/ohosTest/**"
---
# HarmonyOS / ArkTS テスト

> このファイルは [common/testing.md](../common/testing.md) を HarmonyOS 固有のテストプラクティスで拡張します。

## テストフレームワーク

HarmonyOS は `@ohos.test` 機能を持つ組み込みテストフレームワークを使用する:

- **ユニットテスト**: `src/ohosTest/ets/test/` に配置
- **UI テスト**: コンポーネントテストには `@ohos.UiTest` を使用
- **インストルメントテスト**: デバイス/エミュレーターで実行

## テストディレクトリ構成

```
module/
  |-- src/
  |   |-- main/ets/          # プロダクションコード
  |   |-- ohosTest/ets/      # テストコード
  |       |-- test/
  |       |   |-- Ability.test.ets
  |       |   |-- List.test.ets
  |       |-- TestAbility.ets
  |       |-- TestRunner.ets
```

## テストの実行

```bash
# モジュールのすべてのテストを実行する
hvigorw testHap -p product=default

# 接続されたデバイスでテストを実行する
hdc shell aa test -b com.example.app -m entry_test -s unittest /ets/TestRunner/OpenHarmonyTestRunner
```

## ユニットテストの例

```typescript
import { describe, it, expect } from '@ohos/hypium';

export default function UserViewModelTest() {
  describe('UserViewModel', () => {
    it('should_initialize_with_empty_state', 0, () => {
      const vm = new UserViewModel();
      expect(vm.userName).assertEqual('');
      expect(vm.isLoading).assertFalse();
    });

    it('should_update_user_name', 0, () => {
      const vm = new UserViewModel();
      vm.updateUserName('Alice');
      expect(vm.userName).assertEqual('Alice');
    });

    it('should_handle_empty_input', 0, () => {
      const vm = new UserViewModel();
      vm.updateUserName('');
      expect(vm.userName).assertEqual('');
      expect(vm.hasError).assertFalse();
    });
  });
}
```

## UI テストの例

```typescript
import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON } from '@ohos.UiTest';

export default function HomePageUITest() {
  describe('HomePage_UI', () => {
    it('should_display_title', 0, async () => {
      const driver = Driver.create();
      await driver.delayMs(1000);

      const title = await driver.findComponent(ON.text('Home'));
      expect(title !== null).assertTrue();
    });

    it('should_navigate_to_detail_on_click', 0, async () => {
      const driver = Driver.create();
      const button = await driver.findComponent(ON.id('detailButton'));
      await button.click();
      await driver.delayMs(500);

      const detailTitle = await driver.findComponent(ON.text('Detail'));
      expect(detailTitle !== null).assertTrue();
    });
  });
}
```

## HarmonyOS 向け TDD ワークフロー

HarmonyOS に適応した標準 TDD サイクルに従う:

1. **RED**: `ohosTest/ets/test/` に失敗するテストを書く
2. **GREEN**: `main/ets/` にテストを通過するための最小限のコードを実装する
3. **REFACTOR**: テストをグリーンに保ちながらクリーンアップする
4. **ビルド**: `hvigorw assembleHap` を実行してコンパイルを確認する
5. **VERIFY**: デバイス/エミュレーターでテストを実行する

## テストカバレッジ要件

- すべての重要なアプリケーションコード（ViewModels、サービス、ユーティリティ）で最低 80% のカバレッジ
- **ユニットテスト**: すべてのユーティリティ関数、ViewModel ロジック、データモデル
- **統合テスト**: API 呼び出し、データベース操作、クロスモジュールインタラクション
- **E2E / UI テスト**: 重要なユーザーフロー（ログイン、ナビゲーション、データ送信）
- エッジケースのテスト: 空のデータ、ネットワークエラー、パーミッション拒否

## テストのベストプラクティス

- テストを独立させる — テスト間で共有のミュータブルな状態を持たない
- ユニットテストではネットワーク呼び出しとシステム API をモックする
- 意味のあるテスト名を使用する: `should_[期待される動作]_when_[条件]`
- V2 状態管理のリアクティビティをテストする: `@Trace` プロパティが UI 更新をトリガーすることを確認する
- Navigation フローをテストする: `NavPathStack` のプッシュ/ポップ/置き換え操作を確認する
- フレームワーク内部のテストは避ける — ビジネスロジックとユーザーが見える動作に集中する
