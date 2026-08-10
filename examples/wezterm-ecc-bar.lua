-- ECC Codex usage bar for WezTerm.
--
-- Renders the bar in WezTerm's tab bar, so it stays visible outside tmux while
-- Codex owns the screen. The `ecc-codex` wrapper mirrors the bar into the
-- `ecc_codex_bar` user var (OSC 1337 SetUserVar) every ECC_CODEX_BAR_INTERVAL
-- seconds and clears it on exit, so the status fills in when Codex starts and
-- empties again when it stops. No polling or subprocesses on WezTerm's side.
--
-- Install: copy this file next to your wezterm.lua and require it.
--
--   require("wezterm-ecc-bar").apply()
--
-- Or load it straight out of an ECC checkout:
--
--   dofile(os.getenv("HOME") .. "/path/to/ecc/examples/wezterm-ecc-bar.lua").apply()
--
-- Requires `enable_tab_bar = true` (WezTerm's default). Both the retro and the
-- fancy tab bar render the right status.

local wezterm = require("wezterm")

local M = {}

-- The renderer's separator in the UTF-8 glyph set.
local SEP = "│"

M.colors = {
  dim = "#9a9183", -- taupe, matches the renderer's dim role
  five_hour = "#F59E0B", -- ECC amber
  seven_day = "#E07856", -- ECC terracotta
  critical = "#e05656",
}

-- Split on the separator with a plain (non-pattern) find.
--
-- A Lua character class such as [^│] matches BYTES, not characters. │ is
-- e2 94 82 and shares its leading e2 with ⬢ (e2 ac a2), █ (e2 96 88),
-- ░ (e2 96 91) and ↻ (e2 86 bb), so a class-based split cuts those glyphs in
-- half and emits invalid UTF-8. A plain find matches the whole 3-byte
-- sequence, which is the only safe way to split this string.
local function segments(bar)
  -- In the ASCII fallback glyph set "|" is both the separator and the bar
  -- fill, so the string cannot be split without mangling the meter. Colour it
  -- as a single piece instead.
  if not bar:find(SEP, 1, true) then
    return { bar }
  end

  local out, pos = {}, 1
  while true do
    local start_idx, end_idx = bar:find(SEP, pos, true)
    if not start_idx then
      out[#out + 1] = bar:sub(pos)
      return out
    end
    out[#out + 1] = bar:sub(pos, start_idx - 1)
    pos = end_idx + 1
  end
end

local function color_for(segment, colors)
  -- Every percentage in the bar counts usage, not headroom, so a nearly
  -- exhausted window outranks the per-window colour.
  if segment:find("9%d%%") or segment:find("100%%") then
    return colors.critical
  end
  if segment:find("5h", 1, true) then
    return colors.five_hour
  end
  if segment:find("7d", 1, true) or segment:find("⬢", 1, true) then
    return colors.seven_day
  end
  return colors.dim
end

--- Format a bar string into wezterm.format elements.
-- Exposed for testing and for callers that compose their own status line.
function M.format(bar, colors)
  colors = colors or M.colors
  local parts = {}
  for _, segment in ipairs(segments(bar)) do
    parts[#parts + 1] = { Foreground = { Color = color_for(segment, colors) } }
    parts[#parts + 1] = { Text = segment }
  end
  parts[#parts + 1] = { Text = "  " } -- breathing room at the window edge
  return wezterm.format(parts)
end

--- Register the update-status handler.
-- WezTerm supports multiple handlers per event, so this composes with an
-- existing update-status handler as long as that one does not also call
-- set_right_status.
function M.apply(opts)
  opts = opts or {}
  local colors = opts.colors or M.colors

  wezterm.on("update-status", function(window, pane)
    local bar
    if pane then
      local ok, vars = pcall(function()
        return pane:get_user_vars()
      end)
      bar = ok and vars and vars.ecc_codex_bar or nil
    end

    if not bar or bar == "" then
      window:set_right_status("")
      return
    end

    window:set_right_status(M.format(bar, colors))
  end)
end

return M
