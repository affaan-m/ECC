---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---

# Perl 模式

> 本文档在 [common/patterns.md](../common/patterns.md) 的基础上扩展了 Perl 特定的内容。

## 仓储模式

在接口背后使用 **DBI** 或 **DBIx::Class**：

```perl
package MyApp::Repo::User;
use Moo;

has dbh => (is => 'ro', required => 1);

sub find_by_id ($self, $id) {
    my $sth = $self->dbh->prepare('SELECT * FROM users WHERE id = ?');
    $sth->execute($id);
    return $sth->fetchrow_hashref;
}
```

## DTOs / 值对象

使用带有 **Types::Standard** 的 **Moo** 类（相当于 Python 的 dataclasses）：

```perl
package MyApp::DTO::User;
use Moo;
use Types::Standard qw(Str Int);

has name  => (is => 'ro', isa => Str, required => 1);
has email => (is => 'ro', isa => Str, required => 1);
has age   => (is => 'ro', isa => Int);
```

## 资源管理

* 始终使用 **三参数 open** 配合 `autodie`
* 使用 **Path::Tiny** 进行文件操作

```perl
use autodie;
use Path::Tiny;

my $content = path('config.json')->slurp_utf8;
```

## 模块接口

使用 `Exporter 'import'` 配合 `@EXPORT_OK` — 绝不使用 `@EXPORT`：

```perl
use Exporter 'import';
our @EXPORT_OK = qw(parse_config validate_input);
```

## 依赖管理

使用 **cpanfile** + **carton** 以实现可复现的安装：

```bash
carton install
carton exec prove -lr t/
```

## 参考

查看技能：`perl-patterns` 以获取全面的现代 Perl 模式和惯用法。
