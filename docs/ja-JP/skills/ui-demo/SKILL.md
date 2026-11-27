---
name: ui-demo
description: Playwrightを使用して美しいUIデモ動画を録画する。ユーザーがWebアプリのデモ、ウォークスルー、スクリーン録画、またはチュートリアル動画の作成を求める場合に使用する。可視カーソル、自然なリズム、プロフェッショナルな仕上がりのWebM動画を生成する。
origin: ECC
---

# UI デモ動画レコーダー

Playwrightの動画録画機能を使用して、注入されたカーソルオーバーレイ、自然なリズム、ナラティブフローを備えた美しいWebアプリのデモ動画を録画する。

## 使用場面

* ユーザーが「デモ動画」「スクリーン録画」「操作デモ」または「チュートリアル」を求める場合
* ユーザーが機能またはワークフローを視覚的に見せたい場合
* ユーザーがドキュメント、オンボーディング、ステークホルダーへのデモのために動画が必要な場合

## 3フェーズのプロセス

すべてのデモは **探索 -> リハーサル -> 録画** の3つのフェーズを経る。録画フェーズに直接ジャンプしない。

***

## フェーズ 1：探索

スクリプトを書く前に、ターゲットページを探索して実際の内容を把握する。

### なぜか

見たことのない内容のスクリプトは書けない。フィールドが `<textarea>` ではなく `<input>` の場合、ドロップダウンが `<select>` ではなくカスタムコンポーネントの場合、コメントボックスが `@mentions` や `#tags` をサポートしている場合があある。仮定は録画を静かに壊す。

### 方法

フローの各ページに移動し、インタラクティブな要素をダンプする：

```javascript
// Run this for each page in the flow BEFORE writing the demo script
const fields = await page.evaluate(() => {
  const els = [];
  document.querySelectorAll('input, select, textarea, button, [contenteditable]').forEach(el => {
    if (el.offsetParent !== null) {
      els.push({
        tag: el.tagName,
        type: el.type || '',
        name: el.name || '',
        placeholder: el.placeholder || '',
        text: el.textContent?.trim().substring(0, 40) || '',
        contentEditable: el.contentEditable === 'true',
        role: el.getAttribute('role') || '',
      });
    }
  });
  return els;
});
console.log(JSON.stringify(fields, null, 2));
```

### 確認すべき内容

* **フォームフィールド**：`<select>`、`<input>`、カスタムドロップダウン、コンボボックスのどれか？
* **選択オプション**：オプションの値とテキストをダンプする。プレースホルダーには `value="0"` または `value=""` が含まれることがあり、非空に見える。`Array.from(el.options).map(o => ({ value: o.value, text: o.text }))` を使用する。テキストに「選択」が含まれるオプションや値が `"0"` のオプションをスキップする。
* **リッチテキスト**：コメントボックスは `@mentions`、`#tags`、Markdown、絵文字をサポートしているか？プレースホルダーテキストを確認する。
* **必須フィールド**：どのフィールドがフォームの送信をブロックするか？ラベルの `required`、`*` を確認し、空のフォームを送信してバリデーションエラーを確認する。
* **動的コンテンツ**：他のフィールドを入力した後にフィールドが表示されるか？
* **ボタンラベル**：正確なテキスト（`"Submit"`、`"Submit Request"`、`"Send"` など）。
* **テーブル列ヘッダー**：テーブル駆動のモーダルには、各 `input[type="number"]` をその列ヘッダーにマッピングする。すべての数値入力が同じ意味を持つと仮定しない。

### 出力

スクリプトに正しいセレクターを書くために使用する、ページごとのフィールドマッピング。例：

```text
/purchase-requests/new:
  - 予算コード: <select>（ページの最初のドロップダウン、4オプション）
  - 希望納期: <input type="date">
  - 背景説明: <textarea>（inputではない）
  - BOMテーブル: インライン編集可能なセル、span.cursor-pointer -> inputパターン
  - 送信: <button> テキスト="送信"

/purchase-requests/N（詳細）:
  - コメント: <input placeholder="メッセージを入力...">、@ユーザーと#PRタグに対応
  - 送信: <button> テキスト="送信"（入力前は無効）
```

***

## フェーズ 2：リハーサル

録画せずにすべてのステップを実行する。各セレクターが解決されることを確認する。

### なぜか

セレクターの失敗は、デモ録画が壊れる最大の原因。リハーサルは録画を無駄にする前に問題を発見する。

### 方法

`ensureVisible` を使用する——ログを記録して大きくエラーを報告するラッパー：

```javascript
async function ensureVisible(page, locator, label) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    const msg = `REHEARSAL FAIL: "${label}" not found - selector: ${typeof locator === 'string' ? locator : '(locator object)'}`;
    console.error(msg);
    const found = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input, select, textarea, a'))
        .filter(el => el.offsetParent !== null)
        .map(el => `${el.tagName}[${el.type || ''}] "${el.textContent?.trim().substring(0, 30)}"`)
        .join('\n  ');
    });
    console.error('  Visible elements:\n  ' + found);
    return false;
  }
  console.log(`REHEARSAL OK: "${label}"`);
  return true;
}
```

### リハーサルスクリプトの構造

```javascript
const steps = [
  { label: 'Login email field', selector: '#email' },
  { label: 'Login submit', selector: 'button[type="submit"]' },
  { label: 'New Request button', selector: 'button:has-text("New Request")' },
  { label: 'Budget Code select', selector: 'select' },
  { label: 'Delivery date', selector: 'input[type="date"]:visible' },
  { label: 'Description field', selector: 'textarea:visible' },
  { label: 'Add Item button', selector: 'button:has-text("Add Item")' },
  { label: 'Submit button', selector: 'button:has-text("Submit")' },
];

let allOk = true;
for (const step of steps) {
  if (!await ensureVisible(page, step.selector, step.label)) {
    allOk = false;
  }
}
if (!allOk) {
  console.error('REHEARSAL FAILED - fix selectors before recording');
  process.exit(1);
}
console.log('REHEARSAL PASSED - all selectors verified');
```

### リハーサルが失敗した場合

1. 可視要素のダンプを読む。
2. 正しいセレクターを見つける。
3. スクリプトを更新する。
4. リハーサルを再実行する。
5. すべてのセレクターが通過した後のみ続行する。

***

## フェーズ 3：録画

探索とリハーサルが通過した後にのみ、録画を作成する。

### 録画の原則

#### 1. ナラティブフロー

動画をストーリーとして計画する。ユーザーが指定した順序に従うか、このデフォルト順序を使用する：

* **エントリー**：ログインまたは開始点へのナビゲーション
* **コンテキスト**：周囲を確認して、視聴者がどこにいるか理解できるようにする
* **アクション**：主要なワークフローステップを実行する
* **バリアント**：設定、テーマ、ローカライゼーションなどの補助機能を表示する
* **結果**：結果、確認、または新しい状態を表示する

#### 2. リズム

* ログイン後：`4秒`
* ナビゲーション後：`3秒`
* ボタンクリック後：`2秒`
* 主要なステップ間：`1.5〜2秒`
* 最終アクション後：`3秒`
* 入力の遅延：文字ごとに `25〜40ms`

#### 3. カーソルオーバーレイ

マウスの動きを追うSVGの矢印カーソルを注入する：

```javascript
async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
    cursor.style.cssText = `
      position: fixed; z-index: 999999; pointer-events: none;
      width: 24px; height: 24px;
      transition: left 0.1s, top 0.1s;
      filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.3));
    `;
    cursor.style.left = '0px';
    cursor.style.top = '0px';
    document.body.appendChild(cursor);
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });
  });
}
```

オーバーレイはナビゲーション時に破棄されるため、ページナビゲーションのたびに `injectCursor(page)` を呼び出す。

#### 4. マウスの動き

カーソルを瞬間移動させない。クリック前にターゲットに移動する：

```javascript
async function moveAndClick(page, locator, label, opts = {}) {
  const { postClickDelay = 800, ...clickOpts } = opts;
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    console.error(`WARNING: moveAndClick skipped - "${label}" not visible`);
    return false;
  }
  try {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await el.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      await page.waitForTimeout(400);
    }
    await el.click(clickOpts);
  } catch (e) {
    console.error(`WARNING: moveAndClick failed on "${label}": ${e.message}`);
    return false;
  }
  await page.waitForTimeout(postClickDelay);
  return true;
}
```

デバッグのために各呼び出しに説明的な `label` を含める。

#### 5. 入力

瞬時に入力するのではなく、目に見えるように入力する：

```javascript
async function typeSlowly(page, locator, text, label, charDelay = 35) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    console.error(`WARNING: typeSlowly skipped - "${label}" not visible`);
    return false;
  }
  await moveAndClick(page, el, label);
  await el.fill('');
  await el.pressSequentially(text, { delay: charDelay });
  await page.waitForTimeout(500);
  return true;
}
```

#### 6. スクロール

ジャンプではなくスムーズスクロールを使用する：

```javascript
await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
await page.waitForTimeout(1500);
```

#### 7. ダッシュボードパン

ダッシュボードや概要ページを表示する場合、主要な要素の上にカーソルを移動させる：

```javascript
async function panElements(page, selector, maxCount = 6) {
  const elements = await page.locator(selector).all();
  for (let i = 0; i < Math.min(elements.length, maxCount); i++) {
    try {
      const box = await elements[i].boundingBox();
      if (box && box.y < 700) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
        await page.waitForTimeout(600);
      }
    } catch (e) {
      console.warn(`WARNING: panElements skipped element ${i} (selector: "${selector}"): ${e.message}`);
    }
  }
}
```

#### 8. 字幕

ビューポートの下部に字幕バーを注入する：

```javascript
async function injectSubtitleBar(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-subtitle')) return;
    const bar = document.createElement('div');
    bar.id = 'demo-subtitle';
    bar.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 999998;
      text-align: center; padding: 12px 24px;
      background: rgba(0, 0, 0, 0.75);
      color: white; font-family: -apple-system, "Segoe UI", sans-serif;
      font-size: 16px; font-weight: 500; letter-spacing: 0.3px;
      transition: opacity 0.3s;
      pointer-events: none;
    `;
    bar.textContent = '';
    bar.style.opacity = '0';
    document.body.appendChild(bar);
  });
}

async function showSubtitle(page, text) {
  await page.evaluate((t) => {
    const bar = document.getElementById('demo-subtitle');
    if (!bar) return;
    if (t) {
      bar.textContent = t;
      bar.style.opacity = '1';
    } else {
      bar.style.opacity = '0';
    }
  }, text);
  if (text) await page.waitForTimeout(800);
}
```

ナビゲーションのたびに `injectSubtitleBar(page)` を `injectCursor(page)` と一緒に呼び出す。

使用パターン：

```javascript
await showSubtitle(page, 'Step 1 - Logging in');
await showSubtitle(page, 'Step 2 - Dashboard overview');
await showSubtitle(page, '');
```

ガイドライン：

* 字幕テキストは短く、60文字以内が望ましい。
* 一貫性のために `Step N - Action` 形式を使用する。
* 長い一時停止でインターフェースが自己説明的な場合は字幕をクリアする。

## スクリプトテンプレート

```javascript
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:3000';
const VIDEO_DIR = path.join(__dirname, 'screenshots');
const OUTPUT_NAME = 'demo-FEATURE.webm';
const REHEARSAL = process.argv.includes('--rehearse');

// Paste injectCursor, injectSubtitleBar, showSubtitle, moveAndClick,
// typeSlowly, ensureVisible, and panElements here.

(async () => {
  const browser = await chromium.launch({ headless: true });

  if (REHEARSAL) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    // Navigate through the flow and run ensureVisible for each selector.
    await browser.close();
    return;
  }

  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    await injectCursor(page);
    await injectSubtitleBar(page);

    await showSubtitle(page, 'Step 1 - Logging in');
    // login actions

    await page.goto(`${BASE_URL}/dashboard`);
    await injectCursor(page);
    await injectSubtitleBar(page);
    await showSubtitle(page, 'Step 2 - Dashboard overview');
    // pan dashboard

    await showSubtitle(page, 'Step 3 - Main workflow');
    // action sequence

    await showSubtitle(page, 'Step 4 - Result');
    // final reveal
    await showSubtitle(page, '');
  } catch (err) {
    console.error('DEMO ERROR:', err.message);
  } finally {
    await context.close();
    const video = page.video();
    if (video) {
      const src = await video.path();
      const dest = path.join(VIDEO_DIR, OUTPUT_NAME);
      try {
        fs.copyFileSync(src, dest);
        console.log('Video saved:', dest);
      } catch (e) {
        console.error('ERROR: Failed to copy video:', e.message);
        console.error('  Source:', src);
        console.error('  Destination:', dest);
      }
    }
    await browser.close();
  }
})();
```

使用方法：

```bash
# Phase 2: Rehearse
node demo-script.cjs --rehearse

# Phase 3: Record
node demo-script.cjs
```

## 録画前チェックリスト

* \[ ] 探索フェーズが完了
* \[ ] リハーサルが通過し、すべてのセレクターが機能する
* \[ ] ヘッドレスモードが有効
* \[ ] 解像度が `1280x720` に設定されている
* \[ ] 各ナビゲーション後にカーソルと字幕のオーバーレイを再注入する
* \[ ] 主要なトランジション時に `showSubtitle(page, 'Step N - ...')` を使用する
* \[ ] すべてのクリックが説明的なラベル付きの `moveAndClick` を使用する
* \[ ] 目に見える入力が `typeSlowly` を使用する
* \[ ] サイレントキャッチなし。ヘルパー関数は警告を記録する
* \[ ] コンテンツ表示にスムーズスクロールを使用する
* \[ ] 重要な一時停止が視聴者に対して見える
* \[ ] フローが要求されたストーリー順序に従っている
* \[ ] スクリプトがフェーズ1で発見した実際のUIを反映している

## よくある落とし穴

1. ナビゲーション後にカーソルが消える——再注入する。
2. 動画が速すぎる——一時停止を追加する。
3. カーソルが矢印ではなく点になっている——SVGオーバーレイを使用する。
4. カーソルが瞬間移動する——クリック前に移動する。
5. ドロップダウン選択が途切れる——移動を表示してからオプションを選択する。
6. モーダルが唐突に見える——確認前に読み取り一時停止を追加する。
7. 動画ファイルパスがランダム——安定した出力名にコピーする。
8. セレクターの失敗が飲み込まれる——サイレントキャッチブロックを絶対に使わない。
9. フィールドタイプを仮定する——まず探索する。
10. 機能を仮定する——スクリプトを書く前に実際のUIを確認する。
11. プレースホルダーの選択値が本物に見える——`"0"` と `"Select..."` に注意する。
12. ポップアップが別の動画を作成する——ポップアップページを明示的にキャプチャし、必要に応じて後でマージする。
