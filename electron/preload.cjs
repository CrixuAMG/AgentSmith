const { contextBridge, ipcRenderer } = require('electron');

const api = {
  loadSnapshot: () => ipcRenderer.invoke('storage:load'),
  saveResource: (key, value) => ipcRenderer.invoke('storage:save', key, value),
  pickProject: () => ipcRenderer.invoke('projects:pick'),
  validateProject: (project) => ipcRenderer.invoke('projects:validate', project),
  scanProject: (project, options) => ipcRenderer.invoke('projects:scan', project, options),
  readFile: (project, relativePath, guardrails) => ipcRenderer.invoke('files:read', project, relativePath, guardrails),
  gitStatus: (project) => ipcRenderer.invoke('git:status', project),
  gitDiff: (project, relativePath, staged) => ipcRenderer.invoke('git:diff', project, relativePath, staged),
  gitLog: (project, options) => ipcRenderer.invoke('git:log', project, options),
  gitBranches: (project) => ipcRenderer.invoke('git:branches', project),
  gitPush: (project) => ipcRenderer.invoke('git:push', project),
  listInstructions: (project) => ipcRenderer.invoke('instructions:list', project),
  readInstruction: (project, relativePath) => ipcRenderer.invoke('instructions:read', project, relativePath),
  writeInstruction: (project, relativePath, content, overwrite) => ipcRenderer.invoke('instructions:write', project, relativePath, content, overwrite),
  discoverProviders: () => ipcRenderer.invoke('providers:discover'),
  saveSuggestion: (project, content) => ipcRenderer.invoke('suggestions:save', project, content),
  startProcess: (request) => ipcRenderer.invoke('process:start', request),
  cancelProcess: (executionId) => ipcRenderer.invoke('process:cancel', executionId),
  onProcessEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('process:event', listener);
    return () => ipcRenderer.removeListener('process:event', listener);
  },
};

contextBridge.exposeInMainWorld('agentSmith', api);
