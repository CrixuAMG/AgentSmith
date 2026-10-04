const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');

const { loadSnapshot, saveResource, root: storageRoot } = require('./config-store.cjs');
const projectService = require('./project-service.cjs');
const { gitStatus, gitDiff, gitLog, gitBranches, gitPush, gitRemote } = require('./git-service.cjs');
const { discoverProviders } = require('./provider-service.cjs');
const {
  createRepositoryIssue,
  discoverVcsProviders,
  listRepositoryIssues,
  setVcsCredential,
  updateRepositoryIssue,
  authorizeGitHub,
} = require('./vcs-service.cjs');
const { startProcess, cancelProcess, cancelAllProcesses, hydrateJobs, listPromptJobs } = require('./process-service.cjs');
const { saveSuggestion } = require('./suggestion-service.cjs');
const { buildExternalPermissions, writeOpencodeJsonc } = require('./permissions-service.cjs');

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

app.whenReady().then(async () => {
  const initialSnapshot = await loadSnapshot();
  hydrateJobs(initialSnapshot.promptJobs);
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
  ipcMain.handle('git:diff', (_event, project, relativePath, staged, guardrails) => gitDiff(project, relativePath, staged, guardrails));
  ipcMain.handle('git:log', (_event, project, options) => gitLog(project, options || {}));
  ipcMain.handle('git:branches', (_event, project) => gitBranches(project));
  ipcMain.handle('git:push', (_event, project) => gitPush(project));
  ipcMain.handle('git:remote', (_event, project) => gitRemote(project));
  ipcMain.handle('instructions:list', (_event, project) => projectService.listInstructions(project, path.join(storageRoot, 'instructions', 'global.md')));
  ipcMain.handle('instructions:read', (_event, project, relativePath, guardrails) => projectService.readInstruction(project, relativePath, path.join(storageRoot, 'instructions', 'global.md'), guardrails));
  ipcMain.handle('instructions:write', (_event, project, relativePath, content, overwrite) => projectService.writeInstruction(project, relativePath, content, overwrite, path.join(storageRoot, 'instructions', 'global.md')));
  ipcMain.handle('providers:discover', () => discoverProviders());
  // Repository credentials are accepted here and held in main-process memory for the
  // session. No merge channel exists: issues are the only repository write AgentSmith has.
  ipcMain.handle('vcs:discover', () => discoverVcsProviders());
  ipcMain.handle('vcs:credential', (_event, providerId, token) => setVcsCredential(providerId, token));
  ipcMain.handle('vcs:github:authorize', () => authorizeGitHub());
  ipcMain.handle('vcs:issues:list', (_event, project, options) => listRepositoryIssues(project, options || {}));
  ipcMain.handle('vcs:issues:create', (_event, project, draft) => createRepositoryIssue(project, draft));
  ipcMain.handle('vcs:issues:update', (_event, project, number, patch) => updateRepositoryIssue(project, number, patch));
  ipcMain.handle('suggestions:save', (_event, project, content) => saveSuggestion(path.join(storageRoot, 'suggestions'), project, content));
  ipcMain.handle('process:start', async (_event, request) => {
    const snapshot = await loadSnapshot();
    let guardrailProfile = request.guardrailProfile;
    if (request.guardrailProfileId) {
      guardrailProfile = snapshot.guardrails.find((profile) => profile.id === request.guardrailProfileId) ?? null;
      if (!guardrailProfile) throw new Error('The selected guardrail profile no longer exists.');
    }
    return startProcess({ ...request, guardrailProfile }, (payload) => mainWindow?.webContents.send('process:event', payload), snapshot.config.maxConcurrentJobs);
  });
  ipcMain.handle('process:cancel', (_event, executionId) => cancelProcess(executionId));
  ipcMain.handle('process:list', () => listPromptJobs());
  ipcMain.handle('permissions:sync', async (_event, { project = null, allowedExternalPaths = [], allowedExternalPathsGlobal = [], writeExternalRepo = true } = {}) => {
    const asRoot = path.join(__dirname, '..');
    // AgentSmith workspace permissions
    const asPerms = buildExternalPermissions([...allowedExternalPathsGlobal, ...allowedExternalPaths]);
    await writeOpencodeJsonc(asRoot, asPerms);
    // External repo if requested
    if (writeExternalRepo && project?.path) {
      await writeOpencodeJsonc(project.path, buildExternalPermissions(allowedExternalPaths));
    }
    return { ok: true };
  });
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
