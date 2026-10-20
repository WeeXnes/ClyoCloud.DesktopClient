import os from 'os';
import fs from 'fs';

export function getDeviceModelString(): string {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();

  if (platform === 'win32') {
    // Determine Windows version roughly by build number
    const major = parseInt(release.split('.')[0], 10);
    const build = parseInt(release.split('.')[2] || '0', 10);
    if (major === 10) {
      if (build >= 22000) {
        return `Windows 11 (build ${build}, ${arch})`;
      }
      return `Windows 10 (build ${build}, ${arch})`;
    }
    return `Windows (${release}, ${arch})`;
  }

  if (platform === 'linux') {
    try {
      if (fs.existsSync('/etc/os-release')) {
        const content = fs.readFileSync('/etc/os-release', 'utf8');
        const match = content.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
        if (match && match[1]) {
          return `Linux (${match[1]}, ${arch})`;
        }
      }
    } catch {
      // fallback
    }
    return `Linux (${release}, ${arch})`;
  }

  return `Desktop (${platform} ${release}, ${arch})`;
}
