# ResumeATS — Smart Job Apply

ResumeATS is an intelligent Chrome extension powered by the NVIDIA NIM API (Llama 3.3 70B) that revolutionizes how you tailor your resume for job applications. It analyzes the job description on the current page, compares it against your LaTeX resume, provides an ATS score, suggests actionable improvements, applies them directly to your LaTeX source, and lets you download a freshly compiled PDF. It also features one-click form auto-filling and AI-generated cover letters.

## 🚀 Features

- **ATS Scoring & Analysis:** Instantly analyze how well your resume matches any job description on sites like LinkedIn, Indeed, etc.
- **Smart Resume Optimization:** Get AI-driven suggestions to add missing keywords, reword experiences, or emphasize relevant skills.
- **Hyper-Fuzzy LaTeX Replacement (v6.0):** An advanced, robust matching algorithm that seamlessly applies AI suggestions directly to your `.tex` source code, regardless of formatting, spacing, or LaTeX symbol complexities.
- **Instant PDF Compilation:** Automatically compiles your customized `.tex` source into a professional PDF using a remote LaTeX compiler API, ready for download.
- **Auto-Fill Forms:** Effortlessly fill complex job application forms with your profile details in a single click.
- **Cover Letter Generator:** Automatically generate tailored, professional cover letters that map your achievements to the specific job description.
- **Modern UI:** A beautiful, dark-mode, bento-style floating panel interface injected seamlessly using content scripts.

## 🛠 Technology Stack

- **Extension Framework:** Chrome Extension API (Manifest V3)
- **Frontend:** Vanilla HTML, CSS (`content.css`), JavaScript (`content.js`, `popup.js`)
- **Backend / AI Engine:** NVIDIA NIM API (`meta/llama-3.3-70b-instruct`) via OpenAI-compatible chat completions API.
- **PDF Extraction / Compilation:** Pure JS stream parser for extraction and `latex.ytotech.com` for remote compilation.

## 📦 Installation

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right corner.
4. Click on **"Load unpacked"**.
5. Select the `ats-extension` directory.
6. Pin the ResumeATS extension to your toolbar for easy access.

## ⚙️ Setup & Configuration

1. **API Key Setup:**
   - Click the ResumeATS extension icon in your browser toolbar.
   - Enter your **NVIDIA NIM API Key** (starts with `nvapi-`) in the popup and click Save.
   
2. **Upload LaTeX Resume:**
   - In the same popup, click the upload zone to provide your `.tex` resume file. 
   - The extension will automatically extract and cache the text content for lightning-fast analysis on future job applications.

## 💡 How to Use

1. **Find a Job:** Navigate to a job posting (e.g., on LinkedIn).
2. **Analyze:** Click the ResumeATS extension icon, verify your setup is complete, and click **"⚡ Analyze This Job"**.
3. **Review Score:** A panel will slide in summarizing your ATS match, found keywords, and missing keywords.
4. **Apply Changes:** Go to the **"Changes"** tab to review AI suggestions. Select the ones you want, and the extension will precisely update your `.tex` code in memory.
5. **Download PDF:** Go to the **"Review"** tab and click **Download PDF** to get your newly compiled resume.
6. **Auto-Fill & Submit:** Check the **"Auto-Fill"** tab to inject your details into the application form, draft a **Cover Letter**, and apply!

## 🧩 Architecture Details

- **`manifest.json`:** Defines permissions, content scripts, and setting up the service worker.
- **`background.js`:** Service worker responsible for safely interacting with the NVIDIA NIM API, parsing PDF streams, and contacting the LaTeX compiler.
- **`content.js` / `content.css`:** Injected into the active tab to render the UI panel, extract job descriptions, execute the hyper-fuzzy matching algorithms, and auto-fill forms.
- **`popup.html` / `popup.js`:** The extension's initial interaction point for setup, uploading resumes, and managing the API key.

## 🤝 Troubleshooting

- **Fuzzy Match Failed:** If changes aren't applying, it means the text the AI proposed to change no longer matches the source document. However, with the latest **Hyper-Fuzzy 6.0 Mapping Algorithm**, matching is extremely resilient to spacing, typography, and symbol differences.
- **API Errors:** Ensure your NVIDIA NIM API key is valid and has sufficient credits.
- **Compilation Failed:** Ensure your `.tex` source remains syntactically valid after modifications, or verify the public compiler API is accessible.
