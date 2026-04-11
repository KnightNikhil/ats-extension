
window.triggerResumeATSPanel = function (action) {
  chrome.storage.local.get(['apiKey', 'resumeExtractedText', 'latexSource'], async data => {
    S.apiKey = data.apiKey || '';
    S.resumeText = data.resumeExtractedText || '';
    S.latexSource = data.latexSource || '';

    if (action === 'openPanel') {
      buildPanel();
      if (!S.apiKey) { toast('Add API key in the popup', true); return; }
      if (!S.resumeText) { toast('Upload your .tex resume in the popup', true); return; }
      S.jobDescription = await extractJobDesc();
      runAnalysis();
    } else {
      buildPanel();
      switchTab('autofill');
      S.jobDescription = await extractJobDesc();
      renderAutofill({});
    }
  });
};
// content.js — ResumeATS
// Auto-injected on every page via manifest content_scripts.
// Receives messages from popup.js via chrome.runtime.onMessage.


// ── State ─────────────────────────────────────────────────────────────
const S = {
  tab: 'score',
  score: null,
  suggestions: [],
  selected: new Set(),
  fillData: {},
  jobDescription: '',
  resumeText: '',
  latexSource: '',
  apiKey: '',
  companyName: '',
  coverLetter: ''
};

// ── Fonts ─────────────────────────────────────────────────────────────
if (!document.getElementById('rats-fonts')) {
  const l = document.createElement('link');
  l.id = 'rats-fonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap';
  document.head.appendChild(l);
}


// ── Build panel ───────────────────────────────────────────────────────
// Class names MUST match content.css exactly.
function buildPanel() {
  if (document.getElementById('resumeats-panel')) {
    document.getElementById('resumeats-panel').classList.add('open');
    return;
  }

  const el = document.createElement('div');
  el.id = 'resumeats-panel';
  el.innerHTML = `
      <div class="rats-header">
        <div class="rats-logo-text">ResumeATS</div>
        <button class="rats-close" id="rats-close">
          <span class="rats-material-icon">close</span>
        </button>
      </div>
      <div class="rats-tabs">
        <div class="rats-tab active" data-tab="score">
          <span class="rats-material-icon">analytics</span>
          <span class="rats-tab-label">Score</span>
        </div>
        <div class="rats-tab" data-tab="changes">
          <span class="rats-material-icon">history_edu</span>
          <span class="rats-tab-label">Changes</span>
        </div>
        <div class="rats-tab" data-tab="autofill">
          <span class="rats-material-icon">edit_note</span>
          <span class="rats-tab-label">Auto-Fill</span>
        </div>
        <div class="rats-tab" data-tab="review">
          <span class="rats-material-icon">rate_review</span>
          <span class="rats-tab-label">Review</span>
        </div>
        <div class="rats-tab" data-tab="coverletter">
          <span class="rats-material-icon">drafts</span>
          <span class="rats-tab-label">Letter</span>
        </div>
      </div>
      <div class="rats-content">
        <div class="rats-panel active" id="panel-score">
          <div class="rats-loading" id="score-loading">
            <div class="rats-spinner"></div>
            <div class="rats-loading-text">Analyzing job match…</div>
            <div class="rats-loading-sub">Using cached resume · only JD sent</div>
          </div>
          <div id="score-content" style="display:none"></div>
        </div>
        <div class="rats-panel" id="panel-changes">
          <div id="changes-content"></div>
        </div>
        <div class="rats-panel" id="panel-autofill">
          <div id="autofill-content"></div>
        </div>
        <div class="rats-panel" id="panel-review">
          <div id="review-content"></div>
        </div>
        <div class="rats-panel" id="panel-coverletter">
          <div id="coverletter-content">
            <div class="rats-empty" style="margin-top: 40px;">
              <div class="rats-empty-icon">📝</div>
              <div class="rats-empty-text">Cover Letter Generator</div>
              <div class="rats-empty-sub">Create a tailored cover letter for this role using your AI profile.</div>
              <button class="rats-btn-solid" data-action="generateCoverLetter" style="margin-top: 24px;">
                <span class="rats-material-icon fill">bolt</span> Generate Now
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="rats-action-bar" id="rats-action-bar" style="display:none">
        <div class="rats-action-top">
          <span class="rats-action-status"><span class="rats-action-dot"></span><span id="sel-count">0 changes selected</span></span>
          <button class="rats-action-link" id="sel-deselect-btn">Deselect All</button>
        </div>
        <div class="rats-action-row">
          <button class="rats-btn-solid" id="btn-dl" data-action="downloadPdf" disabled>
            <span class="rats-material-icon">check_circle</span> Apply Selected & Download
          </button>
          <button class="rats-btn-icon" data-action="goToAutofill" title="Go to Auto-Fill">
            <span class="rats-material-icon fill">bolt</span>
          </button>
        </div>
      </div>`;

  document.body.appendChild(el);

  // Single delegated click handler — works in content script isolated world
  el.addEventListener('click', e => {
    if (e.target.closest('#rats-close')) { closePanel(); return; }

    const tab = e.target.closest('.rats-tab');
    if (tab?.dataset.tab) { switchTab(tab.dataset.tab); return; }

    const btn = e.target.closest('[data-action]');
    if (btn) {
      const a = btn.dataset.action;
      if (a === 'downloadPdf') downloadPdf();
      if (a === 'goToAutofill') switchTab('autofill');
      if (a === 'viewChanges') switchTab('changes');
      if (a === 'startAutofill') startAutofill();
      if (a === 'goToReview') goToReview();
      if (a === 'submitApp') submitApp();
      if (a === 'backToAutofill') switchTab('autofill');
      if (a === 'retry') retry();
      if (a === 'generateCoverLetter') generateCoverLetter();
      if (a === 'copyCoverLetter') copyCoverLetter();
      if (a === 'downloadCoverLetter') downloadCoverLetter();
      return;
    }

    if (e.target.closest('#sel-deselect-btn')) {
      S.selected.clear();
      document.querySelectorAll('.rats-sug-card.selected').forEach(c => {
        c.classList.remove('selected');
      });
      document.querySelectorAll('.rats-checkbox').forEach(c => {
        c.checked = false;
      });
      const sc = document.getElementById('sel-count');
      if (sc) sc.textContent = `0 changes selected`;
      const actionBtn = document.getElementById('btn-dl');
      if (actionBtn) actionBtn.disabled = true;
      return;
    }

    const sug = e.target.closest('.rats-sug-card');
    if (sug?.dataset.i !== undefined) toggleSug(parseInt(sug.dataset.i));
  });

  setTimeout(() => {
    el.classList.add('open');


  }, 30);
}

function closePanel() {
  document.getElementById('resumeats-panel')?.classList.remove('open');

}

function switchTab(tab) {
  const panel = document.getElementById('resumeats-panel');
  if (!panel) return;
  S.tab = tab;
  panel.querySelectorAll('.rats-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  panel.querySelectorAll('.rats-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'panel-' + tab));
  const bar = document.getElementById('rats-action-bar');
  if (bar) bar.style.display = (tab === 'changes' && S.suggestions.length > 0) ? 'block' : 'none';
}

// ── Job description ────────────────────────────────────────────────────

async function extractJobDesc() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return resolve('');
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const title = document.title ? document.title + '\\n\\n' : '';
          const sel = ['[data-testid="job-description"]', '.job-description', '.jobDescriptionContent', '.description__text', '#job-description', '[class*="jobDescription"]', '.show-more-less-html__markup', '.jobs-description__content', '[class*="JobDetails"]', 'article', 'main'];
          for (const s of sel) {
            const el = document.querySelector(s);
            if (el?.innerText?.length > 200) return title + el.innerText.trim().slice(0, 6000);
          }
          return title + document.body.innerText.slice(0, 4000);
        }
      }, res => resolve(res?.[0]?.result || ''));
    });
  });
}


// ── Claude — plain text only, never sends PDF ──────────────────────────
function claude(prompt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'callClaude', apiKey: S.apiKey, pdfBase64: null, prompt },
      res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.success) resolve(res.response);
        else reject(new Error(res?.error || 'API error'));
      }
    );
  });
}

function hashStr(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = (hash * 33) ^ str.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

// ── ATS Analysis ───────────────────────────────────────────────────────
async function runAnalysis() {
  const loading = document.getElementById('score-loading');
  const scoreContent = document.getElementById('score-content');
  loading.style.display = 'flex';
  scoreContent.style.display = 'none';

  try {
    const cacheKey = 'ats_cache_' + hashStr(S.latexSource + S.jobDescription);
    const cached = await new Promise(res => chrome.storage.local.get(cacheKey, data => res(data[cacheKey])));

    let raw;
    if (cached) {
      raw = cached;
    } else {
      const prompt = `You are an expert ATS analyst and LaTeX resume engineer.

Your task: analyse the resume against the job description, then produce 
structured improvement suggestions that can be applied as non-conflicting 
sequential patches.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESUME (LaTeX source):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${S.latexSource}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JOB DESCRIPTION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${S.jobDescription}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTERNAL REASONING — do this before writing any JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1 — Keyword extraction
  a) List every technical skill, tool, methodology, and domain term in the JD.
  b) Mark each as: FOUND (exists in resume) or MISSING (not in resume).

Step 2 — Score calculation
  found_count / total_count × 70   → keyword coverage points
  + formatting/structure quality    → up to 15 points
  + seniority/experience match      → up to 15 points
  = total score (0–100)

Step 3 — Suggestion planning (most important step)
  a) Identify 5–7 specific improvements.
  b) For EACH suggestion, record the EXACT originalText you will use.
  c) CHECK: does any originalText appear more than once across your list?
     If YES — remove the duplicate. Pick a different line from the resume 
     for that suggestion instead.
  d) CHECK: are suggestions spread across at least 3 different sections?
     If NO — revise until they are.
  e) Only proceed to output once every originalText is unique.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY one valid JSON object.
No markdown fences. No backticks. No explanation. No text before or after.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUGGESTION RULES (read carefully — violations break the patch system)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — EXACT MATCH
  originalText must be a character-for-character copy from the LaTeX source.
  Whitespace, line breaks, backslashes, braces — all must match exactly.
  If you cannot find the exact string, do not include that suggestion.

RULE 2 — ONE SUGGESTION PER LINE (the most critical rule)
  No two suggestions may share the same originalText.
  Each suggestion must target a DIFFERENT line or block in the LaTeX source.
  Treat this as a hard constraint — it cannot be relaxed for any reason.

RULE 3 — REPLACE, NEVER ADD
  Never add new \item entries or new lines.
  Always replace an existing line with a reworded version that incorporates 
  the missing keyword naturally.
  replacementText must have the same number of lines and LaTeX commands as 
  originalText.

RULE 4 — SECTION SPREAD
  Suggestions must be distributed across at least 3 different sections.
  No more than 2 suggestions may target the same section.

RULE 5 — VALID LATEX ONLY
  replacementText must be valid LaTeX.
  Do not break existing environments, commands, or brace pairs.

RULE 6 — IMPACT HONESTY
  impact must reflect real ATS keyword gain.
  Use "+3–5 points" for minor rewording, "+6–10 points" for adding a 
  high-frequency missing keyword.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED JSON SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "score": <integer 0–100>,
  "scoreLabel": "Excellent" | "Good" | "Fair" | "Poor",
  "scoreDescription": "<one sentence explaining the score>",

  "keywordsFound": ["<keyword>"],
  "keywordsMissing": ["<keyword>"],

  "suggestions": [
    {
      "id": <integer, 1-based, unique per suggestion>,
      "type": "add" | "improve" | "reword" | "remove",
      "section": "Skills" | "Summary" | "Experience" | "Education",
      "title": "<short action title>",
      "description": "<why this improves ATS score — name the specific keyword>",
      "impact": "<+N points>",
      "originalText": "<EXACT verbatim LaTeX — must be unique across all suggestions>",
      "replacementText": "<valid LaTeX replacement — same structure as originalText>"
    }
  ],

  "suggestionCount": <integer — must equal suggestions array length>,

  "profileData": {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedIn": "",
    "website": "",
    "summary": "<2–3 sentence summary rewritten to target this specific job>"
  },

  "companyName": "<company name from job description>"
}

SELF-CHECK BEFORE FINALISING (do this mentally):
  □ Every originalText exists verbatim in ${S.latexSource}
  □ No two suggestions share the same originalText
  □ Suggestions span at least 3 different sections
  □ No section has more than 2 suggestions
  □ suggestionCount equals the length of the suggestions array
  □ All replacementText values are valid LaTeX with same line count as originalText
  □ Output is pure JSON — no text before {, no text after }`;
      raw = await claude(prompt);
      chrome.storage.local.set({ [cacheKey]: raw });
    }

    let data;
    try { data = JSON.parse(raw); }
    catch {
      // Robust LaTeX-in-JSON sanitizer:
      // LLMs often return LaTeX commands like \textbf without escaping.
      // We normalize all backslash sequences to result in a single backslash,
      // unless it's a quote escape (\").
      let jsonStr = raw;
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) jsonStr = m[0];

      jsonStr = jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
        // Replace any sequence of 1 or more backslashes (not followed by ") with exactly \\
        // This way \textbf -> \\textbf AND \\textbf -> \\textbf
        return match.replace(/\\+(?!")/g, '\\\\');
      });

      // Fix common LLM hallucinated trailing parenthesis before object close or comma
      // E.g. "Workday Studio}.")}, -> "Workday Studio."},
      jsonStr = jsonStr.replace(/"\s*[\)\]]+\s*}/g, '"}');
      jsonStr = jsonStr.replace(/"\s*[\)\]]+\s*,/g, '",');

      // Fix missing closing brackets for arrays before next JSON keys
      // E.g. "Java", "keywordsMissing": -> "Java"], "keywordsMissing":
      jsonStr = jsonStr.replace(/"\s*,\s*"keywordsMissing"/g, '"], "keywordsMissing"');
      jsonStr = jsonStr.replace(/"\s*,\s*"suggestions"/g, '"], "suggestions"');

      console.log('Sanitized JSON:', jsonStr);
      try { data = JSON.parse(jsonStr); }
      catch (e2) {
        console.error('Final JSON parse failed:', e2, jsonStr);
        throw new Error('Could not parse API response');
      }
    }

    S.selected.clear();
    S.score = data.score;
    S.suggestions = data.suggestions || [];
    S.fillData = data.profileData || {};
    S.companyName = data.companyName || '';

    renderScore(data);
    renderChanges(data.suggestions);
    renderAutofill(data.profileData);

    loading.style.display = 'none';
    scoreContent.style.display = 'block';

  } catch (err) {
    loading.innerHTML = `
        <div style="text-align:center;padding:20px">
          <div style="font-size:32px;margin-bottom:10px">❌</div>
          <div style="color:#ff4d6d;font-size:14px;margin-bottom:8px">Analysis failed</div>
          <div style="color:#5a5a7a;font-size:11px;font-family:monospace;word-break:break-word;margin-bottom:14px">${esc(err.message)}</div>
          <button data-action="retry" style="padding:8px 18px;background:#1a1a24;border:1px solid #222230;color:#e8e8f2;border-radius:8px;cursor:pointer;font-family:Syne,sans-serif">Retry</button>
        </div>`;
  }
}

// ── Score tab ──────────────────────────────────────────────────────────
function renderScore(d) {
  const cls = d.score >= 75 ? 'score-high' : d.score >= 50 ? 'score-mid' : 'score-low';
  document.getElementById('score-content').innerHTML = `
      <div class="rats-score-card">
        <div class="rats-score-glow-bg"></div>
        <div class="rats-score-wrapper">
          <svg>
            <circle class="bg" cx="96" cy="96" r="88"></circle>
            <circle class="fill" cx="96" cy="96" r="88" id="score-fill-svg"></circle>
            <defs>
              <linearGradient id="rats_gradient_score" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#6C63FF;stop-opacity:1"></stop>
                <stop offset="100%" style="stop-color:#00E87A;stop-opacity:1"></stop>
              </linearGradient>
            </defs>
          </svg>
          <div class="rats-score-inner">
            <span class="score">${d.score}%</span>
            <span class="label">${esc(d.scoreLabel)}</span>
          </div>
        </div>
        <h3 class="rats-score-card-title">ATS Match Score</h3>
        <p class="rats-score-card-desc">${esc(d.scoreDescription)}</p>
      </div>
      <div class="rats-keywords-section">
        <div class="rats-section-header">
          <h4 class="found">Keywords Found</h4>
          <span>${(d.keywordsFound || []).length} found</span>
        </div>
        <div class="rats-chips-wrap">
          ${(d.keywordsFound || []).map(k => `<div class="rats-chip rats-chip-found"><span class="rats-material-icon fill">check_circle</span>${esc(k)}</div>`).join('') || '<span style="font-size:12px;color:#5a5a7a">None detected</span>'}
        </div>
      </div>
      <div class="rats-keywords-section">
        <div class="rats-section-header">
          <h4 class="missing">Missing Keywords</h4>
          <span>${(d.keywordsMissing || []).length} missing</span>
        </div>
        <div class="rats-chips-wrap">
          ${(d.keywordsMissing || []).map(k => `<div class="rats-chip rats-chip-missing"><span class="rats-material-icon">cancel</span>${esc(k)}</div>`).join('') || '<span style="font-size:12px;color:#00e87a">All covered 🎉</span>'}
        </div>
      </div>
      <div style="margin-top:24px">
        <button class="rats-btn-solid" data-action="viewChanges" style="width:100%">
          VIEW SUGGESTED CHANGES <span class="rats-material-icon">arrow_forward</span>
        </button>
      </div>`;
  setTimeout(() => {
    const f = document.getElementById('score-fill-svg');
    if (f) {
      const offset = 552.9 - (552.9 * Math.max(0, Math.min(100, d.score)) / 100);
      f.style.strokeDashoffset = offset;
    }
  }, 200);
}

// ── Changes tab ────────────────────────────────────────────────────────
function renderChanges(sugs) {
  const el = document.getElementById('changes-content');
  if (!sugs?.length) {
    el.innerHTML = `<div class="rats-empty"><div class="rats-empty-icon">🎉</div><div class="rats-empty-text">No changes needed</div><div class="rats-empty-sub">Your resume is well optimized!</div></div>`;
    return;
  }
  el.innerHTML = `
      <div class="rats-changes-header">
        <div>
          <h2>Optimization Suggestions</h2>
          <p>Found ${sugs.length} impact opportunities</p>
        </div>
        <span class="rats-badge-autogen">AUTO-GEN</span>
      </div>
      <div class="rats-sug-list">
        ${sugs.map((s, i) => buildSugCard(s, i)).join('')}
      </div>`;

  const bar = document.getElementById('rats-action-bar');
  if (bar && S.tab === 'changes') bar.style.display = 'block';
}

function buildSugCard(s, i) {
  const hasO = (s.originalText || '').trim().length > 0;
  const hasR = (s.replacementText || '').trim().length > 0;
  const diff = (hasO || hasR) ? `
      <div>
        ${hasO ? `<div class="rats-diff-container removed">
          <span class="rats-material-icon">remove</span>
          <p>${esc(s.originalText)}</p>
        </div>` : ''}
        ${hasR ? `<div class="rats-diff-container added">
          <span class="rats-material-icon">add</span>
          <p>${esc(s.replacementText)}</p>
        </div>` : ''}
      </div>` : '';

  return `
      <div class="rats-sug-card" data-i="${i}">
        <div class="rats-sug-top">
          <div class="rats-sug-left">
            <input type="checkbox" class="rats-checkbox" id="chk-${i}" style="pointer-events: none" />
            <span class="rats-sug-section">${esc(s.section || 'EXPERIENCE')}</span>
          </div>
          <span class="rats-sug-impact"><span class="rats-material-icon" style="font-size:14px">trending_up</span> ${esc(s.impact || '+?')}</span>
        </div>
        ${diff}
      </div>`;
}

function toggleSug(i) {
  const el = document.querySelector(`[data-i="${i}"]`);
  if (!el) return;
  if (S.selected.has(i)) S.selected.delete(i);
  else S.selected.add(i);
  el.classList.toggle('selected', S.selected.has(i));
  const chk = document.getElementById(`chk-${i}`);
  if (chk) chk.checked = S.selected.has(i);
  const n = S.selected.size;
  const sc = document.getElementById('sel-count');
  if (sc) sc.textContent = `${n} change${n !== 1 ? 's' : ''} selected`;
  const btn = document.getElementById('btn-dl');
  if (btn) btn.disabled = n === 0;
}

// ── Download PDF ───────────────────────────────────────────────────────
async function downloadPdf() {
  if (!S.selected.size) { toast('Select at least one change first', true); return; }
  if (!S.latexSource) { toast('No LaTeX source — re-upload your .tex in the popup', true); return; }

  const bar = document.getElementById('rats-action-bar');
  const n = S.selected.size;

  const restoreBar = () => {
    bar.innerHTML = `
        <div class="rats-action-top">
          <span class="rats-action-status"><span class="rats-action-dot"></span><span id="sel-count">${n} change${n !== 1 ? 's' : ''} selected</span></span>
          <button class="rats-action-link" id="sel-deselect-btn">Deselect All</button>
        </div>
        <div class="rats-action-row">
          <button class="rats-btn-solid" id="btn-dl" data-action="downloadPdf" ${n ? '' : 'disabled'}>
            <span class="rats-material-icon">download</span> Download PDF
          </button>
          <button class="rats-btn-icon" data-action="goToAutofill">
            <span class="rats-material-icon fill">bolt</span>
          </button>
        </div>`;
  };

  const setStatus = (title, sub) => {
    if (bar) bar.style.display = 'block';
    bar.innerHTML = `
        <div style="text-align:center;width:100%;padding:8px">
          <div class="rats-spinner" style="width:28px;height:28px;border-top-color:#6c63ff;margin:0 auto 8px"></div>
          <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:14px;color:var(--rats-on-surface)">${title}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--rats-outline)">${sub}</div>
        </div>`;
  };

  const selected = [...S.selected].map(i => S.suggestions[i]).filter(Boolean);
  const changes = selected.map((s, i) =>
    `CHANGE ${i + 1} — ${s?.title || 'Untitled'}\n  FIND:    ${JSON.stringify((s?.originalText || '').trim())}\n  REPLACE: ${JSON.stringify((s?.replacementText || '').trim())}`
  ).join('\n\n');
  const lineCount = S.latexSource.split('\n').length;

  try {
    setStatus('Step 1/2 — Editing text…', 'Text-only substitutions · zero formatting changes');

    let cleanLatex = S.latexSource;
    let appliedCount = 0;

    // Function to help find text ignoring whitespace and dash differences
    function fuzzyFind(source, find) {
      if (!find || !find.trim()) return null;

      // Normalize dashes and trim
      const norm = s => s.replace(/[—–−]/g, '-');
      const sNorm = norm(source);
      const fNorm = norm(find).replace(/\s/g, '').toLowerCase();

      if (!fNorm) return null;

      // Build a "clean" version of source without whitespace,
      // but maintain a map to original indices
      const cleanSourceArr = [];
      const sourceMap = [];
      for (let i = 0; i < sNorm.length; i++) {
        const char = sNorm[i];
        if (!/\s/.test(char)) {
          cleanSourceArr.push(char.toLowerCase());
          sourceMap.push(i);
        }
      }

      const cleanSourceStr = cleanSourceArr.join('');
      const foundIdx = cleanSourceStr.indexOf(fNorm);

      if (foundIdx === -1) {
        console.warn('Fuzzy 6.0 failed. Target (Cleaned):', fNorm);
        return null;
      }

      // Get the start and end indices in the ORIGINAL source
      const start = sourceMap[foundIdx];
      const end = sourceMap[foundIdx + fNorm.length - 1];

      return {
        text: source.slice(start, end + 1),
        index: start
      };
    }

    for (const s of selected) {
      if (s.originalText && s.replacementText) {
        const findText = s.originalText.trim();
        const replaceText = s.replacementText.trim();

        const match = fuzzyFind(cleanLatex, findText);
        if (match) {
          // Replace the EXACT text found in the source
          cleanLatex = cleanLatex.slice(0, match.index) + replaceText + cleanLatex.slice(match.index + match.text.length);
          appliedCount++;
          console.log(`✅ Applied: "${s.title}"`);
        } else {
          console.warn(`❌ Fuzzy match failed for: "${s.title}"\nSearching for: [${findText}]`);
        }
      }
    }

    if (appliedCount === 0 && selected.length > 0) {
      throw new Error('Could not match any of your selections. Check if you have made manual changes to the file.');
    }

    setStatus('Step 2/2 — Compiling PDF…', `Applied ${appliedCount}/${selected.length} changes`);

    const pdfB64 = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'compileLaTeX', latex: cleanLatex }, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.success) resolve(res.pdfBase64);
        else reject(new Error(res?.error || 'Compilation failed'));
      });
    });

    const bin = atob(pdfB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    const safeCompany = (S.companyName || 'Company').replace(/[^a-zA-Z0-9_\- ]/g, '_');
    a.download = `Java_Nikhil_Laddha_Resume_${safeCompany}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✓ PDF downloaded — ready to upload!');

  } catch (err) {
    toast('❌ ' + err.message, true);
  } finally {
    restoreBar();
  }
}

// ── Autofill tab ───────────────────────────────────────────────────────
function renderAutofill(p) {
  p = p || {};
  document.getElementById('autofill-content').innerHTML = `
      <section>
        <div class="rats-module-label">MODULE: AUTO-FILL</div>
        <h2 class="rats-form-title">Application Data</h2>
        <p class="rats-form-sub">Ready to sync with active browser tab.</p>
      </section>
      <section class="rats-form-group">
        <div class="rats-input-cell">
          <label class="rats-input-label">FULL NAME</label>
          <input type="text" class="rats-input" id="fill-name" value="${esc(p.name)}" placeholder="John Doe">
        </div>
        <div class="rats-input-cell">
          <label class="rats-input-label">EMAIL ADDRESS</label>
          <input type="text" class="rats-input" id="fill-email" value="${esc(p.email)}" placeholder="john@example.com">
        </div>
        <div class="rats-input-row">
          <div class="rats-input-cell">
            <label class="rats-input-label">PHONE</label>
            <input type="text" class="rats-input" id="fill-phone" value="${esc(p.phone)}" placeholder="(555) 000-0000">
          </div>
          <div class="rats-input-cell">
            <label class="rats-input-label">LOCATION (CURRENT CITY)</label>
            <input type="text" class="rats-input" id="fill-location" value="${esc(p.location || 'Pune')}" placeholder="Pune">
          </div>
        </div>
        <div class="rats-input-cell">
          <label class="rats-input-label">LINKEDIN URL</label>
          <input type="text" class="rats-input" id="fill-linkedin" value="${esc(p.linkedIn)}" placeholder="linkedin.com/in/...">
        </div>
        <div class="rats-input-cell">
          <label class="rats-input-label">PORTFOLIO / WEBSITE</label>
          <input type="text" class="rats-input" id="fill-website" value="${esc(p.website)}" placeholder="yoursite.com">
        </div>

        <div class="rats-input-row">
          <div class="rats-input-cell">
            <label class="rats-input-label">CURRENT CTC (INR)</label>
            <input type="text" class="rats-input" id="fill-cctc" value="${esc(p.cctc || '1500000')}" placeholder="1500000">
          </div>
          <div class="rats-input-cell">
            <label class="rats-input-label">EXPECTED CTC (INR)</label>
            <input type="text" class="rats-input" id="fill-ectc" value="${esc(p.ectc || '1800000')}" placeholder="1800000">
          </div>
        </div>

        <div class="rats-input-cell">
          <label class="rats-input-label">INSTITUTION</label>
          <input type="text" class="rats-input" id="fill-college" value="${esc(p.college || 'SRM Institute of Science and Technology (IST), Kattankulathur, Chennai')}" placeholder="SRM Institute...">
        </div>
        <div class="rats-input-cell">
          <label class="rats-input-label">COURSE / DEGREE / SPECIALISATION</label>
          <input type="text" class="rats-input" id="fill-degree" value="${esc(p.degree || 'B.Tech in Computer Science and Engineering (Specialization in AI and ML)')}" placeholder="B.Tech...">
        </div>

        <div class="rats-input-row">
          <div class="rats-input-cell">
            <label class="rats-input-label">GRADUATION YEAR</label>
            <input type="text" class="rats-input" id="fill-gradYear" value="${esc(p.gradYear || '2022')}" placeholder="2022">
          </div>
          <div class="rats-input-cell">
            <label class="rats-input-label">EXPERIENCE</label>
            <input type="text" class="rats-input" id="fill-experience" value="${esc(p.experience || '3.5+ years')}" placeholder="3.5+ years">
          </div>
        </div>

        <div class="rats-input-row">
          <div class="rats-input-cell">
            <label class="rats-input-label">CURRENT COMPANY</label>
            <input type="text" class="rats-input" id="fill-company" value="${esc(p.company || 'Barclays')}" placeholder="Barclays">
          </div>
          <div class="rats-input-cell">
            <label class="rats-input-label">NOTICE PERIOD</label>
            <input type="text" class="rats-input" id="fill-notice" value="${esc(p.notice || '1 month')}" placeholder="1 month">
          </div>
        </div>
        <div class="rats-input-cell" style="margin-bottom: 16px;">
          <label class="rats-input-label">OPEN TO LOCATIONS</label>
          <input type="text" class="rats-input" id="fill-prefLocations" value="${esc(p.prefLocations || 'Pune, Bengaluru, or PAN India')}" placeholder="Pune, Bengaluru...">
        </div>

        <div class="rats-input-cell">
          <label class="rats-input-label">
            <span>AI-TAILORED SUMMARY</span>
            <span style="color:var(--rats-secondary)">Auto-generated</span>
          </label>
          <textarea class="rats-input" id="fill-summary" rows="4">${esc(p.summary || '')}</textarea>
        </div>
      </section>
      <button data-action="startAutofill" class="rats-btn-solid" style="width:100%;margin-bottom:12px">
        <span class="rats-material-icon fill">bolt</span> AUTO-FILL THIS PAGE
      </button>
      <button data-action="goToReview" class="rats-btn-outline" style="width:100%;margin-bottom:24px;">
        Review & Submit
      </button>
    `;
}

function field(id, label, val, ph) {
  return `<div class="rats-field">
      <div class="rats-field-label">${label}</div>
      <input type="text" id="${id}" value="${esc(val || '')}" placeholder="${ph}">
    </div>`;
}

function goToReview() {
  S.fillData = {
    name: gv('fill-name'), email: gv('fill-email'),
    phone: gv('fill-phone'), location: gv('fill-location'),
    linkedIn: gv('fill-linkedin'), website: gv('fill-website'),
    summary: gv('fill-summary'),
    cctc: gv('fill-cctc'), ectc: gv('fill-ectc'),
    college: gv('fill-college'), degree: gv('fill-degree'),
    gradYear: gv('fill-gradYear'), experience: gv('fill-experience'),
    company: gv('fill-company'), notice: gv('fill-notice'),
    prefLocations: gv('fill-prefLocations')
  };
  renderReview();
  switchTab('review');
}
function gv(id) { return document.getElementById(id)?.value || ''; }

function renderReview() {
  const d = S.fillData;

  let updatedScore = S.score || 0;
  let totalImpact = 0;
  for (const i of S.selected) {
    const impactStr = S.suggestions[i]?.impact || '';
    const match = impactStr.match(/\+?\s*(\d+)/);
    if (match) {
      totalImpact += parseInt(match[1], 10);
    }
  }
  updatedScore = Math.min(100, updatedScore + totalImpact);

  document.getElementById('review-content').innerHTML = `
      <div class="rats-review-header">
        <h3>Final Review</h3>
        <div class="rats-badge-ready">
          <span class="rats-material-icon fill" style="font-size:16px">verified</span>
          <span>READY</span>
        </div>
      </div>
      <div class="rats-review-bento">
        <div class="rats-review-score-row">
          <div class="rats-mini-score">
            <svg><circle class="bg" cx="32" cy="32" r="28"></circle><circle class="fill" cx="32" cy="32" r="28" style="stroke-dashoffset:${176 - (176 * Math.max(0, Math.min(100, updatedScore)) / 100)}"></circle></svg>
            <span class="rats-mini-score-val">${updatedScore}</span>
          </div>
          <div class="rats-review-score-details">
            <div class="label">ATS COMPATIBILITY</div>
            <div class="title">Optimal Match</div>
            <div class="sub">${S.selected.size} Changes applied${totalImpact > 0 ? ` (+${totalImpact}pts)` : ''}</div>
          </div>
        </div>
        <div class="rats-review-info">
          <div class="rats-review-item"><span class="rats-material-icon">contact_page</span> ${esc(d.name || 'No Name Found')}</div>
          <div class="rats-review-item"><span class="rats-material-icon">alternate_email</span> ${esc(d.email || '--')}</div>
        </div>
      </div>
      <div class="rats-warning-box">
        <span class="rats-material-icon fill">warning</span>
        <p>Before You Submit: Remember to upload your newly generated PDF to ensure ATS formatting is maintained.</p>
      </div>
      <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px;">
        <button data-action="submitApp" class="rats-btn-outline" style="width:100%">
          <span class="rats-material-icon">check_circle</span> Highlight Submit Button
        </button>
        <div style="display:flex;gap:12px">
          <button data-action="downloadPdf" class="rats-btn-solid" style="flex:1;background:var(--rats-surface-high);color:white">
            <span class="rats-material-icon">download</span> PDF
          </button>
          <button data-action="startAutofill" class="rats-btn-solid" style="flex:1">
            <span class="rats-material-icon fill">bolt</span> Auto-Fill
          </button>
        </div>
      </div>
    `;
}

function rv(k, v) {
  if (!v) return '';
  return `<div class="rats-review-field"><span class="rats-review-key">${k}</span><span class="rats-review-val">${esc(v)}</span></div>`;
}

function startAutofill() {
  S.fillData = {
    name: gv('fill-name'), email: gv('fill-email'),
    phone: gv('fill-phone'), location: gv('fill-location'),
    linkedIn: gv('fill-linkedin'), website: gv('fill-website'),
    summary: gv('fill-summary'),
    cctc: gv('fill-cctc'), ectc: gv('fill-ectc'),
    college: gv('fill-college'), degree: gv('fill-degree'),
    gradYear: gv('fill-gradYear'), experience: gv('fill-experience'),
    company: gv('fill-company'), notice: gv('fill-notice'),
    prefLocations: gv('fill-prefLocations')
  };
  const map = [
    { p: ['name', 'full.name', 'fullname'], v: S.fillData.name },
    { p: ['email', 'e-mail'], v: S.fillData.email },
    { p: ['phone', 'telephone', 'mobile'], v: S.fillData.phone },
    { p: ['location', 'city', 'address'], v: S.fillData.location },
    { p: ['linkedin'], v: S.fillData.linkedIn },
    { p: ['website', 'portfolio'], v: S.fillData.website },
    { p: ['cover', 'summary', 'letter', 'about'], v: S.fillData.summary },
    { p: ['current ctc', 'cctc', 'current salary', 'current compensation'], v: S.fillData.cctc },
    { p: ['expected ctc', 'ectc', 'expected salary', 'expected compensation'], v: S.fillData.ectc },
    { p: ['institution', 'college', 'university', 'university name', 'college name'], v: S.fillData.college },
    { p: ['course', 'degree', 'specialization', 'major'], v: S.fillData.degree },
    { p: ['company', 'organization', 'current employer', 'employer'], v: S.fillData.company },
    { p: ['graduation year', 'passing year', 'year of graduation', 'grad year'], v: S.fillData.gradYear },
    { p: ['experience', 'total experience', 'years of experience'], v: S.fillData.experience },
    { p: ['notice period', 'notice'], v: S.fillData.notice },
    { p: ['open to', 'preferred location', 'willing to relocate', 'locations'], v: S.fillData.prefLocations }
  ];
  let n = 0;
  document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]),textarea').forEach(inp => {
    if (inp.closest('#resumeats-panel')) return;
    let labelText = '';
    if (inp.labels && inp.labels.length > 0) {
      labelText = Array.from(inp.labels).map(l => l.innerText).join(' ');
    }
    const ariaLabelledBy = inp.getAttribute('aria-labelledby') ? (document.getElementById(inp.getAttribute('aria-labelledby'))?.innerText || '') : '';

    let parentText = '';
    const parent = inp.closest('div[role="listitem"], .freebirdFormviewerViewItemsItemItem, .js-form-item, .form-group, .field, label, tr');
    if (parent) {
      parentText = parent.innerText || '';
    } else if (inp.parentElement && inp.parentElement.innerText) {
      parentText = inp.parentElement.innerText || '';
    }
    if (parentText.length > 150) parentText = '';

    const attrs = [
      inp.name, inp.id, inp.placeholder, inp.getAttribute('aria-label'), ariaLabelledBy, labelText, parentText
    ].filter(Boolean).join(' ').toLowerCase();

    for (const { p, v } of map) {
      if (!v) continue;
      if (p.some(x => attrs.includes(x))) {
        try {
          inp.focus();
          // In React/Angular, properties are patched. The safest way is to force the native window prototype
          const isTextarea = inp.tagName.toLowerCase() === 'textarea';
          const nativeProto = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(nativeProto, 'value')?.set;

          if (setter) setter.call(inp, v);
          else inp.value = v;
        } catch (e) {
          inp.value = v;
        }

        inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, key: 'Enter' }));

        inp.style.outline = '2px solid #00e87a';
        setTimeout(() => inp.style.outline = '', 3000);
        n++; break;
      }
    }
  });
  toast(`✓ Filled ${n} field${n !== 1 ? 's' : ''}`);
}

function submitApp() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        const btns = [...document.querySelectorAll('button,input[type=submit]')]
          .filter(b => !b.closest('#resumeats-panel') && /submit|apply/i.test((b.textContent || '') + b.type + (b.getAttribute('aria-label') || '')));
        if (btns[0]) {
          btns[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          btns[0].style.outline = '3px solid #6c63ff';
          setTimeout(() => { if (btns[0]) btns[0].style.outline = ''; }, 5000);
          return true;
        }
        return false;
      }
    }, res => {
      if (res?.[0]?.result) toast('✓ Submit button highlighted!');
      else toast('Submit button not found — submit manually', true);
    });
  });
}

function retry() {
  const l = document.getElementById('score-loading');
  if (l) {
    l.innerHTML = `<div class="rats-spinner"></div><div class="rats-loading-text">Retrying…</div><div class="rats-loading-sub">Using cached resume</div>`;
    l.style.display = 'flex';
  }
  const sc = document.getElementById('score-content');
  if (sc) sc.style.display = 'none';
  runAnalysis();
}

// ── Cover Letter ────────────────────────────────────────────────────────
async function generateCoverLetter() {
  const el = document.getElementById('coverletter-content');
  if (!el) return;
  if (!S.apiKey) { toast('Add API key in the popup first', true); return; }
  if (!S.resumeText && !S.latexSource) { toast('Upload your .tex resume in the popup first', true); return; }

  // Show loading state
  el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center">
        <div class="rats-spinner"></div>
        <div class="rats-loading-text" style="margin-top:16px">Crafting your cover letter…</div>
        <div class="rats-loading-sub">Analyzing role & mapping your achievements</div>
      </div>`;

  try {
    const cvText = S.resumeText || S.latexSource;
    const profileData = S.fillData || {};
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const jobTitle = tabs[0]?.title || '';
    const uURL = tabs[0]?.url || '';

    const cacheKey = 'cl_cache_' + hashStr(cvText + S.jobDescription);
    const cached = await new Promise(res => chrome.storage.local.get(cacheKey, data => res(data[cacheKey])));

    let letterText;
    if (cached) {
      letterText = cached;
    } else {
      const prompt = `You are an expert career storyteller and professional cover letter writer. Your style is persuasive, authentic, and laser-focused on connecting a candidate's achievements to a company's needs. You avoid corporate jargon and clichés.

Your mission is to write a compelling, concise cover letter that makes the hiring manager excited to interview this candidate.

First, perform this internal analysis (do not write this part in the output):
1.  **Deconstruct the Role:** What are the top 3 most critical responsibilities and qualifications listed in the job description? What is the core problem this role solves?
2.  **Map the Candidate:** For each critical point, find the strongest piece of evidence (a specific project, skill, or quantified achievement) from the candidate's CV.
3.  **Find the Narrative:** What is the core story here? Is it about someone with deep domain knowledge, someone with similar experience, or someone pivoting their skills in a unique way? The letter must tell this story.

Now, using your analysis, write the cover letter. It must have atleast:
- A clear contact header.
- An opening paragraph that hooks the reader and states the specific role.
- A body paragraph that provides concrete, quantified evidence of how the candidate's skills solve the company's needs. Focus on the 2-3 most impactful points you identified.
- A closing paragraph that conveys genuine enthusiasm for the company's mission and includes a clear call to action.

Candidate CV:
${cvText}

Job Posting:
Title: ${jobTitle}
URL: ${uURL}
Description: ${S.jobDescription}

Candidate Details for Header:
Name: ${profileData.name || 'Candidate'}
Email: ${profileData.email || ''}
Phone: ${profileData.phone || ''}
Location: ${profileData.location || ''}

Output ONLY the full, final letter text, starting with the header. FULL COVER LETTER TEXT WITH REAL LINE BREAKS`;

      letterText = await claude(prompt);
      chrome.storage.local.set({ [cacheKey]: letterText });
    }

    S.coverLetter = letterText;

    // Render the cover letter
    el.innerHTML = `
        <div class="rats-cl-wrapper">
          <div class="rats-cl-header">
            <div>
              <h2 class="rats-cl-title">Your Cover Letter</h2>
              <p class="rats-cl-sub">Tailored for ${esc(S.companyName || 'this role')}</p>
            </div>
            <span class="rats-badge-autogen">AI-GEN</span>
          </div>
          <div class="rats-cl-body">${esc(letterText).replace(/\n/g, '<br>')}</div>
          <div class="rats-cl-actions">
            <button class="rats-btn-solid" data-action="downloadCoverLetter" style="flex:1">
              <span class="rats-material-icon">download</span> Download
            </button>
            <button class="rats-btn-solid" data-action="copyCoverLetter" style="flex:1; background: var(--rats-surface-high); color: white;">
              <span class="rats-material-icon">content_copy</span> Copy
            </button>
            <button class="rats-btn-outline" data-action="generateCoverLetter" style="flex:1">
              <span class="rats-material-icon">refresh</span> Retry
            </button>
          </div>
        </div>`;

  } catch (err) {
    el.innerHTML = `
        <div class="rats-empty" style="margin-top: 40px;">
          <div class="rats-empty-icon">❌</div>
          <div class="rats-empty-text">Generation Failed</div>
          <div class="rats-empty-sub" style="font-family:monospace;word-break:break-word;">${esc(err.message)}</div>
          <button class="rats-btn-solid" data-action="generateCoverLetter" style="margin-top: 24px;">
            <span class="rats-material-icon">refresh</span> Retry
          </button>
        </div>`;
  }
}

async function copyCoverLetter() {
  if (!S.coverLetter) { toast('Generate a cover letter first', true); return; }
  try {
    await navigator.clipboard.writeText(S.coverLetter);
    toast('✓ Cover letter copied to clipboard!');
  } catch {
    // Fallback for older browsers / permission issues
    const ta = document.createElement('textarea');
    ta.value = S.coverLetter;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('✓ Cover letter copied to clipboard!');
  }
}

function downloadCoverLetter() {
  if (!S.coverLetter) { toast('Generate a cover letter first', true); return; }

  // Create a blob from the cover letter string
  const blob = new Blob([S.coverLetter], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  // Create a temporary anchor to trigger the download
  const a = document.createElement('a');
  a.href = url;

  // Clean company name for the filename, or fallback to 'Company'
  const companyStr = (S.companyName || 'Company').replace(/[^a-zA-Z0-9]/g, '_');
  a.download = `Cover_Letter_${companyStr}.txt`;

  document.body.appendChild(a);
  a.click();

  // Cleanup
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('✓ Cover letter downloaded!');
}

// ── Toast ──────────────────────────────────────────────────────────────
function toast(msg, isErr = false) {
  let t = document.getElementById('rats-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'rats-toast';
    t.className = 'rats-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.borderColor = isErr ? '#ff4d6d' : '#00e87a';
  t.style.color = isErr ? '#ff4d6d' : '#00e87a';
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


