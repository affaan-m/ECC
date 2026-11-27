# Install observe-wrapper.sh + rewrite settings.local.json to use it
# No Japanese literals - uses $PSScriptRoot instead
# argv-dup bug workaround: use `bash` (PATH-resolved) as first token and
# normalize wrapper path to forward slashes. See PR #1524.
#
# PowerShell 5.1 compatibility:
#   - `ConvertFrom-Json -AsHashtable` is PS 7+ only; fall back to a manual
#     PSCustomObject -> Hashtable conversion on Windows PowerShell 5.1.
#   - PS 5.1 `ConvertTo-Json` collapses single-element arrays inside
#     Hashtables into bare objects. Normalize the hook buckets
#     (PreToolUse / PostToolUse) and their inner `hooks` arrays as
#     `System.Collections.ArrayList` before serialization to preserve
#     array shape.
$ErrorActionPreference = "Stop"

$SkillHooks   = "$env:USERPROFILE\.claude\skills\continuous-learning\hooks"
$WrapperSrc   = Join-Path $PSScriptRoot "observe-wrapper.sh"
$WrapperDst   = "$SkillHooks\observe-wrapper.sh"
$SettingsPath = "$env:USERPROFILE\.claude\settings.local.json"
# Use PATH-resolved `bash` to avoid Claude Code v2.1.116 argv-dup bug that
# double-passes the first token when the quoted path is a Windows .exe.
$BashExe      = "bash"

Write-Host "=== Install Hook Wrapper ===" -ForegroundColor Cyan
Write-Host "ScriptRoot: $PSScriptRoot"
Write-Host "WrapperSrc: $WrapperSrc"

if (-not (Test-Path $WrapperSrc)) {
    Write-Host "[ERROR] Source not found: $WrapperSrc" -ForegroundColor Red
    exit 1
}

# Ensure the hook destination directory exists (fresh installs have no
# skills/continuous-learning/hooks tree yet).
$dstDir = Split-Path $WrapperDst
if (-not (Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}

# --- Helpers ------------------------------------------------------------

# Convert a PSCustomObject tree (as returned by ConvertFrom-Json on PS 5.1)
# into nested Hashtables/ArrayLists so the merge logic below works uniformly
# and so ConvertTo-Json preserves single-element arrays on PS 5.1.
function ConvertTo-HashtableRecursive {
    param($InputObject)
    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $InputObject.Keys) {
            $result[$key] = ConvertTo-HashtableRecursive -InputObject $InputObject[$key]
        }
        return $result
    }
    if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
        $result = @{}
        foreach ($prop in $InputObject.PSObject.Properties) {
            $result[$prop.Name] = ConvertTo-HashtableRecursive -InputObject $prop.Value
        }
        return $result
    }
    if ($InputObject -is [System.Collections.IList] -or $InputObject -is [System.Array]) {
        $list = [System.Collections.ArrayList]::new()
        foreach ($item in $InputObject) {
            $null = $list.Add((ConvertTo-HashtableRecursive -InputObject $item))
        }
        return ,$list
    }
    return $InputObject
}

function Read-SettingsAsHashtable {
    param([string]$Path)
    $raw = Get-Content -Raw -Path $Path -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    try {
        return ($raw | ConvertFrom-Json -AsHashtable)
    } catch {
        $obj = $raw | ConvertFrom-Json
        return (ConvertTo-HashtableRecursive -InputObject $obj)
    }
}

function ConvertTo-ArrayList {
    param($Value)
    $list = [System.Collections.ArrayList]::new()
    foreach ($item in @($Value)) { $null = $list.Add($item) }
    return ,$list
}

# --- 1) Copy wrapper + LF normalization ---------------------------------
Write-Host "[1/4] Copy wrapper to $WrapperDst" -ForegroundColor Yellow
$content = Get-Content -Raw -Path $WrapperSrc
$contentLf = $content -replace "`r`n","`n"
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($WrapperDst, $contentLf, $utf8)
Write-Host "  [OK] wrapper installed with LF endings" -ForegroundColor Green

# --- 2) Backup settings -------------------------------------------------
Write-Host "[2/4] Backup settings.local.json" -ForegroundColor Yellow
if (-not (Test-Path $SettingsPath)) {
    Write-Host "[ERROR] Settings file not found: $SettingsPath" -ForegroundColor Red
    Write-Host "  Run patch_settings_cl_v2_simple.ps1 first to bootstrap the file." -ForegroundColor Yellow
    exit 1
}
$backup = "$SettingsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $SettingsPath $backup -Force
Write-Host "  [OK] $backup" -ForegroundColor Green

# --- 3) Rewrite command path in settings.local.json ---------------------
Write-Host "[3/4] Rewrite hook command to wrapper" -ForegroundColor Yellow
$settings = Read-SettingsAsHashtable -Path $SettingsPath

# Normalize wrapper path to forward slashes so bash (MSYS/Git Bash) does not
# mangle backslashes; quoting keeps spaces safe.
$wrapperPath = $WrapperDst -replace '\\','/'
$preCmd  = $BashExe + ' "' + $wrapperPath + '" pre'
$postCmd = $BashExe + ' "' + $wrapperPath + '" post'

if (-not $settings.ContainsKey("hooks") -or $null -eq $settings["hooks"]) {
    $settings["hooks"] = @{}
}
foreach ($key in @("PreToolUse", "PostToolUse")) {
    if (-not $settings.hooks.ContainsKey($key) -or $null -eq $settings.hooks[$key]) {
        $settings.hooks[$key] = [System.Collections.ArrayList]::new()
    } elseif (-not ($settings.hooks[$key] -is [System.Collections.ArrayList])) {
        $settings.hooks[$key] = (ConvertTo-ArrayList -Value $settings.hooks[$key])
    }
    # Inner `hooks` arrays need the same ArrayList normalization to
    # survive PS 5.1 ConvertTo-Json serialization.
    foreach ($entry in $settings.hooks[$key]) {
        if ($entry -is [System.Collections.IDictionary] -and $entry.ContainsKey("hooks") -and
            -not ($entry["hooks"] -is [System.Collections.ArrayList])) {
            $entry["hooks"] = (ConvertTo-ArrayList -Value $entry["hooks"])
        }
    }
}

# Point every existing hook command at the wrapper with the appropriate
# positional argument. The entry shape is preserved exactly; only the
# `command` field is rewritten.
foreach ($entry in $settings.hooks.PreToolUse) {
    foreach ($h in @($entry.hooks)) {
        if ($h -is [System.Collections.IDictionary]) { $h["command"] = $preCmd }
    }
}
foreach ($entry in $settings.hooks.PostToolUse) {
    foreach ($h in @($entry.hooks)) {
        if ($h -is [System.Collections.IDictionary]) { $h["command"] = $postCmd }
    }
}

$json = $settings | ConvertTo-Json -Depth 20
# Normalize CRLF -> LF so hook parsers never see mixed line endings.
$jsonLf = $json -replace "`r`n","`n"
[System.IO.File]::WriteAllText($SettingsPath, $jsonLf, $utf8)
Write-Host "  [OK] command updated" -ForegroundColor Green
Write-Host "  PreToolUse  command: $preCmd"
Write-Host "  PostToolUse command: $postCmd"

# --- 4) Verify ----------------------------------------------------------
Write-Host "[4/4] Verify" -ForegroundColor Yellow
Get-Content $SettingsPath | Select-String "command"

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Next: Launch Claude CLI and run any command to trigger observations.jsonl"
