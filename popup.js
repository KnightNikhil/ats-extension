// popup.js

document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  document.getElementById('saveApiKeyBtn').addEventListener('click', saveApiKey);
  document.getElementById('clearApiKeyBtn').addEventListener('click', clearApiKey);
  document.getElementById('apiKey').addEventListener('keydown', e => { if (e.key === 'Enter') saveApiKey(); });
  document.getElementById('uploadZone').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', e => handleTexUpload(e.target));
  document.getElementById('analyzeBtn').addEventListener('click', analyzeCurrentPage);
  document.getElementById('autoFillBtn').addEventListener('click', autoFillOnly);
});

// ── Persist state ──────────────────────────────────────────────────────────
function loadSavedState() {
  chrome.storage.local.get(['apiKey', 'resumeName', 'resumeExtractedText', 'latexSource'], data => {
    if (data.apiKey) showSavedKey();
    if (data.resumeName) {
      document.getElementById('uploadText').textContent = data.resumeName;
      document.getElementById('uploadZone').classList.add('has-file');
      document.getElementById('uploadSub').textContent = data.resumeExtractedText
        ? '✓ Extracted & cached · click to replace'
        : '⚠ Add API key to finish processing';
    }
    refreshAnalyzeBtn(data);
  });
}

// ── API key ────────────────────────────────────────────────────────────────
function saveApiKey() {
  const key = document.getElementById('apiKey').value.trim();
  if (!key) return showStatus('Enter your API key', 'error');
  if (!key.startsWith('nvapi-')) return showStatus('Key should start with nvapi-...', 'error');
  chrome.storage.local.set({ apiKey: key }, () => {
    showSavedKey();
    showStatus('API key saved!', 'success');
    // If .tex was already uploaded but not yet processed, do it now
    chrome.storage.local.get(['latexSource', 'resumeExtractedText'], data => {
      if (data.latexSource && !data.resumeExtractedText) extractResume(key, data.latexSource);
      else refreshAnalyzeBtn({ apiKey: key, ...data });
    });
  });
}

function clearApiKey() {
  chrome.storage.local.remove('apiKey', () => {
    document.getElementById('apiKeySaved').style.display = 'none';
    document.getElementById('apiKeyInput').style.display = 'block';
    document.getElementById('apiKey').value = '';
    refreshAnalyzeBtn({});
  });
}

function showSavedKey() {
  document.getElementById('apiKeyInput').style.display = 'none';
  document.getElementById('apiKeySaved').style.display = 'block';
}

// ── .tex upload ────────────────────────────────────────────────────────────
function handleTexUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showStatus('Could not read file', 'error');
  reader.onload = async e => {
    const source = e.target.result;
    if (!source || source.trim().length < 10) return showStatus('File is empty', 'error');

    await storageSet({ latexSource: source, resumeName: file.name, resumeExtractedText: null });

    document.getElementById('uploadText').textContent = file.name;
    document.getElementById('uploadZone').classList.add('has-file');

    const { apiKey } = await storageGet(['apiKey']);
    if (!apiKey) {
      document.getElementById('uploadSub').textContent = '⚠ Add API key to finish processing';
      showStatus('LaTeX saved — add your API key to process it', 'error');
      refreshAnalyzeBtn({ latexSource: source });
      return;
    }
    extractResume(apiKey, source);
  };
  reader.readAsText(file);
}

// ── One-time extraction: LaTeX → plain text (cached forever) ───────────────
async function extractResume(apiKey, latexSource) {
  document.getElementById('uploadSub').textContent = '⏳ Extracting resume text (one-time)...';
  refreshAnalyzeBtn({ apiKey, latexSource, resumeExtractedText: null });

  try {
    const extractedText = await claudeCall(apiKey, null,
      `Extract all readable text from this LaTeX resume.
Output clean plain text: preserve every section, bullet, date, company, job title, skill and contact detail exactly as written.
Strip all LaTeX commands but keep all actual content. Output only the resume text, nothing else.

LATEX SOURCE:
${latexSource}`
    );

    await storageSet({ resumeExtractedText: extractedText });
    document.getElementById('uploadSub').textContent = '✓ Extracted & cached · click to replace';
    showStatus('Resume ready — analysis will be fast!', 'success');
    refreshAnalyzeBtn({ apiKey, latexSource, resumeExtractedText: extractedText });
  } catch (err) {
    document.getElementById('uploadSub').textContent = '❌ Extraction failed · click zone to retry';
    showStatus('Error: ' + err.message, 'error');
    refreshAnalyzeBtn({ apiKey, latexSource, resumeExtractedText: null });
  }
}

// ── Analyze button state ───────────────────────────────────────────────────
function refreshAnalyzeBtn(data) {
  const btn = document.getElementById('analyzeBtn');
  const ready = !!(data.apiKey && data.resumeExtractedText);
  btn.disabled = !ready;
  if (!data.apiKey)                  btn.textContent = '⚠ Add API key first';
  else if (!data.latexSource)        btn.textContent = '⚠ Upload .tex resume first';
  else if (!data.resumeExtractedText) btn.textContent = '⏳ Processing resume...';
  else                               btn.textContent = '⚡ Analyze This Job';
}

// ── Trigger analysis — send message to already-injected content.js ─────────
// content.js is auto-injected on every page via manifest content_scripts.
// We just send it a message. The popup stays open until sendMessage callback
// fires, THEN we close it — no race condition.
function analyzeCurrentPage() {
  document.querySelector('header').style.display = 'none';
  document.querySelector('main').style.display = 'none';
  document.querySelector('footer').style.display = 'none';
  if(window.triggerResumeATSPanel) window.triggerResumeATSPanel('openPanel');
}

function autoFillOnly() {
  document.querySelector('header').style.display = 'none';
  document.querySelector('main').style.display = 'none';
  document.querySelector('footer').style.display = 'none';
  if(window.triggerResumeATSPanel) window.triggerResumeATSPanel('autoFillOnly');
}

// ── Claude API helper (called from popup context) ──────────────────────────
function claudeCall(apiKey, pdfBase64, prompt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'callClaude', apiKey, pdfBase64: pdfBase64 || null, prompt }, res => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res?.success) resolve(res.response);
      else reject(new Error(res?.error || 'Unknown error'));
    });
  });
}

// ── Storage helpers ────────────────────────────────────────────────────────
function storageSet(obj) { return new Promise(r => chrome.storage.local.set(obj, r)); }
function storageGet(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }

// ── Status message ─────────────────────────────────────────────────────────
function showStatus(msg, type) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = type; // 'success' or 'error'
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}
