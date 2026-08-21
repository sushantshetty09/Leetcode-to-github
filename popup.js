/**
 * LeetSync-Mini — Popup Script
 *
 * Loads/saves settings from chrome.storage.local and renders the sync log.
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

  /* ── Check if running inside Chrome Extension ────── */
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    ownerInput.value = 'sushantshetty09';
    repoInput.value = 'DSA';
    setStatus('error', 'Open via Extension icon in toolbar (not 127.0.0.1)');
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.5';
    saveBtn.style.cursor = 'not-allowed';
    return;
  }

  /* ── Load saved settings ───────────────────────── */
  chrome.storage.local.get(
    ['githubToken', 'repoOwner', 'repoName', 'autoSync', 'syncLog'],
    (result) => {
      if (result.githubToken) patInput.value = result.githubToken;
      ownerInput.value = result.repoOwner || 'sushantshetty09';
      repoInput.value = result.repoName || 'DSA';
      autoSyncToggle.checked = result.autoSync !== false; // default true

      if (result.githubToken && result.repoOwner && result.repoName) {
        setStatus('success', 'Connected — ready to sync');
      }

      renderLog(result.syncLog || []);
    },
  );

  /* ── Save settings ─────────────────────────────── */
  saveBtn.addEventListener('click', () => {
    const token = patInput.value.trim();
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const autoSync = autoSyncToggle.checked;

    if (!token || !owner || !repo) {
      setStatus('error', 'All fields are required');
      return;
    }

    chrome.storage.local.set(
      { githubToken: token, repoOwner: owner, repoName: repo, autoSync },
      () => {
        setStatus('success', 'Settings saved ✓');

        // Validate token by hitting /user
        fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${token}`,
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
      },
    );
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
