#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="${1:-all}"

# Extract target ClyoCloud desktop version
VERSION=$(node -p "require('../package.json').version" 2>/dev/null || grep -oP '"version":\s*"\K[^"]+' ../package.json || echo "1.0.6")
echo "$VERSION" > "$SCRIPT_DIR/version.txt"

echo "=================================================="
echo "          Building ClyoCloud Installer"
echo "          Version: $VERSION"
echo "=================================================="

# Ensure framework is setup and SDK TargetFramework aligned
if [ ! -d "lib/InstallerFramework/src" ]; then
    echo "[!] Framework source missing. Running ./setup.sh..."
    ./setup.sh
else
    # Align TargetFramework to current SDK in case SDK changed
    SDK_MAJOR=$(dotnet --list-sdks 2>/dev/null | awk -F'.' '{print $1}' | sort -n | tail -n 1)
    if [ -z "$SDK_MAJOR" ]; then
        SDK_MAJOR=$(dotnet --version 2>/dev/null | cut -d'.' -f1 || echo "10")
    fi
    TARGET_TFM="net${SDK_MAJOR}.0"
    sed -i -E "s/<TargetFramework>net[0-9]+\.0<\/TargetFramework>/<TargetFramework>${TARGET_TFM}<\/TargetFramework>/g" \
        "$SCRIPT_DIR/ClyoCloudInstaller.csproj" \
        "$SCRIPT_DIR"/lib/InstallerFramework/src/*/*.csproj \
        "$SCRIPT_DIR"/lib/InstallerFramework/templates/*/*.csproj 2>/dev/null || true
fi

build_target() {
    local RID="$1"
    local OUT_NAME="$2"
    local PAYLOAD_SOURCE="$3"

    echo ""
    echo "[+] Preparing payload for $RID..."
    if [ -d "$PAYLOAD_SOURCE" ]; then
        # Ensure icon files are present in the payload root
        cp -f "$SCRIPT_DIR/app.png" "$PAYLOAD_SOURCE/clyocloud.png" 2>/dev/null || cp -f "$SCRIPT_DIR/../assets/icon.png" "$PAYLOAD_SOURCE/clyocloud.png" 2>/dev/null || true
        cp -f "$SCRIPT_DIR/app.png" "$PAYLOAD_SOURCE/icon.png" 2>/dev/null || cp -f "$SCRIPT_DIR/../assets/icon.png" "$PAYLOAD_SOURCE/icon.png" 2>/dev/null || true
        cp -f "$SCRIPT_DIR/app.ico" "$PAYLOAD_SOURCE/app.ico" 2>/dev/null || cp -f "$SCRIPT_DIR/../assets/icon.ico" "$PAYLOAD_SOURCE/app.ico" 2>/dev/null || true
        cp -f "$SCRIPT_DIR/app.ico" "$PAYLOAD_SOURCE/icon.ico" 2>/dev/null || cp -f "$SCRIPT_DIR/../assets/icon.ico" "$PAYLOAD_SOURCE/icon.ico" 2>/dev/null || true

        if [ "$RID" = "win-x64" ] && [ -f "$PAYLOAD_SOURCE/clyocloud.exe" ]; then
            echo "[+] Patching Windows PE executable resources and icon..."
            node "$SCRIPT_DIR/../scripts/patch-win-exe.js" "$PAYLOAD_SOURCE/clyocloud.exe" || true
        fi

        echo "[+] Zipping payload from $PAYLOAD_SOURCE to payload.zip..."
        rm -f payload.zip
        if command -v zip >/dev/null 2>&1; then
            (cd "$PAYLOAD_SOURCE" && zip -r -q "$SCRIPT_DIR/payload.zip" .)
        else
            python3 -c "
import os, zipfile
src = '$PAYLOAD_SOURCE'
out = '$SCRIPT_DIR/payload.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src)
            z.write(full, rel)
print('Zipped payload successfully via python3')
"
        fi
    elif [ ! -f "payload.zip" ]; then
        echo "[!] No payload found at '$PAYLOAD_SOURCE'. Creating stub payload.zip..."
        mkdir -p /tmp/clyo-stub
        touch /tmp/clyo-stub/clyocloud
        chmod +x /tmp/clyo-stub/clyocloud
        python3 -c "
import os, zipfile
src = '/tmp/clyo-stub'
out = '$SCRIPT_DIR/payload.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src)
            z.write(full, rel)
"
        rm -rf /tmp/clyo-stub
    fi

    echo "[+] Publishing self-contained single-file standalone installer for $RID (v$VERSION)..."
    mkdir -p "publish/$RID"
    dotnet publish ClyoCloudInstaller.csproj -c Release -r "$RID" \
        --self-contained true \
        /p:PublishSingleFile=true \
        /p:IncludeNativeLibrariesForSelfExtract=true \
        /p:IncludeAllContentForSelfExtract=true \
        /p:EnableCompressionInSingleFile=true \
        /p:DebugType=none \
        /p:DebugSymbols=false \
        /p:Version="$VERSION" \
        /p:InformationalVersion="$VERSION" \
        /p:FileVersion="${VERSION}.0" \
        /p:AssemblyVersion="${VERSION}.0" \
        -o "publish/$RID"

    # Rename output executable cleanly
    if [ -f "publish/$RID/ClyoCloudInstaller.exe" ]; then
        mv "publish/$RID/ClyoCloudInstaller.exe" "publish/$RID/$OUT_NAME"
    elif [ -f "publish/$RID/ClyoCloudInstaller" ]; then
        mv "publish/$RID/ClyoCloudInstaller" "publish/$RID/$OUT_NAME"
    fi

    # Clean out any leftover pdb, json or dll files so only the single standalone executable remains
    find "publish/$RID" -mindepth 1 -not -name "$OUT_NAME" -delete

    echo "[SUCCESS] Standalone single-file installer generated at: publish/$RID/$OUT_NAME"
    ls -lh "publish/$RID/$OUT_NAME"
}

if [ "$TARGET" = "linux-x64" ] || [ "$TARGET" = "linux" ]; then
    build_target "linux-x64" "ClyoCloud-Setup-Linux" "$SCRIPT_DIR/../release/linux-unpacked"
elif [ "$TARGET" = "win-x64" ] || [ "$TARGET" = "win" ] || [ "$TARGET" = "windows" ]; then
    build_target "win-x64" "ClyoCloud-Setup-Windows.exe" "$SCRIPT_DIR/../release/win-unpacked"
else
    # Build both
    build_target "linux-x64" "ClyoCloud-Setup-Linux" "$SCRIPT_DIR/../release/linux-unpacked"
    build_target "win-x64" "ClyoCloud-Setup-Windows.exe" "$SCRIPT_DIR/../release/win-unpacked"
fi

echo ""
echo "=================================================="
echo " [SUCCESS] All target installers built successfully!"
echo "=================================================="
