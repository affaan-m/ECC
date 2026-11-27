---
name: flutter-dart-code-review
description: 库无关的Flutter/Dart代码审查清单，涵盖Widget最佳实践、状态管理模式（BLoC、Riverpod、Provider、GetX、MobX、Signals）、Dart惯用法、性能、可访问性、安全性和整洁架构。
origin: ECC
---

# Flutter/Dart 代码审查最佳实践

适用于审查 Flutter/Dart 应用程序的全面、与库无关的清单。无论使用哪种状态管理方案、路由库或依赖注入框架，这些原则都适用。

***

## 1. 通用项目健康度

* \[ ] 项目遵循一致的文件夹结构（功能优先或分层优先）
* \[ ] 关注点分离得当：UI、业务逻辑、数据层
* \[ ] 部件中无业务逻辑；部件纯粹是展示性的
* \[ ] `pubspec.yaml` 是干净的 —— 没有未使用的依赖项，版本已适当固定
* \[ ] `analysis_options.yaml` 包含严格的 lint 规则集，并启用了严格的分析器设置
* \[ ] 生产代码中没有 `print()` 语句 —— 使用 `dart:developer` `log()` 或日志包
* \[ ] 生成的文件 (`.g.dart`, `.freezed.dart`, `.gr.dart`) 是最新的或在 `.gitignore` 中
* \[ ] 平台特定代码通过抽象进行隔离

***

## 2. Dart 语言陷阱

* \[ ] **隐式动态类型**：缺少类型注解导致 `dynamic` —— 启用 `strict-casts`, `strict-inference`, `strict-raw-types`
* \[ ] **空安全误用**：过度使用 `!`（感叹号操作符）而不是适当的空检查或 Dart 3 模式匹配 (`if (value case var v?)`)
* \[ ] **类型提升失败**：在可以使用局部变量类型提升的地方使用了 `this.field`
* \[ ] **捕获范围过宽**：`catch (e)` 没有 `on` 子句；应始终指定异常类型
* \[ ] **捕获 `Error`**：`Error` 子类型表示错误，不应被捕获
* \[ ] **未使用的 `async`**：标记为 `async` 但从未 `await` 的函数 —— 不必要的开销
* \[ ] **`late` 过度使用**：在可使用可空类型或构造函数初始化更安全的地方使用了 `late`；将错误推迟到运行时
* \[ ] **循环中的字符串拼接**：使用 `StringBuffer` 而不是 `+` 进行迭代式字符串构建
* \[ ] **`const` 上下文中的可变状态**：`const` 构造器类中的字段不应是可变的
* \[ ] **忽略 `Future` 返回值**：使用 `await` 或显式调用 `unawaited()` 来表明意图
* \[ ] **在 `final` 可用时使用 `var`**：局部变量首选 `final`，编译时常量首选 `const`
* \[ ] **相对导入**：为保持一致性，使用 `package:` 导入
* \[ ] **暴露可变集合**：公共 API 应返回不可修改的视图，而不是原始的 `List`/`Map`
* \[ ] **缺少 Dart 3 模式匹配**：优先使用 switch 表达式和 `if-case`，而不是冗长的 `is` 检查和手动类型转换
* \[ ] **为多重返回值使用一次性类**：使用 Dart 3 记录 `(String, int)` 代替一次性 DTO
* \[ ] **生产代码中的 `print()`**：使用 `dart:developer` `log()` 或项目的日志包；`print()` 没有日志级别且无法过滤

***

## 3. 部件最佳实践

### 部件分解：

* \[ ] 没有单个部件的 `build()` 方法超过约 80-100 行
* \[ ] 部件按封装方式以及按变化方式（重建边界）进行拆分
* \[ ] 返回部件的私有 `_build*()` 辅助方法被提取到单独的部件类中（支持元素重用、常量传播和框架优化）
* \[ ] 在不需要可变局部状态的地方，优先使用无状态部件而非有状态部件
* \[ ] 提取的部件在可复用时放在单独的文件中

### Const 使用：

* \[ ] 尽可能使用 `const` 构造器 —— 防止不必要的重建
* \[ ] 对不变化的集合使用 `const` 字面量 (`const []`, `const {}`)
* \[ ] 当所有字段都是 final 时，构造函数声明为 `const`

### Key 使用：

* \[ ] 在列表/网格中使用 `ValueKey` 以在重新排序时保持状态
* \[ ] 谨慎使用 `GlobalKey` —— 仅在确实需要跨树访问状态时使用
* \[ ] 避免在 `build()` 中使用 `UniqueKey` —— 它会强制每帧都重建
* \[ ] 当身份基于数据对象而非单个值时，使用 `ObjectKey`

### 主题与设计系统：

* \[ ] 颜色来自 `Theme.of(context).colorScheme` —— 没有硬编码的 `Colors.red` 或十六进制值
* \[ ] 文本样式来自 `Theme.of(context).textTheme` —— 没有内联的 `TextStyle` 和原始字体大小
* \[ ] 已验证深色模式兼容性 —— 不假设浅色背景
* \[ ] 间距和尺寸使用一致的设计令牌或常量，而不是魔法数字

### Build 方法复杂度：

* \[ ] `build()` 中没有网络调用、文件 I/O 或繁重计算
* \[ ] `build()` 中没有 `Future.then()` 或 `async` 工作
* \[ ] `build()` 中没有创建订阅 (`.listen()`)
* \[ ] `setState()` 局部化到尽可能小的子树

***

## 4. 状态管理（与库无关）

这些原则适用于所有 Flutter 状态管理方案（BLoC、Riverpod、Provider、GetX、MobX、Signals、ValueNotifier 等）。

### 架构：

* \[ ] 业务逻辑位于部件层之外 —— 在状态管理组件中（BLoC、Notifier、Controller、Store、ViewModel 等）
* \[ ] 状态管理器通过依赖注入接收依赖，而不是内部构造它们
* \[ ] 服务或仓库层抽象数据源 —— 部件和状态管理器不应直接调用 API 或数据库
* \[ ] 状态管理器职责单一 —— 没有处理不相关职责的“上帝”管理器
* \[ ] 跨组件依赖遵循解决方案的约定：
  * 在 **Riverpod** 中：提供者通过 `ref.watch` 依赖其他提供者是预期的 —— 仅标记循环或过度复杂的链
  * 在 **BLoC** 中：bloc 不应直接依赖其他 bloc —— 优先使用共享仓库或表示层协调
  * 在其他解决方案中：遵循文档中关于组件间通信的约定

### 不可变性与值相等性（适用于不可变状态解决方案：BLoC、Riverpod、Redux）：

* \[ ] 状态对象是不可变的 —— 通过 `copyWith()` 或构造函数创建新实例，绝不就地修改
* \[ ] 状态类正确实现 `==` 和 `hashCode`（比较中包含所有字段）
* \[ ] 机制在整个项目中保持一致 —— 手动覆盖、`Equatable`、`freezed`、Dart 记录或其他方式
* \[ ] 状态对象内部的集合不作为原始可变的 `List`/`Map` 暴露

### 响应式纪律（适用于响应式突变解决方案：MobX、GetX、Signals）：

* \[ ] 状态仅通过解决方案的响应式 API 进行修改（MobX 中的 `@action`，Signals 上的 `.value`，GetX 中的 `.obs`）—— 直接字段修改会绕过变更跟踪
* \[ ] 派生值使用解决方案的计算机制，而不是冗余存储
* \[ ] 反应和清理器被正确清理（MobX 中的 `ReactionDisposer`，Signals 中的 effect 清理）

### 状态形状设计：

* \[ ] 互斥状态使用密封类型、联合变体或解决方案内置的异步状态类型（例如 Riverpod 的 `AsyncValue`）—— 而不是布尔标志 (`isLoading`, `isError`, `hasData`)
* \[ ] 每个异步操作都将加载、成功和错误建模为不同的状态
* \[ ] UI 中详尽处理所有状态变体 —— 没有静默忽略的情况
* \[ ] 错误状态携带用于显示的错误信息；加载状态不携带陈旧数据
* \[ ] 可空数据不用于作为加载指示器 —— 状态是明确的

```dart
// BAD — boolean flag soup allows impossible states
class UserState {
  bool isLoading = false;
  bool hasError = false; // isLoading && hasError is representable!
  User? user;
}

// GOOD (immutable approach) — sealed types make impossible states unrepresentable
sealed class UserState {}
class UserInitial extends UserState {}
class UserLoading extends UserState {}
class UserLoaded extends UserState {
  final User user;
  const UserLoaded(this.user);
}
class UserError extends UserState {
  final String message;
  const UserError(this.message);
}

// GOOD (reactive approach) — observable enum + data, mutations via reactivity API
// enum UserStatus { initial, loading, loaded, error }
// Use your solution's observable/signal to wrap status and data separately
```

### 重建优化：

* \[ ] 状态消费者部件（Builder、Consumer、Observer、Obx、Watch 等）的范围尽可能窄
* \[ ] 使用选择器仅在特定字段变化时重建 —— 而不是每次状态发射时
* \[ ] 使用 `const` 部件来阻止重建在树中传播
* \[ ] 计算/派生状态是响应式计算的，而不是冗余存储的

### 订阅与清理：

* \[ ] 所有手动订阅 (`.listen()`) 在 `dispose()` / `close()` 中被取消
* \[ ] 流控制器在不再需要时关闭
* \[ ] 定时器在清理生命周期中被取消
* \[ ] 优先使用框架管理的生命周期，而不是手动订阅（声明式构建器优于 `.listen()`）
* \[ ] 异步回调中在 `setState` 之前检查 `mounted`
* \[ ] 在 `await` 之后使用 `BuildContext` 而不检查 `context.mounted`（Flutter 3.7+）—— 过时的上下文会导致崩溃
* \[ ] 在异步间隙后，没有在验证部件仍然挂载的情况下进行导航、显示对话框或脚手架消息
* \[ ] `BuildContext` 绝不存储在单例、状态管理器或静态字段中

### 本地状态与全局状态：

* \[ ] 临时 UI 状态（复选框、滑块、动画）使用本地状态 (`setState`, `ValueNotifier`)
* \[ ] 共享状态仅提升到所需的高度 —— 不过度全局化
* \[ ] 功能作用域的状态在功能不再活跃时被正确清理

***

## 5. 性能

### 不必要的重建：

* \[ ] 不在根部件级别调用 `setState()` —— 将状态变化局部化
* \[ ] 使用 `const` 部件来阻止重建传播
* \[ ] 在独立重绘的复杂子树周围使用 `RepaintBoundary`
* \[ ] 使用 `AnimatedBuilder` 的 child 参数处理独立于动画的子树

### build() 中的昂贵操作：

* \[ ] 不在 `build()` 中对大型集合进行排序、过滤或映射 —— 在状态管理层计算
* \[ ] 不在 `build()` 中编译正则表达式
* \[ ] `MediaQuery.of(context)` 的使用是具体的（例如，`MediaQuery.sizeOf(context)`）

### 图像优化：

* \[ ] 网络图像使用缓存（适用于项目的任何缓存解决方案）
* \[ ] 为目标设备使用适当的图像分辨率（不为缩略图加载 4K 图像）
* \[ ] 使用带有 `cacheWidth`/`cacheHeight` 的 `Image.asset` 以按显示尺寸解码
* \[ ] 为网络图像提供占位符和错误部件

### 懒加载：

* \[ ] 对于大型或动态列表，使用 `ListView.builder` / `GridView.builder` 代替 `ListView(children: [...])`（对于小型、静态列表，具体构造器是可以的）
* \[ ] 为大型数据集实现分页
* \[ ] 在 Web 构建中对重量级库使用延迟加载 (`deferred as`)

### 其他：

* \[ ] 在动画中避免使用 `Opacity` 部件 —— 使用 `AnimatedOpacity` 或 `FadeTransition`
* \[ ] 在动画中避免裁剪 —— 预裁剪图像
* \[ ] 不在部件上重写 `operator ==` —— 使用 `const` 构造器代替
* \[ ] 固有尺寸部件 (`IntrinsicHeight`, `IntrinsicWidth`) 谨慎使用（额外的布局传递）

***

## 6. 测试

### 测试类型与期望：

* \[ ] **单元测试**：覆盖所有业务逻辑（状态管理器、仓库、工具函数）
* \[ ] **部件测试**：覆盖单个部件的行为、交互和视觉输出
* \[ ] **集成测试**：端到端覆盖关键用户流程
* \[ ] **Golden 测试**：对设计关键的 UI 组件进行像素级精确比较

### 覆盖率目标：

* \[ ] 业务逻辑的目标行覆盖率达到 80% 以上
* \[ ] 所有状态转换都有对应的测试（加载 → 成功，加载 → 错误，重试等）
* \[ ] 测试边缘情况：空状态、错误状态、加载状态、边界值

### 测试隔离：

* \[ ] 外部依赖（API 客户端、数据库、服务）已被模拟或伪造
* \[ ] 每个测试文件仅测试一个类/单元
* \[ ] 测试验证行为，而非实现细节
* \[ ] 存根仅定义每个测试所需的行为（最小化存根）
* \[ ] 测试用例之间没有共享的可变状态

### 小部件测试质量：

* \[ ] `pumpWidget` 和 `pump` 被正确用于异步操作
* \[ ] `find.byType`、`find.text`、`find.byKey` 使用得当
* \[ ] 没有依赖于时序的不可靠测试——使用 `pumpAndSettle` 或显式的 `pump(Duration)`
* \[ ] 测试在 CI 中运行，失败会阻止合并

***

## 7. 无障碍功能

### 语义化小部件：

* \[ ] 使用 `Semantics` 小部件在自动标签不足时提供屏幕阅读器标签
* \[ ] 使用 `ExcludeSemantics` 处理纯装饰性元素
* \[ ] 使用 `MergeSemantics` 将相关小部件组合成单个可访问元素
* \[ ] 图像设置了 `semanticLabel` 属性

### 屏幕阅读器支持：

* \[ ] 所有交互元素均可聚焦并具有有意义的描述
* \[ ] 焦点顺序符合逻辑（遵循视觉阅读顺序）

### 视觉无障碍：

* \[ ] 文本与背景的对比度 >= 4.5:1
* \[ ] 可点击目标至少为 48x48 像素
* \[ ] 颜色不是状态的唯一指示器（同时使用图标/文本）
* \[ ] 文本随系统字体大小设置缩放

### 交互无障碍：

* \[ ] 没有无操作的 `onPressed` 回调——每个按钮都有作用或处于禁用状态
* \[ ] 错误字段建议更正
* \[ ] 用户输入数据时，上下文不会意外改变

***

## 8. 平台特定考量

### iOS/Android 差异：

* \[ ] 在适当的地方使用平台自适应小部件
* \[ ] 返回导航处理正确（Android 返回按钮，iOS 滑动返回）
* \[ ] 通过 `SafeArea` 小部件处理状态栏和安全区域
* \[ ] 平台特定权限在 `AndroidManifest.xml` 和 `Info.plist` 中声明

### 响应式设计：

* \[ ] 使用 `LayoutBuilder` 或 `MediaQuery` 实现响应式布局
* \[ ] 断点定义一致（手机、平板、桌面）
* \[ ] 文本在小屏幕上不会溢出——使用 `Flexible`、`Expanded`、`FittedBox`
* \[ ] 测试了横屏方向或明确锁定
* \[ ] Web 特定：支持鼠标/键盘交互，存在悬停状态

***

## 9. 安全性

### 安全存储：

* \[ ] 敏感数据（令牌、凭证）使用平台安全存储存储（iOS 上的 Keychain，Android 上的 EncryptedSharedPreferences）
* \[ ] 从不以明文存储机密信息
* \[ ] 对于敏感操作考虑使用生物识别认证门控

### API 密钥处理：

* \[ ] API 密钥 NOT 硬编码在 Dart 源代码中——使用 `--dart-define`，`.env` 文件从 VCS 中排除，或使用编译时配置
* \[ ] 机密信息未提交到 git——检查 `.gitignore`
* \[ ] 对真正的秘密密钥使用后端代理（客户端不应持有服务器机密）

### 输入验证：

* \[ ] 所有用户输入在发送到 API 前都经过验证
* \[ ] 表单验证使用适当的验证模式
* \[ ] 没有原始 SQL 或用户输入的字符串插值
* \[ ] 深度链接 URL 在导航前经过验证和清理

### 网络安全：

* \[ ] 所有 API 调用强制使用 HTTPS
* \[ ] 对于高安全性应用考虑证书锁定
* \[ ] 认证令牌正确刷新和过期
* \[ ] 没有记录或打印敏感数据

***

## 10. 包/依赖项审查

### 评估 pub.dev 包：

* \[ ] 检查 **pub 分数**（目标 130+/160）
* \[ ] 检查 **点赞数**和**流行度**作为社区信号
* \[ ] 验证发布者在 pub.dev 上**已验证**
* \[ ] 检查最后发布日期——过时的包（>1 年）有风险
* \[ ] 审查维护者的未解决问题和响应时间
* \[ ] 检查许可证与项目的兼容性
* \[ ] 验证平台支持是否覆盖您的目标

### 版本约束：

* \[ ] 对依赖项使用插入符语法（`^1.2.3`）——允许兼容性更新
* \[ ] 仅在绝对必要时固定确切版本
* \[ ] 定期运行 `flutter pub outdated` 以跟踪过时的依赖项
* \[ ] 生产 `pubspec.yaml` 中没有依赖项覆盖——仅用于带有注释/问题链接的临时修复
* \[ ] 最小化传递依赖项数量——每个依赖项都是一个攻击面

### 单仓库特定（melos/workspace）：

* \[ ] 内部包仅从公共 API 导入——没有 `package:other/src/internal.dart`（破坏 Dart 包封装）
* \[ ] 内部包依赖项使用工作区解析，而不是硬编码的 `path: ../../` 相对字符串
* \[ ] 所有子包共享或继承根 `analysis_options.yaml`

***

## 11. 导航和路由

### 通用原则（适用于任何路由解决方案）：

* \[ ] 一致使用一种路由方法——不混合命令式 `Navigator.push` 和声明式路由器
* \[ ] 路由参数是类型化的——没有 `Map<String, dynamic>` 或 `Object?` 转换
* \[ ] 路由路径定义为常量、枚举或生成——没有散布在代码中的魔法字符串
* \[ ] 认证守卫/重定向集中化——不在各个屏幕中重复
* \[ ] 为 Android 和 iOS 配置深度链接
* \[ ] 深度链接 URL 在导航前经过验证和清理
* \[ ] 导航状态是可测试的——可以在测试中验证路由更改
* \[ ] 在所有平台上返回行为正确

***

## 12. 错误处理

### 框架错误处理：

* \[ ] 重写 `FlutterError.onError` 以捕获框架错误（构建、布局、绘制）
* \[ ] 设置 `PlatformDispatcher.instance.onError` 处理 Flutter 未捕获的异步错误
* \[ ] 为发布模式自定义 `ErrorWidget.builder`（用户友好而非红屏）
* \[ ] 在 `runApp` 周围使用全局错误捕获包装器（例如 `runZonedGuarded`，Sentry/Crashlytics 包装器）

### 错误报告：

* \[ ] 集成了错误报告服务（Firebase Crashlytics、Sentry 或等效服务）
* \[ ] 报告非致命错误并附上堆栈跟踪
* \[ ] 状态管理错误观察器连接到错误报告（例如，BlocObserver、ProviderObserver 或适用于您解决方案的等效项）
* \[ ] 为调试目的，将用户可识别信息（用户 ID）附加到错误报告

### 优雅降级：

* \[ ] API 错误导致用户友好的错误 UI，而非崩溃
* \[ ] 针对瞬时网络故障的重试机制
* \[ ] 优雅处理离线状态
* \[ ] 状态管理中的错误状态携带用于显示的错误信息
* \[ ] 原始异常（网络、解析）在到达 UI 之前被映射为用户友好的本地化消息——从不向用户显示原始异常字符串

***

## 13. 国际化（l10n）

### 设置：

* \[ ] 配置了本地化解决方案（Flutter 内置的 ARB/l10n、easy\_localization 或等效方案）
* \[ ] 在应用配置中声明了支持的语言环境

### 内容：

* \[ ] 所有用户可见字符串都使用本地化系统——小部件中没有硬编码字符串
* \[ ] 模板文件包含翻译人员的描述/上下文
* \[ ] 使用 ICU 消息语法处理复数、性别、选择
* \[ ] 使用类型定义占位符
* \[ ] 跨语言环境没有缺失的键

### 代码审查：

* \[ ] 在整个项目中一致使用本地化访问器
* \[ ] 日期、时间、数字和货币格式化具有语言环境感知能力
* \[ ] 如果目标语言是阿拉伯语、希伯来语等，则支持文本方向性（RTL）
* \[ ] 本地化文本没有字符串拼接——使用参数化消息

***

## 14. 依赖注入

### 原则（适用于任何 DI 方法）：

* \[ ] 类在层边界上依赖于抽象（接口），而不是具体实现
* \[ ] 依赖项通过构造函数、DI 框架或提供者图从外部提供——而非内部创建
* \[ ] 注册区分生命周期：单例 vs 工厂 vs 惰性单例
* \[ ] 环境特定绑定（开发/暂存/生产）使用配置，而非运行时 `if` 检查
* \[ ] DI 图中没有循环依赖
* \[ ] 服务定位器调用（如果使用）没有散布在业务逻辑中

***

## 15. 静态分析

### 配置：

* \[ ] 存在 `analysis_options.yaml` 并启用了严格设置
* \[ ] 严格的分析器设置：`strict-casts: true`、`strict-inference: true`、`strict-raw-types: true`
* \[ ] 包含全面的 lint 规则集（very\_good\_analysis、flutter\_lints 或自定义严格规则）
* \[ ] 单仓库中的所有子包继承或共享根分析选项

### 执行：

* \[ ] 提交的代码中没有未解决的分析器警告
* \[ ] lint 抑制（`// ignore:`）有注释说明原因
* \[ ] `flutter analyze` 在 CI 中运行，失败会阻止合并

### 无论使用何种 lint 包都要验证的关键规则：

* \[ ] `prefer_const_constructors`——小部件树中的性能
* \[ ] `avoid_print`——使用适当的日志记录
* \[ ] `unawaited_futures`——防止即发即弃的异步错误
* \[ ] `prefer_final_locals`——变量级别的不可变性
* \[ ] `always_declare_return_types`——明确的契约
* \[ ] `avoid_catches_without_on_clauses`——具体的错误处理
* \[ ] `always_use_package_imports`——一致的导入风格

***

## 状态管理快速参考

下表将通用原则映射到流行解决方案中的实现。使用此表将审查规则调整为项目使用的任何解决方案。

| 原则 | BLoC/Cubit | Riverpod | Provider | GetX | MobX | Signals | 内置 |
|-----------|-----------|----------|----------|------|------|---------|----------|
| 状态容器 | `Bloc`/`Cubit` | `Notifier`/`AsyncNotifier` | `ChangeNotifier` | `GetxController` | `Store` | `signal()` | `StatefulWidget` |
| UI 消费者 | `BlocBuilder` | `ConsumerWidget` | `Consumer` | `Obx`/`GetBuilder` | `Observer` | `Watch` | `setState` |
| 选择器 | `BlocSelector`/`buildWhen` | `ref.watch(p.select(...))` | `Selector` | N/A | computed | `computed()` | N/A |
| 副作用 | `BlocListener` | `ref.listen` | `Consumer` 回调 | `ever()`/`once()` | `reaction` | `effect()` | 回调 |
| 处置 | 通过 `BlocProvider` 自动 | `.autoDispose` | 通过 `Provider` 自动 | `onClose()` | `ReactionDisposer` | 手动 | `dispose()` |
| 测试 | `blocTest()` | `ProviderContainer` | 直接 `ChangeNotifier` | 在测试中 `Get.put` | 直接测试 store | 直接测试 signal | 小部件测试 |

***

## 来源

* [Effective Dart: 风格](https://dart.dev/effective-dart/style)
* [Effective Dart: 用法](https://dart.dev/effective-dart/usage)
* [Effective Dart: 设计](https://dart.dev/effective-dart/design)
* [Flutter 性能最佳实践](https://docs.flutter.dev/perf/best-practices)
* [Flutter 测试概述](https://docs.flutter.dev/testing/overview)
* [Flutter 无障碍功能](https://docs.flutter.dev/ui/accessibility-and-internationalization/accessibility)
* [Flutter 国际化](https://docs.flutter.dev/ui/accessibility-and-internationalization/internationalization)
* [Flutter 导航和路由](https://docs.flutter.dev/ui/navigation)
* [Flutter 错误处理](https://docs.flutter.dev/testing/errors)
* [Flutter 状态管理选项](https://docs.flutter.dev/data-and-backend/state-mgmt/options)
