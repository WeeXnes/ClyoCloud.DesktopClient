# PowerShell Setup Script for InstallerFramework
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$frameworkDir = "lib\InstallerFramework"
$repoUrl = "https://code.weexnes.dev/InstallerFramework.git"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "      ClyoCloud Installer Setup Script" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (Test-Path "$frameworkDir\src") {
    Write-Host "[+] InstallerFramework directory found in '$frameworkDir'." -ForegroundColor Green
} else {
    Write-Host "[+] Cloning InstallerFramework from '$repoUrl'..." -ForegroundColor Yellow
    if (!(Test-Path "lib")) { New-Item -ItemType Directory -Path "lib" | Out-Null }
    git clone $repoUrl $frameworkDir
}

# Restore dependencies
Write-Host "[+] Restoring .NET project dependencies..." -ForegroundColor Yellow
dotnet restore ClyoCloudInstaller.csproj

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " [SUCCESS] ClyoCloud Installer environment ready!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
