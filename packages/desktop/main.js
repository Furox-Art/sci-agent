import { app, BrowserWindow } from 'electron';
import { startServer } from './server.js';

let win = null;

app.whenReady().then(async () => {
  try {
    const { port } = await startServer({ port: 0 });
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      backgroundColor: '#0f1117',
      autoHideMenuBar: true,
      title: 'SciAgent',
    });
    await win.loadURL(`http://127.0.0.1:${port}`);
  } catch (e) {
    console.error('Sunucu başlatılamadı:', e);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
