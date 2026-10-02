const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');

const { loadSnapshot, saveResource, root: storageRoot } = require('./config-store.cjs');
const projectService = require('./project-service.cjs');
const { gitStatus, gitDiff, gitLog, gitBranches, gitPush } = require('./git-service.cjs');
const { discoverProviders } = require('./provider-service.cjs');
const { startProcess, cancelProcess, cancelAllProcesses } = require('./process-service.cjs');
const { saveSuggestion } = require('./suggestion-service.cjs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#080b0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('storage:load', () => loadSnapshot());
  ipcMain.handle('storage:save', (_event, key, value) => saveResource(key, value));
  ipcMain.handle('projects:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a project directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selectedPath = result.filePaths[0];
    return { path: selectedPath, name: path.basename(selectedPath) };
  });
  ipcMain.handle('projects:validate', (_event, project) => projectService.validateProject(project));
  ipcMain.handle('projects:scan', (_event, project, options) => projectService.scanProject(project, options));
  ipcMain.handle('files:read', (_event, project, relativePath, guardrails) => projectService.readFile(project, relativePath, guardrails));
  ipcMain.handle('git:status', (_event, project) => gitStatus(project));
  ipcMain.handle('git:diff', (_event, project, relativePath, staged) => gitDiff(project, relativePath, staged));
  ipcMain.handle('git:log', (_event, project, options) => gitLog(project, options || {}));
  ipcMain.handle('git:branches', (_event, project) => gitBranches(project));
  ipcMain.handle('git:push', (_event, project) => gitPush(project));
  ipcMain.handle('instructions:list', (_event, project) => projectService.listInstructions(project, path.join(storageRoot, 'instructions', 'global.md')));
  ipcMain.handle('instructions:read', (_event, project, relativePath) => projectService.readInstruction(project, relativePath, path.join(storageRoot, 'instructions', 'global.md')));
  ipcMain.handle('instructions:write', (_event, project, relativePath, content, overwrite) => projectService.writeInstruction(project, relativePath, content, overwrite, path.join(storageRoot, 'instructions', 'global.md')));
  ipcMain.handle('providers:discover', () => discoverProviders());
  ipcMain.handle('suggestions:save', (_event, project, content) => saveSuggestion(path.join(storageRoot, 'suggestions'), project, content));
  ipcMain.handle('process:start', async (_event, request) => {
    const snapshot = await loadSnapshot();
    return startProcess(request, (payload) => mainWindow?.webContents.send('process:event', payload), snapshot.config.maxConcurrentJobs);
  });
  ipcMain.handle('process:cancel', (_event, executionId) => cancelProcess(executionId));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cancelAllProcesses();
});
