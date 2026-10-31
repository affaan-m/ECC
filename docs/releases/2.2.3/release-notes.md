# ECC 2.2.3

ECC 2.2.3 is a naming and release-reliability update. The project is called ECC
everywhere it ships, starting with the `pi/core` profile, and the release
workflow now waits long enough for npm to serve a freshly published version.

## Naming

- `pi/core` no longer expands the project name: its README and the bundled
  `blueprint` skill refer to ECC only. The profile contents are otherwise
  unchanged: 123 curated skills and 24 prompt commands, 35,006 characters of
  skill description text.
- Downstream packagers need no changes. The package is still `ecc-pi-core`, the
  directory is still `pi/core/`, and existing install paths keep working.

## Release workflow

- After `npm publish`, the release workflow polls the registry for up to five
  minutes before verifying the published artifact. In 2.2.2 it gave up after
  about 30 seconds while npm was still processing the upload, so the run failed
  before promoting `latest` and creating the GitHub Release, and had to be
  re-run.

Downstream consumption is unchanged: poll `/releases`, download
`archive/refs/tags/vX.Y.Z.tar.gz`, pin its sha256, copy `pi/core/`, and load it
offline.
