# PowerShell Build Script for ClyoCloud Standalone Installer
param(
    [string]$Target = "win-x64"
)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Extract ClyoCloud version
$version = "1.0.6"
if (Test-Path "$scriptDir\..\package.json") {
    try {
        $pkg = Get-Content "$scriptDir\..\package.json" -Raw | ConvertFrom-Json
        if ($pkg.version) { $version = $pkg.version }
    } catch { }
}
Set-Content -Path "$scriptDir\version.txt" -Value $version

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "          Building ClyoCloud Installer" -ForegroundColor Cyan
Write-Host "          Version: $version" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (!(Test-Path "lib\InstallerFramework\src")) {
    Write-Host "[!] Framework source missing. Running setup script..." -ForegroundColor Yellow
    .\setup.ps1
}

$payloadSource = "$scriptDir\..\release\win-unpacked"
if (Test-Path $payloadSource) {
    # Ensure icon files are in payload root
    Copy-Item "$scriptDir\app.ico" "$payloadSource\app.ico" -Force -ErrorAction SilentlyContinue
    Copy-Item "$scriptDir\app.ico" "$payloadSource\icon.ico" -Force -ErrorAction SilentlyContinue
    Copy-Item "$scriptDir\app.png" "$payloadSource\clyocloud.png" -Force -ErrorAction SilentlyContinue
    Copy-Item "$scriptDir\app.png" "$payloadSource\icon.png" -Force -ErrorAction SilentlyContinue

    if (Test-Path "$payloadSource\clyocloud.exe") {
        Write-Host "[+] Patching Windows executable icon and metadata..." -ForegroundColor Yellow
        node "$scriptDir\..\scripts\patch-win-exe.js" "$payloadSource\clyocloud.exe"
    }

    Write-Host "[+] Packaging payload from $payloadSource into payload.zip..." -ForegroundColor Yellow
    if (Test-Path "payload.zip") { Remove-Item "payload.zip" -Force }
    Compress-Archive -Path "$payloadSource\*" -DestinationPath "payload.zip"
}

Write-Host "[+] Publishing self-contained single-file Release installer ($Target, v$version)..." -ForegroundColor Yellow
dotnet publish ClyoCloudInstaller.csproj -c Release -r $Target `
    --self-contained true `
    /p:PublishSingleFile=true `
    /p:IncludeNativeLibrariesForSelfExtract=true `
    /p:IncludeAllContentForSelfExtract=true `
    /p:EnableCompressionInSingleFile=true `
    /p:DebugType=none `
    /p:DebugSymbols=false `
    /p:Version="$version" `
    /p:InformationalVersion="$version" `
    /p:FileVersion="${version}.0" `
    /p:AssemblyVersion="${version}.0" `
    -o "publish\$Target"

if (Test-Path "publish\$Target\ClyoCloudInstaller.exe") {
    Move-Item -Path "publish\$Target\ClyoCloudInstaller.exe" -Destination "publish\$Target\ClyoCloud-Setup-Windows.exe" -Force
}

# Clean out any auxiliary files so only the standalone installer remains
Get-ChildItem -Path "publish\$Target" | Where-Object { $_.Name -ne "ClyoCloud-Setup-Windows.exe" } | Remove-Item -Force -Recurse

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " [SUCCESS] Self-contained standalone installer built:" -ForegroundColor Green
Write-Host " Location: publish\$Target\ClyoCloud-Setup-Windows.exe" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
