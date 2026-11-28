# 工具链审计命令

运行确定性仓库框架审计并返回优先级评分卡。

## 使用方式

`/harness-audit [scope] [--format text|json]`

* `scope` (可选): `repo` (默认), `hooks`, `skills`, `commands`, `agents`
* `--format`: 输出样式 (`text` 默认, `json` 用于自动化)

## 确定性引擎

始终运行：

```bash
# Resolve the ECC root the same way /instinct-status does.
ECC_ROOT="$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var b=String.fromCharCode(92),m=d.match(/^([A-Za-z]):/);if(m&&(d.charAt(2)==='/'||d.charAt(2)===b)){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).split(b).join('/')}}}}catch(_){}d=p.resolve(d);function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot({probe:p.join('scripts','harness-audit.js')})}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}return d})();console.log(r)")" &&
node "$ECC_ROOT/scripts/harness-audit.js" <scope> --format <text|json>
```

此脚本是评分和检查的单一事实来源。不要发明额外的维度或临时添加评分点。

评分标准版本：`2026-03-16`。

该脚本计算 7 个固定类别（每个类别标准化为 `0-10`）：

1. 工具覆盖度
2. 上下文效率
3. 质量门禁
4. 记忆持久化
5. 评估覆盖度
6. 安全护栏
7. 成本效率

分数源自显式的文件/规则检查，并且对于同一提交是可复现的。

## 输出约定

返回：

1. `overall_score` 分（满分 `max_score` 分；`repo` 为 70 分；范围限定审计则分数更小）
2. 类别分数及具体发现项
3. 失败的检查及其确切的文件路径
4. 确定性输出的前 3 项行动（`top_actions`）
5. 建议接下来应用的 ECC 技能

## 检查清单

* 直接使用脚本输出；不要手动重新评分。
* 如果请求 `--format json`，则原样返回脚本的 JSON 输出。
* 如果请求文本输出，则总结失败的检查和首要行动。
* 包含来自 `checks[]` 和 `top_actions[]` 的确切文件路径。

## 结果示例

```text
Harness 审计 (代码库): 66/70
- 工具覆盖率: 10/10 (10/10 分)
- 上下文效率: 9/10 (9/10 分)
- 质量门禁: 10/10 (10/10 分)

首要三项行动:
1) [安全防护] 在 hooks/hooks.json 中添加提示/工具预检安全防护。 (hooks/hooks.json)
2) [工具覆盖率] 同步 commands/harness-audit.md 和 .opencode/commands/harness-audit.md。 (.opencode/commands/harness-audit.md)
3) [评估覆盖率] 提升 scripts/hooks/lib 目录下的自动化测试覆盖率。 (tests/)
```

## 参数

$ARGUMENTS:

* `repo|hooks|skills|commands|agents` (可选范围)
* `--format text|json` (可选输出格式)
