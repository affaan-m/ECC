---
name: perl-security
description: 全面的Perl安全指南，涵盖污染模式、输入验证、安全进程执行、DBI参数化查询、Web安全（XSS/SQLi/CSRF）以及perlcritic安全策略。
origin: ECC
---

# Perl 安全模式

涵盖输入验证、注入预防和安全编码实践的 Perl 应用程序全面安全指南。

## 何时启用

* 处理 Perl 应用程序中的用户输入时
* 构建 Perl Web 应用程序时（CGI、Mojolicious、Dancer2、Catalyst）
* 审查 Perl 代码中的安全漏洞时
* 使用用户提供的路径执行文件操作时
* 从 Perl 执行系统命令时
* 编写 DBI 数据库查询时

## 工作原理

从污染感知的输入边界开始，然后向外扩展：验证并净化输入，保持文件系统和进程执行受限，并处处使用参数化的 DBI 查询。下面的示例展示了在交付涉及用户输入、shell 或网络的 Perl 代码之前，此技能期望您应用的安全默认做法。

## 污染模式

Perl 的污染模式（`-T`）跟踪来自外部源的数据，并防止其在未经明确验证的情况下用于不安全操作。

### 启用污染模式

```perl
#!/usr/bin/perl -T
use v5.36;

# Tainted: anything from outside the program
my $input    = $ARGV[0];        # Tainted
my $env_path = $ENV{PATH};      # Tainted
my $form     = <STDIN>;         # Tainted
my $query    = $ENV{QUERY_STRING}; # Tainted

# Sanitize PATH early (required in taint mode)
$ENV{PATH} = '/usr/local/bin:/usr/bin:/bin';
delete @ENV{qw(IFS CDPATH ENV BASH_ENV)};
```

### 净化模式

```perl
use v5.36;

# Good: Validate and untaint with a specific regex
sub untaint_username($input) {
    if ($input =~ /^([a-zA-Z0-9_]{3,30})$/) {
        return $1;  # $1 is untainted
    }
    die "Invalid username: must be 3-30 alphanumeric characters\n";
}

# Good: Validate and untaint a file path
sub untaint_filename($input) {
    if ($input =~ m{^([a-zA-Z0-9._-]+)$}) {
        return $1;
    }
    die "Invalid filename: contains unsafe characters\n";
}

# Bad: Overly permissive untainting (defeats the purpose)
sub bad_untaint($input) {
    $input =~ /^(.*)$/s;
    return $1;  # Accepts ANYTHING — pointless
}
```

## 输入验证

### 允许列表优于阻止列表

```perl
use v5.36;

# Good: Allowlist — define exactly what's permitted
sub validate_sort_field($field) {
    my %allowed = map { $_ => 1 } qw(name email created_at updated_at);
    die "Invalid sort field: $field\n" unless $allowed{$field};
    return $field;
}

# Good: Validate with specific patterns
sub validate_email($email) {
    if ($email =~ /^([a-zA-Z0-9._%+-]+\@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/) {
        return $1;
    }
    die "Invalid email address\n";
}

sub validate_integer($input) {
    if ($input =~ /^(-?\d{1,10})$/) {
        return $1 + 0;  # Coerce to number
    }
    die "Invalid integer\n";
}

# Bad: Blocklist — always incomplete
sub bad_validate($input) {
    die "Invalid" if $input =~ /[<>"';&|]/;  # Misses encoded attacks
    return $input;
}
```

### 长度约束

```perl
use v5.36;

sub validate_comment($text) {
    die "Comment is required\n"        unless length($text) > 0;
    die "Comment exceeds 10000 chars\n" if length($text) > 10_000;
    return $text;
}
```

## 安全正则表达式

### 防止正则表达式拒绝服务

嵌套的量词应用于重叠模式时会发生灾难性回溯。

```perl
use v5.36;

# Bad: Vulnerable to ReDoS (exponential backtracking)
my $bad_re = qr/^(a+)+$/;           # Nested quantifiers
my $bad_re2 = qr/^([a-zA-Z]+)*$/;   # Nested quantifiers on class
my $bad_re3 = qr/^(.*?,){10,}$/;    # Repeated greedy/lazy combo

# Good: Rewrite without nesting
my $good_re = qr/^a+$/;             # Single quantifier
my $good_re2 = qr/^[a-zA-Z]+$/;     # Single quantifier on class

# Good: Use possessive quantifiers or atomic groups to prevent backtracking
my $safe_re = qr/^[a-zA-Z]++$/;             # Possessive (5.10+)
my $safe_re2 = qr/^(?>a+)$/;                # Atomic group

# Good: Enforce timeout on untrusted patterns
use POSIX qw(alarm);
sub safe_match($string, $pattern, $timeout = 2) {
    my $matched;
    eval {
        local $SIG{ALRM} = sub { die "Regex timeout\n" };
        alarm($timeout);
        $matched = $string =~ $pattern;
        alarm(0);
    };
    alarm(0);
    die $@ if $@;
    return $matched;
}
```

## 安全的文件操作

### 三参数 Open

```perl
use v5.36;

# Good: Three-arg open, lexical filehandle, check return
sub read_file($path) {
    open my $fh, '<:encoding(UTF-8)', $path
        or die "Cannot open '$path': $!\n";
    local $/;
    my $content = <$fh>;
    close $fh;
    return $content;
}

# Bad: Two-arg open with user data (command injection)
sub bad_read($path) {
    open my $fh, $path;        # If $path = "|rm -rf /", runs command!
    open my $fh, "< $path";   # Shell metacharacter injection
}
```

### 防止检查时使用时间和路径遍历

```perl
use v5.36;
use Fcntl qw(:DEFAULT :flock);
use File::Spec;
use Cwd qw(realpath);

# Atomic file creation
sub create_file_safe($path) {
    sysopen(my $fh, $path, O_WRONLY | O_CREAT | O_EXCL, 0600)
        or die "Cannot create '$path': $!\n";
    return $fh;
}

# Validate path stays within allowed directory
sub safe_path($base_dir, $user_path) {
    my $real = realpath(File::Spec->catfile($base_dir, $user_path))
        // die "Path does not exist\n";
    my $base_real = realpath($base_dir)
        // die "Base dir does not exist\n";
    die "Path traversal blocked\n" unless $real =~ /^\Q$base_real\E(?:\/|\z)/;
    return $real;
}
```

使用 `File::Temp` 处理临时文件（`tempfile(UNLINK => 1)`），并使用 `flock(LOCK_EX)` 防止竞态条件。

## 安全的进程执行

### 列表形式的 system 和 exec

```perl
use v5.36;

# Good: List form — no shell interpolation
sub run_command(@cmd) {
    system(@cmd) == 0
        or die "Command failed: @cmd\n";
}

run_command('grep', '-r', $user_pattern, '/var/log/app/');

# Good: Capture output safely with IPC::Run3
use IPC::Run3;
sub capture_output(@cmd) {
    my ($stdout, $stderr);
    run3(\@cmd, \undef, \$stdout, \$stderr);
    if ($?) {
        die "Command failed (exit $?): $stderr\n";
    }
    return $stdout;
}

# Bad: String form — shell injection!
sub bad_search($pattern) {
    system("grep -r '$pattern' /var/log/app/");  # If $pattern = "'; rm -rf / #"
}

# Bad: Backticks with interpolation
my $output = `ls $user_dir`;   # Shell injection risk
```

也可以使用 `Capture::Tiny` 安全地捕获外部命令的标准输出和标准错误。

## SQL 注入预防

### DBI 占位符

```perl
use v5.36;
use DBI;

my $dbh = DBI->connect($dsn, $user, $pass, {
    RaiseError => 1,
    PrintError => 0,
    AutoCommit => 1,
});

# Good: Parameterized queries — always use placeholders
sub find_user($dbh, $email) {
    my $sth = $dbh->prepare('SELECT * FROM users WHERE email = ?');
    $sth->execute($email);
    return $sth->fetchrow_hashref;
}

sub search_users($dbh, $name, $status) {
    my $sth = $dbh->prepare(
        'SELECT * FROM users WHERE name LIKE ? AND status = ? ORDER BY name'
    );
    $sth->execute("%$name%", $status);
    return $sth->fetchall_arrayref({});
}

# Bad: String interpolation in SQL (SQLi vulnerability!)
sub bad_find($dbh, $email) {
    my $sth = $dbh->prepare("SELECT * FROM users WHERE email = '$email'");
    # If $email = "' OR 1=1 --", returns all users
    $sth->execute;
    return $sth->fetchrow_hashref;
}
```

### 动态列允许列表

```perl
use v5.36;

# Good: Validate column names against an allowlist
sub order_by($dbh, $column, $direction) {
    my %allowed_cols = map { $_ => 1 } qw(name email created_at);
    my %allowed_dirs = map { $_ => 1 } qw(ASC DESC);

    die "Invalid column: $column\n"    unless $allowed_cols{$column};
    die "Invalid direction: $direction\n" unless $allowed_dirs{uc $direction};

    my $sth = $dbh->prepare("SELECT * FROM users ORDER BY $column $direction");
    $sth->execute;
    return $sth->fetchall_arrayref({});
}

# Bad: Directly interpolating user-chosen column
sub bad_order($dbh, $column) {
    $dbh->prepare("SELECT * FROM users ORDER BY $column");  # SQLi!
}
```

### DBIx::Class（ORM 安全性）

```perl
use v5.36;

# DBIx::Class generates safe parameterized queries
my @users = $schema->resultset('User')->search({
    status => 'active',
    email  => { -like => '%@example.com' },
}, {
    order_by => { -asc => 'name' },
    rows     => 50,
});
```

## Web 安全

### XSS 预防

```perl
use v5.36;
use HTML::Entities qw(encode_entities);
use URI::Escape qw(uri_escape_utf8);

# Good: Encode output for HTML context
sub safe_html($user_input) {
    return encode_entities($user_input);
}

# Good: Encode for URL context
sub safe_url_param($value) {
    return uri_escape_utf8($value);
}

# Good: Encode for JSON context
use JSON::MaybeXS qw(encode_json);
sub safe_json($data) {
    return encode_json($data);  # Handles escaping
}

# Template auto-escaping (Mojolicious)
# <%= $user_input %>   — auto-escaped (safe)
# <%== $raw_html %>    — raw output (dangerous, use only for trusted content)

# Template auto-escaping (Template Toolkit)
# [% user_input | html %]  — explicit HTML encoding

# Bad: Raw output in HTML
sub bad_html($input) {
    print "<div>$input</div>";  # XSS if $input contains <script>
}
```

### CSRF 保护

```perl
use v5.36;
use Crypt::URandom qw(urandom);
use MIME::Base64 qw(encode_base64url);

sub generate_csrf_token() {
    return encode_base64url(urandom(32));
}
```

验证令牌时使用恒定时间比较。大多数 Web 框架（Mojolicious、Dancer2、Catalyst）都提供内置的 CSRF 保护——优先使用这些而非自行实现的解决方案。

### 会话和标头安全

```perl
use v5.36;

# Mojolicious session + headers
$app->secrets(['long-random-secret-rotated-regularly']);
$app->sessions->secure(1);          # HTTPS only
$app->sessions->samesite('Lax');

$app->hook(after_dispatch => sub ($c) {
    $c->res->headers->header('X-Content-Type-Options' => 'nosniff');
    $c->res->headers->header('X-Frame-Options'        => 'DENY');
    $c->res->headers->header('Content-Security-Policy' => "default-src 'self'");
    $c->res->headers->header('Strict-Transport-Security' => 'max-age=31536000; includeSubDomains');
});
```

## 输出编码

始终根据上下文对输出进行编码：HTML 使用 `HTML::Entities::encode_entities()`，URL 使用 `URI::Escape::uri_escape_utf8()`，JSON 使用 `JSON::MaybeXS::encode_json()`。

## CPAN 模块安全

* **固定版本** 在 cpanfile 中：`requires 'DBI', '== 1.643';`
* **优先使用维护中的模块**：在 MetaCPAN 上检查最新发布版本
* **最小化依赖项**：每个依赖项都是一个攻击面

## 安全工具

### perlcritic 安全策略

```ini
# .perlcriticrc — security-focused configuration
severity = 3
theme = security + core

# Require three-arg open
[InputOutput::RequireThreeArgOpen]
severity = 5

# Require checked system calls
[InputOutput::RequireCheckedSyscalls]
functions = :builtins
severity = 4

# Prohibit string eval
[BuiltinFunctions::ProhibitStringyEval]
severity = 5

# Prohibit backtick operators
[InputOutput::ProhibitBacktickOperators]
severity = 4

# Require taint checking in CGI
[Modules::RequireTaintChecking]
severity = 5

# Prohibit two-arg open
[InputOutput::ProhibitTwoArgOpen]
severity = 5

# Prohibit bare-word filehandles
[InputOutput::ProhibitBarewordFileHandles]
severity = 5
```

### 运行 perlcritic

```bash
# Check a file
perlcritic --severity 3 --theme security lib/MyApp/Handler.pm

# Check entire project
perlcritic --severity 3 --theme security lib/

# CI integration
perlcritic --severity 4 --theme security --quiet lib/ || exit 1
```

## 快速安全检查清单

| 检查项 | 需验证的内容 |
|---|---|
| 污染模式 | CGI/web 脚本上使用 `-T` 标志 |
| 输入验证 | 允许列表模式，长度限制 |
| 文件操作 | 三参数 open，路径遍历检查 |
| 进程执行 | 列表形式的 system，无 shell 插值 |
| SQL 查询 | DBI 占位符，绝不插值 |
| HTML 输出 | `encode_entities()`，模板自动转义 |
| CSRF 令牌 | 生成令牌，并在状态更改请求时验证 |
| 会话配置 | 安全、HttpOnly、SameSite Cookie |
| HTTP 标头 | CSP、X-Frame-Options、HSTS |
| 依赖项 | 固定版本，已审计模块 |
| 正则表达式安全 | 无嵌套量词，锚定模式 |
| 错误消息 | 不向用户泄露堆栈跟踪或路径 |

## 反模式

```perl
# 1. Two-arg open with user data (command injection)
open my $fh, $user_input;               # CRITICAL vulnerability

# 2. String-form system (shell injection)
system("convert $user_file output.png"); # CRITICAL vulnerability

# 3. SQL string interpolation
$dbh->do("DELETE FROM users WHERE id = $id");  # SQLi

# 4. eval with user input (code injection)
eval $user_code;                         # Remote code execution

# 5. Trusting $ENV without sanitizing
my $path = $ENV{UPLOAD_DIR};             # Could be manipulated
system("ls $path");                      # Double vulnerability

# 6. Disabling taint without validation
($input) = $input =~ /(.*)/s;           # Lazy untaint — defeats purpose

# 7. Raw user data in HTML
print "<div>Welcome, $username!</div>";  # XSS

# 8. Unvalidated redirects
print $cgi->redirect($user_url);         # Open redirect
```

**请记住**：Perl 的灵活性很强大，但需要纪律。对面向 Web 的代码使用污染模式，使用允许列表验证所有输入，对每个查询使用 DBI 占位符，并根据上下文对所有输出进行编码。纵深防御——绝不依赖单一防护层。
