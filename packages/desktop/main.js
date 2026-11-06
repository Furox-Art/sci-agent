import { app, BrowserWindow, Menu, dialog } from 'electron';
import { mkdirSync, readFileSync } from 'node:fs';
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
// startServer'ın döndürdüğü { port, close } tutamağı; çıkışta kapatılır.
let serverHandle = null;
// Başlangıçta çözümlenen çalışma alanı (Hakkında diyaloğunda gösterilir).
let workspacePath = '';

// Çalışma alanı önceliği: SCI_AGENT_WORKSPACE env > paketli varsayılan
// (userData, örn. %APPDATA%/SciAgent) > dev cwd (bugünkü davranış korunur).
function resolveWorkspace() {
  if (process.env.SCI_AGENT_WORKSPACE) return path.resolve(process.env.SCI_AGENT_WORKSPACE);
  if (app.isPackaged) return app.getPath('userData');
  return process.cwd();
}

// Sürüm: kök package.json'dan (server.js'in VERSION'u ile aynı kaynak);
// okunamazsa Electron'un bildiği sürüme düş.
function appVersion() {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version;
  } catch {
    return app.getVersion();
  }
}

// Uygulama menüsü: File / View / Help (etiketler İngilizce). Windows'ta menü
// çubuğu BrowserWindow'daki autoHideMenuBar ile gizlidir ve Alt ile açılır.
function buildAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload Window',
          accelerator: 'CmdOrCtrl+R',
          click: () => { if (win && !win.isDestroyed()) win.reload(); },
        },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => { if (win && !win.isDestroyed()) win.webContents.toggleDevTools(); },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SciAgent',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: 'About SciAgent',
              message: `SciAgent ${appVersion()}`,
              detail: `Workspace: ${workspacePath || resolveWorkspace()}`,
            }),
        },
      ],
    },
  ]));
}

// Tek örnek kilidi: sunucu başlangıçta seçtiği portu kapar; ikinci örnek
// portu yarıştırmamak için hiçbir şey başlatmaz, mevcut pencereyi öne getirir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const workspace = resolveWorkspace();
      workspacePath = workspace;
      // Paketlenmiş uygulamada işlem cwd'si salt-okunur olabilir (kurulum
      // dizini); config/oturumlar yazılabilir çalışma alanına sabitlenir.
      if (app.isPackaged) {
        mkdirSync(workspace, { recursive: true });
        process.chdir(workspace);
      }
      const { port, close } = await startServer({ port: 0, workspace });
      serverHandle = { port, close };
      console.log(`SciAgent workspace: ${workspace}`);
      buildAppMenu();
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
      // Sessiz beyaz pencere yerine yerel hata diyaloğu (port çakışması,
      // yazılamayan çalışma alanı vb.) ve temiz çıkış.
      dialog.showErrorBox('SciAgent could not start', `${e?.message ?? e}\n\nThe application will now quit.`);
      app.exit(1);
    }
  });
}

app.on('window-all-closed', () => app.quit());

// Çıkışta sunucu tutamağını kapat: askıda dinleyici kalmasın.
app.on('before-quit', (event) => {
  if (!serverHandle) return;
  const { close } = serverHandle;
  serverHandle = null; // çift kapatmayı ve yeniden erteleme döngüsünü engelle
  event.preventDefault(); // close() bitene kadar çıkışı ertele
  // Pencereyi zorla kapat: canlı SSE/keep-alive bağlantılar close()'u
  // bekletmesin (ajan çalışırken Quit'e basılmış olabilir).
  try { win?.destroy(); } catch { /* pencere zaten yok */ }
  win = null;
  // Güvenlik ağı: kapatma 3 sn içinde bitmezse yine de çık.
  const guard = setTimeout(() => app.exit(0), 3000);
  close().finally(() => {
    clearTimeout(guard);
    app.quit();
  });
});
