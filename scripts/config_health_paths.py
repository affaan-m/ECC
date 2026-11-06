"""Path resolution and defensive reads for the config-health monitor."""

import json
import os

from config_health_constants import (
    AUDIT_MISSING,
    AUDIT_OK,
    AUDIT_SKIP,
    PLACEHOLDER_RE,
    PLUGIN_ROOT_ENV,
    PLUGIN_ROOT_OVERRIDE_ENV,
)


def resolve_dirs():
    """Return (user_home, project_dir) honoring env overrides for determinism."""
    user_home = os.environ.get('CONFIG_HEALTH_USER_HOME') or os.path.expanduser('~')
    project_dir = os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd()
    return user_home, project_dir


def claude_data_dir(user_home):
    """Claude's user data root: CLAUDE_CONFIG_DIR when set, else ~/.claude.

    Claude Code reads user settings from this directory, and launchers move it
    with CLAUDE_CONFIG_DIR. Reading ~/.claude unconditionally would audit a
    file the harness is not loading, which is worse than not auditing at all.
    """
    configured = os.environ.get('CLAUDE_CONFIG_DIR')
    if configured:
        return os.path.abspath(os.path.expanduser(configured))
    return os.path.join(user_home, '.claude')


def read_text(path):
    """Read a file defensively; return None on any read/decode error."""
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


def read_json(path):
    """Parse a JSON file defensively; return None if missing or malformed."""
    text = read_text(path)
    if text is None:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def placeholder_env(project_dir, user_home):
    """Explicit map of the placeholders this monitor is willing to resolve.

    Deliberately an allowlist rather than a copy of ``os.environ``: a hook
    command can contain a provider placeholder we cannot judge, and resolving
    an arbitrary one from ambient shell state would make findings depend on
    unrelated environment. The two provider names below are the exception,
    and only because a plugin install cannot be audited without them — both
    are overridable so an audit can be pinned rather than inherited.

    ``$HOME`` / ``$USERPROFILE`` resolve to ``user_home``, the same value
    ``~`` resolves to, so ``$HOME/x.py`` and ``~/x.py`` are judged alike.

    Args:
        project_dir (`str`): Absolute project directory.
        user_home (`str`): Absolute user home directory.

    Returns:
        `dict`: Placeholder name to absolute directory.
    """
    env = {
        'CLAUDE_PROJECT_DIR': project_dir,
        'HOME': user_home,
        'USERPROFILE': user_home,
    }
    plugin_root = (
        os.environ.get(PLUGIN_ROOT_OVERRIDE_ENV)
        or os.environ.get(PLUGIN_ROOT_ENV)
    )
    if plugin_root:
        # abspath(expanduser(...)): the audited roots are normalized against
        # the process cwd, so a `~`-prefixed or relative plugin root would
        # silently stop being the plugin root at the containment check.
        env[PLUGIN_ROOT_ENV] = os.path.abspath(os.path.expanduser(plugin_root))
    return env


def audit_roots(project_dir, user_home, env):
    """Directories a resolved hook script is allowed to live under.

    Normalized once per audit: the roots do not change within a run, and
    re-normalizing them per token is what made the first cut of this
    containment check measurably slower than the audit it replaced.
    """
    roots = [project_dir, user_home]
    plugin_root = env.get(PLUGIN_ROOT_ENV)
    if plugin_root:
        roots.append(plugin_root)
    return [_normalize(r) for r in roots]


def _normalize(path):
    """Absolute, separator-normalized, case-normalized form of `path`."""
    if not os.path.isabs(path):
        path = os.path.join(os.getcwd(), path)
    return os.path.normcase(os.path.normpath(path))


def is_within(path, roots):
    """Whether `path` is one of `roots` or lives under one of them."""
    target = _normalize(path)
    for base in roots:
        if target == base:
            return True
        if target.startswith(base.rstrip(os.sep) + os.sep):
            return True
    return False


def expand_placeholders(raw, env, single_quoted=False):
    """Expand the placeholders present in `env`, leaving the rest intact.

    Args:
        raw (`str`): A script token from a hook command.
        env (`dict`): Placeholder name to replacement, from
            :func:`placeholder_env`.
        single_quoted (`bool`): Whether the token sat inside single quotes.
            The shell does not expand those, so no path can be built from
            them and the token is treated as unresolvable.

    Returns:
        `tuple[str, list[str], bool]`: The expanded token, the names of any
        placeholders that could not be resolved, and whether anything was
        actually substituted. A token carrying an unresolved placeholder is
        skipped rather than reported as missing — we cannot tell a missing
        script from a path we failed to build.
    """
    unresolved = []

    def _replace(match):
        name = match.group(1)
        if name not in env or single_quoted:
            unresolved.append(name)
            return match.group(0)
        return env[name]

    expanded = PLACEHOLDER_RE.sub(_replace, raw)
    return expanded, unresolved, expanded != raw


def resolve_script_path(raw, project_dir, user_home, env, roots,
                        single_quoted=False):
    """Turn a token from a hook command into the paths we are willing to judge.

    `~` resolves against CONFIG_HEALTH_USER_HOME when set (the same override
    used for the user settings path), else the real home — so tests stay
    deterministic without affecting real users.

    The containment check applies to substituted paths only. A bare relative
    path is not confined to the audited roots: a hook command does not say
    which directory it runs from (plugin commands run from the plugin root,
    project wiring from the project), so such a token is resolved under every
    audited root and reported only when it is missing from all of them. An
    absolute or `~` path outside the roots is still reported — that is a real
    path to a real file, and the monitor has no reason to stay quiet about it.

    Args:
        raw (`str`): A script token from a hook command.
        project_dir (`str`): Absolute project directory.
        user_home (`str`): Absolute user home directory.
        env (`dict`): Supported placeholder replacements.
        roots (`list[str]`): Pre-normalized audited roots, from
            :func:`audit_roots`.
        single_quoted (`bool`): Whether the token sat inside single quotes.

    Returns:
        `tuple[list[str], str, bool]`: The candidate paths, a status (see
            :data:`AUDIT_OK`, :data:`AUDIT_MISSING`, :data:`AUDIT_SKIP`), and
            whether the token was a bare relative path judged against every
            root. That last flag is what lets `--check` name the one case where
            "healthy" and "the project copy is missing" look identical.

            ``'ok'``     — at least one candidate exists on disk.
            ``'missing'`` — no candidate exists; report the token.
            ``'skip'``   — no path could be built (an unresolvable or
                           single-quoted placeholder, or a substituted path
                           outside the audited roots). Reporting these is
                           how a plugin install turns into a false-warning
                           flood, and a monitor that cries wolf is worse than
                           no monitor.
    """
    expanded, unresolved, changed = expand_placeholders(
        raw, env, single_quoted,
    )
    if unresolved:
        return [], AUDIT_SKIP, False

    if expanded.startswith('~'):
        override = os.environ.get('CONFIG_HEALTH_USER_HOME')
        base = override if override else os.path.expanduser('~')
        candidates = [os.path.join(base, expanded[1:].lstrip('/\\'))]
        relative = False
    elif os.path.isabs(expanded):
        candidates = [expanded]
        relative = False
    else:
        candidates = [os.path.join(root, expanded) for root in roots]
        relative = True

    if changed and not all(is_within(c, roots) for c in candidates):
        return [], AUDIT_SKIP, relative

    existing = []
    for candidate in candidates:
        if os.path.exists(candidate):
            existing.append(candidate)
            break
    if existing:
        return existing, AUDIT_OK, relative
    return candidates, AUDIT_MISSING, relative
