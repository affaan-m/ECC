# Sources and curation

- ECC upstream snapshot: Git commit `b38be6a7` (the original checkout in this
  directory). The upstream MIT license is retained in [LICENSE](LICENSE).
- Go, TypeScript, Vue/Nuxt, React, backend/API, Playwright, accessibility,
  application security, PostgreSQL/migrations, Docker, and optimization
  references are adapted from the corresponding upstream `skills/` directories.
  Entry instructions, discovery names, routing, and installation were revised
  for this curated Codex collection. This is not the full upstream ECC plugin.
- Rust material was supplied by the user in the sibling `bol/` directory.
  Its technical topics were consolidated and reviewed for Rust 2024 and Codex.
  No separate license was supplied with `bol`; the upstream ECC MIT file does
  not establish redistribution rights for the user's separate Rust material.
- React performance attribution to Vercel Labs and PostgreSQL attribution to
  Supabase remain in their reference files.
- Zig guidance and the installer/validator were added in this curation.

Primary documentation checked during adaptation:

- [Codex skill discovery and authoring](https://learn.chatgpt.com/docs/build-skills)
- [Rust 2024 edition guide](https://doc.rust-lang.org/edition-guide/rust-2024/index.html)
- [Zig language documentation](https://ziglang.org/documentation/)

Documentation examples are conditional reference material. Match them to the
target project's dependency versions and actual toolchain. No claim is made
that every example across all references was built or executed.

The installer and packaging have local automated checks. These do not constitute
a Snyk service scan or end-to-end evaluation of model skill selection.
