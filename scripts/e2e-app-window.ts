// End-to-end check of the app window against a running ClyoCloud server, without showing any window.
// Usage: E2E_OUT=<dir> E2E_SERVER=<url> E2E_TOKEN=<jwt> electron dist/main/e2e-harness.js
import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { SettingsManager } from '../src/main/storage/settings';
import { SecureStore } from '../src/main/storage/secureStore';
import { AppWindowManager } from '../src/main/appWindow';

const OUT = process.env.E2E_OUT!;
const SERVER = process.env.E2E_SERVER!;
const TOKEN = process.env.E2E_TOKEN!;
app.setPath('userData', path.join(OUT, 'userdata'));
app.setPath('downloads', path.join(OUT, 'downloads'));
fs.mkdirSync(path.join(OUT, 'downloads'), { recursive: true });
// Never put a window on screen
BrowserWindow.prototype.show = function () {} as any;
BrowserWindow.prototype.focus = function () {} as any;

const log = (...a: unknown[]) => console.log('[e2e]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    SettingsManager.getInstance().setServerUrl(SERVER);
    SettingsManager.getInstance().setUsername('tester');
    SecureStore.getInstance().saveToken('tester', TOKEN);
    let accountChanges = 0;
    AppWindowManager.getInstance().init('', () => accountChanges++);

    await AppWindowManager.getInstance().show('/files');
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.webContents;
    await sleep(3000);
    log('1 url after open:', wc.getURL(), '| title:', wc.getTitle());
    fs.writeFileSync(path.join(OUT, '1-files.png'), (await wc.capturePage()).toPNG());
    const visibleText = await wc.executeJavaScript('document.body.innerText.slice(0, 300)');
    log('1 page text:', JSON.stringify(visibleText.replace(/\s+/g, ' ').slice(0, 160)));

    wc.downloadURL(`${SERVER}/file/Docs/readme.txt`);
    await sleep(2500);
    log('2 downloads:', fs.readdirSync(path.join(OUT, 'downloads')), '->', fs.readFileSync(path.join(OUT, 'downloads', 'readme.txt'), 'utf-8').trim());

    await wc.executeJavaScript('document.cookie = "token=; path=/; max-age=0"');
    await sleep(1500);
    log('3 after web sign-out: companion user =', JSON.stringify(SettingsManager.getInstance().getUsername()), '| account change callbacks:', accountChanges);

    SettingsManager.getInstance().setUsername('tester');
    SecureStore.getInstance().saveToken('tester', TOKEN);
    SettingsManager.getInstance().setServerUrl('http://127.0.0.1:1');
    await AppWindowManager.getInstance().load();
    await sleep(2500);
    log('4 unreachable server ->', wc.getURL().split('?')[0].split('/').slice(-2).join('/'));
    log('4 offline page text:', JSON.stringify((await wc.executeJavaScript('document.body.innerText')).replace(/\s+/g, ' ').trim()));
    wc.invalidate();
    const shot = await Promise.race([wc.capturePage(), sleep(4000).then(() => null)]);
    if (shot) fs.writeFileSync(path.join(OUT, '4-offline.png'), shot.toPNG());
    else log('4 (screenshot of the hidden window timed out)');
  } catch (e) {
    log('FAILED', e);
  }
  app.exit(0);
});
