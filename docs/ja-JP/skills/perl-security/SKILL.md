---
name: perl-security
description: テイントモード、入力バリデーション、安全なプロセス実行、DBIパラメータ化クエリ、Webセキュリティ（XSS/SQLi/CSRF）、perlcriticセキュリティポリシーを網羅する包括的なPerlセキュリティ。
origin: ECC
---

# Perlセキュリティパターン

入力バリデーション、インジェクション防止、セキュアコーディングプラクティスを網羅するPerlアプリケーションの包括的なセキュリティガイドライン。

## アクティベートするタイミング

- Perlアプリケーションでユーザー入力を処理するとき
- PerlのWebアプリケーション（CGI、Mojolicious、Dancer2、Catalyst）を構築するとき
- セキュリティ脆弱性についてPerlコードをレビューするとき
- ユーザー指定パスでファイル操作を実行するとき
- PerlからシステムコマンドをExecuteするとき
- DBIデータベースクエリを書くとき

## 仕組み

テイント対応の入力境界から始め、次に外側に移動する: 入力をバリデートしてアンテイントし、ファイルシステムとプロセス実行を制約内に保ち、どこでもパラメータ化されたDBIクエリを使用する。以下の例は、ユーザー入力、シェル、またはネットワークに触れるPerlコードをリリースする前に適用することが期待されるデフォルトを示す。

## テイントモード

Perlのテイントモード（`-T`）は外部ソースからのデータを追跡し、明示的なバリデーションなしに安全でない操作で使用されることを防ぐ。

### テイントモードの有効化

```perl
#!/usr/bin/perl -T
use v5.36;

# テイントされた: プログラム外からのもの
my $input    = $ARGV[0];        # テイントされた
my $env_path = $ENV{PATH};      # テイントされた
my $form     = <STDIN>;         # テイントされた
my $query    = $ENV{QUERY_STRING}; # テイントされた

# PATHを早期にサニタイズ（テイントモードで必要）
$ENV{PATH} = '/usr/local/bin:/usr/bin:/bin';
delete @ENV{qw(IFS CDPATH ENV BASH_ENV)};
```

### アンテイントパターン

```perl
use v5.36;

# Good: 特定の正規表現でバリデートしてアンテイント
sub untaint_username($input) {
    if ($input =~ /^([a-zA-Z0-9_]{3,30})$/) {
        return $1;  # $1はアンテイントされている
    }
    die "Invalid username: must be 3-30 alphanumeric characters\n";
}

# Good: ファイルパスをバリデートしてアンテイント
sub untaint_filename($input) {
    if ($input =~ m{^([a-zA-Z0-9._-]+)$}) {
        return $1;
    }
    die "Invalid filename: contains unsafe characters\n";
}

# Bad: 過度に許可的なアンテイント（目的を無効化する）
sub bad_untaint($input) {
    $input =~ /^(.*)$/s;
    return $1;  # 何でも受け入れる — 無意味
}
```

## 入力バリデーション

### ブロックリストよりアローリスト

```perl
use v5.36;

# Good: アローリスト — 許可されるものを正確に定義
sub validate_sort_field($field) {
    my %allowed = map { $_ => 1 } qw(name email created_at updated_at);
    die "Invalid sort field: $field\n" unless $allowed{$field};
    return $field;
}

# Good: 特定のパターンでバリデート
sub validate_email($email) {
    if ($email =~ /^([a-zA-Z0-9._%+-]+\@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/) {
        return $1;
    }
    die "Invalid email address\n";
}

sub validate_integer($input) {
    if ($input =~ /^(-?\d{1,10})$/) {
        return $1 + 0;  # 数値に強制変換
    }
    die "Invalid integer\n";
}

# Bad: ブロックリスト — 常に不完全
sub bad_validate($input) {
    die "Invalid" if $input =~ /[<>"';&|]/;  # エンコードされた攻撃を見逃す
    return $input;
}
```

### 長さ制約

```perl
use v5.36;

sub validate_comment($text) {
    die "Comment is required\n"        unless length($text) > 0;
    die "Comment exceeds 10000 chars\n" if length($text) > 10_000;
    return $text;
}
```

## 安全な正規表現

### ReDoS防止

壊滅的なバックトラッキングは重複するパターンにネストされた量詞が使用されるときに発生する。

```perl
use v5.36;

# Bad: ReDoSに脆弱（指数的バックトラッキング）
my $bad_re = qr/^(a+)+$/;           # ネストされた量詞
my $bad_re2 = qr/^([a-zA-Z]+)*$/;   # クラスにネストされた量詞
my $bad_re3 = qr/^(.*?,){10,}$/;    # 繰り返される貪欲/怠惰な組み合わせ

# Good: ネストなしで書き直す
my $good_re = qr/^a+$/;             # 単一の量詞
my $good_re2 = qr/^[a-zA-Z]+$/;     # クラスに単一の量詞

# Good: バックトラッキングを防ぐためにpossessive量詞またはアトミックグループを使用
my $safe_re = qr/^[a-zA-Z]++$/;             # Possessive (5.10+)
my $safe_re2 = qr/^(?>a+)$/;                # アトミックグループ

# Good: 信頼されていないパターンにタイムアウトを適用
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

## 安全なファイル操作

### 3引数open

```perl
use v5.36;

# Good: 3引数open、レキシカルファイルハンドル、戻り値チェック
sub read_file($path) {
    open my $fh, '<:encoding(UTF-8)', $path
        or die "Cannot open '$path': $!\n";
    local $/;
    my $content = <$fh>;
    close $fh;
    return $content;
}

# Bad: ユーザーデータを使った2引数open（コマンドインジェクション）
sub bad_read($path) {
    open my $fh, $path;        # $pathが"|rm -rf /"なら、コマンドを実行！
    open my $fh, "< $path";   # シェルメタキャラクターインジェクション
}
```

### TOCTOU防止とパストラバーサル

```perl
use v5.36;
use Fcntl qw(:DEFAULT :flock);
use File::Spec;
use Cwd qw(realpath);

# アトミックファイル作成
sub create_file_safe($path) {
    sysopen(my $fh, $path, O_WRONLY | O_CREAT | O_EXCL, 0600)
        or die "Cannot create '$path': $!\n";
    return $fh;
}

# パスが許可されたディレクトリ内に留まることをバリデート
sub safe_path($base_dir, $user_path) {
    my $real = realpath(File::Spec->catfile($base_dir, $user_path))
        // die "Path does not exist\n";
    my $base_real = realpath($base_dir)
        // die "Base dir does not exist\n";
    die "Path traversal blocked\n" unless $real =~ /^\Q$base_real\E(?:\/|\z)/;
    return $real;
}
```

一時ファイルには`File::Temp`（`tempfile(UNLINK => 1)`）を使用し、レースコンディションを防ぐために`flock(LOCK_EX)`を使用する。

## 安全なプロセス実行

### リスト形式のsystemとexec

```perl
use v5.36;

# Good: リスト形式 — シェル補間なし
sub run_command(@cmd) {
    system(@cmd) == 0
        or die "Command failed: @cmd\n";
}

run_command('grep', '-r', $user_pattern, '/var/log/app/');

# Good: IPC::Run3で安全に出力をキャプチャ
use IPC::Run3;
sub capture_output(@cmd) {
    my ($stdout, $stderr);
    run3(\@cmd, \undef, \$stdout, \$stderr);
    if ($?) {
        die "Command failed (exit $?): $stderr\n";
    }
    return $stdout;
}

# Bad: 文字列形式 — シェルインジェクション！
sub bad_search($pattern) {
    system("grep -r '$pattern' /var/log/app/");  # $patternが"'; rm -rf / #"なら
}

# Bad: 補間のあるバッククォート
my $output = `ls $user_dir`;   # シェルインジェクションリスク
```

外部コマンドからstdout/stderrを安全にキャプチャするためには`Capture::Tiny`も使用する。

## SQLインジェクション防止

### DBIプレースホルダー

```perl
use v5.36;
use DBI;

my $dbh = DBI->connect($dsn, $user, $pass, {
    RaiseError => 1,
    PrintError => 0,
    AutoCommit => 1,
});

# Good: パラメータ化クエリ — 常にプレースホルダーを使用
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

# Bad: SQLでの文字列補間（SQLi脆弱性！）
sub bad_find($dbh, $email) {
    my $sth = $dbh->prepare("SELECT * FROM users WHERE email = '$email'");
    # $emailが"' OR 1=1 --"なら、すべてのユーザーが返される
    $sth->execute;
    return $sth->fetchrow_hashref;
}
```

### 動的カラムアローリスト

```perl
use v5.36;

# Good: アローリストに対してカラム名をバリデート
sub order_by($dbh, $column, $direction) {
    my %allowed_cols = map { $_ => 1 } qw(name email created_at);
    my %allowed_dirs = map { $_ => 1 } qw(ASC DESC);

    die "Invalid column: $column\n"    unless $allowed_cols{$column};
    die "Invalid direction: $direction\n" unless $allowed_dirs{uc $direction};

    my $sth = $dbh->prepare("SELECT * FROM users ORDER BY $column $direction");
    $sth->execute;
    return $sth->fetchall_arrayref({});
}

# Bad: ユーザー選択カラムを直接補間
sub bad_order($dbh, $column) {
    $dbh->prepare("SELECT * FROM users ORDER BY $column");  # SQLi！
}
```

### DBIx::Class（ORM安全性）

```perl
use v5.36;

# DBIx::Classは安全なパラメータ化クエリを生成する
my @users = $schema->resultset('User')->search({
    status => 'active',
    email  => { -like => '%@example.com' },
}, {
    order_by => { -asc => 'name' },
    rows     => 50,
});
```

## Webセキュリティ

### XSS防止

```perl
use v5.36;
use HTML::Entities qw(encode_entities);
use URI::Escape qw(uri_escape_utf8);

# Good: HTMLコンテキスト用に出力をエンコード
sub safe_html($user_input) {
    return encode_entities($user_input);
}

# Good: URLコンテキスト用にエンコード
sub safe_url_param($value) {
    return uri_escape_utf8($value);
}

# Good: JSONコンテキスト用にエンコード
use JSON::MaybeXS qw(encode_json);
sub safe_json($data) {
    return encode_json($data);  # エスケープを処理
}

# テンプレートの自動エスケープ（Mojolicious）
# <%= $user_input %>   — 自動エスケープ（安全）
# <%== $raw_html %>    — 生の出力（危険、信頼されたコンテンツのみ）

# テンプレートの自動エスケープ（Template Toolkit）
# [% user_input | html %]  — 明示的なHTMLエンコード

# Bad: HTMLの生の出力
sub bad_html($input) {
    print "<div>$input</div>";  # $inputが<script>を含む場合XSS
}
```

### CSRF保護

```perl
use v5.36;
use Crypt::URandom qw(urandom);
use MIME::Base64 qw(encode_base64url);

sub generate_csrf_token() {
    return encode_base64url(urandom(32));
}
```

トークンを検証するときは定数時間比較を使用する。ほとんどのWebフレームワーク（Mojolicious、Dancer2、Catalyst）には組み込みのCSRF保護がある — 手作りのソリューションよりそれらを優先する。

### セッションとヘッダーセキュリティ

```perl
use v5.36;

# Mojolicousセッション + ヘッダー
$app->secrets(['long-random-secret-rotated-regularly']);
$app->sessions->secure(1);          # HTTPSのみ
$app->sessions->samesite('Lax');

$app->hook(after_dispatch => sub ($c) {
    $c->res->headers->header('X-Content-Type-Options' => 'nosniff');
    $c->res->headers->header('X-Frame-Options'        => 'DENY');
    $c->res->headers->header('Content-Security-Policy' => "default-src 'self'");
    $c->res->headers->header('Strict-Transport-Security' => 'max-age=31536000; includeSubDomains');
});
```

## 出力エンコード

常に出力をそのコンテキスト用にエンコードする: HTML用には`HTML::Entities::encode_entities()`、URL用には`URI::Escape::uri_escape_utf8()`、JSON用には`JSON::MaybeXS::encode_json()`。

## CPANモジュールセキュリティ

- cpanfileで**バージョンをピン留め**: `requires 'DBI', '== 1.643';`
- **メンテナンスされたモジュールを優先**: MetaCPANで最近のリリースを確認
- **依存関係を最小化**: 各依存関係は攻撃面積

## セキュリティツーリング

### perlcriticセキュリティポリシー

```ini
# .perlcriticrc — セキュリティ重視の設定
severity = 3
theme = security + core

# 3引数openを要求
[InputOutput::RequireThreeArgOpen]
severity = 5

# チェックされたシステムコールを要求
[InputOutput::RequireCheckedSyscalls]
functions = :builtins
severity = 4

# 文字列evalを禁止
[BuiltinFunctions::ProhibitStringyEval]
severity = 5

# バッククォート演算子を禁止
[InputOutput::ProhibitBacktickOperators]
severity = 4

# CGIでテイントチェックを要求
[Modules::RequireTaintChecking]
severity = 5

# 2引数openを禁止
[InputOutput::ProhibitTwoArgOpen]
severity = 5

# 裸のファイルハンドルを禁止
[InputOutput::ProhibitBarewordFileHandles]
severity = 5
```

### perlcriticの実行

```bash
# ファイルをチェック
perlcritic --severity 3 --theme security lib/MyApp/Handler.pm

# プロジェクト全体をチェック
perlcritic --severity 3 --theme security lib/

# CI統合
perlcritic --severity 4 --theme security --quiet lib/ || exit 1
```

## クイックセキュリティチェックリスト

| チェック | 確認事項 |
|---|---|
| テイントモード | CGI/Webスクリプトの`-T`フラグ |
| 入力バリデーション | アローリストパターン、長さ制限 |
| ファイル操作 | 3引数open、パストラバーサルチェック |
| プロセス実行 | リスト形式のsystem、シェル補間なし |
| SQLクエリ | DBIプレースホルダー、補間しない |
| HTML出力 | `encode_entities()`、テンプレート自動エスケープ |
| CSRFトークン | 生成され、状態変更リクエストで検証される |
| セッション設定 | Secure、HttpOnly、SameSiteクッキー |
| HTTPヘッダー | CSP、X-Frame-Options、HSTS |
| 依存関係 | ピン留めされたバージョン、監査されたモジュール |
| 正規表現の安全性 | ネストされた量詞なし、アンカーされたパターン |
| エラーメッセージ | スタックトレースやパスがユーザーに漏れない |

## アンチパターン

```perl
# 1. ユーザーデータを使った2引数open（コマンドインジェクション）
open my $fh, $user_input;               # CRITICAL脆弱性

# 2. 文字列形式のsystem（シェルインジェクション）
system("convert $user_file output.png"); # CRITICAL脆弱性

# 3. SQL文字列補間
$dbh->do("DELETE FROM users WHERE id = $id");  # SQLi

# 4. ユーザー入力でのeval（コードインジェクション）
eval $user_code;                         # リモートコード実行

# 5. サニタイズせずに$ENVを信頼する
my $path = $ENV{UPLOAD_DIR};             # 操作される可能性がある
system("ls $path");                      # 二重脆弱性

# 6. バリデーションなしにテイントを無効化
($input) = $input =~ /(.*)/s;           # 怠惰なアンテイント — 目的を無効化

# 7. HTMLでの生のユーザーデータ
print "<div>Welcome, $username!</div>";  # XSS

# 8. 未バリデートのリダイレクト
print $cgi->redirect($user_url);         # オープンリダイレクト
```

**忘れないこと**: Perlの柔軟性は強力だが規律が必要。Webに面したコードにはテイントモードを使用し、アローリストですべての入力をバリデートし、すべてのクエリにDBIプレースホルダーを使用し、すべての出力をそのコンテキスト用にエンコードする。多層防御 — 単一の層に依存しない。
