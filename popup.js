/**
 * LeetSync-Mini — Popup Script
 *
 * Loads/saves settings from chrome.storage and renders the sync log.
 */

(() => {
  'use strict';

  /* ── DOM refs ──────────────────────────────────── */
  const patInput = document.getElementById('pat');
  const ownerInput = document.getElementById('owner');
  const repoInput = document.getElementById('repo');
  const autoSyncToggle = document.getElementById('autoSync');
  const saveBtn = document.getElementById('saveBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const logList = document.getElementById('logList');
  const SETTINGS_KEYS = ['githubToken', 'repoOwner', 'repoName', 'autoSync', 'syncLog'];

  /* ── Check if running inside Chrome Extension ────── */
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    ownerInput.value = '';
    repoInput.value = '';
    setStatus('error', 'Open via Extension icon in toolbar (not 127.0.0.1)');
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.5';
    saveBtn.style.cursor = 'not-allowed';
    return;
  }

  function storageGet(area, keys) {
    return new Promise((resolve) => {
      area.get(keys, (result) => resolve(result || {}));
    });
  }

  function storageSet(area, value) {
    return new Promise((resolve, reject) => {
      area.set(value, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  /* ── Load saved settings ───────────────────────── */
  loadSettings();

  async function loadSettings() {
    try {
      const [localSettings, syncSettings] = await Promise.all([
        storageGet(chrome.storage.local, SETTINGS_KEYS),
        storageGet(chrome.storage.sync, SETTINGS_KEYS),
      ]);

      const settings = { ...syncSettings, ...localSettings };
      const shouldMigrate = SETTINGS_KEYS.some(
        (key) => localSettings[key] === undefined && syncSettings[key] !== undefined,
      );

      if (shouldMigrate) {
        await storageSet(chrome.storage.local, settings);
      }

      if (settings.githubToken) patInput.value = settings.githubToken;
      ownerInput.value = settings.repoOwner || '';
      repoInput.value = settings.repoName || '';
      autoSyncToggle.checked = settings.autoSync !== false; // default true

      if (settings.githubToken && settings.repoOwner && settings.repoName) {
        setStatus('success', 'Connected — ready to sync');
      }

      renderLog(settings.syncLog || []);
    } catch (err) {
      setStatus('error', `Failed to load settings: ${err.message}`);
    }
  }

  /* ── Save settings ─────────────────────────────── */
  saveBtn.addEventListener('click', async () => {
    const token = patInput.value.trim();
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const autoSync = autoSyncToggle.checked;

    if (!token || !owner || !repo) {
      setStatus('error', 'All fields are required');
      return;
    }

    const settings = { githubToken: token, repoOwner: owner, repoName: repo, autoSync };

    try {
      await Promise.all([
        storageSet(chrome.storage.local, settings),
        storageSet(chrome.storage.sync, settings),
      ]);

      setStatus('success', 'Settings saved ✓');

      // Validate token by hitting /user
      fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
        },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((user) => {
          setStatus('success', `Authenticated as ${user.login}`);
        })
        .catch((err) => {
          setStatus('error', `Token validation failed: ${err.message}`);
        });
    } catch (err) {
      setStatus('error', `Failed to save settings: ${err.message}`);
    }
  });

  /* ── Status indicator ──────────────────────────── */
  function setStatus(type, text) {
    statusDot.className = `status-dot ${type === 'error' ? 'error' : 'success'}`;
    statusText.textContent = text;
  }

  /* ── Render sync log ───────────────────────────── */
  function renderLog(entries) {
    if (!entries || entries.length === 0) {
      logList.innerHTML = `
        <li class="empty-state">
          <span>📭</span>
          No submissions synced yet
        </li>`;
      return;
    }

    // Show last 5
    const recent = entries.slice(0, 5);
    logList.innerHTML = recent
      .map((e) => {
        const diffClass = (e.difficulty || '').toLowerCase();
        const diffLabel = e.difficulty || '?';
        const timeAgo = relativeTime(e.timestamp);

        return `
        <li class="log-item">
          <span class="log-diff ${diffClass}">${diffLabel}</span>
          <div class="log-info">
            <div class="log-title">${e.problemNumber}. ${escapeHtml(e.title)}</div>
            <div class="log-meta">${escapeHtml(e.language)} · ${timeAgo}</div>
          </div>
        </li>`;
      })
      .join('');
  }

  /* ── Helpers ────────────────────────────────────── */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  /* ── Live-update the log when storage changes ──── */
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.syncLog) {
      renderLog(changes.syncLog.newValue || []);
    }
  });
})();
