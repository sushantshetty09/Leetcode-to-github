/**
 * LeetSync-Mini — Popup Script
 *
 * Loads/saves settings from chrome.storage (sync & local) and renders the sync log.
 */

(() => {
  'use strict';

  /* ── DOM refs ──────────────────────────────────── */
  const patInput = document.getElementById('pat');
  const togglePatBtn = document.getElementById('togglePat');
  const ownerInput = document.getElementById('owner');
  const repoInput = document.getElementById('repo');
  const autoSyncToggle = document.getElementById('autoSync');
  const saveBtn = document.getElementById('saveBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const logList = document.getElementById('logList');

  /* ── Check if running inside Chrome Extension ────── */
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    if (statusDot) statusDot.className = 'status-dot error';
    if (statusText) statusText.textContent = 'Open via Extension icon in Chrome toolbar';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.5';
      saveBtn.style.cursor = 'not-allowed';
    }
    return;
  }

  /* ── Storage Dual-Layer Helpers ───────────────── */
  function getSettings(callback) {
    const keys = ['githubToken', 'repoOwner', 'repoName', 'autoSync', 'syncLog'];
    if (chrome.storage.sync) {
      chrome.storage.sync.get(keys, (syncResult) => {
        chrome.storage.local.get(keys, (localResult) => {
          const merged = {
            githubToken: syncResult?.githubToken || localResult?.githubToken || '',
            repoOwner: syncResult?.repoOwner || localResult?.repoOwner || '',
            repoName: syncResult?.repoName || localResult?.repoName || '',
            autoSync: syncResult?.autoSync !== undefined ? syncResult.autoSync : (localResult?.autoSync !== false),
            syncLog: localResult?.syncLog || syncResult?.syncLog || [],
          };
          callback(merged);
        });
      });
    } else {
      chrome.storage.local.get(keys, (localResult) => {
        callback({
          githubToken: localResult?.githubToken || '',
          repoOwner: localResult?.repoOwner || '',
          repoName: localResult?.repoName || '',
          autoSync: localResult?.autoSync !== false,
          syncLog: localResult?.syncLog || [],
        });
      });
    }
  }

  function saveSettings(data, callback) {
    if (chrome.storage.sync) {
      chrome.storage.sync.set(data, () => {
        chrome.storage.local.set(data, callback);
      });
    } else {
      chrome.storage.local.set(data, callback);
    }
  }

  /* ── Toggle Password Visibility ────────────────── */
  if (togglePatBtn && patInput) {
    togglePatBtn.addEventListener('click', () => {
      const isPassword = patInput.type === 'password';
      patInput.type = isPassword ? 'text' : 'password';
      togglePatBtn.textContent = isPassword ? '🙈' : '👁️';
    });
  }

  /* ── Load saved settings ───────────────────────── */
  getSettings((result) => {
    if (result.githubToken) patInput.value = result.githubToken;
    if (result.repoOwner) ownerInput.value = result.repoOwner;
    if (result.repoName) repoInput.value = result.repoName;
    autoSyncToggle.checked = result.autoSync !== false;

    if (result.githubToken && result.repoOwner && result.repoName) {
      setStatus('success', 'Connected — ready to sync');
    } else {
      setStatus('idle', 'Enter GitHub Token, Owner & Repo');
    }

    renderLog(result.syncLog || []);
  });

  /* ── Save settings action ───────────────────────── */
  function performSave(silent = false) {
    const rawToken = patInput.value.trim();
    // Clean token: strip outer quotes or accidental "Bearer "/"token " prefix
    const token = rawToken.replace(/^["']|["']$/g, '').replace(/^(Bearer|token)\s+/i, '').trim();
    if (token !== rawToken) {
      patInput.value = token;
    }
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const autoSync = autoSyncToggle.checked;

    if (!token || !owner || !repo) {
      if (!silent) setStatus('error', 'All fields are required');
      return;
    }

    saveSettings({ githubToken: token, repoOwner: owner, repoName: repo, autoSync }, () => {
      if (!silent) setStatus('success', 'Settings saved ✓');

      // Validate token by hitting /user, falling back to /repos/owner/repo for fine-grained PATs
      fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      })
        .then(async (res) => {
          if (res.ok) {
            const user = await res.json();
            setStatus('success', `Authenticated as ${user.login}`);
            return;
          }
          // If /user failed (e.g. Fine-grained PAT without account user scope), check target repository access
          const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
            },
          });
          if (repoRes.ok) {
            setStatus('success', `Connected to repository ${owner}/${repo} ✓`);
          } else {
            const errData = await repoRes.json().catch(() => ({}));
            const msg = errData.message || `HTTP ${repoRes.status}`;
            if (repoRes.status === 401 || res.status === 401) {
              setStatus('error', '401 Bad credentials — PAT is invalid, expired, or missing repo scope');
            } else {
              setStatus('error', `GitHub API error (${repoRes.status}): ${msg}`);
            }
          }
        })
        .catch((err) => {
          setStatus('error', `Validation failed: ${err.message}`);
        });
    });
  }

  saveBtn.addEventListener('click', () => performSave(false));

  // Auto-save on blur / change for seamless persistence
  [patInput, ownerInput, repoInput].forEach((input) => {
    input.addEventListener('change', () => performSave(true));
  });
  autoSyncToggle.addEventListener('change', () => performSave(true));

  /* ── Status indicator ──────────────────────────── */
  function setStatus(type, text) {
    statusDot.className = `status-dot ${type === 'error' ? 'error' : type === 'success' ? 'success' : 'idle'}`;
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
            <div class="log-title">${e.problemNumber ? e.problemNumber + '. ' : ''}${escapeHtml(e.title)}</div>
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
