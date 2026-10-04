const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const { canonicalRoot } = require('./project-service.cjs');
const { buildExecutionCommand, discoverProviders } = require('./provider-service.cjs');
const { saveResource } = require('./config-store.cjs');

const activeProcesses = new Map();
const startingProcesses = new Map();
const queuedProcesses = [];
const jobRecords = new Map();
const cancellationTimers = new Map();
const cancellationGracePeriod = 2000;
const defaultMaxConcurrentJobs = 2;
const maxOutputBytes = 256 * 1024;
// Terminal control characters are intentional here because this is the output sanitizer.
// eslint-disable-next-line no-control-regex
const ansiPattern = /(?:\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~])/g;
let persistTimer = null;

function normalizeMaxConcurrentJobs(value) {
  if (!Number.isInteger(value)) return defaultMaxConcurrentJobs;
  return Math.min(Math.max(value, 1), 10);
}

function closeProcessInput(child) {
  child.stdin?.end();
}

function providerEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/^AGENTSMITH_(?:GITHUB|GITLAB)_TOKEN$/.test(key)));
}

function stripAnsi(value) {
  return String(value).replace(ansiPattern, '').replace(/\r\n?/g, '\n');
}

function now() {
  return new Date().toISOString();
}

function persistJobs() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void saveResource('promptJobs', listPromptJobs()).catch(() => {});
  }, 120);
  persistTimer.unref?.();
}

function listPromptJobs() {
  return [...jobRecords.values()]
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, 100);
}

function hydrateJobs(records = []) {
  jobRecords.clear();
  for (const record of Array.isArray(records) ? records : []) {
    const hydrated = {
      ...record,
      output: Array.isArray(record.output)
        ? record.output.map((line) => ({ ...line, text: stripAnsi(line.text ?? '') }))
        : [],
    };
    if (['queued', 'starting', 'running'].includes(hydrated.state)) {
      hydrated.state = 'interrupted';
      hydrated.error = 'Execution was interrupted when AgentSmith restarted.';
      hydrated.executionId = null;
      hydrated.finishedAt = now();
      hydrated.updatedAt = hydrated.finishedAt;
    }
    jobRecords.set(hydrated.id, hydrated);
  }
  persistJobs();
}

function appendOutput(record, kind, text) {
  const cleanText = stripAnsi(text ?? '');
  if (!cleanText) return { text: '', truncated: false };
  const remaining = maxOutputBytes - (record.outputBytes || 0);
  if (remaining <= 0) {
    if (!record.outputTruncated) {
      record.outputTruncated = true;
      return { text: '\n[AgentSmith truncated further process output after 256 KiB.]\n', truncated: true };
    }
    return { text: '', truncated: false };
  }
  const source = Buffer.from(cleanText, 'utf8');
  const accepted = source.length <= remaining ? source : source.subarray(0, remaining);
  const acceptedText = accepted.toString('utf8');
  record.outputBytes = (record.outputBytes || 0) + accepted.length;
  if (accepted.length < source.length) record.outputTruncated = true;
  record.output.push({ kind, text: acceptedText });
  if (accepted.length < source.length) {
    return { text: `${acceptedText}\n[AgentSmith truncated further process output after 256 KiB.]\n`, truncated: true };
  }
  return { text: acceptedText, truncated: false };
}

function sendEvent(record, emit, payload) {
  if (typeof payload.text === 'string') payload = { ...payload, text: stripAnsi(payload.text) };
  const timestamp = now();
  if (payload.kind === 'queued') record.state = 'queued';
  if (payload.kind === 'starting') record.state = 'starting';
  if (payload.kind === 'started') {
    record.state = 'running';
    record.command = payload.command ?? record.command;
  }
  if (payload.kind === 'stdout' || payload.kind === 'stderr') {
    const output = appendOutput(record, payload.kind, payload.text ?? '');
    if (!output.text) return;
    payload = { ...payload, text: output.text, outputTruncated: output.truncated || record.outputTruncated };
  }
  if (payload.kind === 'completed' || payload.kind === 'failed' || payload.kind === 'cancelled') {
    record.state = payload.kind;
    record.exitCode = payload.exitCode ?? null;
    record.error = payload.kind === 'failed' ? (payload.text ?? record.error ?? null) : record.error;
    if (payload.kind === 'failed' && payload.text) record.output.push({ kind: 'error', text: payload.text });
    record.finishedAt = timestamp;
  }
  record.updatedAt = timestamp;
  persistJobs();
  emit({ ...payload, executionId: record.executionId, jobId: record.id, providerId: record.providerId });
}

function evaluateExecutionGuardrails(request) {
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new Error('An execution prompt is required.');
  const denied = (request.guardrailProfile?.rules || []).find((rule) => rule.enabled
    && rule.type === 'agent_permission'
    && rule.action === 'deny'
    && rule.enforcement !== 'prompt'
    && rule.enforcement !== 'advisory'
    && /execute|provider process|run agent/i.test(rule.pattern));
  if (denied) throw new Error(denied.description || `Execution blocked by guardrail ${denied.id}.`);
  const deniedContext = request.contextManifest?.entries.find((entry) => entry.included && entry.decision === 'deny');
  if (deniedContext) throw new Error(deniedContext.reason || `Execution blocked by context guardrail ${deniedContext.ruleId || deniedContext.id}.`);
}

async function launchProcess(item) {
  const { request, emit, executionId, record } = item;
  if (item.cancelRequested) {
    sendEvent(record, emit, { executionId, kind: 'cancelled', text: 'Starting execution cancelled.', exitCode: null });
    return;
  }
  let root;
  let discovery;
  let configuration;
  let child;
  try {
    root = await canonicalRoot({ path: request.projectPath });
    discovery = await discoverProviders();
    configuration = buildExecutionCommand({ ...request, projectPath: root }, discovery);
    if (item.cancelRequested) {
      sendEvent(record, emit, { executionId, kind: 'cancelled', text: 'Starting execution cancelled.', exitCode: null });
      return;
    }
    child = spawn(configuration.executable, configuration.args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      // VCS credentials belong to the main-process API client, never to an AI provider.
      env: providerEnvironment(),
    });
  } catch (error) {
    sendEvent(record, emit, { executionId, kind: 'failed', text: error instanceof Error ? error.message : String(error), exitCode: null });
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
  sendEvent(record, emit, { executionId, kind: 'started', command: configuration.displayCommand });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => sendEvent(record, emit, { executionId, kind: 'stdout', text: String(text) }));
  child.stderr.on('data', (text) => sendEvent(record, emit, { executionId, kind: 'stderr', text: String(text) }));
  child.on('error', (error) => {
    if (!clearProcess()) return;
    sendEvent(record, emit, { executionId, kind: 'failed', text: error.message, exitCode: null });
    void pumpQueue();
  });
  child.on('close', (code, signal) => {
    if (!clearProcess()) return;
    sendEvent(record, emit, signal
      ? { executionId, kind: 'cancelled', text: `Process terminated with ${signal}.`, exitCode: code }
      : { executionId, kind: code === 0 ? 'completed' : 'failed', exitCode: code });
    void pumpQueue();
  });
}

async function pumpQueue() {
  while (queuedProcesses.length && activeProcesses.size + startingProcesses.size < queuedProcesses[0].limit) {
    const item = queuedProcesses.shift();
    startingProcesses.set(item.executionId, item);
    sendEvent(item.record, item.emit, { executionId: item.executionId, kind: 'starting' });
    void launchProcess(item).finally(() => {
      startingProcesses.delete(item.executionId);
      void pumpQueue();
    });
  }
}

async function startProcess(request, emit, maxConcurrentJobs = defaultMaxConcurrentJobs) {
  evaluateExecutionGuardrails(request);
  const executionId = crypto.randomUUID();
  const jobId = request.jobId || executionId;
  const timestamp = now();
  const record = {
    id: jobId,
    projectId: request.projectId ?? null,
    historyEntryId: request.historyEntryId ?? null,
    task: request.task || (request.purpose === 'suggestion'
      ? 'Generate provider suggestions'
      : request.purpose === 'issue-analysis' ? 'Analyze repository for issue drafts' : 'Provider execution'),
    state: 'queued',
    executionId,
    command: null,
    output: [],
    exitCode: null,
    providerId: request.providerId,
    modelId: request.modelId ?? null,
    purpose: request.purpose || 'task',
    outputBytes: 0,
    outputTruncated: false,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  };
  jobRecords.set(jobId, record);
  const item = { request, emit, executionId, record, limit: normalizeMaxConcurrentJobs(maxConcurrentJobs), cancelRequested: false };
  queuedProcesses.push(item);
  sendEvent(record, emit, { executionId, kind: 'queued' });
  void pumpQueue();
  return { executionId, jobId, command: null };
}

async function cancelProcess(executionId) {
  const child = activeProcesses.get(executionId);
  if (child) {
    try { child.kill('SIGTERM'); } catch { return; }
    if (cancellationTimers.has(executionId)) return;
    const timer = setTimeout(() => {
      if (activeProcesses.get(executionId) !== child) return;
      try { child.kill('SIGKILL'); } catch { /* The process may have exited. */ }
    }, cancellationGracePeriod);
    timer.unref?.();
    cancellationTimers.set(executionId, timer);
    return;
  }
  const starting = startingProcesses.get(executionId);
  if (starting) {
    starting.cancelRequested = true;
    sendEvent(starting.record, starting.emit, { executionId, kind: 'cancelled', text: 'Starting execution cancelled.', exitCode: null });
    return;
  }
  const index = queuedProcesses.findIndex((item) => item.executionId === executionId);
  if (index >= 0) {
    const [item] = queuedProcesses.splice(index, 1);
    sendEvent(item.record, item.emit, { executionId, kind: 'cancelled', text: 'Queued execution cancelled.', exitCode: null });
  }
}

function cancelAllProcesses() {
  for (const executionId of activeProcesses.keys()) void cancelProcess(executionId);
  for (const executionId of startingProcesses.keys()) void cancelProcess(executionId);
  for (const item of queuedProcesses.splice(0)) sendEvent(item.record, item.emit, { executionId: item.executionId, kind: 'cancelled', text: 'Queued execution cancelled.', exitCode: null });
}

module.exports = {
  startProcess,
  cancelProcess,
  cancelAllProcesses,
  evaluateExecutionGuardrails,
  closeProcessInput,
  providerEnvironment,
  stripAnsi,
  normalizeMaxConcurrentJobs,
  listPromptJobs,
  hydrateJobs,
  maxOutputBytes,
};
