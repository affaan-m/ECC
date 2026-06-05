---
name: perl-testing
description: Perl testing patterns using Test2::V0, Test::More, prove runner, mocking, coverage with Devel::Cover, and TDD methodology.
origin: ECC
---

# Perl Testing Patterns

Comprehensive testing strategies for Perl applications using Test2::V0, Test::More, prove, and TDD methodology.

## When to Activate

- Writing new Perl code (follow TDD: red, green, refactor)
- Designing test suites for Perl modules or applications
- Reviewing Perl test coverage
- Setting up Perl testing infrastructure
- Migrating tests from Test::More to Test2::V0
- Debugging failing Perl tests

## TDD Workflow

Always follow the RED-GREEN-REFACTOR cycle.

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

## Test::More Fundamentals

The standard Perl testing module — widely used, ships with core.

### Basic Assertions

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

### SKIP and TODO

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

## Test2::V0 Modern Framework

Test2::V0 is the modern replacement for Test::More — richer assertions, better diagnostics, and extensible.

### Why Test2?

- Superior deep comparison with hash/array builders
- Better diagnostic output on failures
- Subtests with cleaner scoping
- Extensible via Test2::Tools::* plugins
- Backward-compatible with Test::More tests

### Deep Comparison with Builders

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

### Subtests

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

### Exception Testing with Test2

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

## Test Organization and prove

### Directory Structure

```text
t/
├── 00-load.t              # Verify modules compile
├── 01-basic.t             # Core functionality
├── unit/
│   ├── config.t           # Unit tests by module
│   ├── user.t
│   └── util.t
├── integration/
│   ├── database.t
│   └── api.t
├── lib/
│   └── TestHelper.pm      # Shared test utilities
└── fixtures/
    ├── config.json        # Test data files
    └── users.csv
```

### prove Commands

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

### .proverc Configuration

```text
-l
--color
--timer
-r
-j4
--state=save
```

## Fixtures and Setup/Teardown

### Subtest Isolation

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

### Shared Test Helpers

Place reusable helpers in `t/lib/TestHelper.pm` and load with `use lib 't/lib'`. Export factory functions like `create_test_db()`, `create_temp_dir()`, and `fixture_path()` via `Exporter`.

## Mocking

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

For lightweight mock objects, use `Test::MockObject` to create injectable test doubles with `->mock()` and verify calls with `->called_ok()`.

## Coverage with Devel::Cover

### Running Coverage

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

### Integration Testing

Use in-memory SQLite for database tests, mock HTTP::Tiny for API tests.

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

## Best Practices

### DO

- **Follow TDD**: Write tests before implementation (red-green-refactor)
- **Use Test2::V0**: Modern assertions, better diagnostics
- **Use subtests**: Group related assertions, isolate state
- **Mock external dependencies**: Network, database, file system
- **Use `prove -l`**: Always include lib/ in `@INC`
- **Name tests clearly**: `'user login with invalid password fails'`
- **Test edge cases**: Empty strings, undef, zero, boundary values
- **Aim for 80%+ coverage**: Focus on business logic paths
- **Keep tests fast**: Mock I/O, use in-memory databases

### DON'T

- **Don't test implementation**: Test behavior and output, not internals
- **Don't share state between subtests**: Each subtest should be independent
- **Don't skip `done_testing`**: Ensures all planned tests ran
- **Don't over-mock**: Mock boundaries only, not the code under test
- **Don't use `Test::More` for new projects**: Prefer Test2::V0
- **Don't ignore test failures**: All tests must pass before merge
- **Don't test CPAN modules**: Trust libraries to work correctly
- **Don't write brittle tests**: Avoid over-specific string matching

## Quick Reference

| Task | Command / Pattern |
|---|---|
| Run all tests | `prove -lr t/` |
| Run one test verbose | `prove -lv t/unit/user.t` |
| Parallel test run | `prove -lr -j8 t/` |
| Coverage report | `cover -test && cover -report html` |
| Test equality | `is($got, $expected, 'label')` |
| Deep comparison | `is($got, hash { field k => 'v'; etc() }, 'label')` |
| Test exception | `like(dies { ... }, qr/msg/, 'label')` |
| Test no exception | `ok(lives { ... }, 'label')` |
| Mock a method | `Test::MockModule->new('Pkg')->mock(m => sub { ... })` |
| Skip tests | `SKIP: { skip 'reason', $count unless $cond; ... }` |
| TODO tests | `TODO: { local $TODO = 'reason'; ... }` |

## Common Pitfalls

### Forgetting `done_testing`

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

### Missing `-l` Flag

```bash
# Bad: Modules in lib/ not found
prove t/unit/user.t
# Can't locate MyApp/User.pm in @INC

# Good: Include lib/ in @INC
prove -l t/unit/user.t
```

### Over-Mocking

Mock the *dependency*, not the code under test. If your test only verifies that a mock returns what you told it to, it tests nothing.

### Test Pollution

Use `my` variables inside subtests — never `our` — to prevent state leaking between tests.

**Remember**: Tests are your safety net. Keep them fast, focused, and independent. Use Test2::V0 for new projects, prove for running, and Devel::Cover for accountability.
