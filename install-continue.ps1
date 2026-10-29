#!/usr/bin/env pwsh
# install-continue.ps1 - install ECC into the Continue CLI (`cn`) on Windows.
#
#   .\install-continue.ps1
#   .\install-continue.ps1 --langs python,typescript --skills developer
#   .\install-continue.ps1 --help
#
# See CONTINUE-CLI.md. All options are passed to scripts/install-continue.js.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$installer = Join-Path -Path (Join-Path -Path $scriptDir -ChildPath 'scripts') -ChildPath 'install-continue.js'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error '[ECC] Node.js 18+ is required (https://nodejs.org).'
    exit 1
}

# SECURITY: --ignore-scripts blocks install-time scripts from dependencies.
if (-not (Test-Path -LiteralPath (Join-Path -Path $scriptDir -ChildPath 'node_modules'))) {
    Write-Host '[ECC] Installing dependencies...'
    Push-Location $scriptDir
    try {
        & npm install --ignore-scripts --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}

if (-not (Get-Command cn -ErrorAction SilentlyContinue)) {
    Write-Host '[ECC] Note: the Continue CLI is not on PATH yet. Install it with: npm i -g @continuedev/cli'
}

& node $installer @args
exit $LASTEXITCODE
