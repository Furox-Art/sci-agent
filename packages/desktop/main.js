import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Not (paketleme): sunucu ayrı bir `node server.js` süreci olarak değil,
// startServer doğrudan import edilerek aynı süreçte başlatılır ve asar ile
// paketlenir. server.js'in paket kökü dışına çıkan göreli yolları
// (../core/src/eq/eq-layer.js ve ../../package.json) electron-builder.yml
// içindeki extraResources/extraFiles ile paketlemeye eklenir.
import { startServer } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;

app.whenReady().then(async () => {
  try {
    const { port } = await startServer({ port: 0 });
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      backgroundColor: '#071b33',
      autoHideMenuBar: true,
      title: 'SciAgent',
      icon: path.join(__dirname, 'ui/assets/icon.png'),
    });
    await win.loadURL(`http://127.0.0.1:${port}`);
  } catch (e) {
    console.error('Sunucu başlatılamadı:', e);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
