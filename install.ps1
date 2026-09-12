#!/usr/bin/env pwsh
# install.ps1 - Windows-native entrypoint for the ECC installer.
#
# This wrapper resolves the real repo/package root when invoked through a
# symlinked path, then delegates to the Node-based installer runtime.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = $PSCommandPath

while ($true) {
    $item = Get-Item -LiteralPath $scriptPath -Force
    if (-not $item.LinkType) {
        break
    }

    $targetPath = $item.Target
    if ($targetPath -is [array]) {
        $targetPath = $targetPath[0]
    }

    if (-not $targetPath) {
        break
    }

    if (-not [System.IO.Path]::IsPathRooted($targetPath)) {
        $targetPath = Join-Path -Path $item.DirectoryName -ChildPath $targetPath
    }

    $scriptPath = [System.IO.Path]::GetFullPath($targetPath)
}

$scriptDir = Split-Path -Parent $scriptPath
$installerScript = Join-Path -Path (Join-Path -Path $scriptDir -ChildPath 'scripts') -ChildPath 'install-apply.js'

# ponytail: preflight Node.js presence and version (>= 18)
$minimumNodeMajor = 18
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("[ECC] Node.js is required but was not found in PATH. Please install Node.js $minimumNodeMajor or newer: https://nodejs.org")
    exit 1
}

$nodeVersion = (& node -v 2>$null | Select-Object -First 1)
if (-not $nodeVersion -or $nodeVersion -notmatch '^\s*v?(\d+)\.') {
    [Console]::Error.WriteLine("[ECC] Failed to determine Node.js version (found '$nodeVersion'). Node.js $minimumNodeMajor or newer is required: https://nodejs.org")
    exit 1
}

if ([int]$Matches[1] -lt $minimumNodeMajor) {
    [Console]::Error.WriteLine("[ECC] Node.js $minimumNodeMajor or newer is required (found $nodeVersion). Please update Node.js: https://nodejs.org")
    exit 1
}

# Auto-install Node dependencies when running from a git clone
$nodeModules = Join-Path -Path $scriptDir -ChildPath 'node_modules'
if (-not (Test-Path -LiteralPath $nodeModules)) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        [Console]::Error.WriteLine('[ECC] npm is required to install dependencies but was not found in PATH.')
        exit 1
    }
    Write-Host '[ECC] Installing dependencies...'
    Push-Location $scriptDir
    try {
        & npm install --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) {
            [Console]::Error.WriteLine("npm install failed with exit code $LASTEXITCODE")
            exit $LASTEXITCODE
        }
    }
    finally { Pop-Location }
}

& node $installerScript @args
exit $LASTEXITCODE
