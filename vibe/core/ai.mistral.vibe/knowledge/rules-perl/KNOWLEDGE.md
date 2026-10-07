---
name: rules-perl
description: ECC perl engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Perl Rules"
icon: book
---

# ECC Perl Rules

## Perl Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Perl-specific content.

### Standards

- Always `use v5.36` (enables `strict`, `warnings`, `say`, subroutine signatures)
- Use subroutine signatures — never unpack `@_` manually
- Prefer `say` over `print` with explicit newlines

### Immutability

- Use **Moo** with `is => 'ro'` and `Types::Standard` for all attributes
- Never use blessed hashrefs directly — always use Moo/Moose accessors
- **OO override note**: Moo `has` attributes with `builder` or `default` are acceptable for computed read-only values

### Formatting

Use **perltidy** with these settings:

```
-i=4    # 4-space indent
-l=100  # 100 char line length
-ce     # cuddled else
-bar    # opening brace always right
```

### Linting

Use **perlcritic** at severity 3 with themes: `core`, `pbp`, `security`.

```bash
perlcritic --severity 3 --theme 'core || pbp || security' lib/
```

### Reference

See skill: `perl-patterns` for comprehensive modern Perl idioms and best practices.

## Perl Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Perl-specific content.

### PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **perltidy**: Auto-format `.pl` and `.pm` files after edit
- **perlcritic**: Run lint check after editing `.pm` files

### Warnings

- Warn about `print` in non-script `.pm` files — use `say` or a logging module (e.g., `Log::Any`)

## Perl Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Perl-specific content.

### Repository Pattern

Use **DBI** or **DBIx::Class** behind an interface:

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

### DTOs / Value Objects

Use **Moo** classes with **Types::Standard** (equivalent to Python dataclasses):

```perl
package MyApp::DTO::User;
use Moo;
use Types::Standard qw(Str Int);

has name  => (is => 'ro', isa => Str, required => 1);
has email => (is => 'ro', isa => Str, required => 1);
has age   => (is => 'ro', isa => Int);
```

### Resource Management

- Always use **three-arg open** with `autodie`
- Use **Path::Tiny** for file operations

```perl
use autodie;
use Path::Tiny;

my $content = path('config.json')->slurp_utf8;
```

### Module Interface

Use `Exporter 'import'` with `@EXPORT_OK` — never `@EXPORT`:

```perl
use Exporter 'import';
our @EXPORT_OK = qw(parse_config validate_input);
```

### Dependency Management

Use **cpanfile** + **carton** for reproducible installs:

```bash
carton install
carton exec prove -lr t/
```

### Reference

See skill: `perl-patterns` for comprehensive modern Perl patterns and idioms.

## Perl Security

> This file extends [common/security.md](../common/security.md) with Perl-specific content.

### Taint Mode

- Use `-T` flag on all CGI/web-facing scripts
- Sanitize `%ENV` (`$ENV{PATH}`, `$ENV{CDPATH}`, etc.) before any external command

### Input Validation

- Use allowlist regex for untainting — never `/(.*)/s`
- Validate all user input with explicit patterns:

```perl
if ($input =~ /\A([a-zA-Z0-9_-]+)\z/) {
    my $clean = $1;
}
```

### File I/O

- **Three-arg open only** — never two-arg open
- Prevent path traversal with `Cwd::realpath`:

```perl
use Cwd 'realpath';
my $safe_path = realpath($user_path);
die "Path traversal" unless $safe_path =~ m{\A/allowed/directory/};
```

### Process Execution

- Use **list-form `system()`** — never single-string form
- Use **IPC::Run3** for capturing output
- Never use backticks with variable interpolation

```perl
system('grep', '-r', $pattern, $directory);  # safe
```

### SQL Injection Prevention

Always use DBI placeholders — never interpolate into SQL:

```perl
my $sth = $dbh->prepare('SELECT * FROM users WHERE email = ?');
$sth->execute($email);
```

### Security Scanning

Run **perlcritic** with the security theme at severity 4+:

```bash
perlcritic --severity 4 --theme security lib/
```

### Reference

See skill: `perl-security` for comprehensive Perl security patterns, taint mode, and safe I/O.

## Perl Testing

> This file extends [common/testing.md](../common/testing.md) with Perl-specific content.

### Framework

Use **Test2::V0** for new projects (not Test::More):

```perl
use Test2::V0;

is($result, 42, 'answer is correct');

done_testing;
```

### Runner

```bash
prove -l t/              # adds lib/ to @INC
prove -lr -j8 t/         # recursive, 8 parallel jobs
```

Always use `-l` to ensure `lib/` is on `@INC`.

### Coverage

Use **Devel::Cover** — target 80%+:

```bash
cover -test
```

### Mocking

- **Test::MockModule** — mock methods on existing modules
- **Test::MockObject** — create test doubles from scratch

### Pitfalls

- Always end test files with `done_testing`
- Never forget the `-l` flag with `prove`

### Reference

See skill: `perl-testing` for detailed Perl TDD patterns with Test2::V0, prove, and Devel::Cover.
