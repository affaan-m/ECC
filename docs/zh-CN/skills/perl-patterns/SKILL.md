---
name: perl-patterns
description: 现代 Perl 5.36+ 的惯用法、最佳实践和约定，用于构建稳健、可维护的 Perl 应用程序。
origin: ECC
---

# 现代 Perl 开发模式

适用于构建健壮、可维护应用程序的 Perl 5.36+ 惯用模式和最佳实践。

## 何时启用

* 编写新的 Perl 代码或模块时
* 审查 Perl 代码是否符合惯用法时
* 重构遗留 Perl 代码以符合现代标准时
* 设计 Perl 模块架构时
* 将 5.36 之前的代码迁移到现代 Perl 时

## 工作原理

将这些模式作为偏向现代 Perl 5.36+ 默认设置的指南应用：签名、显式模块、聚焦的错误处理和可测试的边界。下面的示例旨在作为起点被复制，然后根据您面前的实际应用程序、依赖栈和部署模型进行调整。

## 核心原则

### 1. 使用 `v5.36` 编译指令

单个 `use v5.36` 即可替代旧的样板代码，并启用严格模式、警告和子程序签名。

```perl
# Good: Modern preamble
use v5.36;

sub greet($name) {
    say "Hello, $name!";
}

# Bad: Legacy boilerplate
use strict;
use warnings;
use feature 'say', 'signatures';
no warnings 'experimental::signatures';

sub greet {
    my ($name) = @_;
    say "Hello, $name!";
}
```

### 2. 子程序签名

使用签名以提高清晰度和自动参数数量检查。

```perl
use v5.36;

# Good: Signatures with defaults
sub connect_db($host, $port = 5432, $timeout = 30) {
    # $host is required, others have defaults
    return DBI->connect("dbi:Pg:host=$host;port=$port", undef, undef, {
        RaiseError => 1,
        PrintError => 0,
    });
}

# Good: Slurpy parameter for variable args
sub log_message($level, @details) {
    say "[$level] " . join(' ', @details);
}

# Bad: Manual argument unpacking
sub connect_db {
    my ($host, $port, $timeout) = @_;
    $port    //= 5432;
    $timeout //= 30;
    # ...
}
```

### 3. 上下文敏感性

理解标量上下文与列表上下文——这是 Perl 的核心概念。

```perl
use v5.36;

my @items = (1, 2, 3, 4, 5);

my @copy  = @items;            # List context: all elements
my $count = @items;            # Scalar context: count (5)
say "Items: " . scalar @items; # Force scalar context
```

### 4. 后缀解引用

对嵌套结构使用后缀解引用语法以提高可读性。

```perl
use v5.36;

my $data = {
    users => [
        { name => 'Alice', roles => ['admin', 'user'] },
        { name => 'Bob',   roles => ['user'] },
    ],
};

# Good: Postfix dereferencing
my @users = $data->{users}->@*;
my @roles = $data->{users}[0]{roles}->@*;
my %first = $data->{users}[0]->%*;

# Bad: Circumfix dereferencing (harder to read in chains)
my @users = @{ $data->{users} };
my @roles = @{ $data->{users}[0]{roles} };
```

### 5. `isa` 运算符 (5.32+)

中缀类型检查——替代 `blessed($o) && $o->isa('X')`。

```perl
use v5.36;
if ($obj isa 'My::Class') { $obj->do_something }
```

## 错误处理

### eval/die 模式

```perl
use v5.36;

sub parse_config($path) {
    my $content = eval { path($path)->slurp_utf8 };
    die "Config error: $@" if $@;
    return decode_json($content);
}
```

### Try::Tiny（可靠的异常处理）

```perl
use v5.36;
use Try::Tiny;

sub fetch_user($id) {
    my $user = try {
        $db->resultset('User')->find($id)
            // die "User $id not found\n";
    }
    catch {
        warn "Failed to fetch user $id: $_";
        undef;
    };
    return $user;
}
```

### 原生 try/catch (5.40+)

```perl
use v5.40;

sub divide($x, $y) {
    try {
        die "Division by zero" if $y == 0;
        return $x / $y;
    }
    catch ($e) {
        warn "Error: $e";
        return;
    }
}
```

## 使用 Moo 的现代 OO

优先使用 Moo 进行轻量级、现代的面向对象编程。仅当需要 Moose 的元协议时才使用它。

```perl
# Good: Moo class
package User;
use Moo;
use Types::Standard qw(Str Int ArrayRef);
use namespace::autoclean;

has name  => (is => 'ro', isa => Str, required => 1);
has email => (is => 'ro', isa => Str, required => 1);
has age   => (is => 'ro', isa => Int, default  => sub { 0 });
has roles => (is => 'ro', isa => ArrayRef[Str], default => sub { [] });

sub is_admin($self) {
    return grep { $_ eq 'admin' } $self->roles->@*;
}

sub greet($self) {
    return "Hello, I'm " . $self->name;
}

1;

# Usage
my $user = User->new(
    name  => 'Alice',
    email => 'alice@example.com',
    roles => ['admin', 'user'],
);

# Bad: Blessed hashref (no validation, no accessors)
package User;
sub new {
    my ($class, %args) = @_;
    return bless \%args, $class;
}
sub name { return $_[0]->{name} }
1;
```

### Moo 角色

```perl
package Role::Serializable;
use Moo::Role;
use JSON::MaybeXS qw(encode_json);
requires 'TO_HASH';
sub to_json($self) { encode_json($self->TO_HASH) }
1;

package User;
use Moo;
with 'Role::Serializable';
has name  => (is => 'ro', required => 1);
has email => (is => 'ro', required => 1);
sub TO_HASH($self) { { name => $self->name, email => $self->email } }
1;
```

### 原生 `class` 关键字 (5.38+, Corinna)

```perl
use v5.38;
use feature 'class';
no warnings 'experimental::class';

class Point {
    field $x :param;
    field $y :param;
    method magnitude() { sqrt($x**2 + $y**2) }
}

my $p = Point->new(x => 3, y => 4);
say $p->magnitude;  # 5
```

## 正则表达式

### 命名捕获和 `/x` 标志

```perl
use v5.36;

# Good: Named captures with /x for readability
my $log_re = qr{
    ^ (?<timestamp> \d{4}-\d{2}-\d{2} \s \d{2}:\d{2}:\d{2} )
    \s+ \[ (?<level> \w+ ) \]
    \s+ (?<message> .+ ) $
}x;

if ($line =~ $log_re) {
    say "Time: $+{timestamp}, Level: $+{level}";
    say "Message: $+{message}";
}

# Bad: Positional captures (hard to maintain)
if ($line =~ /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(.+)$/) {
    say "Time: $1, Level: $2";
}
```

### 预编译模式

```perl
use v5.36;

# Good: Compile once, use many
my $email_re = qr/^[A-Za-z0-9._%+-]+\@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

sub validate_emails(@emails) {
    return grep { $_ =~ $email_re } @emails;
}
```

## 数据结构

### 引用和安全深度访问

```perl
use v5.36;

# Hash and array references
my $config = {
    database => {
        host => 'localhost',
        port => 5432,
        options => ['utf8', 'sslmode=require'],
    },
};

# Safe deep access (returns undef if any level missing)
my $port = $config->{database}{port};           # 5432
my $missing = $config->{cache}{host};           # undef, no error

# Hash slices
my %subset;
@subset{qw(host port)} = @{$config->{database}}{qw(host port)};

# Array slices
my @first_two = $config->{database}{options}->@[0, 1];

# Multi-variable for loop (experimental in 5.36, stable in 5.40)
use feature 'for_list';
no warnings 'experimental::for_list';
for my ($key, $val) (%$config) {
    say "$key => $val";
}
```

## 文件 I/O

### 三参数 open

```perl
use v5.36;

# Good: Three-arg open with autodie (core module, eliminates 'or die')
use autodie;

sub read_file($path) {
    open my $fh, '<:encoding(UTF-8)', $path;
    local $/;
    my $content = <$fh>;
    close $fh;
    return $content;
}

# Bad: Two-arg open (shell injection risk, see perl-security)
open FH, $path;            # NEVER do this
open FH, "< $path";        # Still bad — user data in mode string
```

### 使用 Path::Tiny 进行文件操作

```perl
use v5.36;
use Path::Tiny;

my $file = path('config', 'app.json');
my $content = $file->slurp_utf8;
$file->spew_utf8($new_content);

# Iterate directory
for my $child (path('src')->children(qr/\.pl$/)) {
    say $child->basename;
}
```

## 模块组织

### 标准项目布局

```text
MyApp/
├── lib/
│   └── MyApp/
│       ├── App.pm           # 主模块
│       ├── Config.pm        # 配置
│       ├── DB.pm            # 数据库层
│       └── Util.pm          # 工具集
├── bin/
│   └── myapp                # 入口脚本
├── t/
│   ├── 00-load.t            # 编译测试
│   ├── unit/                # 单元测试
│   └── integration/         # 集成测试
├── cpanfile                 # 依赖项
├── Makefile.PL              # 构建系统
└── .perlcriticrc            # 代码检查配置
```

### 导出器模式

```perl
package MyApp::Util;
use v5.36;
use Exporter 'import';

our @EXPORT_OK   = qw(trim);
our %EXPORT_TAGS = (all => \@EXPORT_OK);

sub trim($str) { $str =~ s/^\s+|\s+$//gr }

1;
```

## 工具

### perltidy 配置 (.perltidyrc)

```text
-i=4        # 4 空格缩进
-l=100      # 100 字符行宽
-ci=4       # 续行缩进
-ce         # else 与右花括号同行
-bar        # 左花括号与语句同行
-nolq       # 不对长引用字符串进行反向缩进
```

### perlcritic 配置 (.perlcriticrc)

```ini
severity = 3
theme = core + pbp + security

[InputOutput::RequireCheckedSyscalls]
functions = :builtins
exclude_functions = say print

[Subroutines::ProhibitExplicitReturnUndef]
severity = 4

[ValuesAndExpressions::ProhibitMagicNumbers]
allowed_values = 0 1 2 -1
```

### 依赖管理 (cpanfile + carton)

```bash
cpanm App::cpanminus Carton   # Install tools
carton install                 # Install deps from cpanfile
carton exec -- perl bin/myapp  # Run with local deps
```

```perl
# cpanfile
requires 'Moo', '>= 2.005';
requires 'Path::Tiny';
requires 'JSON::MaybeXS';
requires 'Try::Tiny';

on test => sub {
    requires 'Test2::V0';
    requires 'Test::MockModule';
};
```

## 快速参考：现代 Perl 惯用法

| 遗留模式 | 现代替代方案 |
|---|---|
| `use strict; use warnings;` | `use v5.36;` |
| `my ($x, $y) = @_;` | `sub foo($x, $y) { ... }` |
| `@{ $ref }` | `$ref->@*` |
| `%{ $ref }` | `$ref->%*` |
| `open FH, "< $file"` | `open my $fh, '<:encoding(UTF-8)', $file` |
| `blessed hashref` | `Moo` 带类型的类 |
| `$1, $2, $3` | `$+{name}` (命名捕获) |
| `eval { }; if ($@)` | `Try::Tiny` 或原生 `try/catch` (5.40+) |
| `BEGIN { require Exporter; }` | `use Exporter 'import';` |
| 手动文件操作 | `Path::Tiny` |
| `blessed($o) && $o->isa('X')` | `$o isa 'X'` (5.32+) |
| `builtin::true / false` | `use builtin 'true', 'false';` (5.36+, 实验性) |

## 反模式

```perl
# 1. Two-arg open (security risk)
open FH, $filename;                     # NEVER

# 2. Indirect object syntax (ambiguous parsing)
my $obj = new Foo(bar => 1);            # Bad
my $obj = Foo->new(bar => 1);           # Good

# 3. Excessive reliance on $_
map { process($_) } grep { validate($_) } @items;  # Hard to follow
my @valid = grep { validate($_) } @items;           # Better: break it up
my @results = map { process($_) } @valid;

# 4. Disabling strict refs
no strict 'refs';                        # Almost always wrong
${"My::Package::$var"} = $value;         # Use a hash instead

# 5. Global variables as configuration
our $TIMEOUT = 30;                       # Bad: mutable global
use constant TIMEOUT => 30;              # Better: constant
# Best: Moo attribute with default

# 6. String eval for module loading
eval "require $module";                  # Bad: code injection risk
eval "use $module";                      # Bad
use Module::Runtime 'require_module';    # Good: safe module loading
require_module($module);
```

**记住**：现代 Perl 是简洁、可读且安全的。让 `use v5.36` 处理样板代码，使用 Moo 处理对象，并优先使用 CPAN 上经过实战检验的模块，而不是自己动手的解决方案。
