/**
 * LeetSync-Mini — Content Script
 *
 * Runs on https://leetcode.com/* and https://leetcode.cn/*
 * injected.js is loaded by the manifest in MAIN world (world: "MAIN").
 * This script receives postMessages when a submission is "Accepted",
 * fetches full problem metadata via GraphQL, and sends your code + stats
 * to the background service worker.
 */

(() => {
  'use strict';

  /* ──────────────────── State ──────────────────── */
  const processedSubmissions = new Set();

  /* ──────────────────── Listen to postMessage ──── */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'LEETSYNC_ACCEPTED_SUBMISSION') {
      console.log('[LeetSync-Mini] Received submission signal from page:', event.data.payload);
      handleAcceptedSubmission(event.data.payload);
    }
  });

  /* ──────────────────── Helpers ──────────────────── */
  function getProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  async function fetchProblemMeta(slug) {
    const query = `
      query questionData($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          questionFrontendId
          title
          titleSlug
          difficulty
          topicTags { name slug }
          content
        }
      }`;
    try {
      const res = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { titleSlug: slug } }),
      });
      const json = await res.json();
      return json?.data?.question || null;
    } catch (err) {
      console.warn('[LeetSync-Mini] Failed to fetch problem metadata:', err);
      return null;
    }
  }

  async function fetchLatestSubmissionId(slug) {
    const query = `
      query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
        submissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
          submissions {
            id
            statusDisplay
            lang
          }
        }
      }`;
    try {
      const res = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { questionSlug: slug, offset: 0, limit: 5 },
        }),
      });
      const json = await res.json();
      const subs = json?.data?.submissionList?.submissions || [];
      const accepted = subs.find((s) => s.statusDisplay === 'Accepted') || subs[0];
      return accepted?.id || null;
    } catch (err) {
      console.warn('[LeetSync-Mini] Failed to fetch submission list:', err);
      return null;
    }
  }

  async function fetchSubmissionDetails(submissionId) {
    if (!submissionId) return null;
    const query = `
      query submissionDetails($submissionId: Int!) {
        submissionDetails(submissionId: $submissionId) {
          runtimeDisplay
          memoryDisplay
          code
          lang { name verboseName }
          runtimePercentile
          memoryPercentile
          statusCode
        }
      }`;
    try {
      const res = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { submissionId: Number(submissionId) },
        }),
      });
      const json = await res.json();
      return json?.data?.submissionDetails || null;
    } catch (err) {
      console.warn('[LeetSync-Mini] Failed to fetch submission details:', err);
      return null;
    }
  }

  /* ──────────────────── Send to background ──────────────────── */
  async function handleAcceptedSubmission(payload) {
    const slug = getProblemSlug();
    if (!slug) {
      console.warn('[LeetSync-Mini] Could not determine problem slug.');
      return;
    }

    let submissionId =
      payload.id || payload.submission_id || payload.submissionId;

    if (!submissionId) {
      console.log('[LeetSync-Mini] No submissionId in payload, fetching latest for slug:', slug);
      submissionId = await fetchLatestSubmissionId(slug);
    }

    if (submissionId && processedSubmissions.has(String(submissionId))) {
      console.log('[LeetSync-Mini] Duplicate submission ignored:', submissionId);
      return;
    }
    if (submissionId) processedSubmissions.add(String(submissionId));

    const meta = await fetchProblemMeta(slug);
    let details = null;
    if (submissionId) {
      details = await fetchSubmissionDetails(submissionId);
    }

    const code =
      payload.code ||
      details?.code ||
      payload.typed_code ||
      payload.submitted_code ||
      '';

    const langRaw =
      payload.lang ||
      details?.lang?.name ||
      payload.language ||
      payload.lang_name ||
      'unknown';

    if (!code || code.trim().length === 0) {
      console.warn('[LeetSync-Mini] Source code is empty, skipping push.');
      return;
    }

    const message = {
      type: 'ACCEPTED_SUBMISSION',
      problemNumber: meta?.questionFrontendId || payload.question_id || '',
      title: meta?.title || slug.replace(/-/g, ' '),
      titleSlug: slug,
      difficulty: meta?.difficulty || 'Easy',
      tags: (meta?.topicTags || []).map((t) => t.name),
      language: langRaw,
      code,
      runtime: details?.runtimeDisplay || payload.status_runtime || '',
      runtimePercentile: details?.runtimePercentile || payload.runtime_percentile || '',
      memory: details?.memoryDisplay || payload.status_memory || '',
      memoryPercentile: details?.memoryPercentile || payload.memory_percentile || '',
      submissionId: submissionId || '',
      problemContent: meta?.content || '',
    };

    console.log('[LeetSync-Mini] Sending accepted submission to background →', message);

    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('[LeetSync-Mini] Extension context invalidated. Please refresh the page.');
        return;
      }

      chrome.runtime.sendMessage(message, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          console.warn('[LeetSync-Mini] Could not send message to background worker:', lastErr.message);
        } else {
          console.log('[LeetSync-Mini] Background response:', response);
        }
      });
    } catch (err) {
      console.warn('[LeetSync-Mini] Messaging error:', err);
    }
  }

  /* ──────────────────── DOM fallback (MutationObserver) ──────── */
  let domFallbackFired = false;
  const observer = new MutationObserver((mutations) => {
    if (domFallbackFired) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        if (node.closest?.('[class*="testcase"], [class*="test-result"], [data-cy="test-result"]')) {
          continue;
        }

        const text = node.textContent || '';
        if (/\bAccepted\b/.test(text)) {
          const el =
            node.querySelector('[data-e2e-locator="submission-result"]') ||
            node.querySelector('.text-green-s, .text-green-60');

          if (el && /accepted/i.test(el.textContent.trim())) {
            console.log('[LeetSync-Mini] DOM fallback detected Accepted submission');
            domFallbackFired = true;
            handleAcceptedSubmission({ status_msg: 'Accepted' });
            setTimeout(() => { domFallbackFired = false; }, 5000);
            return;
          }
        }
      }
    }
  });

  function startObserver() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      });
    }
  }

  /* ──────────────────── SPA Navigation Observer ──────── */
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Reset state on page navigation so new problem submissions are captured
      processedSubmissions.clear();
      domFallbackFired = false;
      const slug = getProblemSlug();
      if (slug) {
        console.log('[LeetSync-Mini] Navigated to problem:', slug);
      }
    }
  });
  if (document.documentElement) {
    urlObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  startObserver();

  console.log('[LeetSync-Mini] Content script loaded on', window.location.href);
})();
