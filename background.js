// background.js - Service Worker (no external scripts - MV3 CSP blocks them)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractPDF') {
    extractPdfText(message.base64)
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'callClaude') {
    callClaudeAPI(message.prompt, message.apiKey, message.pdfBase64 || null, message.systemPrompt || null)
      .then(response => sendResponse({ success: true, response }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'compileLaTeX') {
    compileLaTeX(message.latex)
      .then(pdfBase64 => sendResponse({ success: true, pdfBase64 }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ─── Pure JS PDF Text Extractor ───────────────────────────────────────────
// Handles text-based PDFs by parsing content streams directly.
// Works for the vast majority of generated/exported PDFs.

async function extractPdfText(base64) {
  const b64 = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const str = binary; // raw binary string for searching

  // Step 1: Extract all raw stream contents
  const streams = await extractStreams(bytes, str);

  // Step 2: Parse text from streams using PDF text operators
  let fullText = '';
  for (const stream of streams) {
    fullText += parseTextFromStream(stream) + '\n';
  }

  // Step 3: If stream parsing got little text, fall back to string scanning
  if (fullText.replace(/\s/g, '').length < 100) {
    fullText = fallbackTextScan(str);
  }

  return fullText
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000);
}

async function extractStreams(bytes, str) {
  const streams = [];
  let pos = 0;

  while (pos < str.length) {
    const streamStart = str.indexOf('stream', pos);
    if (streamStart === -1) break;

    // Must be followed by \r\n or \n
    let dataStart = streamStart + 6;
    if (str[dataStart] === '\r') dataStart++;
    if (str[dataStart] === '\n') dataStart++;
    else { pos = streamStart + 1; continue; }

    // Find endstream
    const streamEnd = str.indexOf('endstream', dataStart);
    if (streamEnd === -1) break;

    // Get the stream's dictionary (look back for << ... >>)
    const dictEnd = streamStart;
    const dictStart = str.lastIndexOf('<<', dictEnd);
    const dictStr = str.slice(dictStart, dictEnd);

    // Check if it's a content stream (has Length, not an image/font)
    const isImage = /\/Subtype\s*\/Image/i.test(dictStr);
    const isFont  = /\/Type\s*\/Font/i.test(dictStr);
    if (isImage || isFont) { pos = streamEnd + 9; continue; }

    // Get filter type
    const filterMatch = dictStr.match(/\/Filter\s*\/?(\w+)/);
    const filter = filterMatch ? filterMatch[1] : null;

    const rawBytes = bytes.slice(dataStart, streamEnd);

    try {
      let decoded;
      if (filter === 'FlateDecode') {
        try {
          decoded = await inflate(rawBytes);
        } catch (e) {
          pos = streamEnd + 9;
          continue; // skip this stream, move to next
        }
      } else if (!filter) {
        decoded = rawBytes;
      } else {
        // Skip other filters (LZW, CCITTFax = images, etc.)
        pos = streamEnd + 9;
        continue;
      }

      // Convert to string
      let s = '';
      for (let i = 0; i < decoded.length; i++) {
        s += String.fromCharCode(decoded[i]);
      }
      streams.push(s);
    } catch (e) {
      // Skip undecodable streams
    }

    pos = streamEnd + 9;
  }

  return streams;
}

// Decompress FlateDecode streams — PDF uses zlib (deflate with 2-byte header + 4-byte checksum)
async function inflate(bytes) {
  // Strategy 1: strip zlib header (bytes 0x78 0x??) and decompress as raw deflate
  // This is the correct approach for PDF FlateDecode
  if (bytes.length > 2 && bytes[0] === 0x78) {
    try {
      // Skip 2-byte zlib header, also skip last 4 bytes (adler32 checksum)
      const raw = bytes.slice(2, bytes.length - 4);
      return await decompressRaw(raw);
    } catch (e) {
      // Try without stripping the checksum
      try {
        return await decompressRaw(bytes.slice(2));
      } catch (e2) {}
    }
  }

  // Strategy 2: try raw deflate on the full buffer (no zlib header)
  try {
    return await decompressRaw(bytes);
  } catch (e) {}

  // Strategy 3: try browser 'deflate' mode (zlib-wrapped) on full buffer
  try {
    return await decompressStream(bytes, 'deflate');
  } catch (e) {}

  throw new Error('inflate failed: unsupported compression');
}

async function decompressRaw(bytes) {
  return decompressStream(bytes, 'deflate-raw');
}

async function decompressStream(bytes, format) {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write in a separate microtask to avoid deadlock
  const writePromise = (async () => {
    try {
      await writer.write(bytes);
      await writer.close();
    } catch (e) {}
  })();

  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch (e) {
    // If we got some chunks before the error, use them
    if (chunks.length === 0) throw e;
  }

  await writePromise.catch(() => {});

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

// Parse PDF text operators from a content stream string
function parseTextFromStream(stream) {
  let text = '';
  let inTextBlock = false;
  let i = 0;

  while (i < stream.length) {
    // Start of text block
    if (stream[i] === 'B' && stream[i+1] === 'T' && (stream[i+2] === ' ' || stream[i+2] === '\n' || stream[i+2] === '\r')) {
      inTextBlock = true;
      i += 2;
      continue;
    }

    // End of text block
    if (stream[i] === 'E' && stream[i+1] === 'T' && (i+2 >= stream.length || /\s/.test(stream[i+2]))) {
      if (inTextBlock) text += '\n';
      inTextBlock = false;
      i += 2;
      continue;
    }

    if (!inTextBlock) { i++; continue; }

    // String literal: (...)Tj or (...)' or (...)TJ
    if (stream[i] === '(') {
      const { str: extracted, end } = extractPdfString(stream, i);
      i = end;

      // Skip whitespace
      while (i < stream.length && /\s/.test(stream[i])) i++;

      // Read operator
      const opEnd = stream.indexOf('\n', i);
      const line = stream.slice(i, opEnd === -1 ? i + 10 : opEnd).trim();
      const op = line.split(/\s/)[0];

      if (op === 'Tj' || op === "'" || op === '"' || op === 'TJ') {
        text += extracted;
        if (op === "'") text += '\n';
      }
      continue;
    }

    // Array form: [...] TJ
    if (stream[i] === '[') {
      const closeArr = findMatchingBracket(stream, i, '[', ']');
      const arrContent = stream.slice(i + 1, closeArr);
      i = closeArr + 1;

      while (i < stream.length && /\s/.test(stream[i])) i++;
      const opEnd = stream.indexOf('\n', i);
      const op = stream.slice(i, opEnd === -1 ? i + 5 : opEnd).trim().split(/\s/)[0];

      if (op === 'TJ') {
        // Extract all string parts from array
        let j = 0;
        while (j < arrContent.length) {
          if (arrContent[j] === '(') {
            const { str: s, end } = extractPdfString(arrContent, j);
            text += s;
            j = end;
          } else if (arrContent[j] === '<') {
            const hexEnd = arrContent.indexOf('>', j);
            if (hexEnd !== -1) {
              text += hexToText(arrContent.slice(j+1, hexEnd));
              j = hexEnd + 1;
            } else j++;
          } else {
            // Negative number = space hint
            const numMatch = arrContent.slice(j).match(/^-?\d+(\.\d+)?/);
            if (numMatch) {
              if (parseFloat(numMatch[0]) < -100) text += ' ';
              j += numMatch[0].length;
            } else j++;
          }
        }
      }
      continue;
    }

    // Hex string: <...> Tj
    if (stream[i] === '<' && stream[i+1] !== '<') {
      const hexEnd = stream.indexOf('>', i);
      if (hexEnd !== -1) {
        const hex = stream.slice(i+1, hexEnd);
        i = hexEnd + 1;
        while (i < stream.length && /\s/.test(stream[i])) i++;
        const opEnd = stream.indexOf('\n', i);
        const op = stream.slice(i, opEnd === -1 ? i+5 : opEnd).trim().split(/\s/)[0];
        if (op === 'Tj' || op === 'TJ') text += hexToText(hex);
        continue;
      }
    }

    // Td / TD / T* = new line hint
    if (stream[i] === 'T') {
      if (stream[i+1] === 'd' || stream[i+1] === 'D' || stream[i+1] === '*') {
        text += '\n';
      }
    }

    i++;
  }

  return text;
}

function extractPdfString(str, start) {
  let result = '';
  let i = start + 1; // skip opening (
  let depth = 1;

  while (i < str.length && depth > 0) {
    if (str[i] === '\\') {
      i++;
      const esc = str[i];
      if (esc === 'n') result += '\n';
      else if (esc === 'r') result += '\r';
      else if (esc === 't') result += '\t';
      else if (esc === '(' || esc === ')' || esc === '\\') result += esc;
      else if (/[0-7]/.test(esc)) {
        // Octal
        let oct = esc;
        if (/[0-7]/.test(str[i+1])) { oct += str[++i]; }
        if (/[0-7]/.test(str[i+1])) { oct += str[++i]; }
        result += String.fromCharCode(parseInt(oct, 8));
      }
      i++;
    } else if (str[i] === '(') {
      depth++;
      result += '(';
      i++;
    } else if (str[i] === ')') {
      depth--;
      if (depth > 0) result += ')';
      i++;
    } else {
      result += str[i++];
    }
  }

  return { str: cleanPdfString(result), end: i };
}

function cleanPdfString(s) {
  // Remove non-printable except newline/space, collapse garbage
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10 || c === 13 || c === 9 || (c >= 32 && c < 127)) out += s[i];
    else if (c > 127) out += ' '; // non-ASCII — likely encoding artifact
  }
  return out;
}

function hexToText(hex) {
  hex = hex.replace(/\s/g, '');
  let text = '';
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i+2), 16);
    if (code >= 32 && code < 127) text += String.fromCharCode(code);
    else if (code === 10 || code === 13) text += '\n';
  }
  return text;
}

function findMatchingBracket(str, start, open, close) {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === open) depth++;
    else if (str[i] === close) { depth--; if (depth === 0) return i; }
  }
  return str.length - 1;
}

// Fallback: scan raw binary for readable ASCII strings (works for simple PDFs)
function fallbackTextScan(str) {
  let text = '';
  let run = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if ((c >= 32 && c < 127) || c === 10 || c === 13) {
      run += str[i];
    } else {
      if (run.length > 4) text += run + '\n';
      run = '';
    }
  }
  if (run.length > 4) text += run;

  // Filter out PDF syntax noise — keep lines that look like real text
  return text.split('\n')
    .filter(line => {
      const clean = line.trim();
      if (clean.length < 3) return false;
      if (/^[\d\s.]+$/.test(clean)) return false; // pure numbers
      if (/^[\/\[\]<>{}]+/.test(clean)) return false; // PDF operators
      if (/^(obj|endobj|stream|xref|trailer|startxref)/.test(clean)) return false;
      return true;
    })
    .join('\n');
}

// ─── NVIDIA NIM API (OpenAI-compatible) ───────────────────────────────────
async function callClaudeAPI(prompt, apiKey, pdfBase64, systemPrompt) {
  // pdfBase64 is ignored — Llama is text-only; caller already extracts text
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) });

  const body = {
    model: 'meta/llama-3.3-70b-instruct',
    max_tokens: 4096,
    temperature: 0.3,
    top_p: 0.7,
    messages
  };

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || err.detail || `API error ${response.status}`;
    console.error('NVIDIA NIM API Error:', msg, err);
    throw new Error(msg);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── LaTeX → PDF compilation via latex.ytotech.com ───────────────────────
// Free public API, no auth needed. Returns compiled PDF bytes.
async function compileLaTeX(latexSource) {
  // latex.ytotech.com API: POST multipart/form-data with file field
  const encoder = new TextEncoder();
  const latexBytes = encoder.encode(latexSource);

  // Build multipart form manually (FormData not available in all SW contexts)
  const boundary = '----RATSBoundary' + Math.random().toString(36).slice(2);
  const CRLF = '\r\n';

  // Header part
  const headerStr =
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="file"; filename="resume.tex"' + CRLF +
    'Content-Type: application/x-tex' + CRLF +
    CRLF;

  // Footer part
  const footerStr = CRLF + '--' + boundary + '--' + CRLF;

  const headerBytes = encoder.encode(headerStr);
  const footerBytes = encoder.encode(footerStr);

  const body = new Uint8Array(headerBytes.length + latexBytes.length + footerBytes.length);
  body.set(headerBytes, 0);
  body.set(latexBytes, headerBytes.length);
  body.set(footerBytes, headerBytes.length + latexBytes.length);

  // Try latex.ytotech.com first
  let response;
  try {
    response = await fetch('https://latex.ytotech.com/builds/sync', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: body
    });
  } catch (e) {
    throw new Error('LaTeX compiler unreachable. Save the .tex and compile on overleaf.com');
  }

  if (!response.ok) {
    // Try to extract error log
    let errText = '';
    try { errText = await response.text(); } catch(_) {}
    // Parse LaTeX error from log if present
    const logMatch = errText.match(/!(.*?)(?:\n|$)/);
    const latexErr = logMatch ? logMatch[1].trim() : `Compilation failed (${response.status})`;
    throw new Error(latexErr);
  }

  // Response is the raw PDF binary
  const pdfBuffer = await response.arrayBuffer();
  const pdfBytes = new Uint8Array(pdfBuffer);

  // Validate it's actually a PDF
  const magic = String.fromCharCode(...pdfBytes.slice(0, 4));
  if (magic !== '%PDF') {
    // Might be an error log returned as text
    const text = new TextDecoder().decode(pdfBytes.slice(0, 500));
    const logMatch = text.match(/!(.*?)(?:\n|$)/);
    throw new Error(logMatch ? logMatch[1].trim() : 'Compiler returned invalid PDF');
  }

  // Convert to base64 for message passing
  let binary = '';
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}
