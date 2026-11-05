#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FRAMEWORK_DIR="lib/InstallerFramework"
REPO_URL="https://code.weexnes.dev/InstallerFramework.git"
LOCAL_FRAMEWORK="/tmp/InstallerFramework"
DEV_FRAMEWORK="/home/weexnes/Development/InstallerFramework/InstallerFramework"

echo "=================================================="
echo "      ClyoCloud Installer Setup Script"
echo "=================================================="

if [ -d "$FRAMEWORK_DIR/.git" ] || [ -d "$FRAMEWORK_DIR/src" ]; then
    echo "[+] InstallerFramework directory found in '$FRAMEWORK_DIR'."
elif [ -d "$DEV_FRAMEWORK/src" ]; then
    echo "[+] Copying InstallerFramework from local dev '$DEV_FRAMEWORK'..."
    mkdir -p lib
    cp -r "$DEV_FRAMEWORK" "$FRAMEWORK_DIR"
elif [ -d "$LOCAL_FRAMEWORK" ]; then
    echo "[+] Copying cached InstallerFramework from '$LOCAL_FRAMEWORK'..."
    mkdir -p lib
    cp -r "$LOCAL_FRAMEWORK" "$FRAMEWORK_DIR"
else
    echo "[+] Cloning InstallerFramework from '$REPO_URL'..."
    mkdir -p lib
    git clone "$REPO_URL" "$FRAMEWORK_DIR" || true
fi

# Detect installed .NET SDK version and ensure all projects match
SDK_MAJOR=$(dotnet --list-sdks 2>/dev/null | awk -F'.' '{print $1}' | sort -n | tail -n 1)
if [ -z "$SDK_MAJOR" ]; then
    SDK_MAJOR=$(dotnet --version 2>/dev/null | cut -d'.' -f1 || echo "10")
fi
TARGET_TFM="net${SDK_MAJOR}.0"
echo "[+] Detected .NET SDK major version: $SDK_MAJOR. Aligning all projects to TargetFramework: $TARGET_TFM..."

sed -i -E "s/<TargetFramework>net[0-9]+\.0<\/TargetFramework>/<TargetFramework>${TARGET_TFM}<\/TargetFramework>/g" \
    "$SCRIPT_DIR/ClyoCloudInstaller.csproj" \
    "$SCRIPT_DIR"/lib/InstallerFramework/src/*/*.csproj \
    "$SCRIPT_DIR"/lib/InstallerFramework/templates/*/*.csproj 2>/dev/null || true

echo "[+] Restoring .NET project dependencies..."
dotnet restore "$SCRIPT_DIR/ClyoCloudInstaller.csproj"

echo ""
echo "=================================================="
echo " [SUCCESS] ClyoCloud Installer environment ready!"
echo "=================================================="
