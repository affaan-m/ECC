"""Compatibility import for the canonical ECC Resolve adapter.

Alias the module itself so integrations that patch this import path continue
patching the globals used by the canonical implementation.
"""
import sys

from tasteforge import resolve as _canonical

sys.modules[__name__] = _canonical
