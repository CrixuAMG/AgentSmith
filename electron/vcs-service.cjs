/**
 * Hosted repository access for version-control providers.
 *
 * Two rules shape this module:
 *
 * 1. Credentials live in main-process memory. A remembered GitHub credential is stored
 *    only as an OS-encrypted blob; raw tokens never appear in a result, message, or log.
 *    There is one flow: the user pastes a personal access token, which is verified before
 *    it is remembered. Nothing is read from the environment.
 * 2. Merging does not exist here. There is no merge request, no merge endpoint, and no
 *    way for configuration to authorize one; closing a pull request is the only pull
 *    request transition offered.
 */

const API_TIMEOUT_MS = 15000;
const MAX_ISSUES = 50;
const MAX_ISSUE_TITLE_CHARS = 256;
const MAX_ISSUE_BODY_CHARS = 65536;
const MAX_LABELS = 20;
const ISSUE_STATE_FILTERS = new Set(['open', 'closed', 'all']);
const PATCHABLE_FIELDS = new Set(['title', 'body', 'state', 'labels']);
const CREDENTIAL_PROVIDERS = new Set(['github', 'gitlab']);
const PERSISTED_PROVIDERS = new Set(['github']);

const fs = require('node:fs/promises');
const nodePath = require('node:path');

/** providerId -> token, held in memory for the lifetime of the process only. */
const sessionCredentials = new Map();
const storedCredentials = new Map();
let credentialStorage = null;

const providerCapabilities = {
  github: { supportsIssues: true, supportsBranches: true, supportsPullRequests: true, supportsMerge: false },
};

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves the active credential: what the user pasted for this run first, then the
 * remembered credential loaded from encrypted storage at startup. There is no
 * environment fallback; the Issues page is the single entry point.
 */
function credentialFor(providerId) {
  const session = sessionCredentials.get(providerId);
  if (session) return { token: session, source: 'session' };
  const stored = storedCredentials.get(providerId);
  if (stored) return { token: stored, source: 'stored' };
  return { token: null, source: 'none' };
}

function credentialState(providerId) {
  const { token, source } = credentialFor(providerId);
  return { providerId, configured: Boolean(token), source: token ? source : 'none' };
}

/**
 * Installs the encrypted-credential backend. It receives the file location plus the
 * host's `safeStorage` encrypt/decrypt pair; the service never knows the raw paths of
 * anything except that single credential file.
 */
function configureCredentialStorage(storage) {
  credentialStorage = storage && typeof storage === 'object' ? storage : null;
}

/**
 * Restores a remembered credential at startup. A missing, malformed, or undecryptable
 * file is treated as "not connected" instead of blocking launch.
 */
async function loadStoredVcsCredential() {
  storedCredentials.clear();
  if (!credentialStorage?.encryptionAvailable || typeof credentialStorage.decrypt !== 'function') return false;
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(credentialStorage.filePath, 'utf8'));
    if (parsed?.version !== 1 || parsed.providerId !== 'github' || typeof parsed.encryptedToken !== 'string') return false;
    const token = credentialStorage.decrypt(Buffer.from(parsed.encryptedToken, 'base64'));
    if (typeof token !== 'string' || !token.trim()) return false;
    storedCredentials.set('github', token.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Stores the credential as an OS-encrypted blob, or removes any stored credential when
 * the user declines to remember it or forgets it. Only an encrypted token reaches disk,
 * written to a private directory and replaced atomically.
 */
async function persistVcsCredential(providerId, token, remember) {
  storedCredentials.delete(providerId);
  const canPersist = PERSISTED_PROVIDERS.has(providerId) && credentialStorage?.encryptionAvailable && typeof credentialStorage.encrypt === 'function';
  if (!canPersist || !remember || typeof token !== 'string' || !token.trim()) {
    if (credentialStorage?.filePath) await fs.unlink(credentialStorage.filePath).catch(() => {});
    return { persisted: false };
  }
  const encryptedToken = credentialStorage.encrypt(token.trim());
  await fs.mkdir(nodePath.dirname(credentialStorage.filePath), { recursive: true, mode: 0o700 });
  const temporary = `${credentialStorage.filePath}.tmp-${process.pid}-${Date.now()}`;
  const document = JSON.stringify({ version: 1, providerId, encryptedToken: encryptedToken.toString('base64') });
  try {
    await fs.writeFile(temporary, `${document}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, credentialStorage.filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  storedCredentials.set(providerId, token.trim());
  return { persisted: true };
}

/**
 * Confirms with the provider that the active credential is usable before it is
 * remembered. Returns the account name, never the token, and never writes anything.
 */
async function verifyVcsCredential(providerId) {
  const { token } = credentialFor(providerId);
  if (!token) return { verified: false, account: null, error: 'No token is configured.' };
  if (providerId !== 'github') return { verified: false, account: null, error: `The provider ${String(providerId)} cannot verify a credential yet.` };
  const response = await request({ providerId: 'github', host: 'github.com', owner: '', name: '', defaultBranch: '' }, '/user');
  if (!response.ok) return { verified: false, account: null, error: response.error };
  return { verified: true, account: typeof response.data?.login === 'string' ? response.data.login : null, error: null };
}

/**
 * Accepts a credential for the running session or clears it. A token is never echoed
 * back to the renderer; the returned state only reports whether one is configured.
 */
function setVcsCredential(providerId, token) {
  if (!CREDENTIAL_PROVIDERS.has(providerId)) throw new Error(`The repository provider ${String(providerId)} is not supported.`);
  if (token === null || token === undefined || token === '') {
    sessionCredentials.delete(providerId);
    storedCredentials.delete(providerId);
    return credentialState(providerId);
  }
  if (typeof token !== 'string') throw new Error('The credential must be a string.');
  const normalized = token.trim();
  if (!normalized) {
    sessionCredentials.delete(providerId);
    storedCredentials.delete(providerId);
    return credentialState(providerId);
  }
  sessionCredentials.set(providerId, normalized);
  return credentialState(providerId);
}

function apiBaseFor(link) {
  if (link.providerId !== 'github') throw new Error(`The repository provider ${String(link.providerId)} is not implemented yet.`);
  if (typeof link.host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(link.host)) throw new Error('The repository host is not valid.');
  return link.host === 'github.com' ? 'https://api.github.com' : `https://${link.host}/api/v3`;
}

function repositoryLabel(link) {
  return `${link.owner}/${link.name}`;
}

function linkedRepository(project) {
  const link = project && typeof project === 'object' ? project.repository : null;
  if (!link || typeof link !== 'object') return { link: null, error: 'This project is not linked to a repository yet.' };
  const { providerId, host, owner, name } = link;
  if (!providerCapabilities[providerId]) return { link: null, error: `The repository provider ${String(providerId)} is not implemented yet.` };
  if (typeof host !== 'string' || !host || !/^[A-Za-z0-9.-]+$/.test(host)) return { link: null, error: 'The stored repository host is not valid.' };
  if (typeof owner !== 'string' || !owner || typeof name !== 'string' || !name) return { link: null, error: 'The stored repository path is not valid.' };
  if (providerId === 'github' && (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name))) {
    return { link: null, error: 'The stored GitHub repository path is not valid.' };
  }
  return { link, error: null };
}

/**
 * Performs one authenticated API call. Transport, status, and payload problems become a
 * plain message: the response body is summarized, never the request headers.
 */
async function request(link, path, options = {}) {
  const { token, source } = credentialFor(link.providerId);
  if (!token) {
    return { ok: false, status: null, data: null, error: `No ${link.providerId} credential is configured.` };
  }
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'AgentSmith',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${apiBaseFor(link)}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, status: null, data: null, error: `The ${link.providerId} request failed: ${messageOf(error)}` };
  }
  let data = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (response.ok) return { ok: true, status: response.status, data, error: null, credentialSource: source };
  const detail = data && typeof data.message === 'string' ? data.message : null;
  if (response.status === 401) {
    return { ok: false, status: 401, data: null, error: 'The repository credential was rejected. Update the token and try again.' };
  }
  if (response.status === 403) {
    if (options.operation === 'issue-write') {
      return {
        ok: false,
        status: 403,
        data: null,
        error: `GitHub denied issue write access. Give this token Issues: Read and write for ${repositoryLabel(link)}${detail ? ` (${detail})` : ''}.`,
      };
    }
    return { ok: false, status: 403, data: null, error: `The repository provider refused the request: ${detail ?? 'forbidden'}.` };
  }
  if (response.status === 404) {
    return { ok: false, status: 404, data: null, error: 'The repository or issue was not found, or the credential cannot see it.' };
  }
  return { ok: false, status: response.status, data: null, error: `The repository provider returned an error: ${detail ?? response.status}.` };
}

function toIssue(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.number !== 'number') return null;
  return {
    number: raw.number,
    title: typeof raw.title === 'string' ? raw.title : '',
    body: typeof raw.body === 'string' ? raw.body : '',
    state: raw.state === 'closed' ? 'closed' : 'open',
    url: typeof raw.html_url === 'string' ? raw.html_url : '',
    author: raw.user && typeof raw.user.login === 'string' ? raw.user.login : 'unknown',
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((label) => (typeof label === 'string' ? label : label?.name)).filter((name) => typeof name === 'string' && name)
      : [],
    comments: Number.isInteger(raw.comments) ? raw.comments : 0,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
  };
}

async function detectGitHub() {
  const credential = credentialState('github');
  const link = { providerId: 'github', host: 'github.com', owner: '', name: '', defaultBranch: '' };
  if (!credential.configured) {
    return {
      installation: { providerId: 'github', connected: false, account: null, error: null },
      capabilities: providerCapabilities.github,
      credential,
      note: 'Enter a GitHub personal access token with Issues: Read and write. AgentSmith verifies it with GitHub before it is remembered.',
    };
  }
  const response = await request(link, '/user');
  if (!response.ok) {
    return {
      installation: { providerId: 'github', connected: false, account: null, error: response.error },
      capabilities: providerCapabilities.github,
      credential,
      note: 'The stored credential could not be verified. Nothing was sent to the repository.',
    };
  }
  return {
    installation: { providerId: 'github', connected: true, account: response.data?.login ?? null, error: null },
    capabilities: providerCapabilities.github,
    credential,
    note: 'Merging is not offered by AgentSmith, regardless of the credential scope.',
  };
}

async function discoverVcsProviders() {
  return [await detectGitHub()];
}

/**
 * Lists issues for the linked repository. Pull requests arrive on the same endpoint and
 * are filtered out, so the list contains issues only.
 */
async function listRepositoryIssues(project, options = {}) {
  const { link, error } = linkedRepository(project);
  if (error) return { ok: false, repository: '', issues: [], error };
  const state = ISSUE_STATE_FILTERS.has(options.state) ? options.state : 'open';
  const response = await request(link, `/repos/${link.owner}/${link.name}/issues?state=${state}&per_page=${MAX_ISSUES}`);
  if (!response.ok) return { ok: false, repository: repositoryLabel(link), issues: [], error: response.error };
  const issues = (Array.isArray(response.data) ? response.data : [])
    .filter((raw) => raw && typeof raw === 'object' && !raw.pull_request)
    .map(toIssue)
    .filter(Boolean);
  return { ok: true, repository: repositoryLabel(link), issues, error: null };
}

function validateDraft(draft) {
  const title = typeof draft?.title === 'string' ? draft.title.trim() : '';
  if (!title) return { error: 'An issue needs a title.' };
  if (title.length > MAX_ISSUE_TITLE_CHARS) return { error: `An issue title cannot exceed ${MAX_ISSUE_TITLE_CHARS} characters.` };
  const body = typeof draft?.body === 'string' ? draft.body : '';
  if (body.length > MAX_ISSUE_BODY_CHARS) return { error: `An issue description cannot exceed ${MAX_ISSUE_BODY_CHARS} characters.` };
  const labels = Array.isArray(draft?.labels)
    ? draft.labels.filter((label) => typeof label === 'string' && label.trim()).map((label) => label.trim()).filter((label) => label.length <= 100).slice(0, MAX_LABELS)
    : [];
  return { error: null, draft: { title, body, labels } };
}

async function createRepositoryIssue(project, draft) {
  const { link, error } = linkedRepository(project);
  if (error) return { ok: false, issue: null, error };
  const validated = validateDraft(draft);
  if (validated.error) return { ok: false, issue: null, error: validated.error };
  const { title, body, labels } = validated.draft;
  const response = await request(link, `/repos/${link.owner}/${link.name}/issues`, {
    method: 'POST',
    operation: 'issue-write',
    body: { title, body, ...(labels.length ? { labels } : {}) },
  });
  if (!response.ok) return { ok: false, issue: null, error: response.error };
  const issue = toIssue(response.data);
  if (!issue) return { ok: false, issue: null, error: 'The repository provider returned an unreadable issue.' };
  return { ok: true, issue, error: null };
}

/**
 * Updates an existing issue. The accepted fields are an explicit allowlist, so a field
 * that would change pull request state, most notably a merge, cannot be sent even if the
 * renderer asks for it.
 */
async function updateRepositoryIssue(project, number, patch) {
  const { link, error } = linkedRepository(project);
  if (error) return { ok: false, issue: null, error };
  if (!Number.isInteger(number) || number < 1) return { ok: false, issue: null, error: 'The issue number is not valid.' };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, issue: null, error: 'The issue update is not valid.' };
  const rejected = Object.keys(patch).filter((key) => !PATCHABLE_FIELDS.has(key));
  if (rejected.length) {
    return { ok: false, issue: null, error: `These fields cannot be changed on an issue: ${rejected.join(', ')}.` };
  }
  const body = {};
  if (typeof patch.title === 'string') {
    const title = patch.title.trim();
    if (!title) return { ok: false, issue: null, error: 'An issue needs a title.' };
    if (title.length > MAX_ISSUE_TITLE_CHARS) return { ok: false, issue: null, error: `An issue title cannot exceed ${MAX_ISSUE_TITLE_CHARS} characters.` };
    body.title = title;
  }
  if (typeof patch.body === 'string') {
    if (patch.body.length > MAX_ISSUE_BODY_CHARS) return { ok: false, issue: null, error: `An issue description cannot exceed ${MAX_ISSUE_BODY_CHARS} characters.` };
    body.body = patch.body;
  }
  if (patch.state !== undefined) {
    if (patch.state !== 'open' && patch.state !== 'closed') return { ok: false, issue: null, error: 'An issue can only be open or closed.' };
    body.state = patch.state;
  }
  if (patch.labels !== undefined) {
    if (!Array.isArray(patch.labels)) return { ok: false, issue: null, error: 'Issue labels must be a list of names.' };
    body.labels = patch.labels.filter((label) => typeof label === 'string' && label.trim()).map((label) => label.trim()).filter((label) => label.length <= 100).slice(0, MAX_LABELS);
  }
  if (!Object.keys(body).length) return { ok: false, issue: null, error: 'Nothing to change on this issue.' };
  const response = await request(link, `/repos/${link.owner}/${link.name}/issues/${number}`, { method: 'PATCH', operation: 'issue-write', body });
  if (!response.ok) return { ok: false, issue: null, error: response.error };
  const issue = toIssue(response.data);
  if (!issue) return { ok: false, issue: null, error: 'The repository provider returned an unreadable issue.' };
  return { ok: true, issue, error: null };
}

module.exports = {
  apiBaseFor,
  credentialState,
  discoverVcsProviders,
  listRepositoryIssues,
  createRepositoryIssue,
  setVcsCredential,
  configureCredentialStorage,
  loadStoredVcsCredential,
  persistVcsCredential,
  verifyVcsCredential,
  updateRepositoryIssue,
  validateDraft,
};
