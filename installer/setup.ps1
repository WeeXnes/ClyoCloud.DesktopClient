# PowerShell Setup Script for ClyoCloud Standalone Installer
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$frameworkDir = Join-Path $scriptDir "lib\InstallerFramework"
$repoUrl = "https://code.weexnes.dev/InstallerFramework.git"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "      ClyoCloud Installer Setup Script" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (!(Test-Path $frameworkDir)) {
    Write-Host "[+] Cloning InstallerFramework from '$repoUrl'..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "lib" -Force | Out-Null
    git clone $repoUrl $frameworkDir
} else {
    Write-Host "[+] InstallerFramework directory found in '$frameworkDir'." -ForegroundColor Green
}

# Detect installed .NET SDK version and ensure all projects match
$sdkOutput = dotnet --list-sdks 2>$null
$sdkMajor = 10
if ($sdkOutput) {
    $matches = [regex]::Matches($sdkOutput, "^(\d+)\.", [System.Text.RegularExpressions.RegexOptions]::Multiline)
    if ($matches.Count -gt 0) {
        $sdkMajor = [int]($matches | ForEach-Object { $_.Groups[1].Value } | Measure-Object -Maximum).Maximum
    }
}
$targetTfm = "net$sdkMajor.0"
Write-Host "[+] Detected .NET SDK major version: $sdkMajor. Aligning TargetFramework to: $targetTfm..." -ForegroundColor Yellow

Get-ChildItem -Path @("ClyoCloudInstaller.csproj", "lib\InstallerFramework\src\*\*.csproj", "lib\InstallerFramework\templates\*\*.csproj") -ErrorAction SilentlyContinue | ForEach-Object {
    (Get-Content $_.FullName) -replace '<TargetFramework>net\d+\.0</TargetFramework>', "<TargetFramework>$targetTfm</TargetFramework>" | Set-Content $_.FullName
}

Write-Host "[+] Restoring .NET project dependencies..." -ForegroundColor Yellow
dotnet restore "$scriptDir\ClyoCloudInstaller.csproj"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " [SUCCESS] ClyoCloud Installer environment ready!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
