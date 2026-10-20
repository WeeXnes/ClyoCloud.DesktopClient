# PowerShell Build Script for ClyoCloud Standalone Installer
param(
    [string]$Target = "win-x64"
)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "          Building ClyoCloud Installer" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (!(Test-Path "lib\InstallerFramework\src")) {
    Write-Host "[!] Framework source missing. Running setup script..." -ForegroundColor Yellow
    .\setup.ps1
}

$payloadSource = "$scriptDir\..\release\win-unpacked"
if (Test-Path $payloadSource) {
    Write-Host "[+] Packaging payload from $payloadSource into payload.zip..." -ForegroundColor Yellow
    if (Test-Path "payload.zip") { Remove-Item "payload.zip" -Force }
    Compress-Archive -Path "$payloadSource\*" -DestinationPath "payload.zip"
}

Write-Host "[+] Publishing single-file Release installer ($Target)..." -ForegroundColor Yellow
dotnet publish ClyoCloudInstaller.csproj -c Release -r $Target `
    /p:PublishSingleFile=true `
    /p:IncludeNativeLibrariesForSelfExtract=true `
    --self-contained true `
    -o "publish\$Target"

if (Test-Path "publish\$Target\ClyoCloudInstaller.exe") {
    Move-Item -Path "publish\$Target\ClyoCloudInstaller.exe" -Destination "publish\$Target\ClyoCloud-Setup-Windows.exe" -Force
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " [SUCCESS] Single-file installer built:" -ForegroundColor Green
Write-Host " Location: publish\$Target\ClyoCloud-Setup-Windows.exe" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
