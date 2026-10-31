"""Hash existing local assets into an exclusive receipt without provider execution.

Config paths are relative to the config file. Provider provenance is a supplied
claim bound to local evidence, not independent verification of a remote service.
Image/video hashes prove byte identity, not decodability; downstream media tools
must probe their format before use. GLB containers receive a header check here.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import struct
from pathlib import Path
from typing import Any

SCHEMA = 'tasteforge.assets.v1'
MODALITIES = {'image', 'video', '3d_asset'}
ORIGINS = {'local_passthrough', 'external_result', 'recovered_unverified'}


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{name} must be a nonempty string')
    return value


def _path(value: Any, base: Path) -> Path:
    raw = _text(str(value) if isinstance(value, Path) else value, 'path')
    if '://' in raw or raw.startswith(('file:', 'http:', 'https:')):
        raise ValueError('Only local filesystem paths are supported')
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = base / path
    # Check before resolving '..' to avoid hiding a symlink in the path.
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError(f'Symlinks are not accepted: {part}')
    return path.resolve()


def _fingerprint(path: Path, modality: str | None = None) -> dict[str, Any]:
    _path(path, Path.cwd())
    try:
        before = path.stat()
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f'Not a regular file: {path}')
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | os.O_NONBLOCK
        fd = os.open(path, flags)
        with os.fdopen(fd, 'rb') as stream:
            opened = os.fstat(stream.fileno())
            if not stat.S_ISREG(opened.st_mode):
                raise ValueError(f'Not a regular file: {path}')
            digest = hashlib.sha256()
            header = stream.read(12)
            digest.update(header)
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
            after = os.fstat(stream.fileno())
        final = path.stat()
    except OSError as exc:
        raise ValueError(f'Cannot read local asset: {path}') from exc
    def identity(info: os.stat_result) -> tuple[int, ...]:
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    if len({identity(info) for info in (before, opened, after, final)}) != 1:
        raise ValueError(f'File changed while hashing: {path}')
    if modality == '3d_asset':
        if len(header) != 12:
            raise ValueError(f'Truncated GLB header: {path}')
        magic, version, size = struct.unpack('<4sII', header)
        if magic != b'glTF' or version != 2 or size != final.st_size:
            raise ValueError(f'Invalid GLB magic, version or declared size: {path}')
    return dict(path=str(path), bytes=final.st_size, sha256=digest.hexdigest())


def _load(path: Path) -> dict[str, Any]:
    _fingerprint(path)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, OSError) as exc:
        raise ValueError(f'Cannot read JSON object: {path}') from exc
    if not isinstance(data, dict):
        raise ValueError('Expected a JSON object')
    return data


def _assets(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ValueError('assets must be a nonempty list')
    ids = set()
    for asset in value:
        if not isinstance(asset, dict):
            raise ValueError('Each asset must be an object')
        asset_id = _text(asset.get('id'), 'asset id')
        if asset_id in ids:
            raise ValueError(f'Duplicate asset id: {asset_id}')
        ids.add(asset_id)
        if asset.get('modality') not in tuple(MODALITIES):
            raise ValueError('modality must be image, video or 3d_asset')
        if asset.get('origin') not in tuple(ORIGINS):
            raise ValueError('Invalid asset origin')
    return value


def _provenance(asset: dict[str, Any], base: Path, verify: bool) -> dict[str, Any] | None:
    source = asset.get('provider_provenance')
    if asset['origin'] != 'external_result':
        if source is not None:
            raise ValueError('Provider provenance requires external_result origin')
        return None
    if not isinstance(source, dict):
        raise ValueError('external_result requires provider provenance and local evidence')
    provider = _text(source.get('provider'), 'provider')
    identifiers = {key: _text(source[key], key) for key in ('request_id', 'workflow_id')
                   if key in source}
    if not identifiers:
        raise ValueError('Provider provenance requires request_id or workflow_id')
    if verify:
        evidence = _verify_binding(source.get('evidence'), base)
    else:
        evidence = _fingerprint(_path(source.get('evidence_path'), base))
    return dict(provider=provider, **identifiers, evidence=evidence,
                verification='supplied_local_evidence_only')


def _verify_binding(value: Any, base: Path, modality: str | None = None) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError('Missing artifact binding')
    actual = _fingerprint(_path(value.get('path'), base), modality)
    if type(value.get('bytes')) is not int or any(value.get(k) != v for k, v in actual.items()):
        raise ValueError(f'Artifact changed or binding invalid: {actual["path"]}')
    return actual


_TASTE_FIELDS = ('genre_number', 'genre_slug', 'style_fingerprint', 'reference_sha256')


def _bundle(value: Any, base: Path, verify: bool) -> tuple[dict[str, Any], dict[tuple[str, str], Any]]:
    from .contract import validate_bundle

    if verify:
        binding = _verify_binding(value, base)
        root = Path(binding['path']).parent
    else:
        root = _path(value, base)
        binding = _fingerprint(root / 'receipt.json')
    validate_bundle(root)
    requests = {}
    for modality in sorted(MODALITIES):
        manifest = _load(root / 'manifests' / f'{modality}.json')
        for request in manifest['requests']:
            key = (modality, _text(request.get('request_id'), 'request_id'))
            if key in requests:
                raise ValueError('Ambiguous duplicate bundle request')
            requests[key] = request
    if binding != _fingerprint(root / 'receipt.json'):
        raise ValueError('Bundle changed during validation')
    return binding, requests


def _taste(asset: dict[str, Any], requests: dict[Any, Any], verify: bool) -> dict[str, Any]:
    if not requests:
        if any(key in asset for key in (*_TASTE_FIELDS, 'request_id')):
            raise ValueError('Taste claims require a validated bundle')
        return {}
    request_id = _text(asset.get('request_id'), 'bundle request_id')
    request = requests.get((asset['modality'], request_id))
    if request is None:
        raise ValueError('Asset request_id/modality does not match the bundle')
    result = dict(request_id=request_id, **{key: request[key] for key in _TASTE_FIELDS})
    if verify:
        if any(asset.get(key) != value for key, value in result.items()):
            raise ValueError('Asset taste lineage differs from its bundle request')
    elif any(key in asset for key in _TASTE_FIELDS):
        raise ValueError('Taste fields are derived from the bundle, not supplied')
    return result


def ingest_assets(config_path: str | Path, out_receipt: str | Path) -> dict[str, Any]:
    """Bind local assets/provenance/lineage; write a new receipt, never overwrite."""
    config_file = _path(config_path, Path.cwd())
    config = _load(config_file)
    base = config_file.parent
    output = _path(out_receipt, Path.cwd())
    if output.exists():
        raise ValueError(f'Receipt output already exists: {output}')
    binding, requests = (_bundle(config['bundle_dir'], base, False)
                         if 'bundle_dir' in config else (None, {}))
    records = []
    for asset in _assets(config.get('assets')):
        record = {key: asset[key] for key in ('id', 'modality', 'origin')}
        record.update(_taste(asset, requests, False))
        record.update(_fingerprint(_path(asset.get('path'), base), asset['modality']))
        provenance = _provenance(asset, base, False)
        if provenance is not None:
            record['provider_provenance'] = provenance
        records.append(record)
    inputs = config.get('input_artifacts', [])
    if not isinstance(inputs, list):
        raise ValueError('input_artifacts must be a list of local paths')
    receipt = dict(schema=SCHEMA, provider_calls=0, provider_execution=False,
                   assets=records, input_artifacts=[_fingerprint(_path(p, base)) for p in inputs])
    if binding is not None:
        receipt['bundle_receipt'] = binding
    if 'genre_spec' in config:
        receipt['genre_spec'] = _fingerprint(_path(config['genre_spec'], base))
    # All inputs already exist, so the output-exists gate also prevents collisions.
    try:
        with output.open('x', encoding='utf-8') as stream:
            json.dump(receipt, stream, indent=2, sort_keys=True)
            stream.write('\n')
    except OSError as exc:
        raise ValueError(f'Cannot create exclusive receipt: {output}') from exc
    return receipt


def validate_assets(receipt_path: str | Path) -> dict[str, Any]:
    """Re-hash every bound file and validate receipt semantics; no remote calls."""
    path = _path(receipt_path, Path.cwd())
    receipt = _load(path)
    if receipt.get('schema') != SCHEMA:
        raise ValueError('Unsupported asset receipt schema')
    if type(receipt.get('provider_calls')) is not int or receipt['provider_calls'] != 0:
        raise ValueError('Local ingestion must have zero provider calls')
    if receipt.get('provider_execution') is not False:
        raise ValueError('Local ingestion cannot claim provider execution')
    _, requests = (_bundle(receipt['bundle_receipt'], path.parent, True)
                   if 'bundle_receipt' in receipt else (None, {}))
    for asset in _assets(receipt.get('assets')):
        _taste(asset, requests, True)
        _verify_binding(asset, path.parent, asset['modality'])
        provenance = _provenance(asset, path.parent, True)
        if provenance is not None and provenance != asset['provider_provenance']:
            raise ValueError('Invalid supplied provenance declaration')
    inputs = receipt.get('input_artifacts')
    if not isinstance(inputs, list):
        raise ValueError('input_artifacts must be a list')
    for artifact in inputs:
        _verify_binding(artifact, path.parent)
    if 'genre_spec' in receipt:
        _verify_binding(receipt['genre_spec'], path.parent)
    return receipt
