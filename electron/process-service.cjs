const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const { canonicalRoot } = require('./project-service.cjs');
const { buildExecutionCommand, discoverProviders } = require('./provider-service.cjs');

const activeProcesses = new Map();

async function startProcess(request, emit) {
  const root = await canonicalRoot({ path: request.projectPath });
  const discovery = await discoverProviders();
  const configuration = buildExecutionCommand({ ...request, projectPath: root }, discovery);
  const executionId = crypto.randomUUID();
  const child = spawn(configuration.executable, configuration.args, {
    cwd: root,
    shell: false,
    windowsHide: true,
    env: process.env,
  });
  activeProcesses.set(executionId, child);
  emit({ executionId, kind: 'started', providerId: request.providerId });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => emit({ executionId, kind: 'stdout', text: String(text), providerId: request.providerId }));
  child.stderr.on('data', (text) => emit({ executionId, kind: 'stderr', text: String(text), providerId: request.providerId }));
  child.on('error', (error) => {
    activeProcesses.delete(executionId);
    emit({ executionId, kind: 'failed', text: error.message, exitCode: null, providerId: request.providerId });
  });
  child.on('close', (code, signal) => {
    activeProcesses.delete(executionId);
    if (signal) emit({ executionId, kind: 'cancelled', text: `Process terminated with ${signal}.`, exitCode: code, providerId: request.providerId });
    else emit({ executionId, kind: code === 0 ? 'completed' : 'failed', exitCode: code, providerId: request.providerId });
  });
  return { executionId, command: configuration.displayCommand };
}

async function cancelProcess(executionId) {
  const child = activeProcesses.get(executionId);
  if (!child) return;
  child.kill('SIGTERM');
}

module.exports = { startProcess, cancelProcess };
