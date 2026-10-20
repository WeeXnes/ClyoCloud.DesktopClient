#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FRAMEWORK_DIR="lib/InstallerFramework"
REPO_URL="https://code.weexnes.dev/InstallerFramework.git"
LOCAL_FRAMEWORK="/tmp/InstallerFramework"

echo "=================================================="
echo "      ClyoCloud Installer Setup Script"
echo "=================================================="

if [ -d "$FRAMEWORK_DIR/.git" ] || [ -d "$FRAMEWORK_DIR/src" ]; then
    echo "[+] InstallerFramework directory found in '$FRAMEWORK_DIR'."
elif [ -d "$LOCAL_FRAMEWORK" ]; then
    echo "[+] Copying cached InstallerFramework from '$LOCAL_FRAMEWORK'..."
    mkdir -p lib
    cp -r "$LOCAL_FRAMEWORK" "$FRAMEWORK_DIR"
else
    echo "[+] Cloning InstallerFramework from '$REPO_URL'..."
    mkdir -p lib
    git clone "$REPO_URL" "$FRAMEWORK_DIR" || true
fi

# Detect if current SDK is .NET 8 or .NET 10
DOTNET_VER=$(dotnet --version 2>/dev/null || echo "8.0")
if [[ "$DOTNET_VER" =~ ^8\. ]]; then
    echo "[+] Adapting TargetFramework to net8.0 for current SDK ($DOTNET_VER)..."
    sed -i 's/<TargetFramework>net10.0<\/TargetFramework>/<TargetFramework>net8.0<\/TargetFramework>/g' \
        lib/InstallerFramework/src/*/*.csproj 2>/dev/null || true
fi

echo "[+] Restoring .NET project dependencies..."
dotnet restore ClyoCloudInstaller.csproj

echo ""
echo "=================================================="
echo " [SUCCESS] ClyoCloud Installer environment ready!"
echo "=================================================="
