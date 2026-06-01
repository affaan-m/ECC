# Billing Marketplace 準備状況プレイブック

リリースコピーまたはロードマップのテキストに、ECC Tools の課金・Marketplace の提供状況・アカウント復旧・プラン・シート・エンタイトルメント・サブスクリプション状態について言及がある場合に、このプレイブックを使用してください。

## 受け入れパス

1. `docs/releases/2.0.0-rc.1/publication-readiness.md` を起点とする。
2. 現在のリポジトリおよび公開リスティングのサーフェスを確認する:
   - `gh api repos/ECC-Tools/ECC-Tools`
   - `https://github.com/marketplace/ecc-tools`
3. 課金または Marketplace に関するすべての主張を以下のいずれかに分類する:
   - `verified`（検証済み）
   - `blocked`（ブロック済み）
   - `remove-before-publication`（公開前に削除）
4. ロードマップの受け入れ基準と稼働中のプロダクトの主張を分けて管理する。
5. 証拠が稼働中の URL またはコマンドの実行結果を指している場合にのみ、リリースコピーを更新する。
6. タグの作成、npm publish、プラグインの申請、Marketplace の編集、サブスクリプションの変更、アナウンスの投稿は承認ゲートを維持する。

## 拒否パス

ロードマップ項目が存在する、ドライランが成功した、または Marketplace の URL が判明しているという理由だけで、課金が稼働中であると断言してはならない。ロードマップの意図とドライラン公開の証拠は、課金の状態ではない。

エバリュエーター実行からプラン制限・サブスクリプション・シート・エンタイトルメント・Marketplace のメタデータを編集してはならない。それらはプロダクト/オペレーターのアクションであり、独自の承認パスが必要である。

## バリデーションゲート

- `rg -n "billing|Billing|Marketplace|marketplace|subscription|seat|entitlement|plan" README.md docs/releases/2.0.0-rc.1 docs/ECC-2.0-GA-ROADMAP.md`
- `gh api repos/ECC-Tools/ECC-Tools`
- `https://github.com/marketplace/ecc-tools` の手動ライブ確認
- `npx --yes markdownlint-cli docs/releases/2.0.0-rc.1/*.md docs/ECC-2.0-GA-ROADMAP.md`
- `git diff --check`

リリースコピーを公開する前に、メンテナーが所有する PR に証拠を記録すること。
