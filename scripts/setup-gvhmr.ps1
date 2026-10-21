# Isolated local runtime. Run from the repository root with uv and Git installed.
param([string]$SmplxModel = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
function Run-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
$gvhmrRevision = 'ee960bb6e2ea2d381aa97f08e9b71ef320b624b1'
if (!(Test-Path artifacts/GVHMR/.git)) {
    Run-Checked git @('clone', 'https://github.com/zju3dv/GVHMR.git', 'artifacts/GVHMR')
    Run-Checked git @('-C', 'artifacts/GVHMR', 'checkout', $gvhmrRevision)
}
$actualRevision = git -C artifacts/GVHMR rev-parse HEAD
if ($actualRevision -ne $gvhmrRevision) { throw 'Existing GVHMR checkout differs from the tested revision.' }
if (!(Test-Path artifacts/gvhmr-env/Scripts/python.exe)) {
    Run-Checked uv @('venv', '--python', '3.10', 'artifacts/gvhmr-env')
}
$python = Join-Path $projectRoot 'artifacts/gvhmr-env/Scripts/python.exe'
Run-Checked uv @('pip', 'install', '--python', $python, '--no-cache', 'torch==2.3.0', 'torchvision==0.18.0', '--index-url', 'https://download.pytorch.org/whl/cu121')
Run-Checked uv @('pip', 'install', '--python', $python, '--no-cache', '-r', 'scripts/gvhmr-requirements.txt', '-c', 'scripts/gvhmr-windows.lock.txt')
if (!(Test-Path artifacts/pytorch3d/.git)) {
    Run-Checked git @('clone', '--depth', '1', '--branch', 'v0.7.6', 'https://github.com/facebookresearch/pytorch3d.git', 'artifacts/pytorch3d')
}
$previousNoExtension = $env:PYTORCH3D_NO_EXTENSION
try {
    $env:PYTORCH3D_NO_EXTENSION = '1'
    Run-Checked uv @('pip', 'install', '--python', $python, '--no-cache', '--no-build-isolation', './artifacts/pytorch3d')
} finally {
    $env:PYTORCH3D_NO_EXTENSION = $previousNoExtension
}
Run-Checked $python @('scripts/gvhmr_windows_compat.py')
Run-Checked $python @('scripts/gvhmr_download_weights.py')
if ($SmplxModel) {
    $bodyFolder = Join-Path $projectRoot 'artifacts/GVHMR/inputs/checkpoints/body_models/smplx'
    New-Item -ItemType Directory -Path $bodyFolder -Force | Out-Null
    Copy-Item -LiteralPath $SmplxModel -Destination (Join-Path $bodyFolder 'SMPLX_NEUTRAL.npz')
}
if (!(Test-Path artifacts/blender/blender-4.2.0-windows-x64/blender.exe)) {
    $archivePath = Join-Path $projectRoot 'artifacts/blender-4.2.0-windows-x64.zip'
    Run-Checked curl.exe @('--fail', '--location', '--output', $archivePath, 'https://download.blender.org/release/Blender4.2/blender-4.2.0-windows-x64.zip')
    Expand-Archive -LiteralPath $archivePath -DestinationPath (Join-Path $projectRoot 'artifacts/blender')
    Remove-Item -LiteralPath $archivePath
}
if (!(Test-Path artifacts/GVHMR/inputs/checkpoints/body_models/smplx/SMPLX_NEUTRAL.npz)) {
    throw 'Runtime installed, but SMPLX_NEUTRAL.npz is missing. Rerun with -SmplxModel pointing to your licensed model.'
}
Write-Host 'Setup complete. Process all videos with:'
Write-Host 'artifacts/gvhmr-env/Scripts/python.exe scripts/gvhmr_extract.py'
