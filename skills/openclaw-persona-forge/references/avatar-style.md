# Step 5：头像风格 & 生图

所有龙虾头像**必须使用统一的视觉风格**，确保龙虾家族的风格一致性。
头像需传达 3 个信息：**物种形态 + 性格暗示 + 标志道具**

## 风格参考

亚当（Adam）—— 龙虾族创世神，本 Skill 的首个作品。

所有新生成的龙虾头像应与这一风格保持一致：复古未来主义、街机 UI 包边、强轮廓、可在 64x64 下辨识。

## 统一风格基底（STYLE_BASE）

**每次生成都必须包含这段基底**，不得修改或省略：

```
STYLE_BASE = """
Retro-futuristic 3D rendered illustration, in the style of 1950s-60s Space Age
pin-up poster art reimagined as glossy inflatable 3D, framed within a vintage
arcade game UI overlay.

Material: high-gloss PVC/latex-like finish, soft specular highlights, puffy
inflatable quality reminiscent of vintage pool toys meets sci-fi concept art.
Smooth subsurface scattering on shell surface.

Arcade UI frame: pixel-art arcade cabinet border elements, a top banner with
character name in chunky 8-bit bitmap font with scan-line glow effect, a pixel
energy bar in the upper corner, small coin-credit text "INSERT SOUL TO CONTINUE"
at bottom in phosphor green monospace type, subtle CRT screen curvature and
scan-line overlay across entire image. Decorative corner bezels styled as chrome
arcade cabinet trim with atomic-age starburst rivets.

Pose: references classic Gil Elvgren pin-up compositions, confident and
charismatic with a slight theatrical tilt.

Color system: vintage NASA poster palette as base — deep navy, teal, dusty coral,
cream — viewed through arcade CRT monitor with slight RGB fringing at edges.
Overall aesthetic combines Googie architecture curves, Raygun Gothic design
language, mid-century advertising illustration, modern 3D inflatable character
rendering, and 80s-90s arcade game UI. Chrome and pastel accent details on
joints and antenna tips.

Format: square, optimized for avatar use. Strong silhouette readable at 64x64
pixels.
"""
```

## 个性化变量

在统一基底之上，根据灵魂填充以下变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `CHARACTER_NAME` | 街机横幅上显示的名字 | "ADAM"、"DEWEY"、"RIFF" |
| `SHELL_COLOR` | 龙虾壳的主色调（在统一色盘内变化） | "deep crimson"、"dusty teal"、"warm amber" |
| `SIGNATURE_PROP` | 标志性道具 | "cracked sunglasses"、"reading glasses on a chain" |
| `EXPRESSION` | 表情/姿态 | "stoic but kind-eyed"、"nervously focused" |
| `UNIQUE_DETAIL` | 独特细节（纹路/装饰/伤痕等） | "constellation patterns etched on claws"、"bandaged left claw" |
| `BACKGROUND_ACCENT` | 背景的个性化元素（在统一宇宙背景上叠加） | "musical notes floating as nebula dust"、"ancient book pages drifting" |
| `ENERGY_BAR_LABEL` | 街机 UI 能量条的标签（个性化小彩蛋） | "CREATION POWER"、"CALM LEVEL"、"ROCK METER" |

## 提示词组装

```
最终提示词 = STYLE_BASE + 个性化描述段落
```

个性化描述段落模板：

```
The character is a cartoon lobster with a [SHELL_COLOR] shell,
[EXPRESSION], wearing/holding [SIGNATURE_PROP].
[UNIQUE_DETAIL]. Background accent: [BACKGROUND_ACCENT].
The arcade top banner reads "[CHARACTER_NAME]" and the energy bar
is labeled "[ENERGY_BAR_LABEL]".
The key silhouette recognition points at small size are:
[SIGNATURE_PROP] and [one other distinctive feature].
```

## 生图流程

提示词组装完成后：

### 路径 A：已安装且已审核的生图 skill

1. 先将龙虾名字规整为安全片段：仅保留字母、数字和连字符，其余字符替换为 `-`
2. 用 Write 工具写入：`/tmp/openclaw-<safe-name>-prompt.md`
3. 调用当前环境允许的生图 skill 生成图片
4. 用 Read 工具展示生成的图片给用户
5. 问用户是否满意，不满意可调整变量重新生成

### 路径 B：未安装可用的生图 skill

输出完整提示词文本，附手动使用说明：

```markdown
**头像提示词**（可复制到以下平台手动生成）：
- Google Gemini：直接粘贴
- ChatGPT（DALL-E）：直接粘贴
- Midjourney：粘贴后加 `--ar 1:1 --style raw`

> [完整英文提示词]

如当前环境后续提供经过审核的生图 skill，可再接回自动生图流程。
```

## 展示给用户的格式

```markdown
## 头像

**个性化变量**：
- 壳色：[SHELL_COLOR]
- 道具：[SIGNATURE_PROP]
- 表情：[EXPRESSION]
- 独特细节：[UNIQUE_DETAIL]
- 背景点缀：[BACKGROUND_ACCENT]
- 能量条标签：[ENERGY_BAR_LABEL]

**生成结果**：
[图片（路径A）或提示词文本（路径B）]

> 满意吗？不满意我可以调整 [具体可调项] 后重新生成。
```
