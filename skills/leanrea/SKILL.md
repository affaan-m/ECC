---
name: leanrea
description: Reverse engineer shipped software with plain local CLI tools, no heavy MCP needed. Covers Electron/JS bundles, native PE/ELF/Mach-O, Go/Rust/.NET/Flutter/WASM binaries, APKs, SQLite, pcaps, firmware and websites. Enforces strict ecosystem standards (Python via uv/ruff; reimplementations in Rust + wgpu + egui).
origin: ECC
---

# LeanREA: Lightweight CLI Reverse Engineering

A fast, token-efficient reverse engineering and binary reconstruction workflow using local CLI tools directly, eliminating heavy MCP dependencies while enforcing modern toolchain standards.

## When to Activate

- Reversing shipped software, desktop packages, or web assets (Electron `.asar`, Windows PE `.exe`/`.dll`, Mach-O, ELF, APKs, SQLite, or minified JS bundles).
- Investigating binary protocols, proprietary asset formats, or application state without launching full GUI debuggers.
- Decompiling specific targeted routines or extracting embedded schemas and symbols under tight context constraints.
- Rebuilding or porting extracted logic into high-performance, modern Rust architectures.

---

## Toolchain & Ecosystem Standards

### 1. Python Discipline (`uv` & `ruff`)
Whenever Python is needed for quick scripts, format parsing, or automation:
- **Runner & Package Management:** Exclusively use `uv` (`uv run python ...`, `uv pip`, `uv tool run`).
  - Never use bare `pip install`, `python -m venv`, or pollute system Python environments.
- **Linting & Formatting:** Exclusively use `ruff` (`uv run ruff check`, `uv run ruff format`). Avoid legacy linters (`flake8`, `black`, `pylint`).

### 2. JavaScript / TypeScript Discipline (`bun`-First)
- Use `bun` and `bunx` for JS/TS tasks and unpacking tools (e.g., `bunx @electron/asar`, `bun test`, `bun run`).
- Avoid invoking `npm`, `npx`, or standalone Node unless explicitly mandated by legacy toolchains.

### 3. Target Reconstruction Architecture (`Rust + wgpu + egui`)
When reimplementing reverse-engineered game engines, tools, or data pipelines:
- **Primary Language:** Safe, modern **Rust**.
- **Graphics & Rendering:** Modern `wgpu` (Vulkan primary on Windows/Linux, DX12 fallback; `glow`/legacy OpenGL is avoided).
- **User Interface:** Immediate-mode `egui` + `eframe` (ultra-lightweight, zero idle CPU overhead). Avoid heavyweight webview/Electron wrappers for developer tools.
- **Serialization & Binary Storage:** Prefer zero-copy binary serialization (`rkyv` or `zerocopy`) over abandoned libraries like `bincode`.

---

## Core Investigation Principles

1. **Work on an Isolated Copy:**
   Never mutate or operate directly inside the original installation directory. Always copy targets to a temporary directory:
   - Windows: `$env:TEMP\re\<target_name>`
   - POSIX: `$TMPDIR/re/<target_name>`

2. **Grep and Strings First (`rg -a` / `rg -uu`):**
   80% of reverse engineering questions (endpoints, IPC channel names, formats, magic bytes, versions) can be answered with fast ripgrep scans before running heavy decompilers.
   - For binary files: `rg -a`
   - For unpack directories with hidden/ignored files: `rg -uu`

3. **Slice, Don't Dump:**
   Avoid dumping multi-megabyte files or full decompilations into LLM context. Always slice around points of interest:
   ```bash
   # Extract 150 characters of context around matching patterns
   rg -uu -o '.{0,150}KEYWORD.{0,150}' <file> | head -n 20
   ```

4. **Evidence-Based Claims:**
   - **seen:** Backed by concrete file path, offset, symbol name, or hex string (e.g., `game.exe:0x0041a020`).
   - **inferred:** Reasonable logical deduction based on adjacent structures.
   - **unknown:** Unknown or unverified; do not invent or guess missing logic.

5. **Batch Commands:**
   Combine exploratory CLI steps into single chained invocations to save roundtrips and preserve context.

---

## Quick Recon Workflows

### 1. Windows PE / Native Binaries (`.exe`, `.dll`)

- **ASCII / UTF-16 String Scanning:**
  ```powershell
  rg -a -o '[A-Za-z0-9_\-\.]{5,}' target.exe | rg -i "config|api|secret|license" | Select-Object -First 50
  ```

- **PE Header & Section Inspection (via `uv` & `pefile`):**
  ```powershell
  uv run python -c "import pefile; pe = pefile.PE('target.exe'); print([(s.Name.decode().strip(), hex(s.VirtualAddress), s.SizeOfRawData) for s in pe.sections])"
  ```

- **Headless Ghidra CLI Decompilation:**
  Use Ghidra's `analyzeHeadless` in batch mode without opening the heavy GUI:
  ```powershell
  analyzeHeadless "$env:TEMP\ghidra_proj" TempProj -import target.exe -noanalysis -readOnly
  ```

### 2. Custom Binary Format Parsers (`uv` Prototyping -> Rust Port)

1. Rapidly prototype format inspection in Python:
   ```python
   # parse_header.py
   import struct, sys
   with open(sys.argv[1], "rb") as f:
       magic, version, count = struct.unpack("<4sII", f.read(12))
       print(f"Magic: {magic}, Version: {version}, Entries: {count}")
   ```
   Run and format with `uv`:
   ```bash
   uv run python parse_header.py sample.bin
   uv run ruff check parse_header.py
   uv run ruff format parse_header.py
   ```

2. Port verified structures to Rust using explicit alignment:
   ```rust
   #[repr(C, packed)]
   pub struct FileHeader {
       pub magic: [u8; 4],
       pub version: u32,
       pub entry_count: u32,
   }
   ```

### 3. Electron Applications (`app.asar`)

- **Extracting ASAR archives with Bun:**
  ```powershell
  $target = "app.asar"; $out = "$env:TEMP\re\asar"
  bunx @electron/asar extract $target $out
  Get-Content "$out\package.json" | Select-String "name|version|main"
  ```

- **Tracing IPC Channels:**
  ```sh
  rg -uu -o --glob '!node_modules' '.{0,150}(ipcMain\.(handle|on)|ipcRenderer\.(invoke|send)).{0,150}' $out | head -20
  ```

### 4. SQLite Databases (`.db`, `.sqlite`)

Extract schema and tables in read-only mode without file locking:
```bash
sqlite3 "file:data.db?mode=ro" ".schema"
sqlite3 "file:data.db?mode=ro" "SELECT name, sql FROM sqlite_master WHERE type='table';"
```

### 5. Web Bundles & Minified JS

Format and isolate symbols using `bunx prettier`:
```bash
bunx prettier --parser babel bundle.js > bundle.pretty.js
rg -n "function\s+[a-zA-Z0-9_]+\s*\(" bundle.pretty.js | head -n 30
```

---

## Target Matrix Summary

| Target | Preferred Fast CLI Tool | Quality & Safety Contract |
|---|---|---|
| **PE / Native Binary** | `rg -a`, `uv run python` (`pefile`), Ghidra Headless | Isolate to `$env:TEMP\re`; verify offsets before decompiling. |
| **Python Helpers** | `uv run ...` | `uv` + `ruff` required; no bare `pip` or unformatted scripts. |
| **Custom Binary Formats** | Python prototype (`uv`) -> Rust (`nom`/`zerocopy`) | Strict bounds checking; safe casting; zero-copy deserialization. |
| **GUI & Reimplementation** | **Rust + egui + eframe** | Zero idle CPU; lightweight immediate mode; no WebView/Electron. |
| **Render Engine** | **wgpu** | Vulkan / DX12 backend; cross-platform shader safety. |
| **Electron (`.asar`)** | `bunx @electron/asar` | Extract to temp copy; scan IPC contracts with `rg -uu`. |
| **SQLite Databases** | `sqlite3 'file:path?mode=ro'` | Read-only URI mode; zero lock interference with running apps. |
