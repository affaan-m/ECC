---
name: perl-testing
description: 使用Test2::V0、Test::More、prove runner、模拟、Devel::Cover覆盖率和TDD方法的Perl测试模式。
origin: ECC
---

# Perl 测试模式

使用 Test2::V0、Test::More、prove 和 TDD 方法论为 Perl 应用程序提供全面的测试策略。

## 何时激活

* 编写新的 Perl 代码（遵循 TDD：红、绿、重构）
* 为 Perl 模块或应用程序设计测试套件
* 审查 Perl 测试覆盖率
* 设置 Perl 测试基础设施
* 将测试从 Test::More 迁移到 Test2::V0
* 调试失败的 Perl 测试

## TDD 工作流程

始终遵循 RED-GREEN-REFACTOR 循环。

```perl
# Step 1: RED — Write a failing test
# t/unit/calculator.t
use v5.36;
use Test2::V0;

use lib 'lib';
use Calculator;

subtest 'addition' => sub {
    my $calc = Calculator->new;
    is($calc->add(2, 3), 5, 'adds two numbers');
    is($calc->add(-1, 1), 0, 'handles negatives');
};

done_testing;

# Step 2: GREEN — Write minimal implementation
# lib/Calculator.pm
package Calculator;
use v5.36;
use Moo;

sub add($self, $a, $b) {
    return $a + $b;
}

1;

# Step 3: REFACTOR — Improve while tests stay green
# Run: prove -lv t/unit/calculator.t
```

## Test::More 基础

标准的 Perl 测试模块 —— 广泛使用，随核心发行。

### 基本断言

```perl
use v5.36;
use Test::More;

# Plan upfront or use done_testing
# plan tests => 5;  # Fixed plan (optional)

# Equality
is($result, 42, 'returns correct value');
isnt($result, 0, 'not zero');

# Boolean
ok($user->is_active, 'user is active');
ok(!$user->is_banned, 'user is not banned');

# Deep comparison
is_deeply(
    $got,
    { name => 'Alice', roles => ['admin'] },
    'returns expected structure'
);

# Pattern matching
like($error, qr/not found/i, 'error mentions not found');
unlike($output, qr/password/, 'output hides password');

# Type check
isa_ok($obj, 'MyApp::User');
can_ok($obj, 'save', 'delete');

done_testing;
```

### SKIP 和 TODO

```perl
use v5.36;
use Test::More;

# Skip tests conditionally
SKIP: {
    skip 'No database configured', 2 unless $ENV{TEST_DB};

    my $db = connect_db();
    ok($db->ping, 'database is reachable');
    is($db->version, '15', 'correct PostgreSQL version');
}

# Mark expected failures
TODO: {
    local $TODO = 'Caching not yet implemented';
    is($cache->get('key'), 'value', 'cache returns value');
}

done_testing;
```

## Test2::V0 现代框架

Test2::V0 是 Test::More 的现代替代品 —— 更丰富的断言、更好的诊断和可扩展性。

### 为什么选择 Test2？

* 使用哈希/数组构建器进行卓越的深层比较
* 失败时提供更好的诊断输出
* 具有更清晰作用域的子测试
* 可通过 Test2::Tools::\* 插件扩展
* 与 Test::More 测试向后兼容

### 使用构建器进行深层比较

```perl
use v5.36;
use Test2::V0;

# Hash builder — check partial structure
is(
    $user->to_hash,
    hash {
        field name  => 'Alice';
        field email => match(qr/\@example\.com$/);
        field age   => validator(sub { $_ >= 18 });
        # Ignore other fields
        etc();
    },
    'user has expected fields'
);

# Array builder
is(
    $result,
    array {
        item 'first';
        item match(qr/^second/);
        item DNE();  # Does Not Exist — verify no extra items
    },
    'result matches expected list'
);

# Bag — order-independent comparison
is(
    $tags,
    bag {
        item 'perl';
        item 'testing';
        item 'tdd';
    },
    'has all required tags regardless of order'
);
```

### 子测试

```perl
use v5.36;
use Test2::V0;

subtest 'User creation' => sub {
    my $user = User->new(name => 'Alice', email => 'alice@example.com');
    ok($user, 'user object created');
    is($user->name, 'Alice', 'name is set');
    is($user->email, 'alice@example.com', 'email is set');
};

subtest 'User validation' => sub {
    my $warnings = warns {
        User->new(name => '', email => 'bad');
    };
    ok($warnings, 'warns on invalid data');
};

done_testing;
```

### 使用 Test2 进行异常测试

```perl
use v5.36;
use Test2::V0;

# Test that code dies
like(
    dies { divide(10, 0) },
    qr/Division by zero/,
    'dies on division by zero'
);

# Test that code lives
ok(lives { divide(10, 2) }, 'division succeeds') or note($@);

# Combined pattern
subtest 'error handling' => sub {
    ok(lives { parse_config('valid.json') }, 'valid config parses');
    like(
        dies { parse_config('missing.json') },
        qr/Cannot open/,
        'missing file dies with message'
    );
};

done_testing;
```

## 测试组织与 prove

### 目录结构

```text
t/
├── 00-load.t              # 验证模块编译
├── 01-basic.t             # 核心功能
├── unit/
│   ├── config.t           # 按模块划分的单元测试
│   ├── user.t
│   └── util.t
├── integration/
│   ├── database.t
│   └── api.t
├── lib/
│   └── TestHelper.pm      # 共享测试工具
└── fixtures/
    ├── config.json        # 测试数据文件
    └── users.csv
```

### prove 命令

```bash
# Run all tests
prove -l t/

# Verbose output
prove -lv t/

# Run specific test
prove -lv t/unit/user.t

# Recursive search
prove -lr t/

# Parallel execution (8 jobs)
prove -lr -j8 t/

# Run only failing tests from last run
prove -l --state=failed t/

# Colored output with timer
prove -l --color --timer t/

# TAP output for CI
prove -l --formatter TAP::Formatter::JUnit t/ > results.xml
```

### .proverc 配置

```text
-l
--color
--timer
-r
-j4
--state=save
```

## 夹具与设置/拆卸

### 子测试隔离

```perl
use v5.36;
use Test2::V0;
use File::Temp qw(tempdir);
use Path::Tiny;

subtest 'file processing' => sub {
    # Setup
    my $dir = tempdir(CLEANUP => 1);
    my $file = path($dir, 'input.txt');
    $file->spew_utf8("line1\nline2\nline3\n");

    # Test
    my $result = process_file("$file");
    is($result->{line_count}, 3, 'counts lines');

    # Teardown happens automatically (CLEANUP => 1)
};
```

### 共享测试助手

将可重用的助手放在 `t/lib/TestHelper.pm` 中，并通过 `use lib 't/lib'` 加载。通过 `Exporter` 导出工厂函数，例如 `create_test_db()`、`create_temp_dir()` 和 `fixture_path()`。

## 模拟

### Test::MockModule

```perl
use v5.36;
use Test2::V0;
use Test::MockModule;

subtest 'mock external API' => sub {
    my $mock = Test::MockModule->new('MyApp::API');

    # Good: Mock returns controlled data
    $mock->mock(fetch_user => sub ($self, $id) {
        return { id => $id, name => 'Mock User', email => 'mock@test.com' };
    });

    my $api = MyApp::API->new;
    my $user = $api->fetch_user(42);
    is($user->{name}, 'Mock User', 'returns mocked user');

    # Verify call count
    my $call_count = 0;
    $mock->mock(fetch_user => sub { $call_count++; return {} });
    $api->fetch_user(1);
    $api->fetch_user(2);
    is($call_count, 2, 'fetch_user called twice');

    # Mock is automatically restored when $mock goes out of scope
};

# Bad: Monkey-patching without restoration
# *MyApp::API::fetch_user = sub { ... };  # NEVER — leaks across tests
```

对于轻量级的模拟对象，使用 `Test::MockObject` 创建可注入的测试替身，使用 `->mock()` 并验证调用 `->called_ok()`。

## 使用 Devel::Cover 进行覆盖率分析

### 运行覆盖率分析

```bash
# Basic coverage report
cover -test

# Or step by step
perl -MDevel::Cover -Ilib t/unit/user.t
cover

# HTML report
cover -report html
open cover_db/coverage.html

# Specific thresholds
cover -test -report text | grep 'Total'

# CI-friendly: fail under threshold
cover -test && cover -report text -select '^lib/' \
  | perl -ne 'if (/Total.*?(\d+\.\d+)/) { exit 1 if $1 < 80 }'
```

### 集成测试

对数据库测试使用内存中的 SQLite，对 API 测试模拟 HTTP::Tiny。

```perl
use v5.36;
use Test2::V0;
use DBI;

subtest 'database integration' => sub {
    my $dbh = DBI->connect('dbi:SQLite:dbname=:memory:', '', '', {
        RaiseError => 1,
    });
    $dbh->do('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');

    $dbh->prepare('INSERT INTO users (name) VALUES (?)')->execute('Alice');
    my $row = $dbh->selectrow_hashref('SELECT * FROM users WHERE name = ?', undef, 'Alice');
    is($row->{name}, 'Alice', 'inserted and retrieved user');
};

done_testing;
```

## 最佳实践

### 应做事项

* **遵循 TDD**：在实现之前编写测试（红-绿-重构）
* **使用 Test2::V0**：现代断言，更好的诊断
* **使用子测试**：分组相关断言，隔离状态
* **模拟外部依赖**：网络、数据库、文件系统
* **使用 `prove -l`**：始终将 lib/ 包含在 `@INC` 中
* **清晰命名测试**：`'user login with invalid password fails'`
* **测试边界情况**：空字符串、undef、零、边界值
* **目标 80%+ 覆盖率**：专注于业务逻辑路径
* **保持测试快速**：模拟 I/O，使用内存数据库

### 禁止事项

* **不要测试实现**：测试行为和输出，而非内部细节
* **不要在子测试之间共享状态**：每个子测试都应是独立的
* **不要跳过 `done_testing`**：确保所有计划的测试都已运行
* **不要过度模拟**：仅模拟边界，而非被测试的代码
* **不要在新项目中使用 `Test::More`**：首选 Test2::V0
* **不要忽略测试失败**：所有测试必须在合并前通过
* **不要测试 CPAN 模块**：相信库能正常工作
* **不要编写脆弱的测试**：避免过度具体的字符串匹配

## 快速参考

| 任务 | 命令 / 模式 |
|---|---|
| 运行所有测试 | `prove -lr t/` |
| 详细运行单个测试 | `prove -lv t/unit/user.t` |
| 并行测试运行 | `prove -lr -j8 t/` |
| 覆盖率报告 | `cover -test && cover -report html` |
| 测试相等性 | `is($got, $expected, 'label')` |
| 深层比较 | `is($got, hash { field k => 'v'; etc() }, 'label')` |
| 测试异常 | `like(dies { ... }, qr/msg/, 'label')` |
| 测试无异常 | `ok(lives { ... }, 'label')` |
| 模拟一个方法 | `Test::MockModule->new('Pkg')->mock(m => sub { ... })` |
| 跳过测试 | `SKIP: { skip 'reason', $count unless $cond; ... }` |
| TODO 测试 | `TODO: { local $TODO = 'reason'; ... }` |

## 常见陷阱

### 忘记 `done_testing`

```perl
# Bad: Test file runs but doesn't verify all tests executed
use Test2::V0;
is(1, 1, 'works');
# Missing done_testing — silent bugs if test code is skipped

# Good: Always end with done_testing
use Test2::V0;
is(1, 1, 'works');
done_testing;
```

### 缺少 `-l` 标志

```bash
# Bad: Modules in lib/ not found
prove t/unit/user.t
# Can't locate MyApp/User.pm in @INC

# Good: Include lib/ in @INC
prove -l t/unit/user.t
```

### 过度模拟

模拟*依赖项*，而非被测试的代码。如果你的测试只验证模拟返回了你告诉它的内容，那么它什么也没测试。

### 测试污染

在子测试内部使用 `my` 变量 —— 永远不要用 `our` —— 以防止状态在测试之间泄漏。

**记住**：测试是你的安全网。保持它们快速、专注和独立。新项目使用 Test2::V0，运行使用 prove，问责使用 Devel::Cover。
