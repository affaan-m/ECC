---
paths:
  - "**/*.ets"
  - "**/*.ts"
  - "**/module.json5"
---
# HarmonyOS / ArkTS セキュリティ

> このファイルは [common/security.md](../common/security.md) を HarmonyOS 固有のセキュリティプラクティスで拡張します。

## パーミッション管理

### module.json5 でのパーミッション宣言

パーミッションが必要なすべてのシステム API 呼び出しを宣言する必要がある:

```json5
{
  "module": {
    "requestPermissions": [
      {
        "name": "ohos.permission.INTERNET",
        "reason": "$string:internet_permission_reason",
        "usedScene": {
          "abilities": ["EntryAbility"],
          "when": "always"
        }
      }
    ]
  }
}
```

### パーミッションチェックリスト

システム API を呼び出す前に確認する:

- [ ] パーミッションが `module.json5` に宣言されている
- [ ] パーミッション理由の文字列がリソースで定義されている（ユーザー向けパーミッションの場合）
- [ ] 機密性の高いパーミッション（カメラ、位置情報など）に対してランタイムパーミッションリクエストが実装されている
- [ ] API 呼び出し前にパーミッションを確認し、拒否時の適切なフォールバックがある

### ランタイムパーミッションリクエスト

```typescript
import { abilityAccessCtrl, bundleManager, Permissions } from '@kit.AbilityKit';

async function checkAndRequestPermission(permission: Permissions): Promise<boolean> {
  const atManager = abilityAccessCtrl.createAtManager();
  const bundleInfo = await bundleManager.getBundleInfoForSelf(
    bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION
  );
  const tokenId = bundleInfo.appInfo.accessTokenId;
  const grantStatus = await atManager.checkAccessToken(tokenId, permission);

  if (grantStatus === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
    return true;
  }

  const result = await atManager.requestPermissionsFromUser(getContext(), [permission]);
  return result.authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
}
```

## シークレット管理

- API キー、トークン、パスワードを `.ets`/`.ts` ソースファイルに**絶対にハードコードしない**
- 機密性の低い設定には HarmonyOS Preferences API を使用する
- 機密性の高い認証情報には HarmonyOS キーストアを使用する
- 環境固有の設定はビルドプロファイルで管理する

```typescript
// BAD: ハードコードされたシークレット
const API_KEY: string = 'sk-xxxxxxxxxxxx';

// GOOD: ビルドプロファイル設定から取得（機密性なし）
import { BuildProfile } from 'BuildProfile';
const endpoint = BuildProfile.API_ENDPOINT;

// GOOD: HUKS を使用してキー素材を露出せずにデータを暗号化/復号化する
import { huks } from '@kit.UniversalKeystoreKit';
async function decryptWithKeystore(alias: string, nonce: Uint8Array, aad: Uint8Array, cipherData: Uint8Array): Promise<Uint8Array> {
  const options: huks.HuksOptions = {
    properties: [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT },
      { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
      { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
      { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce },
      { tag: huks.HuksTag.HUKS_TAG_ASSOCIATED_DATA, value: aad }
    ],
    inData: cipherData
  };
  const handle = await huks.initSession(alias, options);
  const result = await huks.finishSession(handle.handle, options);
  return result.outData;
}
```

## 入力バリデーション

- 処理前にすべてのユーザー入力を検証する
- インジェクションを防ぐため、UI に表示する前にデータをサニタイズする
- ナビゲーション前にディープリンクのパラメータを検証する

```typescript
// ナビゲーション前に検証する
function handleDeepLink(uri: string): void {
  const allowedPaths: string[] = ['detail', 'settings', 'profile'];
  const parsed = new URL(uri);
  const path = parsed.pathname.replace('/', '');

  if (!allowedPaths.includes(path)) {
    hilog.warn(0x0000, 'DeepLink', 'Invalid deep link path: %{public}s', path);
    return;
  }

  navPathStack.pushPath({ name: path });
}
```

## ネットワークセキュリティ

- ネットワークリクエストには常に HTTPS を使用する
- サーバー証明書を検証する
- リクエストのタイムアウトとリトライポリシーを実装する
- ネットワークリクエスト/レスポンスのログに機密データ（トークン、ユーザー認証情報）を記録しない

## データストレージセキュリティ

- 機密性の高いローカルデータには暗号化されたプリファレンスを使用する
- 不要になった機密データはメモリから消去する
- 適切なデータライフサイクル管理を実装する
- ストレージメカニズムを選択する際にデータ分類（公開、内部、機密）を考慮する

## 依存関係のセキュリティ

- 信頼できるソース（公式 ohpm レジストリ）からの依存関係のみを使用する
- `oh-package.json5` の依存関係バージョンを確認する
- サードパーティライブラリの既知の脆弱性を定期的に確認する
- 予期しない更新を避けるために依存関係バージョンを固定する
