---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---

# Perl 安全

> 本文档在 [common/security.md](../common/security.md) 的基础上扩展了 Perl 相关的内容。

## 污染模式

* 在所有 CGI/面向 Web 的脚本中使用 `-T` 标志
* 在执行任何外部命令前，清理 `%ENV` (`$ENV{PATH}`、`$ENV{CDPATH}` 等)

## 输入验证

* 使用允许列表正则表达式进行去污化 — 绝不要使用 `/(.*)/s`
* 使用明确的模式验证所有用户输入：

```perl
if ($input =~ /\A([a-zA-Z0-9_-]+)\z/) {
    my $clean = $1;
}
```

## 文件 I/O

* **仅使用三参数 open** — 绝不要使用两参数 open
* 使用 `Cwd::realpath` 防止路径遍历：

```perl
use Cwd 'realpath';
my $safe_path = realpath($user_path);
die "Path traversal" unless $safe_path =~ m{\A/allowed/directory/};
```

## 进程执行

* 使用 **列表形式的 `system()`** — 绝不要使用单字符串形式
* 使用 **IPC::Run3** 来捕获输出
* 绝对不要在反引号中使用变量插值

```perl
system('grep', '-r', $pattern, $directory);  # safe
```

## SQL 注入预防

始终使用 DBI 占位符 — 绝不要将变量插值到 SQL 中：

```perl
my $sth = $dbh->prepare('SELECT * FROM users WHERE email = ?');
$sth->execute($email);
```

## 安全扫描

运行 **perlcritic** 并使用安全主题，严重级别设为 4 或更高：

```bash
perlcritic --severity 4 --theme security lib/
```

## 参考

有关全面的 Perl 安全模式、污染模式和安全 I/O，请参阅技能：`perl-security`。
