# 样式预设参考

为 `frontend-slides` 整理的视觉样式。

使用此文件用于：

* 强制性的视口适配 CSS 基础
* 预设选择和情绪映射
* CSS 陷阱和验证规则

仅使用抽象形状。除非用户明确要求，否则避免使用插图。

## 视口适配不容妥协

每张幻灯片必须完全适配一个视口。

### 黄金法则

```text
每个幻灯片 = 恰好一个视口高度。
内容过多 = 分割成更多幻灯片。
切勿在幻灯片内部滚动。
```

### 内容密度限制

| 幻灯片类型 | 最大内容量 |
|---|---|
| 标题幻灯片 | 1 个标题 + 1 个副标题 + 可选标语 |
| 内容幻灯片 | 1 个标题 + 4-6 个要点或 2 个段落 |
| 功能网格 | 最多 6 张卡片 |
| 代码幻灯片 | 最多 8-10 行 |
| 引用幻灯片 | 1 条引用 + 出处 |
| 图片幻灯片 | 1 张图片，理想情况下低于 60vh |

## 强制基础 CSS

将此代码块复制到每个生成的演示文稿中，然后在其基础上应用主题。

```css
/* ===========================================
   VIEWPORT FITTING: MANDATORY BASE STYLES
   =========================================== */

html, body {
    height: 100%;
    overflow-x: hidden;
}

html {
    scroll-snap-type: y mandatory;
    scroll-behavior: smooth;
}

.slide {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    position: relative;
}

.slide-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    max-height: 100%;
    overflow: hidden;
    padding: var(--slide-padding);
}

:root {
    --title-size: clamp(1.5rem, 5vw, 4rem);
    --h2-size: clamp(1.25rem, 3.5vw, 2.5rem);
    --h3-size: clamp(1rem, 2.5vw, 1.75rem);
    --body-size: clamp(0.75rem, 1.5vw, 1.125rem);
    --small-size: clamp(0.65rem, 1vw, 0.875rem);

    --slide-padding: clamp(1rem, 4vw, 4rem);
    --content-gap: clamp(0.5rem, 2vw, 2rem);
    --element-gap: clamp(0.25rem, 1vw, 1rem);
}

.card, .container, .content-box {
    max-width: min(90vw, 1000px);
    max-height: min(80vh, 700px);
}

.feature-list, .bullet-list {
    gap: clamp(0.4rem, 1vh, 1rem);
}

.feature-list li, .bullet-list li {
    font-size: var(--body-size);
    line-height: 1.4;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
    gap: clamp(0.5rem, 1.5vw, 1rem);
}

img, .image-container {
    max-width: 100%;
    max-height: min(50vh, 400px);
    object-fit: contain;
}

@media (max-height: 700px) {
    :root {
        --slide-padding: clamp(0.75rem, 3vw, 2rem);
        --content-gap: clamp(0.4rem, 1.5vw, 1rem);
        --title-size: clamp(1.25rem, 4.5vw, 2.5rem);
        --h2-size: clamp(1rem, 3vw, 1.75rem);
    }
}

@media (max-height: 600px) {
    :root {
        --slide-padding: clamp(0.5rem, 2.5vw, 1.5rem);
        --content-gap: clamp(0.3rem, 1vw, 0.75rem);
        --title-size: clamp(1.1rem, 4vw, 2rem);
        --body-size: clamp(0.7rem, 1.2vw, 0.95rem);
    }

    .nav-dots, .keyboard-hint, .decorative {
        display: none;
    }
}

@media (max-height: 500px) {
    :root {
        --slide-padding: clamp(0.4rem, 2vw, 1rem);
        --title-size: clamp(1rem, 3.5vw, 1.5rem);
        --h2-size: clamp(0.9rem, 2.5vw, 1.25rem);
        --body-size: clamp(0.65rem, 1vw, 0.85rem);
    }
}

@media (max-width: 600px) {
    :root {
        --title-size: clamp(1.25rem, 7vw, 2.5rem);
    }

    .grid {
        grid-template-columns: 1fr;
    }
}

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.2s !important;
    }

    html {
        scroll-behavior: auto;
    }
}
```

## 视口检查清单

* 每个 `.slide` 都有 `height: 100vh`、`height: 100dvh` 和 `overflow: hidden`
* 所有排版都使用 `clamp()`
* 所有间距都使用 `clamp()` 或视口单位
* 图片有 `max-height` 约束
* 网格使用 `auto-fit` + `minmax()` 进行适配
* 短高度断点存在于 `700px`、`600px` 和 `500px`
* 如果感觉任何内容拥挤，请拆分幻灯片

## 情绪到预设的映射

| 情绪 | 推荐的预设 |
|---|---|
| 印象深刻 / 自信 | Bold Signal, Electric Studio, Dark Botanical |
| 兴奋 / 充满活力 | Creative Voltage, Neon Cyber, Split Pastel |
| 平静 / 专注 | Notebook Tabs, Paper & Ink, Swiss Modern |
| 受启发 / 感动 | Dark Botanical, Vintage Editorial, Pastel Geometry |

## 预设目录

### 1. Bold Signal

* 氛围：自信，高冲击力，适合主题演讲
* 最适合：推介演示，产品发布，声明
* 字体：Archivo Black + Space Grotesk
* 调色板：炭灰色基底，亮橙色焦点卡片，纯白色文本
* 特色：超大章节编号，深色背景上的高对比度卡片

### 2. Electric Studio

* 氛围：简洁，大胆，机构级精致
* 最适合：客户演示，战略评审
* 字体：仅 Manrope
* 调色板：黑色，白色，饱和钴蓝色点缀
* 特色：双面板分割和锐利的编辑式对齐

### 3. Creative Voltage

* 氛围：充满活力，复古现代，俏皮自信
* 最适合：创意工作室，品牌工作，产品故事叙述
* 字体：Syne + Space Mono
* 调色板：电光蓝，霓虹黄，深海军蓝
* 特色：半色调纹理，徽章，强烈的对比

### 4. Dark Botanical

* 氛围：优雅，高端，有氛围感
* 最适合：奢侈品牌，深思熟虑的叙述，高端产品演示
* 字体：Cormorant + IBM Plex Sans
* 调色板：接近黑色，温暖的象牙色，腮红，金色，赤陶色
* 特色：模糊的抽象圆形，精细的线条，克制的动效

### 5. Notebook Tabs

* 氛围：编辑感，有条理，有触感
* 最适合：报告，评审，结构化的故事叙述
* 字体：Bodoni Moda + DM Sans
* 调色板：炭灰色上的奶油色纸张搭配柔和色彩标签
* 特色：纸张效果，彩色侧边标签，活页夹细节

### 6. Pastel Geometry

* 氛围：平易近人，现代，友好
* 最适合：产品概览，入门介绍，较轻松的品牌演示
* 字体：仅 Plus Jakarta Sans
* 调色板：淡蓝色背景，奶油色卡片，柔和的粉色/薄荷色/薰衣草色点缀
* 特色：垂直药丸形状，圆角卡片，柔和阴影

### 7. Split Pastel

* 氛围：有趣，现代，有创意
* 最适合：机构介绍，研讨会，作品集
* 字体：仅 Outfit
* 调色板：桃色 + 薰衣草色分割背景搭配薄荷色徽章
* 特色：分割背景，圆角标签，轻网格叠加层

### 8. Vintage Editorial

* 氛围：诙谐，个性鲜明，受杂志启发
* 最适合：个人品牌，观点性演讲，故事叙述
* 字体：Fraunces + Work Sans
* 调色板：奶油色，炭灰色，灰暗的暖色点缀
* 特色：几何点缀，带边框的标注，醒目的衬线标题

### 9. Neon Cyber

* 氛围：未来感，科技感，动感
* 最适合：AI，基础设施，开发工具，关于未来趋势的演讲
* 字体：Clash Display + Satoshi
* 调色板：午夜海军蓝，青色，洋红色
* 特色：发光效果，粒子，网格，数据雷达能量感

### 10. Terminal Green

* 氛围：面向开发者，黑客风格简洁
* 最适合：API，CLI 工具，工程演示
* 字体：仅 JetBrains Mono
* 调色板：GitHub 深色 + 终端绿色
* 特色：扫描线，命令行框架，精确的等宽字体节奏

### 11. Swiss Modern

* 氛围：极简，精确，数据导向
* 最适合：企业，产品战略，分析
* 字体：Archivo + Nunito
* 调色板：白色，黑色，信号红色
* 特色：可见的网格，不对称，几何秩序感

### 12. Paper & Ink

* 氛围：文学性，深思熟虑，故事驱动
* 最适合：散文，主题演讲叙述，宣言式演示
* 字体：Cormorant Garamond + Source Serif 4
* 调色板：温暖的奶油色，炭灰色，深红色点缀
* 特色：引文突出，首字下沉，优雅的线条

## 直接选择提示

如果用户已经知道他们想要的样式，让他们直接从上面的预设名称中选择，而不是强制生成预览。

## 动画感觉映射

| 感觉 | 动效方向 |
|---|---|
| 戏剧性 / 电影感 | 缓慢淡入淡出，视差滚动，大比例缩放进入 |
| 科技感 / 未来感 | 发光，粒子，网格运动，文字乱序出现 |
| 有趣 / 友好 | 弹性缓动，圆角形状，漂浮运动 |
| 专业 / 企业 | 微妙的 200-300 毫秒过渡，干净的幻灯片切换 |
| 平静 / 极简 | 非常克制的运动，留白优先 |
| 编辑感 / 杂志感 | 强烈的层次感，错落的文字和图片互动 |

## CSS 陷阱：否定函数

切勿编写这些：

```css
right: -clamp(28px, 3.5vw, 44px);
margin-left: -min(10vw, 100px);
```

浏览器会静默忽略它们。

始终改为编写这个：

```css
right: calc(-1 * clamp(28px, 3.5vw, 44px));
margin-left: calc(-1 * min(10vw, 100px));
```

## 验证尺寸

至少测试以下尺寸：

* 桌面：`1920x1080`，`1440x900`，`1280x720`
* 平板：`1024x768`，`768x1024`
* 手机：`375x667`，`414x896`
* 横屏手机：`667x375`，`896x414`

## 反模式

请勿使用：

* 紫底白字的初创公司模板
* Inter / Roboto / Arial 作为视觉声音，除非用户明确想要实用主义的中性风格
* 要点堆砌、过小字体或需要滚动的代码块
* 装饰性插图，当抽象几何形状能更好地完成工作时
