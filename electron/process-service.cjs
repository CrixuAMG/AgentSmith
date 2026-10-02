const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const { canonicalRoot } = require('./project-service.cjs');
const { buildExecutionCommand, discoverProviders } = require('./provider-service.cjs');

const activeProcesses = new Map();
const cancellationTimers = new Map();
const cancellationGracePeriod = 2000;

function evaluateExecutionGuardrails(request) {
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new Error('An execution prompt is required.');
  const denied = (request.guardrailProfile?.rules || []).find((rule) => rule.enabled
    && rule.type === 'agent_permission'
    && rule.action === 'deny'
    && /execute|provider process|run agent/i.test(rule.pattern));
  if (denied) throw new Error(denied.description || `Execution blocked by guardrail ${denied.id}.`);
}

async function startProcess(request, emit) {
  evaluateExecutionGuardrails(request);
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
  emit({ executionId, kind: 'started', providerId: request.providerId });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => emit({ executionId, kind: 'stdout', text: String(text), providerId: request.providerId }));
  child.stderr.on('data', (text) => emit({ executionId, kind: 'stderr', text: String(text), providerId: request.providerId }));
  child.on('error', (error) => {
    if (!clearProcess()) return;
    emit({ executionId, kind: 'failed', text: error.message, exitCode: null, providerId: request.providerId });
  });
  child.on('close', (code, signal) => {
    if (!clearProcess()) return;
    if (signal) emit({ executionId, kind: 'cancelled', text: `Process terminated with ${signal}.`, exitCode: code, providerId: request.providerId });
    else emit({ executionId, kind: code === 0 ? 'completed' : 'failed', exitCode: code, providerId: request.providerId });
  });
  return { executionId, command: configuration.displayCommand };
}

async function cancelProcess(executionId) {
  const child = activeProcesses.get(executionId);
  if (!child) return;
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
}

module.exports = { startProcess, cancelProcess, cancelAllProcesses, evaluateExecutionGuardrails };
