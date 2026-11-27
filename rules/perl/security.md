---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---
# Perl Security

> This file extends [common/security.md](../common/security.md) with Perl-specific content.

## Taint Mode

- Use `-T` flag on all CGI/web-facing scripts
- Sanitize `%ENV` (`$ENV{PATH}`, `$ENV{CDPATH}`, etc.) before any external command

## Input Validation

- Use allowlist regex for untainting — never `/(.*)/s`
- Validate all user input with explicit patterns:

```perl
if ($input =~ /\A([a-zA-Z0-9_-]+)\z/) {
    my $clean = $1;
}
```

## File I/O

- **Three-arg open only** — never two-arg open
- Prevent path traversal with `Cwd::realpath`:

```perl
use Cwd 'realpath';
my $safe_path = realpath($user_path);
die "Path traversal" unless $safe_path =~ m{\A/allowed/directory/};
```

## Process Execution

- Use **list-form `system()`** — never single-string form
- Use **IPC::Run3** for capturing output
- Never use backticks with variable interpolation

```perl
system('grep', '-r', $pattern, $directory);  # safe
```

## SQL Injection Prevention

Always use DBI placeholders — never interpolate into SQL:

```perl
my $sth = $dbh->prepare('SELECT * FROM users WHERE email = ?');
$sth->execute($email);
```

## Security Scanning

Run **perlcritic** with the security theme at severity 4+:

```bash
perlcritic --severity 4 --theme security lib/
```

## Reference

See skill: `perl-security` for comprehensive Perl security patterns, taint mode, and safe I/O.
