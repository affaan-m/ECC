---
description: AndroidおよびKMPプロジェクトのGradleビルドエラーを修正します
---

# Gradleビルド修正

AndroidおよびKotlin Multiplatformプロジェクトのgradleビルドおよびコンパイルエラーをインクリメンタルに修正します。

## ステップ 1: ビルド設定の検出

プロジェクトタイプを特定し、適切なビルドを実行:

| インジケーター | ビルドコマンド |
|--------------|--------------|
| `build.gradle.kts` + `composeApp/`（KMP） | `./gradlew composeApp:compileKotlinMetadata 2>&1` |
| `build.gradle.kts` + `app/`（Android） | `./gradlew app:compileDebugKotlin 2>&1` |
| モジュール付き`settings.gradle.kts` | `./gradlew assemble 2>&1` |
| Detekt設定済み | `./gradlew detekt 2>&1` |

`gradle.properties`と`local.properties`の設定も確認します。

## ステップ 2: エラーの解析とグループ化

1. ビルドコマンドを実行し出力をキャプチャ
2. Kotlinコンパイルエラーとgradle設定エラーを分離
3. モジュールとファイルパスでグループ化
4. ソート: 設定エラーを最初に、次に依存関係順でコンパイルエラー

## ステップ 3: 修正ループ

各エラーに対して:

1. **ファイルを読む** — エラー行周辺の完全なコンテキスト
2. **診断** — 一般的なカテゴリ:
   - importの欠落または未解決の参照
   - 型の不一致または非互換な型
   - `build.gradle.kts`内の依存関係の欠落
   - Expect/actualの不一致（KMP）
   - Composeコンパイラエラー
3. **最小限の修正** — エラーを解決する最小の変更
4. **ビルドを再実行** — 修正を検証し新しいエラーを確認
5. **続行** — 次のエラーへ

## ステップ 4: ガードレール

以下の場合はユーザーに停止して確認:
- 修正が解決するより多くのエラーを導入
- 3回の試行後も同じエラーが持続
- エラーが新しい依存関係の追加やモジュール構造の変更を必要とする
- Gradle sync自体が失敗（設定フェーズエラー）
- エラーが生成コード内にある（Room、SQLDelight、KSP）

## ステップ 5: サマリー

報告内容:
- 修正されたエラー（モジュール、ファイル、説明）
- 残りのエラー
- 導入された新しいエラー（ゼロであるべき）
- 推奨される次のステップ

## 一般的なGradle/KMP修正

| エラー | 修正 |
|--------|------|
| `commonMain`内の未解決の参照 | 依存関係が`commonMain.dependencies {}`にあるか確認 |
| actualなしのExpect宣言 | 各プラットフォームソースセットに`actual`実装を追加 |
| Composeコンパイラバージョンの不一致 | `libs.versions.toml`でKotlinとComposeコンパイラバージョンを揃える |
| 重複クラス | `./gradlew dependencies`で競合する依存関係を確認 |
| KSPエラー | `./gradlew kspCommonMainKotlinMetadata`を実行して再生成 |
| 設定キャッシュの問題 | シリアライズ不可能なタスク入力を確認 |
