---
name: instinct-status
description: 展示已学习的本能（项目+全局）并充满信心
command: true
---

# 本能状态命令

显示当前项目学习到的本能以及全局本能，按领域分组。

## 实现

以与 `hooks/hooks.json` 和其他斜杠命令（`/sessions`、`/skill-health`）
相同的解析器运行本能 CLI——环境变量 → 标准安装 → 已知插件根 → 插件缓存 → 回退。
这样可以避免当 `CLAUDE_PLUGIN_ROOT` 未设置而旧的
`~/.claude/skills/continuous-learning-v2/` 目录仍然存在时发生的路径分歧 (#2037)。

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=p.join(o.homedir(),'.claude');function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot()}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}try{var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=f.readdirSync(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=f.readdirSync(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}}catch(_){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

## 用法

```
/instinct-status
```

## 操作步骤

1. 检测当前项目上下文（git remote/路径哈希）
2. 从 `~/.claude/homunculus/projects/<project-id>/instincts/` 读取项目本能
3. 从 `~/.claude/homunculus/instincts/` 读取全局本能
4. 合并并应用优先级规则（当ID冲突时，项目本能覆盖全局本能）
5. 按领域分组显示，包含置信度条和观察统计数据

## 输出格式

```
============================================================
  INSTINCT 状态 - 总计 12
============================================================

  项目: my-app (a1b2c3d4e5f6)
  项目 instincts: 8
  全局 instincts:  4

## 项目范围内 (my-app)
  ### 工作流 (3)
    ███████░░░  70%  grep-before-edit [project]
              触发条件: 当修改代码时

## 全局 (适用于所有项目)
  ### 安全 (2)
    █████████░  85%  validate-user-input [global]
              触发条件: 当处理用户输入时
```
