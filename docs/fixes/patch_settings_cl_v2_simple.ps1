# Simple patcher for settings.local.json - CL v2 hooks (argv-dup safe)
#
# No Japanese literals - keeps the file ASCII-only so PowerShell parses it
# regardless of the active code page.
#
# argv-dup bug workaround (Claude Code v2.1.116):
#   - Use PATH-resolved `bash` (no quoted .exe) as the first argv token.
#   - Point the hook at observe-wrapper.sh (not observe.sh).
#   - Pass `pre` / `post` as explicit positional arguments so PreToolUse and
#     PostToolUse are registered as distinct commands.
#   - Normalize the wrapper path to forward slashes to keep MSYS/Git Bash
#     happy and write the JSON with LF endings only.
#
# References:
#   - PR #1524 (settings.local.json argv-dup fix)
#   - PR #1540 (install_hook_wrapper.ps1 argv-dup fix)
$ErrorActionPreference = "Stop"

$SettingsPath = "$env:USERPROFILE\.claude\settings.local.json"
$WrapperDst   = "$env:USERPROFILE\.claude\skills\continuous-learning\hooks\observe-wrapper.sh"
$BashExe      = "bash"

# Normalize wrapper path to forward slashes and build distinct pre/post
# commands. Quoting keeps spaces in the path safe.
$wrapperPath = $WrapperDst -replace '\\','/'
$preCmd  = $BashExe + ' "' + $wrapperPath + '" pre'
$postCmd = $BashExe + ' "' + $wrapperPath + '" post'

Write-Host "=== CL v2 Simple Patcher (argv-dup safe) ===" -ForegroundColor Cyan
Write-Host "Target      : $SettingsPath"
Write-Host "Wrapper     : $wrapperPath"
Write-Host "Pre command : $preCmd"
Write-Host "Post command: $postCmd"

# Ensure parent dir exists
$parent = Split-Path $SettingsPath
if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

function New-HookEntry {
    param([string]$Command)
    # Inner `hooks` uses ArrayList so a single-element list does not get
    # collapsed into an object when PS 5.1 ConvertTo-Json serializes the
    # enclosing Hashtable.
    $inner = [System.Collections.ArrayList]::new()
    $null = $inner.Add(@{ type = "command"; command = $Command })
    return @{
        matcher = "*"
        hooks   = $inner
    }
}

# Convert a PSCustomObject tree (as returned by ConvertFrom-Json on PS 5.1)
# into nested Hashtables/Arrays so the merge logic below works uniformly.
# PS 7+ gets the same shape via `ConvertFrom-Json -AsHashtable` directly.
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
        # Use ArrayList so PS 5.1 ConvertTo-Json preserves single-element
        # arrays instead of collapsing them into objects. Plain Object[]
        # suffers from that collapse when embedded in a Hashtable value.
        $result = [System.Collections.ArrayList]::new()
        foreach ($item in $InputObject) {
            $null = $result.Add((ConvertTo-HashtableRecursive -InputObject $item))
        }
        return ,$result
    }
    return $InputObject
}

function Read-SettingsAsHashtable {
    param([string]$Path)
    $raw = Get-Content -Raw -Path $Path -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    # Prefer `-AsHashtable` (PS 7+); fall back to manual conversion on PS 5.1
    # where that parameter does not exist.
    try {
        return ($raw | ConvertFrom-Json -AsHashtable)
    } catch {
        $obj = $raw | ConvertFrom-Json
        return (ConvertTo-HashtableRecursive -InputObject $obj)
    }
}

$preEntry  = New-HookEntry -Command $preCmd
$postEntry = New-HookEntry -Command $postCmd

if (Test-Path $SettingsPath) {
    $backup = "$SettingsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $SettingsPath $backup -Force
    Write-Host "[BACKUP] $backup" -ForegroundColor Yellow

    try {
        $existing = Read-SettingsAsHashtable -Path $SettingsPath
    } catch {
        Write-Host "[WARN] Failed to parse existing JSON, will overwrite (backup preserved)" -ForegroundColor Yellow
        $existing = @{}
    }
    if ($null -eq $existing) { $existing = @{} }

    if (-not $existing.ContainsKey("hooks")) {
        $existing["hooks"] = @{}
    }
    # Normalize the two hook buckets into ArrayList so both existing and newly
    # added entries survive PS 5.1 ConvertTo-Json array collapsing.
    foreach ($key in @("PreToolUse", "PostToolUse")) {
        if (-not $existing.hooks.ContainsKey($key)) {
            $existing.hooks[$key] = [System.Collections.ArrayList]::new()
        } elseif (-not ($existing.hooks[$key] -is [System.Collections.ArrayList])) {
            $list = [System.Collections.ArrayList]::new()
            foreach ($item in @($existing.hooks[$key])) { $null = $list.Add($item) }
            $existing.hooks[$key] = $list
        }
        # Each entry's inner `hooks` array needs the same treatment so legacy
        # single-element arrays do not serialize as bare objects.
        foreach ($entry in $existing.hooks[$key]) {
            if ($entry -is [System.Collections.IDictionary] -and $entry.ContainsKey("hooks") -and
                -not ($entry["hooks"] -is [System.Collections.ArrayList])) {
                $innerList = [System.Collections.ArrayList]::new()
                foreach ($item in @($entry["hooks"])) { $null = $innerList.Add($item) }
                $entry["hooks"] = $innerList
            }
        }
    }

    # Duplicate check uses the exact command string so legacy observe.sh
    # entries are left in place unless re-run manually removes them.
    $hasPre = $false
    foreach ($e in $existing.hooks.PreToolUse) {
        foreach ($h in @($e.hooks)) { if ($h.command -eq $preCmd) { $hasPre = $true } }
    }
    $hasPost = $false
    foreach ($e in $existing.hooks.PostToolUse) {
        foreach ($h in @($e.hooks)) { if ($h.command -eq $postCmd) { $hasPost = $true } }
    }

    if (-not $hasPre) {
        $null = $existing.hooks.PreToolUse.Add($preEntry)
        Write-Host "[ADD] PreToolUse" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] PreToolUse already registered" -ForegroundColor Gray
    }
    if (-not $hasPost) {
        $null = $existing.hooks.PostToolUse.Add($postEntry)
        Write-Host "[ADD] PostToolUse" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] PostToolUse already registered" -ForegroundColor Gray
    }

    $json = $existing | ConvertTo-Json -Depth 20
} else {
    Write-Host "[CREATE] new settings.local.json" -ForegroundColor Green
    $newSettings = @{
        hooks = @{
            PreToolUse  = @($preEntry)
            PostToolUse = @($postEntry)
        }
    }
    $json = $newSettings | ConvertTo-Json -Depth 20
}

# Write UTF-8 no BOM and normalize CRLF -> LF so hook parsers never see
# mixed line endings.
$jsonLf = $json -replace "`r`n","`n"
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($SettingsPath, $jsonLf, $utf8)

Write-Host ""
Write-Host "=== Patch SUCCESS ===" -ForegroundColor Green
Write-Host ""
Get-Content -Path $SettingsPath -Encoding UTF8
