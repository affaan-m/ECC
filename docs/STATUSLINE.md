# Optional Claude usage display

ECC's existing statusline can show rate-limit windows, prompt-cache usage,
session cost, and installed plugin information when explicitly enabled. It
reads Claude's statusline input and local ECC metrics; it makes no network
requests and does not register hooks or change shell aliases.

To try it on macOS or Linux, adapt the existing statusline example in
`examples/statusline.json` and prefix its command with `ECC_STATUSLINE_USAGE=1`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "ECC_STATUSLINE_USAGE=1 /absolute/path/to/node /absolute/path/to/ecc/scripts/hooks/ecc-statusline.js"
  }
}
```

Use the absolute Node executable that works on your machine, and quote paths
containing spaces. Keep any existing custom statusline unless you choose to
replace it. Windows users can set `ECC_STATUSLINE_USAGE=1` in their provider's
environment and use the same script command with quoted absolute paths.

Removing the environment setting restores the existing compact output. Missing
rate-limit data produces no usage window. `ECC_BAR_GLYPHS=ascii` selects ASCII
symbols, and `ECC_STATUSLINE_COMPACT=1` requests the compact variant inside
the optional display.

The rendering idea comes from PR #2716 and the MIT-licensed
[claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar).
Automatic installation and a managed Codex terminal bar remain separate work.
