#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="${1:-all}"

echo "=================================================="
echo "          Building ClyoCloud Installer"
echo "=================================================="

# Ensure framework is setup
if [ ! -d "lib/InstallerFramework/src" ]; then
    echo "[!] Framework source missing. Running ./setup.sh..."
    ./setup.sh
fi

build_target() {
    local RID="$1"
    local OUT_NAME="$2"
    local PAYLOAD_SOURCE="$3"

    echo ""
    echo "[+] Preparing payload for $RID..."
    if [ -d "$PAYLOAD_SOURCE" ]; then
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

    echo "[+] Publishing single-file installer for $RID..."
    dotnet publish ClyoCloudInstaller.csproj -c Release -r "$RID" \
        /p:PublishSingleFile=true \
        /p:IncludeNativeLibrariesForSelfExtract=true \
        --self-contained true \
        -o "publish/$RID"

    # Rename output executable cleanly
    if [ -f "publish/$RID/ClyoCloudInstaller.exe" ]; then
        mv "publish/$RID/ClyoCloudInstaller.exe" "publish/$RID/$OUT_NAME"
    elif [ -f "publish/$RID/ClyoCloudInstaller" ]; then
        mv "publish/$RID/ClyoCloudInstaller" "publish/$RID/$OUT_NAME"
    fi

    echo "[SUCCESS] Installer generated at: publish/$RID/$OUT_NAME"
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
