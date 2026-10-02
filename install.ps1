#!/usr/bin/env pwsh
# install.ps1 — Windows-native entrypoint for the ECC installer.
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

# Auto-install Node dependencies when running from a git clone
# SECURITY: --ignore-scripts blocks preinstall/postinstall RCE from a compromised dependency.
$nodeModules = Join-Path -Path $scriptDir -ChildPath 'node_modules'
if (-not (Test-Path -LiteralPath $nodeModules)) {
    Write-Host '[ECC] Installing dependencies...'
    Push-Location $scriptDir
    try {
        & npm install --ignore-scripts --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed with exit code $LASTEXITCODE"
            exit $LASTEXITCODE
        }
    }
    finally { Pop-Location }
}

& node $installerScript @args
exit $LASTEXITCODE
