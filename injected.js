/**
 * LeetSync-Mini — Main World Interceptor
 *
 * Injected directly into the LeetCode page (MAIN world) to intercept
 * window.fetch and XMLHttpRequest calls made by LeetCode's frontend.
 * Captures ONLY true "Accepted" submissions.
 */

(() => {
  'use strict';

  function getCodeFromMonaco() {
    try {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          const val = models[0].getValue();
          if (val && val.trim().length > 0) return val;
        }
        const editors = window.monaco.editor.getEditors();
        if (editors && editors.length > 0) {
          const val = editors[0].getValue();
          if (val && val.trim().length > 0) return val;
        }
      }
    } catch (e) {
      console.warn('[LeetSync-Mini] Could not read from window.monaco:', e);
    }

    try {
      const lines = Array.from(document.querySelectorAll('.monaco-editor .view-line'));
      if (lines.length > 0) {
        return lines.map((l) => l.textContent).join('\n');
      }
    } catch (_) {}

    return '';
  }

  function getLanguageFromMonaco() {
    try {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          const langId = models[0].getLanguageId();
          if (langId) return langId;
        }
      }
    } catch (_) {}

    try {
      const btn = document.querySelector('[data-cy="lang-select"], button[id*="lang"]');
      if (btn) return btn.textContent.trim().toLowerCase();
    } catch (_) {}

    return '';
  }

  function isAccepted(payload) {
    if (!payload || typeof payload !== 'object') return false;

    // Reject Run Code
    if (
      payload.interpret_id ||
      payload.interpret_code ||
      payload.submission_type === 'interpret'
    ) {
      return false;
    }

    const code = payload.statusCode ?? payload.status_code;
    if (code !== undefined && code !== null) {
      if (Number(code) === 10) return true;
    }

    const msg = String(payload.status_msg || payload.statusDisplay || '').trim().toLowerCase();
    if (msg === 'accepted') {
      return true;
    }

    return false;
  }

  /** Deep search payload tree for an Accepted submission object */
  function findAcceptedPayload(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    if (isAccepted(obj)) return obj;
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === 'object') {
        const found = findAcceptedPayload(obj[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function checkAndPost(url, body) {
    if (!body || typeof body !== 'object') return;
    if (url.includes('interpret') || url.includes('/test/') || url.includes('runcode')) return;

    const acceptedPayload = findAcceptedPayload(body);
    if (acceptedPayload) {
      const monacoCode = getCodeFromMonaco();
      const monacoLang = getLanguageFromMonaco();

      const enrichedPayload = {
        ...acceptedPayload,
        code: acceptedPayload.code || acceptedPayload.typed_code || acceptedPayload.submitted_code || monacoCode,
        lang: acceptedPayload.lang || acceptedPayload.language || acceptedPayload.lang_name || monacoLang,
      };

      console.log('[LeetSync-Mini] ✅ Verified Accepted submission:', enrichedPayload);
      window.postMessage({ type: 'LEETSYNC_ACCEPTED_SUBMISSION', payload: enrichedPayload }, '*');
    }
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('interpret') || url.includes('/test/') || url.includes('runcode')) {
        return response;
      }
      if (
        url.includes('/graphql') ||
        url.includes('/submissions/') ||
        url.includes('/check/') ||
        url.includes('/submit')
      ) {
        const clone = response.clone();
        clone
          .json()
          .then((body) => checkAndPost(url, body))
          .catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  // Intercept XHR
  const XHROpen = XMLHttpRequest.prototype.open;
  const XHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._lsUrl = url;
    return XHROpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this._lsUrl || '';
        if (url.includes('interpret') || url.includes('/test/') || url.includes('runcode')) return;
        if (
          url.includes('/graphql') ||
          url.includes('/submissions/') ||
          url.includes('/check/') ||
          url.includes('/submit')
        ) {
          const body = JSON.parse(this.responseText);
          checkAndPost(url, body);
        }
      } catch (_) {}
    });
    return XHRSend.apply(this, args);
  };

  console.log('[LeetSync-Mini] Main-world network & Monaco editor interceptor ready.');
})();
