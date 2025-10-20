const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Configure environment for server and transcoding
// Do NOT force a default PORT here; we use a default range (4000-4010) below
process.env.ELECTRON_TRANSCODE = process.env.ELECTRON_TRANSCODE || 'false';
process.env.NODE_ENV = 'production';

let mainWindow;
let serverInfo = null;

async function waitForServer(maxWaitMs = 15000, host = '127.0.0.1', port = 3001) {
  const start = Date.now();
  const http = require('http');
  while (Date.now() - start < maxWaitMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get({ host, port, path: '/api/health', timeout: 1500 }, res => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve(); else reject(new Error('bad status'));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
      });
      return true;
    } catch (_) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // Allow loading external content for video streaming
    }
  });

  const host = (serverInfo && serverInfo.host) || process.env.HOST || '127.0.0.1';
  const port = (serverInfo && serverInfo.port) || Number(process.env.PORT) || 3001;
  await waitForServer(20000, host, port);
  const url = `http://${host}:${port}`;
  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle navigation and external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow external links to open in default browser
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent in-app navigation to external domains (e.g., OAuth pages); open externally
  const appOrigin = `http://${host}:${port}`;
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (!String(targetUrl).startsWith(appOrigin)) {
        event.preventDefault();
        require('electron').shell.openExternal(targetUrl);
      }
    } catch (_) {}
  });

  // IPC: open external media player (mpv/vlc)
  const { ipcMain } = require('electron');
  const { spawn } = require('child_process');
  ipcMain.handle('open-external-player', async (_evt, url) => {
    try {
      const trySpawn = (cmd, args) => new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.on('error', reject);
        child.unref();
        resolve(true);
      });
      // Prefer mpv, then vlc
      try {
        await trySpawn('mpv', ['--no-terminal', url]);
        return { ok: true, player: 'mpv' };
      } catch (_) {}
      try {
        await trySpawn('vlc', ['--quiet', url]);
        return { ok: true, player: 'vlc' };
      } catch (e2) {
        // Fallback: open in default browser if no player
        require('electron').shell.openExternal(url);
        return { ok: true, player: 'browser' };
      }
    } catch (e) {
      console.error('Failed to open external player:', e);
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

// Start Express server inside Electron process (dynamic port and host; try a list of ports)
async function startServer() {
  try {
    const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
    const srv = require(serverEntry);
    const host = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';
    const rangeEnv = process.env.PORT_RANGE || '';
    const ports = [];
    // 1) If PORT is set, try it first, but do not fail if busy
    const envPort = parseInt(process.env.PORT || '', 10);
    if (!isNaN(envPort) && envPort > 0) ports.push(envPort);
    // 2) If PORT_RANGE provided, append that sequence
    if (rangeEnv && /\d+-\d+/.test(rangeEnv)) {
      const [a, b] = rangeEnv.split('-').map(x => parseInt(x, 10));
      if (!isNaN(a) && !isNaN(b) && a <= b) {
        for (let p = a; p <= b; p++) ports.push(p);
      }
    } else {
      // 3) Default range 4000-4010
      for (let p = 4000; p <= 4010; p++) ports.push(p);
    }
    // Deduplicate while preserving order
    const seen = new Set();
    const tryPorts = ports.filter(p => (p && !seen.has(p)) ? (seen.add(p), true) : false);
    let lastError = null;
    for (const p of tryPorts) {
      try {
        serverInfo = await srv.startServer(p, host, { allowRandomFallback: false });
        break;
      } catch (e) {
        lastError = e;
        if (!(e && e.code === 'EADDRINUSE')) throw e;
        // else try next port
      }
    }
    if (!serverInfo) throw lastError || new Error('Failed to bind any port');
    console.log('Server started successfully in Electron process at', serverInfo);
  } catch (error) {
    console.error('Failed to start server:', error);
    throw error;
  }
}

app.whenReady().then(async () => {
  // Allow mixed content for debrid video origins if needed
  const ses = session.defaultSession;
  try {
    await ses.setPermissionCheckHandler(() => true);
  } catch (_) {}

  try {
    await startServer();
    await createWindow();
  } catch (e) {
    console.error('Fatal: could not start server or create window', e);
    const { dialog } = require('electron');
    try {
      await dialog.showErrorBox('Flake Wire', `Failed to start server: ${e && e.message ? e.message : e}`);
    } catch (_) {}
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
