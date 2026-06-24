---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---
# Perl パターン

> このファイルは [common/patterns.md](../common/patterns.md) を Perl 固有のコンテンツで拡張します。

## リポジトリパターン

**DBI** または **DBIx::Class** をインターフェースの背後に使用する:

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

## DTO / 値オブジェクト

**Moo** クラスと **Types::Standard** を使用する（Python の dataclass に相当）:

```perl
package MyApp::DTO::User;
use Moo;
use Types::Standard qw(Str Int);

has name  => (is => 'ro', isa => Str, required => 1);
has email => (is => 'ro', isa => Str, required => 1);
has age   => (is => 'ro', isa => Int);
```

## リソース管理

- 常に `autodie` 付きの **3引数 open** を使用する
- ファイル操作には **Path::Tiny** を使用する

```perl
use autodie;
use Path::Tiny;

my $content = path('config.json')->slurp_utf8;
```

## モジュールインターフェース

`Exporter 'import'` と `@EXPORT_OK` を使用する — `@EXPORT` は使用しない:

```perl
use Exporter 'import';
our @EXPORT_OK = qw(parse_config validate_input);
```

## 依存関係管理

再現可能なインストールのために **cpanfile** + **carton** を使用する:

```bash
carton install
carton exec prove -lr t/
```

## リファレンス

スキル: `perl-patterns` で包括的なモダン Perl のパターンとイディオムを参照してください。
