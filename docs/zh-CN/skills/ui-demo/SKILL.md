---
name: ui-demo
description: 使用 Playwright 录制精美的 UI 演示视频。当用户要求创建 Web 应用的演示、导览、屏幕录制或教程视频时使用。生成带有可见光标、自然节奏和专业感的 WebM 视频。
origin: ECC
---

# UI 演示视频录制器

使用 Playwright 的视频录制功能，配合注入的光标覆盖层、自然的节奏和叙事流程，录制精美的 Web 应用演示视频。

## 使用场景

* 用户要求制作"演示视频"、"屏幕录制"、"操作演示"或"教程"
* 用户希望以视觉方式展示某个功能或工作流程
* 用户需要为文档、入职培训或利益相关者演示制作视频

## 三阶段流程

每个演示都需经历三个阶段：**探索 -> 排练 -> 录制**。切勿直接跳至录制阶段。

***

## 阶段 1：探索

在编写任何脚本之前，先探索目标页面，了解实际内容。

### 原因

你无法为未见过的内容编写脚本。字段可能是 `<input>` 而非 `<textarea>`，下拉菜单可能是自定义组件而非 `<select>`，评论框可能支持 `@mentions` 或 `#tags`。假设会无声地破坏录制。

### 方法

导航至流程中的每个页面，并转储其交互元素：

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

### 需要关注的内容

* **表单字段**：它们是 `<select>`、`<input>`、自定义下拉菜单还是组合框？
* **选择选项**：转储选项的值和文本。占位符通常包含 `value="0"` 或 `value=""`，看起来非空。使用 `Array.from(el.options).map(o => ({ value: o.value, text: o.text }))`。跳过文本包含"选择"或值为 `"0"` 的选项。
* **富文本**：评论框是否支持 `@mentions`、`#tags`、Markdown 或表情符号？检查占位符文本。
* **必填字段**：哪些字段会阻止表单提交？检查标签中的 `required`、`*`，并尝试提交空表单以查看验证错误。
* **动态内容**：字段是否在填写其他字段后出现？
* **按钮标签**：确切的文本，如 `"Submit"`、`"Submit Request"` 或 `"Send"`。
* **表格列标题**：对于表格驱动的模态框，将每个 `input[type="number"]` 映射到其列标题，而不是假设所有数字输入都表示相同含义。

### 输出

每个页面的字段映射，用于在脚本中编写正确的选择器。示例：

```text
/purchase-requests/new:
  - 预算代码: <select> (页面上的第一个下拉框，4个选项)
  - 期望交付日期: <input type="date">
  - 背景说明: <textarea> (非输入框)
  - BOM表: 可内联编辑的单元格，包含 span.cursor-pointer -> input 模式
  - 提交: <button> 文本="提交"

/purchase-requests/N (详情):
  - 评论: <input placeholder="输入消息..."> 支持 @用户 和 #PR 标签
  - 发送: <button> 文本="发送" (在输入内容前处于禁用状态)
```

***

## 阶段 2：排练

在不录制的情况下运行所有步骤。验证每个选择器都能解析。

### 原因

静默的选择器失败是演示录制中断的主要原因。排练可以在浪费录制之前发现它们。

### 方法

使用 `ensureVisible`，一个记录日志并大声报错的包装器：

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

### 排练脚本结构

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

### 排练失败时

1. 读取可见元素转储。
2. 找到正确的选择器。
3. 更新脚本。
4. 重新运行排练。
5. 仅在所有选择器通过后才继续。

***

## 阶段 3：录制

仅在探索和排练通过后，才创建录制。

### 录制原则

#### 1. 叙事流程

将视频规划为一个故事。遵循用户指定的顺序，或使用此默认顺序：

* **入口**：登录或导航至起始点
* **背景**：平移周围环境，让观众定位
* **操作**：执行主要工作流程步骤
* **变体**：展示次要功能，如设置、主题或本地化
* **结果**：展示结果、确认或新状态

#### 2. 节奏

* 登录后：`4s`
* 导航后：`3s`
* 点击按钮后：`2s`
* 主要步骤之间：`1.5-2s`
* 最终操作后：`3s`
* 输入延迟：每个字符 `25-40ms`

#### 3. 光标覆盖层

注入一个跟随鼠标移动的 SVG 箭头光标：

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

每次页面导航后调用 `injectCursor(page)`，因为覆盖层会在导航时被销毁。

#### 4. 鼠标移动

切勿瞬移光标。在点击前移动到目标：

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

每次调用都应包含描述性的 `label` 以便调试。

#### 5. 输入

可见地输入，而非瞬间填充：

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

#### 6. 滚动

使用平滑滚动而非跳跃：

```javascript
await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
await page.waitForTimeout(1500);
```

#### 7. 仪表盘平移

展示仪表盘或概览页面时，将光标移过关键元素：

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

在视口底部注入一个字幕栏：

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

每次导航后，将 `injectSubtitleBar(page)` 与 `injectCursor(page)` 一起调用。

使用模式：

```javascript
await showSubtitle(page, 'Step 1 - Logging in');
await showSubtitle(page, 'Step 2 - Dashboard overview');
await showSubtitle(page, '');
```

指南：

* 保持字幕文本简短，最好在 60 个字符以内。
* 使用 `Step N - Action` 格式以保持一致性。
* 在长时间暂停且界面可以自我说明时清除字幕。

## 脚本模板

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

使用方式：

```bash
# Phase 2: Rehearse
node demo-script.cjs --rehearse

# Phase 3: Record
node demo-script.cjs
```

## 录制前检查清单

* \[ ] 探索阶段已完成
* \[ ] 排练通过，所有选择器正常
* \[ ] 已启用无头模式
* \[ ] 分辨率设置为 `1280x720`
* \[ ] 每次导航后重新注入光标和字幕覆盖层
* \[ ] 在主要过渡时使用 `showSubtitle(page, 'Step N - ...')`
* \[ ] 所有点击均使用 `moveAndClick` 并带有描述性标签
* \[ ] 可见输入使用 `typeSlowly`
* \[ ] 无静默捕获；辅助函数记录警告
* \[ ] 内容展示使用平滑滚动
* \[ ] 关键暂停对观看者可见
* \[ ] 流程符合请求的故事顺序
* \[ ] 脚本反映阶段 1 中发现的实际 UI

## 常见陷阱

1. 导航后光标消失 - 重新注入。
2. 视频太快 - 添加暂停。
3. 光标是点而非箭头 - 使用 SVG 覆盖层。
4. 光标瞬移 - 在点击前移动。
5. 选择下拉菜单显示异常 - 展示移动过程，然后选择选项。
6. 模态框显得突兀 - 在确认前添加阅读暂停。
7. 视频文件路径随机 - 将其复制到稳定的输出名称。
8. 选择器失败被吞没 - 切勿使用静默捕获块。
9. 字段类型被假设 - 先探索它们。
10. 功能被假设 - 在编写脚本前检查实际 UI。
11. 占位符选择值看起来真实 - 注意 `"0"` 和 `"Select..."`。
12. 弹出窗口创建单独的视频 - 显式捕获弹出页面，必要时稍后合并。
