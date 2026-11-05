#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const targetExe = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../release/win-unpacked/clyocloud.exe');

const iconIco = path.resolve(__dirname, '../assets/icon.ico');
const pkgJsonPath = path.resolve(__dirname, '../package.json');

if (!fs.existsSync(targetExe)) {
  console.log(`[patch-win-exe] Executable not found at ${targetExe}, skipping.`);
  process.exit(0);
}

if (!fs.existsSync(iconIco)) {
  console.log(`[patch-win-exe] Icon file not found at ${iconIco}, skipping.`);
  process.exit(0);
}

let version = '1.0.6';
let productName = 'ClyoCloud';
let description = 'ClyoCloud Desktop Companion';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  if (pkg.version) version = pkg.version;
  if (pkg.build && pkg.build.productName) productName = pkg.build.productName;
  if (pkg.description) description = pkg.description;
} catch (e) {
  console.warn('[patch-win-exe] Failed to read package.json:', e);
}

try {
  const resedit = require('resedit');
  const exeData = fs.readFileSync(targetExe);
  const exe = resedit.NtExecutable.from(exeData);
  const res = resedit.NtExecutableResource.from(exe);

  // 1. Replace default Electron icon with ClyoCloud icon
  const iconData = fs.readFileSync(iconIco);
  const iconFile = resedit.Data.IconFile.from(iconData);
  resedit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033,
    iconFile.icons.map((item) => item.data)
  );

  // 2. Update VersionInfo resource
  const quadVersion = version.split('.').length === 3 ? `${version}.0` : version;
  const viList = resedit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList.length > 0 ? viList[0] : resedit.Resource.VersionInfo.createEmpty();
  vi.setProductVersion(quadVersion, 1033);
  vi.setFileVersion(quadVersion, 1033);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      FileDescription: description,
      ProductName: productName,
      CompanyName: 'WeeXnes',
      LegalCopyright: 'Copyright (c) ClyoCloud',
      OriginalFilename: 'clyocloud.exe',
      InternalName: 'clyocloud'
    }
  );
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  const newExeData = Buffer.from(exe.generate());
  fs.writeFileSync(targetExe, newExeData);
  console.log(`[patch-win-exe] Successfully patched icon and version info into ${targetExe}`);
} catch (err) {
  console.error('[patch-win-exe] Failed to patch Windows executable:', err);
}
