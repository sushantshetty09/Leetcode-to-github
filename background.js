/**
 * LeetSync-Mini — Background Service Worker
 *
 * Receives accepted-submission messages from the content script and pushes
 * solution files + a README.md to the configured GitHub repository via the
 * GitHub Contents API.
 */

/* ──────────────────── Language → extension map ──────────────────── */

const LANG_EXT = {
  python: 'py',
  python3: 'py',
  java: 'java',
  javascript: 'js',
  typescript: 'ts',
  c: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  'c#': 'cs',
  csharp: 'cs',
  go: 'go',
  golang: 'go',
  rust: 'rs',
  swift: 'swift',
  kotlin: 'kt',
  ruby: 'rb',
  php: 'php',
  scala: 'scala',
  dart: 'dart',
  racket: 'rkt',
  erlang: 'erl',
  elixir: 'ex',
  sql: 'sql',
  mysql: 'sql',
  mssql: 'sql',
  oraclesql: 'sql',
  bash: 'sh',
  r: 'r',
  lua: 'lua',
};

function getExtension(lang) {
  const key = String(lang || '').toLowerCase().replace(/\s+/g, '');
  return LANG_EXT[key] || 'txt';
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Robust UTF-8 to Base64 encoding */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str || '');
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/* ──────────────────── Debounce map ──────────────────── */

const recentPushes = new Map();
const DEBOUNCE_MS = 5_000; // 5 seconds debounce

/* ──────────────────── GitHub API helpers ──────────────────── */

async function getFile(owner, repo, path, token) {
  const cleanPath = path.replace(/^\/+/, '');
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub GET ${res.status}: ${errBody}`);
  }
  return res.json();
}

async function putFile(owner, repo, path, content, commitMessage, token, sha) {
  const cleanPath = path.replace(/^\/+/, '');
  const body = {
    message: commitMessage,
    content: utf8ToBase64(content),
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub PUT ${res.status}: ${errBody}`);
  }
  return res.json();
}

/* ──────────────────── Build README content ──────────────────── */

function buildReadme(data) {
  const {
    problemNumber,
    title,
    titleSlug,
    difficulty,
    tags,
    runtime,
    runtimePercentile,
    memory,
    memoryPercentile,
  } = data;

  const diff = difficulty || 'Easy';
  const diffBadge =
    diff === 'Easy'
      ? '🟢 Easy'
      : diff === 'Medium'
        ? '🟡 Medium'
        : diff === 'Hard'
          ? '🔴 Hard'
          : diff;

  let md = `# ${problemNumber || ''}. ${title || ''}\n\n`;
  md += `**Difficulty:** ${diffBadge}\n\n`;

  if (tags && tags.length) {
    md += `**Topics:** ${tags.map((t) => '`' + t + '`').join('  ')}\n\n`;
  }

  if (titleSlug) {
    md += `**LeetCode Link:** [https://leetcode.com/problems/${titleSlug}/](https://leetcode.com/problems/${titleSlug}/)\n\n`;
  }

  md += `## Stats\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  if (runtime) {
    const pct = runtimePercentile
      ? ` (beats ${parseFloat(runtimePercentile).toFixed(1)}%)`
      : '';
    md += `| Runtime | ${runtime}${pct} |\n`;
  }
  if (memory) {
    const pct = memoryPercentile
      ? ` (beats ${parseFloat(memoryPercentile).toFixed(1)}%)`
      : '';
    md += `| Memory | ${memory}${pct} |\n`;
  }

  md += `\n---\n*Auto-synced by [LeetSync-Mini](https://github.com)*\n`;
  return md;
}

/* ──────────────────── Sync log helpers ──────────────────── */

async function appendSyncLog(entry) {
  const { syncLog = [] } = await chrome.storage.local.get('syncLog');
  syncLog.unshift(entry);
  if (syncLog.length > 20) syncLog.length = 20;
  await chrome.storage.local.set({ syncLog });
}

/* ──────────────────── Notification helper ──────────────────── */

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
  });
}

/* ──────────────────── Main handler ──────────────────── */

async function handleSubmission(data, sendResponse) {
  console.log('[LeetSync-Mini Background] Processing submission:', data);

  const settings = await chrome.storage.local.get([
    'githubToken',
    'repoOwner',
    'repoName',
    'autoSync',
  ]);

  if (settings.autoSync === false) {
    console.log('[LeetSync-Mini Background] Auto-sync is disabled.');
    sendResponse({ status: 'skipped', reason: 'Auto-sync disabled' });
    return;
  }

  const { githubToken, repoOwner, repoName } = settings;

  if (!githubToken || !repoOwner || !repoName) {
    const msg = 'LeetSync-Mini is not configured. Open extension popup to set GitHub token & repo.';
    console.warn('[LeetSync-Mini Background]', msg);
    notify('LeetSync-Mini ⚠️', msg);
    sendResponse({ status: 'error', reason: msg });
    return;
  }

  const probNum = data.problemNumber || '0';
  const key = `${probNum}-${data.titleSlug}`;
  const lastPush = recentPushes.get(key);
  if (lastPush && Date.now() - lastPush < DEBOUNCE_MS) {
    console.log('[LeetSync-Mini Background] Debounced duplicate push for', key);
    sendResponse({ status: 'debounced' });
    return;
  }
  recentPushes.set(key, Date.now());

  const ext = getExtension(data.language);
  const diff = data.difficulty || 'Easy';
  const paddedNum = String(probNum).padStart(4, '0');
  const slug = slugify(data.title || data.titleSlug);
  const dirPath = `${diff}/${paddedNum}-${slug}`;
  const solutionPath = `${dirPath}/solution.${ext}`;
  const readmePath = `${dirPath}/README.md`;
  const commitMsg = `Solved: ${probNum}. ${data.title} (${diff})`;

  try {
    console.log(`[LeetSync-Mini Background] Pushing to GitHub: ${repoOwner}/${repoName} -> ${solutionPath}`);

    const existingSolution = await getFile(repoOwner, repoName, solutionPath, githubToken);
    await putFile(
      repoOwner,
      repoName,
      solutionPath,
      data.code,
      commitMsg,
      githubToken,
      existingSolution?.sha,
    );

    const existingReadme = await getFile(repoOwner, repoName, readmePath, githubToken);
    await putFile(
      repoOwner,
      repoName,
      readmePath,
      buildReadme(data),
      `docs: ${probNum}. ${data.title}`,
      githubToken,
      existingReadme?.sha,
    );

    const logEntry = {
      problemNumber: probNum,
      title: data.title,
      difficulty: diff,
      language: data.language,
      timestamp: new Date().toISOString(),
      path: solutionPath,
    };
    await appendSyncLog(logEntry);

    notify(
      'LeetSync-Mini ✅',
      `Pushed ${probNum}. ${data.title} to ${repoOwner}/${repoName}`,
    );

    sendResponse({ status: 'success', path: solutionPath });
  } catch (err) {
    console.error('[LeetSync-Mini Background] GitHub push failed:', err);
    notify('LeetSync-Mini ❌', `Push failed: ${err.message}`);
    sendResponse({ status: 'error', reason: err.message });
  }
}

/* ──────────────────── Message listener ──────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ACCEPTED_SUBMISSION') {
    handleSubmission(message, sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['autoSync', 'repoOwner', 'repoName'], (result) => {
    const updates = {};
    if (result.autoSync === undefined) updates.autoSync = true;
    if (!result.repoOwner) updates.repoOwner = 'sushantshetty09';
    if (!result.repoName) updates.repoName = 'DSA';
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
  console.log('[LeetSync-Mini Background] Service worker initialized.');
});
