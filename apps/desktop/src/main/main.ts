import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import { join, resolve } from 'path';
import fg from 'fast-glob';
import * as mm from 'music-metadata';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

const createWindow = async () => {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'HiResSpot',
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      // Allow loading local file:// resources (audio) from the dev server origin
      webSecurity: false,
      devTools: !app.isPackaged
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
};

app.whenReady().then(() => {
  // Register custom protocol to serve local files without file:// restrictions
  const ses = session.defaultSession;
  try {
    ses.protocol.registerFileProtocol('local-audio', (request, callback) => {
      try {
        const url = request.url.replace('local-audio://', '');
        const filePath = decodeURIComponent(url);
        callback({ path: filePath });
      } catch (err) {
        console.error('local-audio protocol error', err);
        callback({ path: '' });
      }
    });
  } catch (err) {
    console.error('Failed to register local-audio protocol', err);
  }
  createWindow().catch((error) => {
    console.error('Failed to create main window:', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error('Failed to recreate main window:', error);
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---- IPC: Spotify (dummy for now) ----
ipcMain.handle('spotify:login', async () => 'login-ok');
ipcMain.handle('spotify:logout', async () => 'logout-ok');

// ---- IPC: System ----
ipcMain.handle('system:openFolderDialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecciona tu carpeta de música',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---- IPC: Library ----
ipcMain.handle('library:scanFolder', async (_event, folderPath: string) => {
  try {
    if (!folderPath) return [];
    const cwd = resolve(folderPath);
    const files = await fg(["**/*.flac", "**/*.wav"], {
      cwd,
      onlyFiles: true,
      absolute: true,
      dot: false,
      followSymbolicLinks: true,
      caseSensitiveMatch: false
    });

    const tracks = await Promise.all(
      files.map(async (filePath) => {
        try {
          const metadata = await mm.parseFile(filePath, { duration: true });
          const common = metadata.common || {};
          const format = metadata.format || {};

          let picture: string | undefined;
          if (Array.isArray(common.picture) && common.picture.length > 0) {
            const pic = common.picture[0];
            const mime = pic.format || 'image/jpeg';
            picture = `data:${mime};base64,${Buffer.from(pic.data).toString('base64')}`;
          }

          const title = common.title || filePath.split(/[\/\\]/).pop() || 'Unknown Title';
          // Prefer a single primary artist to avoid grouping differences by features
          const artist = (common.artist || (Array.isArray(common.artists) ? common.artists[0] : undefined) || 'Unknown Artist') as string;
          const album = common.album || 'Unknown Album';
          const albumArtist = (common as any).albumartist as string | undefined;

          return {
            id: filePath,
            path: filePath,
            title,
            artist,
            album,
            albumArtist,
            duration: typeof format.duration === 'number' ? format.duration : undefined,
            sampleRate: format.sampleRate,
            bitDepth: (format.bitsPerSample as number | undefined) || undefined,
            picture
          };
        } catch (err) {
          // If a file fails to parse, skip it instead of failing the whole scan
          return null;
        }
      })
    );

    return tracks.filter((t): t is any => !!t);
  } catch (error) {
    console.error('library:scanFolder error', error);
    return [];
  }
});

// ---- IPC: File Read ----
ipcMain.handle('file:read', async (_e, absPath: string) => {
  const { readFile } = await import('fs/promises');
  return readFile(absPath);
});
