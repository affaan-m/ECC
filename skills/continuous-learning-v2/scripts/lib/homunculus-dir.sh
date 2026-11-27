#!/usr/bin/env bash
# Shared continuous-learning-v2 data-directory resolver.
#
# Resolution precedence:
#   1. CLV2_HOMUNCULUS_DIR, when absolute
#   2. XDG_DATA_HOME/ecc-homunculus, when XDG_DATA_HOME is absolute
#   3. HOME/.local/share/ecc-homunculus

# On MSYS/Cygwin shells a Windows-form absolute path (C:/x or C:\x) does not
# start with "/", but the Node and Python resolvers accept it. Set _clv2_abs to
# $1, converted to the shell's form in that case. Builtins only: this runs on
# every tool call and launching cygpath costs 80-280 ms under Git Bash. WSL is
# left out on purpose: its OSTYPE is linux-gnu and a C:/ path is not usable there.
_clv2_posix_path() {
  _clv2_abs=$1
  case "${OSTYPE:-}" in
    msys*|cygwin*|win32*) ;;
    *) return 0 ;;
  esac
  case "$1" in
    [A-Za-z]:/*|[A-Za-z]:\\*)
      _clv2_abs=${1//\\//}
      # Git Bash and MSYS2 mount drives at /x. Cygwin's drive prefix is
      # configurable (/cygdrive by default, /mnt etc. via fstab), so use
      # /proc/cygdrive, which always points at it.
      case "${OSTYPE:-}" in
        cygwin*) _clv2_abs=/proc/cygdrive/${_clv2_abs%%:*}${_clv2_abs#*:} ;;
        *) _clv2_abs=/${_clv2_abs%%:*}${_clv2_abs#*:} ;;
      esac
      ;;
  esac
}

_clv2_resolve_homunculus_dir() {
  if [ -n "${CLV2_HOMUNCULUS_DIR:-}" ]; then
    _clv2_posix_path "$CLV2_HOMUNCULUS_DIR"
    case "$_clv2_abs" in
      /*) printf '%s\n' "$_clv2_abs"; return 0 ;;
      *) printf '[ecc] CLV2_HOMUNCULUS_DIR=%s is not absolute; ignoring\n' "$CLV2_HOMUNCULUS_DIR" >&2 ;;
    esac
  fi

  if [ -n "${XDG_DATA_HOME:-}" ]; then
    _clv2_posix_path "$XDG_DATA_HOME"
    case "$_clv2_abs" in
      /*) printf '%s/ecc-homunculus\n' "$_clv2_abs"; return 0 ;;
      *) printf '[ecc] XDG_DATA_HOME=%s is not absolute; ignoring\n' "$XDG_DATA_HOME" >&2 ;;
    esac
  fi

  case "${HOME:-}" in
    /*) printf '%s/.local/share/ecc-homunculus\n' "$HOME" ;;
    *)
      printf '[ecc] HOME=%s is not absolute; cannot resolve homunculus dir\n' "${HOME:-}" >&2
      return 1
      ;;
  esac
}
