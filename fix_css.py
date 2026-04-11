import re

with open('content.css', 'r') as f:
    css = f.read()

scrollbar = """
.rats-content::-webkit-scrollbar { width: 6px; }
.rats-content::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 4px; }
.rats-content::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }
.rats-panel { display: none; padding: 24px; }
.rats-panel.active { display: block; }

/* ── Loading ──────────────────────────── */
"""

css = re.sub(
    r'\.rats-content::-webkit-scrollbar \{ width: 6px; \}.*?/\* ── Loading ──────────────────────────── \*/',
    scrollbar.strip(),
    css,
    flags=re.DOTALL
)

with open('content.css', 'w') as f:
    f.write(css)

