const { spawn } = require('node:child_process');

const capabilities = {
  opencode: {
    supportsModelDiscovery: true,
    supportsReasoningEffort: true,
    supportsStreaming: true,
    supportsInteractiveTerminal: true,
    supportsPermissionModes: true,
    supportsSandboxing: false,
    supportsWorkingDirectory: true,
  },
  codex: {
    supportsModelDiscovery: false,
    supportsReasoningEffort: false,
    supportsStreaming: true,
    supportsInteractiveTerminal: true,
    supportsPermissionModes: true,
    supportsSandboxing: false,
    supportsWorkingDirectory: true,
  },
};

function run(executable, args, timeout = 12000) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeout);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ code: null, stdout, stderr, error });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, timedOut: false });
    });
  });
}

async function findExecutable(name) {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = await run(command, [name], 4000);
  if (result.code !== 0 || !result.stdout.trim()) return null;
  return result.stdout.trim().split(/\r?\n/)[0];
}

function readJsonObject(lines, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  const parts = [];
  for (let lineIndex = start; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    parts.push(line);
    for (const character of line) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return { json: parts.join('\n'), nextIndex: lineIndex };
    }
  }
  }
  return null;
}

function parseOpenCodeModels(output) {
  const lines = output.split(/\r?\n/);
  const models = [];
  for (let index = 0; index < lines.length; index += 1) {
    const id = lines[index].trim();
    if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(id)) continue;
    let metadata = null;
    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    if (lines[cursor]?.trim().startsWith('{')) {
      const result = readJsonObject(lines, cursor);
      if (result) {
        try { metadata = JSON.parse(result.json); } catch { metadata = null; }
        index = result.nextIndex;
      }
    }
    const variants = metadata && metadata.variants && typeof metadata.variants === 'object'
      ? Object.keys(metadata.variants).map((variantId) => ({ id: variantId, label: variantId, verified: true }))
      : [];
    models.push({
      id,
      name: metadata?.name || id.split('/').slice(1).join('/'),
      verified: true,
      variants,
    });
  }
  return models;
}

async function detectOpenCode() {
  const executable = await findExecutable('opencode');
  if (!executable) return {
    installation: { providerId: 'opencode', installed: false, executable: null, version: null, error: 'OpenCode executable was not found on PATH.' },
    capabilities: capabilities.opencode,
    models: [],
    modelDiscoveryAvailable: false,
    note: 'Install OpenCode or make its executable available on PATH.',
    executionSupported: false,
  };
  const version = await run(executable, ['--version']);
  let models = await run(executable, ['models', '--verbose']);
  let discoveredModels = parseOpenCodeModels(models.stdout);
  if (models.code !== 0 || discoveredModels.length === 0) {
    models = await run(executable, ['models']);
    discoveredModels = parseOpenCodeModels(models.stdout);
  }
  return {
    installation: { providerId: 'opencode', installed: true, executable, version: version.stdout.trim() || version.stderr.trim() || 'installed', error: null },
    capabilities: capabilities.opencode,
    models: discoveredModels,
    modelDiscoveryAvailable: models.code === 0,
    note: models.code === 0 ? 'Models were read from the installed OpenCode CLI.' : 'OpenCode was found, but model discovery failed. Check provider diagnostics.',
    executionSupported: true,
  };
}

async function detectCodex() {
  const executable = await findExecutable('codex');
  if (!executable) return {
    installation: { providerId: 'codex', installed: false, executable: null, version: null, error: 'Codex executable was not found on PATH.' },
    capabilities: capabilities.codex,
    models: [],
    modelDiscoveryAvailable: false,
    note: 'No stable model discovery interface was available without an installed Codex CLI.',
    executionSupported: false,
  };
  const version = await run(executable, ['--version']);
  const help = await run(executable, ['--help']);
  const supportsExec = /\bexec\b/.test(help.stdout);
  return {
    installation: { providerId: 'codex', installed: true, executable, version: version.stdout.trim() || version.stderr.trim() || 'installed', error: null },
    capabilities: { ...capabilities.codex, supportsInteractiveTerminal: !supportsExec || capabilities.codex.supportsInteractiveTerminal },
    models: [],
    modelDiscoveryAvailable: false,
    note: supportsExec ? 'Codex is installed. This release uses its stable exec command and requires a manually selected model when available.' : 'Codex is installed, but its exec interface was not verified from --help.',
    executionSupported: supportsExec,
  };
}

async function discoverProviders() {
  return Promise.all([detectOpenCode(), detectCodex()]);
}

function buildExecutionCommand(request, discovery) {
  const provider = request.providerId;
  const found = discovery.find((item) => item.installation.providerId === provider);
  if (!found?.installation.installed || !found.installation.executable) throw new Error(`${provider} is not installed.`);
  if (found.executionSupported === false) throw new Error(`${provider} does not expose a verified execution interface.`);
  if (provider === 'opencode') {
    const args = ['run'];
    if (request.modelId) args.push('--model', request.modelId);
    if (typeof request.variant?.reasoningEffort === 'string') args.push('--variant', request.variant.reasoningEffort);
    args.push(request.prompt);
    return { executable: found.installation.executable, args, cwd: request.projectPath, displayCommand: [found.installation.executable, ...args.slice(0, -1), '<prompt>'].join(' ') };
  }
  if (provider === 'codex') {
    const args = ['exec'];
    if (request.modelId) args.push('--model', request.modelId);
    args.push(request.prompt);
    return { executable: found.installation.executable, args, cwd: request.projectPath, displayCommand: [found.installation.executable, ...args.slice(0, -1), '<prompt>'].join(' ') };
  }
  throw new Error(`Unsupported provider: ${provider}.`);
}

module.exports = { discoverProviders, buildExecutionCommand, findExecutable, run, parseOpenCodeModels };
