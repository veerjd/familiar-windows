# Build the Windows.Media.Ocr helper into build/ocr/familiar-ocr.exe.
#
# Prerequisites: .NET 8 SDK (https://dotnet.microsoft.com/download).
# This is a *manual* step — the prebuilt binary is checked into the repo
# (same precedent as build/tess/), so contributors do not need .NET to
# build or run Familiar from source. Re-run this only when the C# source
# in native/ocr/ changes.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $repoRoot 'native\ocr\Familiar.Ocr.csproj'
$outDir = Join-Path $repoRoot 'build\ocr'

if (-not (Test-Path $proj)) {
    throw "Cannot find C# project at $proj"
}

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw "dotnet SDK not on PATH. Install .NET 8 SDK from https://dotnet.microsoft.com/download"
}

Write-Host "Publishing native OCR helper to $outDir ..." -ForegroundColor Cyan

# Use a temp publish dir and copy the single-file exe over. Avoids leaving
# obj/, deps json, pdbs, etc. in build/ocr/.
$tmp = Join-Path $env:TEMP "familiar-ocr-publish-$([guid]::NewGuid())"
try {
    dotnet publish $proj -c Release -o $tmp `
        -p:PublishSingleFile=true `
        -p:SelfContained=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -p:DebugType=none `
        -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit $LASTEXITCODE)" }

    $exe = Join-Path $tmp 'familiar-ocr.exe'
    if (-not (Test-Path $exe)) { throw "Build succeeded but $exe not found" }

    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    Copy-Item -Force $exe $outDir
    Write-Host "Built $(Join-Path $outDir 'familiar-ocr.exe') ($([math]::Round((Get-Item (Join-Path $outDir 'familiar-ocr.exe')).Length / 1MB, 1)) MB)" -ForegroundColor Green
}
finally {
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
