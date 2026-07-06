# ECC 中文翻译术语表(Glossary)

所有翻译 agent 必须使用此表中的固定译法。术语不一致会导致镜像可读性破坏。

## 第一优先级:核心产品术语(必须保留英文或采用固定译法)

| 英文术语 | 中文译法 | 备注 |
|----------|----------|------|
| Agent | 智能体 | agents/ 目录译为"智能体目录" |
| Skill | 技能 | skills/ 目录译为"技能目录" |
| Command | 命令 | commands/ 目录译为"命令目录" |
| Hook | Hook | **保留英文**;广泛使用,翻译会破坏可搜索性 |
| Harness | Harness | **保留英文**;产品定位词 |
| Frontmatter | frontmatter | **保留英文**;YAML 字段名 |
| Plugin | 插件 | |
| Marketplace | 市场 | /plugin marketplace → /plugin 市场 |
| Skill placement | 技能放置 | |
| Slash command | 斜杠命令 | |
| Subagent | 子代理 | |
| Task tool | Task 工具 | |
| Read tool | Read 工具 | |
| Write tool | Write 工具 | |
| Edit tool | Edit 工具 | |
| Bash tool | Bash 工具 | |
| Grep | Grep | **保留英文**;工具名 |
| Glob | Glob | **保留英文**;工具名 |
| WebFetch | WebFetch | **保留英文**;工具名 |
| WebSearch | WebSearch | **保留英文**;工具名 |
| Model | 模型 | opus/sonnet/haiku 保留英文 |
| Opus | Opus | **保留英文**;模型名 |
| Sonnet | Sonnet | **保留英文**;模型名 |
| Haiku | Haiku | **保留英文**;模型名 |
| Token | token | **保留英文**;行业标准词 |
| Context window | 上下文窗口 | |
| Prompt | 提示 | |
| System prompt | 系统提示 | |
| Workflow | 工作流 | |
| Pipeline | 流水线 | |
| Lint | lint | **保留英文**;命令名 |
| Build | 构建 | |
| Linter | linter | **保留英文**; |
| Test | 测试 | |
| Coverage | 覆盖率 | |
| Pre-tool use | Pre-tool use | **保留英文**;hook 事件名 |
| Post-tool use | Post-tool use | **保留英文**;hook 事件名 |
| SessionStart | SessionStart | **保留英文**;hook 事件名 |
| SessionEnd | SessionEnd | **保留英文**;hook 事件名 |
| UserPromptSubmit | UserPromptSubmit | **保留英文**;hook 事件名 |
| Stop | Stop | **保留英文**;hook 事件名 |
| SubagentStop | SubagentStop | **保留英文**;hook 事件名 |
| Notification | Notification | **保留英文**;hook 事件名 |
| PreCompact | PreCompact | **保留英文**;hook 事件名 |
| PostToolUse | PostToolUse | **保留英文**;hook 事件名 |
| ECC | ECC | **保留英文**;产品名 |
| Claude Code | Claude Code | **保留英文**;宿主产品名 |
| Cursor | Cursor | **保留英文**;产品名 |
| Codex | Codex | **保留英文**;产品名 |
| OpenCode | OpenCode | **保留英文**;产品名 |
| Zed | Zed | **保留英文**;产品名 |
| Gemini | Gemini | **保留英文**;产品名 |
| Antigravity | Antigravity | **保留英文**;产品名 |
| JoyCode | JoyCode | **保留英文**;产品名 |
| CodeBuddy | CodeBuddy | **保留英文**;产品名 |
| Qwen | Qwen | **保留英文**;产品名 |
| Trae | Trae | **保留英文**;产品名 |
| Hermes | Hermes | **保留英文**;产品名 |
| OpenClaw | OpenClaw | **保留英文**;产品名 |
| Kimi | Kimi | **保留英文**;产品名 |
| MCP | MCP | **保留英文**;协议名 |
| AgentShield | AgentShield | **保留英文**;产品名 |
| Hermes Setup | Hermes Setup | **保留英文**;产品特性名 |
| NanoClaw | NanoClaw | **保留英文**;产品特性名 |
| AGENTS.md | AGENTS.md | **保留英文**;文件名 |
| CLAUDE.md | CLAUDE.md | **保留英文**;文件名 |
| README.md | README.md | **保留英文**;文件名 |
| CHANGELOG.md | CHANGELOG.md | **保留英文**;文件名 |
| CONTRIBUTING.md | CONTRIBUTING.md | **保留英文**;文件名 |
| TROUBLESHOOTING.md | TROUBLESHOOTING.md | **保留英文**;文件名 |
| SECURITY.md | SECURITY.md | **保留英文**;文件名 |
| SPONSORS.md | SPONSORS.md | **保留英文**;文件名 |
| SOUL.md | SOUL.md | **保留英文**;文件名 |
| package.json | package.json | **保留英文**;文件名 |
| yarn.lock | yarn.lock | **保留英文**;文件名 |
| npm | npm | **保留英文**;工具名 |
| ESLint | ESLint | **保留英文**;工具名 |
| Prettier | Prettier | **保留英文**;工具名 |
| TypeScript | TypeScript | **保留英文**;语言名 |
| JavaScript | JavaScript | **保留英文**;语言名 |
| Python | Python | **保留英文**;语言名 |
| Go | Go | **保留英文**;语言名 |
| Rust | Rust | **保留英文**;语言名 |
| Swift | Swift | **保留英文**;语言名 |
| Kotlin | Kotlin | **保留英文**;语言名 |
| C++ | C++ | **保留英文**;语言名 |
| C# | C# | **保留英文**;语言名 |
| PHP | PHP | **保留英文**;语言名 |
| Ruby | Ruby | **保留英文**;语言名 |
| ArkTS | ArkTS | **保留英文**;语言名 |
| Dart | Dart | **保留英文**;语言名 |
| F# | F# | **保留英文**;语言名 |
| Perl | Perl | **保留英文**;语言名 |
| Markdown | Markdown | **保留英文**;语言名 |
| YAML | YAML | **保留英文**;格式名 |
| JSON | JSON | **保留英文**;格式名 |
| TOML | TOML | **保留英文**;格式名 |
| CommonJS | CommonJS | **保留英文**;模块系统 |
| Node.js | Node.js | **保留英文**;运行时 |
| c8 | c8 | **保留英文**;工具名 |
| markdownlint | markdownlint | **保留英文**;工具名 |

## 第二优先级:概念术语(必须采用统一译法)

| 英文 | 中文 |
|------|------|
| Frontmatter | frontmatter(保留英文) |
| Description | description(保留英文,在代码块中) |
| Commit | 提交 |
| Pull request | PR(保留英文) / 拉取请求 |
| Branch | 分支 |
| Tag | 标签 |
| Repository | 仓库 |
| Issue | Issue(保留英文) |
| Discussion | 讨论 |
| Workflow | 工作流 |
| Pipeline | 流水线 |
| Profile | profile(保留英文,在 CLI 中) |
| Target | target(保留英文,在 CLI 中) |
| Plugin | 插件 |
| Skill placement | 技能放置 |
| Slash entry | 斜杠入口 |
| Shim | 垫片 |
| Adapter | 适配器 |
| Migration | 迁移 |
| Locale | 语言环境 |
| Translation | 翻译 |
| Mirror | 镜像 |
| Installer | 安装器 |
| Uninstaller | 卸载器 |
| Validator | 校验器 |
| Pre-commit | pre-commit(保留英文) |
| Post-commit | post-commit(保留英文) |
| Linter | linter(保留英文) |
| Formatter | formatter(保留英文) |
| Bundler | bundler(保留英文) |
| Compiler | 编译器 |
| Runtime | 运行时 |
| Dependency | 依赖 |
| Lock file | 锁文件 |
| Manifest | 清单 |
| Schema | schema(保留英文) |
| Selector | 选择器 |
| Matcher | 匹配器 |
| Hook event | Hook 事件 |
| Description | 描述(在叙述中) |
| Use case | 用例 |
| Best practice | 最佳实践 |
| Anti-pattern | 反模式 |
| Quick start | 快速开始 |
| Getting started | 入门 |
| Tutorial | 教程 |
| Reference | 参考 |
| Architecture | 架构 |
| Component | 组件 |
| Module | 模块 |
| Package | 包 |
| Library | 库 |
| Framework | 框架 |
| API | API(保留英文) |
| CLI | CLI(保留英文) |
| UI | UI(保留英文) |
| UX | UX(保留英文) |
| Web | Web(保留英文) |
| HTTP | HTTP(保留英文) |
| HTTPS | HTTPS(保留英文) |
| URL | URL(保留英文) |
| URI | URI(保留英文) |
| Path | 路径 |
| File | 文件 |
| Directory | 目录 |
| Folder | 文件夹 |
| Workspace | 工作区 |
| Home directory | 主目录 |
| Root | 根 |
| Parent | 父 |
| Child | 子 |
| Symbol | 符号 |
| Variable | 变量 |
| Constant | 常量 |
| Function | 函数 |
| Method | 方法 |
| Class | 类 |
| Object | 对象 |
| Type | 类型 |
| Interface | 接口 |
| Enum | 枚举 |
| Struct | 结构体 |
| Trait | trait(保留英文,Rust) |
| Generic | 泛型 |
| Async | 异步 |
| Sync | 同步 |
| Concurrent | 并发 |
| Parallel | 并行 |
| Sequential | 顺序 |
| Recursive | 递归 |
| Iteration | 迭代 |
| Callback | 回调 |
| Promise | Promise(保留英文) |
| Future | Future(保留英文) |
| Event | 事件 |
| Signal | 信号 |
| State | 状态 |
| Context | 上下文 |
| Scope | 作用域 |
| Lifetime | 生命周期 |
| Ownership | 所有权 |
| Borrowing | 借用 |
| Closure | 闭包 |
| Decorator | 装饰器 |
| Annotation | 注解 |
| Attribute | 属性 |
| Macro | 宏 |
| Pattern | 模式 |
| Match | 匹配 |
| Bind | 绑定 |
| Reference | 引用 |
| Pointer | 指针 |
| Array | 数组 |
| Slice | 切片 |
| List | 列表 |
| Map | 映射 |
| Set | 集合 |
| Queue | 队列 |
| Stack | 栈 |
| Hash | 哈希 |
| Tree | 树 |
| Graph | 图 |
| Node | 节点 |
| Edge | 边 |
| Vertex | 顶点 |
| Key | 键 |
| Value | 值 |
| Index | 索引 |
| Iterator | 迭代器 |
| Generator | 生成器 |
| Coroutine | 协程 |
| Channel | 通道 |
| Mutex | mutex(保留英文) |
| Lock | 锁 |
| Thread | 线程 |
| Process | 进程 |
| Task | 任务 |
| Job | 作业 |
| Worker | worker(保留英文) |
| Pool | 池 |
| Buffer | 缓冲区 |
| Stream | 流 |
| Pipe | 管道 |
| Filter | 过滤器 |
| Transform | 转换 |
| Map | map(保留英文,在 Rust 中) |
| Reduce | reduce(保留英文) |
| Fold | fold(保留英文) |
| Compose | 组合 |
| Apply | 应用 |
| Call | 调用 |
| Invoke | 调用 |
| Execute | 执行 |
| Run | 运行 |
| Start | 启动 |
| Stop | 停止 |
| Pause | 暂停 |
| Resume | 恢复 |
| Cancel | 取消 |
| Abort | 中止 |
| Exit | 退出 |
| Return | 返回 |
| Yield | 产出 |
| Throw | 抛出 |
| Catch | 捕获 |
| Handle | 处理 |
| Process | 进程 |
| Dispatch | 派发 |
| Schedule | 调度 |
| Queue | 队列 |
| Defer | 延迟 |
| Lazy | 惰性 |
| Eager | 急切 |
| Immutable | 不可变 |
| Mutable | 可变 |
| Pure | 纯 |
| Side effect | 副作用 |
| Effect | 副作用/效果 |
| Resource | 资源 |
| Handle | 句柄 |
| Reference | 引用 |
| Pointer | 指针 |
| Smart pointer | 智能指针 |
| Box | Box(保留英文,Rust) |
| Arc | Arc(保留英文,Rust) |
| Rc | Rc(保留英文,Rust) |
| RefCell | RefCell(保留英文,Rust) |
| Cell | Cell(保留英文,Rust) |
| Pin | Pin(保留英文,Rust) |
| Drop | Drop(保留英文,Rust) |
| Clone | Clone(保留英文,Rust) |
| Copy | Copy(保留英文,Rust) |
| Send | Send(保留英文,Rust) |
| Sync | Sync(保留英文,Rust) |
| Unpin | Unpin(保留英文,Rust) |
| PhantomData | PhantomData(保留英文,Rust) |
| Cow | Cow(保留英文,Rust) |
| Result | Result(保留英文,Rust) |
| Option | Option(保留英文,Rust) |
| Some | Some(保留英文,Rust) |
| None | None(保留英文,Rust) |
| Ok | Ok(保留英文,Rust) |
| Err | Err(保留英文,Rust) |
| await | await(保留英文) |
| async | async(保留英文) |
| impl | impl(保留英文,Rust) |
| trait | trait(保留英文,Rust) |
| struct | struct(保留英文,Rust) |
| enum | enum(保留英文,Rust) |
| pub | pub(保留英文,Rust) |
| fn | fn(保留英文,Rust) |
| let | let(保留英文,Rust) |
| mut | mut(保留英文,Rust) |
| const | const(保留英文) |
| static | static(保留英文) |
| use | use(保留英文,Rust) |
| mod | mod(保留英文,Rust) |
| crate | crate(保留英文,Rust) |
| super | super(保留英文,Rust) |
| self | self(保留英文,Rust) |
| Self | Self(保留英文,Rust) |
| ref | ref(保留英文,Rust) |
| move | move(保留英文,Rust) |
| match | match(保留英文,Rust) |
| if | if(保留英文) |
| else | else(保留英文) |
| for | for(保留英文) |
| while | while(保留英文) |
| loop | loop(保留英文,Rust) |
| break | break(保留英文) |
| continue | continue(保留英文) |
| return | return(保留英文) |
| goto | goto(保留英文) |
| switch | switch(保留英文) |
| case | case(保留英文) |
| default | default(保留英文) |
| do | do(保留英文) |
| try | try(保留英文) |
| catch | catch(保留英文) |
| finally | finally(保留英文) |
| with | with(保留英文) |
| as | as(保留英文) |
| in | in(保留英文) |
| of | of(保留英文) |
| to | to(保留英文) |
| from | from(保留英文) |
| into | into(保留英文) |
| over | over(保留英文) |
| at | at(保留英文) |
| by | by(保留英文) |
| on | on(保留英文) |
| off | off(保留英文) |
| up | up(保留英文) |
| down | down(保留英文) |
| in | in(保留英文) |
| out | out(保留英文) |
| true | true(保留英文) |
| false | false(保留英文) |
| null | null(保留英文) |
| nil | nil(保留英文) |
| undefined | undefined(保留英文) |
| void | void(保留英文) |
| this | this(保留英文) |
| that | that(保留英文) |
| new | new(保留英文) |
| old | old(保留英文) |
| base | base(保留英文) |
| derived | derived(保留英文) |
| abstract | abstract(保留英文) |
| virtual | virtual(保留英文) |
| override | override(保留英文) |
| final | final(保留英文) |
| sealed | sealed(保留英文) |
| static | static(保留英文) |
| instance | instance(保留英文) |
| class | class(保留英文) |
| super | super(保留英文) |
| parent | parent(保留英文) |
| inner | inner(保留英文) |
| outer | outer(保留英文) |
| nested | nested(保留英文) |
| anonymous | anonymous(保留英文) |
| lambda | lambda(保留英文) |
| arrow function | 箭头函数 |
| template | 模板 |
| generics | 泛型 |
| trait | trait(保留英文,Rust) |
| mixin | mixin(保留英文) |
| dependency injection | 依赖注入 |
| inversion of control | 控制反转 |
| single responsibility | 单一职责 |
| open/closed | 开闭 |
| Liskov substitution | 里氏替换 |
| interface segregation | 接口隔离 |
| dependency inversion | 依赖反转 |
| don't repeat yourself | DRY(保留英文) |
| keep it simple, stupid | KISS(保留英文) |
| you aren't gonna need it | YAGNI(保留英文) |
| test-driven development | TDD(保留英文) |
| behavior-driven development | BDD(保留英文) |
| domain-driven design | DDD(保留英文) |
| continuous integration | 持续集成 |
| continuous delivery | 持续交付 |
| continuous deployment | 持续部署 |
| git | git(保留英文) |
| commit | 提交 |
| push | 推送 |
| pull | 拉取 |
| fetch | 获取 |
| merge | 合并 |
| rebase | rebase(保留英文) |
| cherry-pick | cherry-pick(保留英文) |
| stash | stash(保留英文) |
| diff | diff(保留英文) |
| log | log(保留英文) |
| blame | blame(保留英文) |
| tag | 标签 |
| branch | 分支 |
| checkout | checkout(保留英文) |
| reset | reset(保留英文) |
| revert | revert(保留英文) |
| clone | clone(保留英文) |
| init | init(保留英文) |
| status | status(保留英文) |
| add | add(保留英文) |
| rm | rm(保留英文) |
| mv | mv(保留英文) |
| cp | cp(保留英文) |
| ls | ls(保留英文) |
| cd | cd(保留英文) |
| pwd | pwd(保留英文) |
| mkdir | mkdir(保留英文) |
| rmdir | rmdir(保留英文) |
| touch | touch(保留英文) |
| cat | cat(保留英文) |
| less | less(保留英文) |
| more | more(保留英文) |
| head | head(保留英文) |
| tail | tail(保留英文) |
| grep | grep(保留英文) |
| awk | awk(保留英文) |
| sed | sed(保留英文) |
| find | find(保留英文) |
| locate | locate(保留英文) |
| which | which(保留英文) |
| whereis | whereis(保留英文) |
| man | man(保留英文) |
| help | help(保留英文) |
| history | history(保留英文) |
| env | env(保留英文) |
| export | export(保留英文) |
| source | source(保留英文) |
| alias | alias(保留英文) |
| unalias | unalias(保留英文) |
| set | set(保留英文) |
| unset | unset(保留英文) |
| echo | echo(保留英文) |
| printf | printf(保留英文) |
| read | read(保留英文) |
| readline | readline(保留英文) |
| type | type(保留英文) |
| hash | hash(保留英文) |
| md5sum | md5sum(保留英文) |
| sha256sum | sha256sum(保留英文) |
| base64 | base64(保留英文) |
| openssl | openssl(保留英文) |
| ssh | ssh(保留英文) |
| scp | scp(保留英文) |
| rsync | rsync(保留英文) |
| curl | curl(保留英文) |
| wget | wget(保留英文) |
| ping | ping(保留英文) |
| traceroute | traceroute(保留英文) |
| netstat | netstat(保留英文) |
| ss | ss(保留英文) |
| ifconfig | ifconfig(保留英文) |
| ip | ip(保留英文) |
| iptables | iptables(保留英文) |
| tcpdump | tcpdump(保留英文) |
| nmap | nmap(保留英文) |
| ps | ps(保留英文) |
| top | top(保留英文) |
| htop | htop(保留英文) |
| kill | kill(保留英文) |
| killall | killall(保留英文) |
| pkill | pkill(保留英文) |
| nice | nice(保留英文) |
| renice | renice(保留英文) |
| uptime | uptime(保留英文) |
| free | free(保留英文) |
| df | df(保留英文) |
| du | du(保留英文) |
| mount | mount(保留英文) |
| umount | umount(保留英文) |
| fdisk | fdisk(保留英文) |
| mkfs | mkfs(保留英文) |
| fsck | fsck(保留英文) |
| dd | dd(保留英文) |
| tar | tar(保留英文) |
| gzip | gzip(保留英文) |
| gunzip | gunzip(保留英文) |
| bzip2 | bzip2(保留英文) |
| xz | xz(保留英文) |
| zip | zip(保留英文) |
| unzip | unzip(保留英文) |
| 7z | 7z(保留英文) |
| rar | rar(保留英文) |
| chmod | chmod(保留英文) |
| chown | chown(保留英文) |
| chgrp | chgrp(保留英文) |
| umask | umask(保留英文) |
| su | su(保留英文) |
| sudo | sudo(保留英文) |
| whoami | whoami(保留英文) |
| who | who(保留英文) |
| w | w(保留英文) |
| last | last(保留英文) |
| lastlog | lastlog(保留英文) |
| users | users(保留英文) |
| groups | groups(保留英文) |
| id | id(保留英文) |
| passwd | passwd(保留英文) |
| shadow | shadow(保留英文) |
| useradd | useradd(保留英文) |
| userdel | userdel(保留英文) |
| usermod | usermod(保留英文) |
| groupadd | groupadd(保留英文) |
| groupdel | groupdel(保留英文) |
| groupmod | groupmod(保留英文) |
| crontab | crontab(保留英文) |
| at | at(保留英文) |
| batch | batch(保留英文) |
| anacron | anacron(保留英文) |
| systemd | systemd(保留英文) |
| systemctl | systemctl(保留英文) |
| journalctl | journalctl(保留英文) |
| service | service(保留英文) |
| init | init(保留英文) |
| telinit | telinit(保留英文) |
| runlevel | runlevel(保留英文) |
| shutdown | shutdown(保留英文) |
| reboot | reboot(保留英文) |
| halt | halt(保留英文) |
| poweroff | poweroff(保留英文) |
| exit | exit(保留英文) |
| logout | logout(保留英文) |
| login | login(保留英文) |
| screen | screen(保留英文) |
| tmux | tmux(保留英文) |
| byobu | byobu(保留英文) |
| dtach | dtach(保留英文) |
| abduco | abduco(保留英文) |
| dvtm | dvtm(保留英文) |
| nohup | nohup(保留英文) |
| disown | disown(保留英文) |
| bg | bg(保留英文) |
| fg | fg(保留英文) |
| jobs | jobs(保留英文) |
| wait | wait(保留英文) |
| trap | trap(保留英文) |
| kill | kill(保留英文) |
| signal | signal(保留英文) |
| SIGINT | SIGINT(保留英文) |
| SIGTERM | SIGTERM(保留英文) |
| SIGKILL | SIGKILL(保留英文) |
| SIGHUP | SIGHUP(保留英文) |
| SIGQUIT | SIGQUIT(保留英文) |
| SIGSTOP | SIGSTOP(保留英文) |
| SIGCONT | SIGCONT(保留英文) |
| SIGUSR1 | SIGUSR1(保留英文) |
| SIGUSR2 | SIGUSR2(保留英文) |
| SIGPIPE | SIGPIPE(保留英文) |
| SIGCHLD | SIGCHLD(保留英文) |
| SIGALRM | SIGALRM(保留英文) |

## 第三优先级:文档章节标题常用译法

| 英文 | 中文 |
|------|------|
| Overview | 概览 |
| Quick Start | 快速开始 |
| Installation | 安装 |
| Usage | 使用方法 |
| Examples | 示例 |
| API | API(保留英文) |
| Configuration | 配置 |
| Contributing | 贡献 |
| License | 许可证 |
| Tests | 测试 |
| Build | 构建 |
| Lint | lint(保留英文) |
| Format | 格式化 |
| Deploy | 部署 |
| FAQ | FAQ(保留英文) |
| Troubleshooting | 故障排查 |
| Changelog | 变更日志 |
| Authors | 作者 |
| Acknowledgments | 致谢 |
| See Also | 参见 |
| Notes | 备注 |
| Warning | 警告 |
| Caution | 注意 |
| Tip | 提示 |
| Note | 注 |
| Important | 重要 |
| TODO | TODO(保留英文) |
| FIXME | FIXME(保留英文) |
| XXX | XXX(保留英文) |
| BUG | BUG(保留英文) |
| HACK | HACK(保留英文) |
| NOTE | NOTE(保留英文) |
| README | README(保留英文) |
| Index | 索引 |
| Glossary | 术语表 |
| References | 参考 |
| Bibliography | 参考文献 |
| Appendix | 附录 |
| Preface | 前言 |
| Introduction | 引言 |
| Foreword | 序 |
| Acknowledgments | 致谢 |
| About | 关于 |
| Status | 状态 |
| Roadmap | 路线图 |
| History | 历史 |
| Background | 背景 |
| Motivation | 动机 |
| Goals | 目标 |
| Non-goals | 非目标 |
| Design | 设计 |
| Implementation | 实现 |
| Architecture | 架构 |
| Components | 组件 |
| Modules | 模块 |
| Packages | 包 |
| Dependencies | 依赖 |
| Requirements | 要求 |
| Compatibility | 兼容性 |
| Limitations | 限制 |
| Caveats | 注意事项 |
| Known Issues | 已知问题 |
| Migration | 迁移 |
| Upgrade | 升级 |
| Downgrade | 降级 |
| Rollback | 回滚 |
| Recovery | 恢复 |
| Backup | 备份 |
| Restore | 还原 |
| Sync | 同步 |
| Reset | 重置 |
| Clear | 清除 |
| Clean | 清理 |
| Purge | 清除 |
| Remove | 移除 |
| Delete | 删除 |
| Add | 添加 |
| Create | 创建 |
| Update | 更新 |
| Modify | 修改 |
| Edit | 编辑 |
| View | 查看 |
| Show | 显示 |
| Hide | 隐藏 |
| List | 列表 |
| Get | 获取 |
| Set | 设置 |
| Put | 放置 |
| Post | 提交 |
| Patch | 修补 |
| Push | 推送 |
| Pull | 拉取 |
| Fetch | 获取 |
| Import | 导入 |
| Export | 导出 |
| Read | 读取 |
| Write | 写入 |
| Open | 打开 |
| Close | 关闭 |
| Start | 启动 |
| Stop | 停止 |
| Begin | 开始 |
| End | 结束 |
| Pause | 暂停 |
| Resume | 恢复 |
| Continue | 继续 |
| Skip | 跳过 |
| Retry | 重试 |
| Abort | 中止 |
| Cancel | 取消 |
| Quit | 退出 |
| Exit | 退出 |
| Return | 返回 |
| Continue | 继续 |
| Next | 下一个 |
| Previous | 上一个 |
| First | 第一个 |
| Last | 最后一个 |
| Top | 顶部 |
| Bottom | 底部 |
| Left | 左 |
| Right | 右 |
| Center | 中央 |
| Front | 前 |
| Back | 后 |
| Up | 上 |
| Down | 下 |
| In | 内 |
| Out | 外 |
| On | 开 |
| Off | 关 |
| True | true(保留英文) |
| False | false(保留英文) |
| Yes | 是 |
| No | 否 |
| On | 启用 |
| Off | 禁用 |
| Enable | 启用 |
| Disable | 禁用 |
| Allow | 允许 |
| Deny | 拒绝 |
| Permit | 准许 |
| Forbid | 禁止 |
| Accept | 接受 |
| Reject | 拒绝 |
| Approve | 批准 |
| Reject | 驳回 |
| Pass | 通过 |
| Fail | 失败 |
| Success | 成功 |
| Error | 错误 |
| Warning | 警告 |
| Info | 信息 |
| Debug | 调试 |
| Trace | 跟踪 |
| Log | 日志 |
| Output | 输出 |
| Input | 输入 |
| Result | 结果 |
| Return value | 返回值 |
| Exception | 异常 |
| Error message | 错误消息 |
| Stack trace | 堆栈跟踪 |
| Debug info | 调试信息 |
| Verbose | 详细 |
| Quiet | 静默 |
| Silent | 静默 |
| Force | 强制 |
| Optional | 可选 |
| Required | 必需 |
| Default | 默认 |
| Custom | 自定义 |
| Standard | 标准 |
| Advanced | 高级 |
| Basic | 基础 |
| Beginner | 入门 |
| Intermediate | 中级 |
| Expert | 专家 |
| Master | 精通 |
| Pro | 进阶 |
| Pro tip | 进阶提示 |
| Tip | 提示 |
| Trick | 技巧 |
| Hack | 技巧 |
| Workaround | 变通方法 |
| Best practice | 最佳实践 |
| Recommendation | 推荐 |
| Suggestion | 建议 |
| Guideline | 指南 |
| Rule | 规则 |
| Policy | 策略 |
| Procedure | 流程 |
| Process | 流程 |
| Workflow | 工作流 |
| Pipeline | 流水线 |
| Steps | 步骤 |
| Phase | 阶段 |
| Stage | 阶段 |
| Step | 步骤 |
| Task | 任务 |
| Action | 动作 |
| Operation | 操作 |
| Function | 函数 |
| Method | 方法 |
| Procedure | 流程 |
| Routine | 例程 |
| Subroutine | 子例程 |
| Program | 程序 |
| Script | 脚本 |
| Code | 代码 |
| Source | 源 |
| Target | target(保留英文) |
| Destination | 目标 |
| Output | 输出 |
| Input | 输入 |
| Argument | 参数 |
| Parameter | 参数 |
| Option | 选项 |
| Flag | flag(保留英文) |
| Switch | switch(保留英文) |
| Argument | 参数 |
| Option | 选项 |
| Setting | 设置 |
| Preference | 偏好 |
| Configuration | 配置 |
| Profile | profile(保留英文) |
| Preset | 预设 |
| Template | 模板 |
| Schema | schema(保留英文) |
| Format | 格式 |
| Style | 风格 |
| Theme | 主题 |
| Skin | 皮肤 |
| Look | 外观 |
| Feel | 感觉 |
| Behavior | 行为 |
| Logic | 逻辑 |
| Algorithm | 算法 |
| Data structure | 数据结构 |
| Data type | 数据类型 |
| Variable | 变量 |
| Constant | 常量 |
| Literal | 字面量 |
| Expression | 表达式 |
| Statement | 语句 |
| Block | 块 |
| Scope | 作用域 |
| Context | 上下文 |
| Closure | 闭包 |
| Callback | 回调 |
| Promise | Promise(保留英文) |
| Future | Future(保留英文) |
| Event | 事件 |
| Handler | 处理器 |
| Listener | 监听器 |
| Observer | 观察者 |
| Subject | 主体 |
| Subscriber | 订阅者 |
| Publisher | 发布者 |
| Producer | 生产者 |
| Consumer | 消费者 |
| Source | 源 |
| Sink | 接收器 |
| Stream | 流 |
| Buffer | 缓冲区 |
| Queue | 队列 |
| Stack | 栈 |
| Heap | 堆 |
| Pool | 池 |
| Cache | 缓存 |
| Memo | 备忘 |
| Map | 映射 |
| Set | 集合 |
| List | 列表 |
| Array | 数组 |
| Tuple | 元组 |
| Pair | 配对 |
| Record | 记录 |
| Struct | 结构体 |
| Class | 类 |
| Object | 对象 |
| Instance | 实例 |
| Method | 方法 |
| Property | 属性 |
| Attribute | 属性 |
| Field | 字段 |
| Member | 成员 |
| Accessor | 访问器 |
| Mutator | 修改器 |
| Getter | getter(保留英文) |
| Setter | setter(保留英文) |
| Constructor | 构造函数 |
| Destructor | 析构函数 |
| Initializer | 初始化器 |
| Finalizer | 终结器 |
| Allocator | 分配器 |
| Iterator | 迭代器 |
| Generator | 生成器 |
| Coroutine | 协程 |
| Fiber | 纤程 |
| Green thread | 绿色线程 |
| Native thread | 原生线程 |
| Thread pool | 线程池 |
| Worker thread | 工作线程 |
| Main thread | 主线程 |
| UI thread | UI 线程 |
| Event loop | 事件循环 |
| Message loop | 消息循环 |
| Run loop | 运行循环 |
| Main loop | 主循环 |
| Tick | tick(保留英文) |
| Heartbeat | 心跳 |
| Pulse | 脉冲 |
| Signal | 信号 |
| Slot | 槽 |
| Channel | 通道 |
| Pipe | 管道 |
| Socket | 套接字 |
| Port | 端口 |
| Address | 地址 |
| Host | 主机 |
| Domain | 域 |
| Subnet | 子网 |
| Network | 网络 |
| Internet | 互联网 |
| Intranet | 内联网 |
| LAN | LAN(保留英文) |
| WAN | WAN(保留英文) |
| VPN | VPN(保留英文) |
| Proxy | 代理 |
| Firewall | 防火墙 |
| Gateway | 网关 |
| Router | 路由器 |
| Switch | 交换机 |
| Hub | 集线器 |
| Bridge | 网桥 |
| Modem | 调制解调器 |
| NIC | NIC(保留英文) |
| MAC | MAC(保留英文) |
| IP | IP(保留英文) |
| TCP | TCP(保留英文) |
| UDP | UDP(保留英文) |
| HTTP | HTTP(保留英文) |
| HTTPS | HTTPS(保留英文) |
| FTP | FTP(保留英文) |
| SSH | SSH(保留英文) |
| DNS | DNS(保留英文) |
| DHCP | DHCP(保留英文) |
| NTP | NTP(保留英文) |
| SMTP | SMTP(保留英文) |
| POP3 | POP3(保留英文) |
| IMAP | IMAP(保留英文) |
| LDAP | LDAP(保留英文) |
| Kerberos | Kerberos(保留英文) |
| OAuth | OAuth(保留英文) |
| OpenID | OpenID(保留英文) |
| SAML | SAML(保留英文) |
| JWT | JWT(保留英文) |
| SSL | SSL(保留英文) |
| TLS | TLS(保留英文) |
| X.509 | X.509(保留英文) |
| Certificate | 证书 |
| Public key | 公钥 |
| Private key | 私钥 |
| Secret | 密钥 |
| Password | 密码 |
| Token | token(保留英文) |
| Hash | 哈希 |
| Salt | 盐 |
| Nonce | nonce(保留英文) |
| IV | IV(保留英文) |
| Cipher | 密码 |
| Plaintext | 明文 |
| Ciphertext | 密文 |
| Encrypt | 加密 |
| Decrypt | 解密 |
| Sign | 签名 |
| Verify | 验证 |
| Authenticate | 认证 |
| Authorize | 授权 |
| Audit | 审计 |
| Log | 日志 |
| Monitor | 监控 |
| Alert | 告警 |
| Notify | 通知 |
| Subscribe | 订阅 |
| Publish | 发布 |
| Broadcast | 广播 |
| Multicast | 多播 |
| Unicast | 单播 |
| Anycast | 任播 |
| Geocast | 地理多播 |
