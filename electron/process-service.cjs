const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const { canonicalRoot } = require('./project-service.cjs');
const { buildExecutionCommand, discoverProviders } = require('./provider-service.cjs');

const activeProcesses = new Map();
const queuedProcesses = [];
let startingProcesses = 0;
const cancellationTimers = new Map();
const cancellationGracePeriod = 2000;
const defaultMaxConcurrentJobs = 2;

function normalizeMaxConcurrentJobs(value) {
  if (!Number.isInteger(value)) return defaultMaxConcurrentJobs;
  return Math.min(Math.max(value, 1), 10);
}

function closeProcessInput(child) {
  child.stdin?.end();
}

function evaluateExecutionGuardrails(request) {
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new Error('An execution prompt is required.');
  const denied = (request.guardrailProfile?.rules || []).find((rule) => rule.enabled
    && rule.type === 'agent_permission'
    && rule.action === 'deny'
    && /execute|provider process|run agent/i.test(rule.pattern));
  if (denied) throw new Error(denied.description || `Execution blocked by guardrail ${denied.id}.`);
}

async function launchProcess(request, emit, executionId) {
  let root;
  let discovery;
  let configuration;
  let child;
  try {
    root = await canonicalRoot({ path: request.projectPath });
    discovery = await discoverProviders();
    configuration = buildExecutionCommand({ ...request, projectPath: root }, discovery);
    child = spawn(configuration.executable, configuration.args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: process.env,
    });
  } catch (error) {
    emit({ executionId, kind: 'failed', text: error.message, exitCode: null, providerId: request.providerId });
    return;
  }
  closeProcessInput(child);
  activeProcesses.set(executionId, child);
  let ended = false;
  const clearProcess = () => {
    if (ended) return false;
    ended = true;
    activeProcesses.delete(executionId);
    const timer = cancellationTimers.get(executionId);
    if (timer) clearTimeout(timer);
    cancellationTimers.delete(executionId);
    return true;
  };
  emit({ executionId, kind: 'started', providerId: request.providerId, command: configuration.displayCommand });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => emit({ executionId, kind: 'stdout', text: String(text), providerId: request.providerId }));
  child.stderr.on('data', (text) => emit({ executionId, kind: 'stderr', text: String(text), providerId: request.providerId }));
  child.on('error', (error) => {
    if (!clearProcess()) return;
    emit({ executionId, kind: 'failed', text: error.message, exitCode: null, providerId: request.providerId });
    void pumpQueue();
  });
  child.on('close', (code, signal) => {
    if (!clearProcess()) return;
    if (signal) emit({ executionId, kind: 'cancelled', text: `Process terminated with ${signal}.`, exitCode: code, providerId: request.providerId });
    else emit({ executionId, kind: code === 0 ? 'completed' : 'failed', exitCode: code, providerId: request.providerId });
    void pumpQueue();
  });
}

async function pumpQueue() {
  while (queuedProcesses.length && activeProcesses.size + startingProcesses < queuedProcesses[0].limit) {
    const item = queuedProcesses.shift();
    startingProcesses += 1;
    void launchProcess(item.request, item.emit, item.executionId).finally(() => {
      startingProcesses -= 1;
      void pumpQueue();
    });
  }
}

async function startProcess(request, emit, maxConcurrentJobs = defaultMaxConcurrentJobs) {
  evaluateExecutionGuardrails(request);
  const limit = normalizeMaxConcurrentJobs(maxConcurrentJobs);
  const executionId = crypto.randomUUID();
  queuedProcesses.push({ request, emit, executionId, limit });
  void pumpQueue();
  return { executionId, command: null };
}

async function cancelProcess(executionId) {
  const child = activeProcesses.get(executionId);
  if (!child) {
    const index = queuedProcesses.findIndex((item) => item.executionId === executionId);
    if (index >= 0) {
      const [item] = queuedProcesses.splice(index, 1);
      item.emit({ executionId, kind: 'cancelled', text: 'Queued execution cancelled.', exitCode: null, providerId: item.request.providerId });
    }
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  if (cancellationTimers.has(executionId)) return;
  const timer = setTimeout(() => {
    if (activeProcesses.get(executionId) !== child) return;
    try {
      child.kill('SIGKILL');
    } catch {
      // The process may have exited during the grace period.
    }
  }, cancellationGracePeriod);
  timer.unref?.();
  cancellationTimers.set(executionId, timer);
}

function cancelAllProcesses() {
  for (const executionId of activeProcesses.keys()) void cancelProcess(executionId);
  for (const item of queuedProcesses.splice(0)) {
    item.emit({ executionId: item.executionId, kind: 'cancelled', text: 'Queued execution cancelled.', exitCode: null, providerId: item.request.providerId });
  }
}

module.exports = { startProcess, cancelProcess, cancelAllProcesses, evaluateExecutionGuardrails, closeProcessInput, normalizeMaxConcurrentJobs };
