---
paths:
  - "**/*.ets"
  - "**/*.ts"
  - "**/module.json5"
---
# HarmonyOS / ArkTS Security

> This file extends [common/security.md](../common/security.md) with HarmonyOS-specific security practices.

## Permission Management

### Declare Permissions in module.json5

All system API calls requiring permissions must be declared:

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

### Permission Checklist

Before calling system APIs, verify:

- [ ] Permission declared in `module.json5`
- [ ] Permission reason string defined in resources (for user-facing permissions)
- [ ] Runtime permission request implemented for sensitive permissions (camera, location, etc.)
- [ ] Permission check before API call with graceful fallback on denial

### Runtime Permission Request

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

## Secret Management

- **NEVER** hardcode API keys, tokens, or passwords in `.ets`/`.ts` source files
- Use HarmonyOS Preferences API for non-sensitive configuration
- Use HarmonyOS Keystore for sensitive credentials
- Environment-specific configs should be managed via build profiles

```typescript
// BAD: hardcoded secret
const API_KEY: string = 'sk-xxxxxxxxxxxx';

// GOOD: from build profile config (non-sensitive)
import { BuildProfile } from 'BuildProfile';
const endpoint = BuildProfile.API_ENDPOINT;

// GOOD: use HUKS to encrypt/decrypt data without exposing key material
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

## Input Validation

- Validate all user input before processing
- Sanitize data before displaying in UI to prevent injection
- Validate deep link parameters before navigation

```typescript
// Validate before navigation
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

## Network Security

- Always use HTTPS for network requests
- Validate server certificates
- Implement request timeout and retry policies
- Never log sensitive data (tokens, user credentials) in network request/response logs

## Data Storage Security

- Use encrypted preferences for sensitive local data
- Clear sensitive data from memory when no longer needed
- Implement proper data lifecycle management
- Consider data classification (public, internal, confidential) when choosing storage mechanisms

## Dependency Security

- Only use dependencies from trusted sources (official ohpm registry)
- Verify dependency versions in `oh-package.json5`
- Regularly check for known vulnerabilities in third-party libraries
- Pin dependency versions to avoid unexpected updates
