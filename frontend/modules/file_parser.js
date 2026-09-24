(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIFileParser = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

const FileParserStrategy = (() => {
  const MARKITDOWN_ONLY_EXTS = new Set([
    'doc','epub','zip','png','jpg','jpeg','gif','webp','wav','mp3','m4a'
  ]);

  const CODE_LANGS = {
    py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    cpp: 'cpp', c: 'c', cs: 'csharp', php: 'php', swift: 'swift',
    yaml: 'yaml', yml: 'yaml', xml: 'xml', toml: 'toml', ini: 'ini',
    r: 'r', lua: 'lua', pl: 'perl', ex: 'elixir', exs: 'elixir',
    scala: 'scala', dart: 'dart', vue: 'html', svelte: 'html',
  };

  function _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function _yieldTick() {
    return new Promise(res => setTimeout(res, 0));
  }

  // ── TEXT / MARKDOWN ──
  async function parseTxt(file) {
    const text = await file.text();
    const name = file.name.replace(/\.[^.]+$/, '');
    if (file.name.endsWith('.md')) return text;
    let md = `# ${name}\n\n`;
    const lines = text.split('\n');
    // Detect paragraph breaks
    let para = [];
    for (const line of lines) {
      if (line.trim() === '') {
        if (para.length) { md += para.join(' ') + '\n\n'; para = []; }
      } else {
        para.push(line.trim());
      }
    }
    if (para.length) md += para.join(' ') + '\n\n';
    return md.trimEnd();
  }

  // ── CODE FILES ──
  async function parseCode(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const lang = CODE_LANGS[ext] || ext;
    const text = await file.text();
    const name = file.name.replace(/\.[^.]+$/, '');
    let title = name;
    let docstring = '';
    let body = text;

    // Python docstring
    const pyDoc = text.match(/^(?:["']{3})([\s\S]*?)(?:["']{3})/m);
    // JS/TS JSDoc or block comment
    const jsDoc = text.match(/^\/\*\*([\s\S]*?)\*\//m);
    // Shell/Python/Ruby # comment block at top
    const hashDoc = text.match(/^(?:#[^\n]*\n){1,10}/);
    // SQL comment block
    const sqlDoc = text.match(/^(?:--[^\n]*\n){1,10}/);

    if (pyDoc) {
      const raw = pyDoc[1].trim().split('\n')[0].replace(/[*\s]+/g, ' ').trim();
      if (raw) title = raw;
      docstring = `> ${pyDoc[1].trim().replace(/\n/g,' ')}\n\n`;
    } else if (jsDoc) {
      const raw = jsDoc[1].trim().split('\n')[0].replace(/[*\s]+/g, ' ').trim();
      if (raw) title = raw;
      docstring = `> ${jsDoc[1].trim().replace(/\n\s*\*/g,' ').trim()}\n\n`;
    } else if ((ext === 'sh' || ext === 'py' || ext === 'rb') && hashDoc) {
      const lines = hashDoc[0].split('\n').filter(l => l.trim().startsWith('#'));
      title = lines[0].replace(/^#\s*/, '').trim() || name;
      if (lines.length > 1) docstring = `> ${lines.slice(1).map(l => l.replace(/^#\s*/, '')).join(' ')}\n\n`;
    } else if (ext === 'sql' && sqlDoc) {
      const lines = sqlDoc[0].split('\n').filter(l => l.startsWith('--'));
      title = lines[0].replace(/^--\s*/, '').trim() || name;
    }

    const md = [
      `# ${title}`,
      '',
      docstring,
      `**Arquivo:** \`${file.name}\` | **Linguagem:** ${lang.charAt(0).toUpperCase()+lang.slice(1)} | **Tamanho:** ${_formatSize(file.size)}`,
      '',
      `\`\`\`${lang}`,
      body,
      '```',
    ].join('\n');
    return md;
  }

  // ── PDF ──
  async function parsePdf(file, onProgress) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js não carregado.');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const name = file.name.replace(/\.[^.]+$/, '');
    let md = `# ${name}\n\n`;
    md += `**Páginas:** ${pdf.numPages} | **Arquivo:** \`${file.name}\`\n\n---\n\n`;

    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(i / pdf.numPages);
      await _yieldTick();

      const page = await pdf.getPage(i);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const viewport = page.getViewport({ scale: 1 });

      // Group items by approximate Y position to form lines
      const lineMap = {};
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        if (!lineMap[y]) lineMap[y] = { items: [], height: item.height || 12 };
        lineMap[y].items.push(item);
        if (item.height > lineMap[y].height) lineMap[y].height = item.height;
      }

      const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
      const pageLines = [];

      for (const y of sortedYs) {
        const { items, height } = lineMap[y];
        const lineText = items
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map(i => i.str).join(' ').trim();
        if (!lineText) continue;

        // Heuristic: large font → heading
        if (height >= 20 && lineText.length < 120) {
          pageLines.push(`\n## ${lineText}\n`);
        } else if (height >= 14 && lineText.length < 100) {
          pageLines.push(`\n### ${lineText}\n`);
        } else {
          pageLines.push(lineText);
        }
      }

      // Group consecutive non-heading lines into paragraphs
      let para = [];
      let pageMd = `## Página ${i}\n\n`;
      for (const line of pageLines) {
        if (line.startsWith('\n##') || line.startsWith('\n###')) {
          if (para.length) { pageMd += para.join(' ') + '\n\n'; para = []; }
          pageMd += line + '\n';
        } else {
          para.push(line);
        }
      }
      if (para.length) pageMd += para.join(' ') + '\n\n';
      md += pageMd + '\n';
    }
    return md.trimEnd();
  }

  // ── DOCX ──
  async function parseDocx(file) {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const html = result.value;
    // Convert HTML to Markdown manually
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return _htmlToMarkdown(doc.body);
  }

  function _htmlToMarkdown(el) {
    let md = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        md += node.textContent;
      } else if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        const inner = _htmlToMarkdown(node);
        switch (tag) {
          case 'h1': md += `\n# ${inner.trim()}\n\n`; break;
          case 'h2': md += `\n## ${inner.trim()}\n\n`; break;
          case 'h3': md += `\n### ${inner.trim()}\n\n`; break;
          case 'h4': md += `\n#### ${inner.trim()}\n\n`; break;
          case 'h5': md += `\n##### ${inner.trim()}\n\n`; break;
          case 'h6': md += `\n###### ${inner.trim()}\n\n`; break;
          case 'p':  md += `\n${inner.trim()}\n\n`; break;
          case 'strong': case 'b': md += `**${inner}**`; break;
          case 'em': case 'i': md += `*${inner}*`; break;
          case 'u': md += `__${inner}__`; break;
          case 'code': md += `\`${inner}\``; break;
          case 'pre': md += `\n\`\`\`\n${inner}\n\`\`\`\n\n`; break;
          case 'a': md += `[${inner}](${node.href || '#'})`; break;
          case 'br': md += '\n'; break;
          case 'hr': md += '\n---\n\n'; break;
          case 'ul': {
            for (const li of node.querySelectorAll(':scope > li')) {
              md += `\n- ${_htmlToMarkdown(li).trim()}`;
            }
            md += '\n\n'; break;
          }
          case 'ol': {
            let n = 1;
            for (const li of node.querySelectorAll(':scope > li')) {
              md += `\n${n}. ${_htmlToMarkdown(li).trim()}`;
              n++;
            }
            md += '\n\n'; break;
          }
          case 'table': {
            const rows = node.querySelectorAll('tr');
            if (!rows.length) break;
            const headerCells = rows[0].querySelectorAll('th,td');
            const headers = Array.from(headerCells).map(c => c.textContent.trim());
            md += '\n| ' + headers.join(' | ') + ' |\n';
            md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
            for (let i = 1; i < rows.length; i++) {
              const cells = Array.from(rows[i].querySelectorAll('td')).map(c => c.textContent.trim());
              md += '| ' + cells.join(' | ') + ' |\n';
            }
            md += '\n'; break;
          }
          case 'blockquote': md += `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`; break;
          case 'img': md += `![${node.alt||''}](${node.src||''})`; break;
          default: md += inner;
        }
      }
    }
    return md;
  }

  // ── CSV ──
  async function parseCsv(file) {
    const text = await file.text();
    return _csvToTable(text, file.name.replace(/\.[^.]+$/, ''));
  }

  function _csvToTable(text, title) {
    // Smart CSV parser handling quoted fields
    function parseRow(row) {
      const cells = [];
      let inQuote = false, cur = '';
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '"') {
          if (inQuote && row[i+1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if ((c === ',' || c === ';' || c === '\t') && !inQuote) {
          cells.push(cur.trim()); cur = '';
        } else { cur += c; }
      }
      cells.push(cur.trim());
      return cells;
    }

    const lines = text.split('\n').filter(l => l.trim());
    if (!lines.length) return `# ${title}\n\n_Arquivo vazio._`;

    // Detect separator
    const firstLine = lines[0];
    const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

    const headers = parseRow(firstLine);
    const colWidths = headers.map(h => h.length);

    const rows = lines.slice(1).map(line => {
      const cells = parseRow(line);
      cells.forEach((c, i) => { if (c.length > (colWidths[i]||0)) colWidths[i] = c.length; });
      return cells;
    });

    const pad = (str, len) => str.padEnd(len);
    let md = `# ${title}\n\n`;
    md += `**Linhas:** ${rows.length} | **Colunas:** ${headers.length}\n\n`;
    md += '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
    md += '| ' + colWidths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |\n';
    for (const row of rows) {
      md += '| ' + headers.map((_, i) => pad(row[i] || '', colWidths[i])).join(' | ') + ' |\n';
    }
    return md;
  }

  // ── XLSX ──
  async function parseXlsx(file) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const name = file.name.replace(/\.[^.]+$/, '');
    let md = `# ${name}\n\n`;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!data.length) continue;

      md += `## ${sheetName}\n\n`;
      const headers = data[0].map(String);
      const colWidths = headers.map(h => h.length);
      const rows = data.slice(1).map(row =>
        headers.map((_, i) => String(row[i] !== undefined ? row[i] : ''))
      );
      rows.forEach(row => row.forEach((c, i) => { if (c.length > (colWidths[i]||0)) colWidths[i] = c.length; }));

      const pad = (s, l) => s.padEnd(l);
      md += '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
      md += '| ' + colWidths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |\n';
      for (const row of rows) {
        md += '| ' + headers.map((_, i) => pad(row[i], colWidths[i])).join(' | ') + ' |\n';
      }
      md += '\n';
    }
    return md.trimEnd();
  }

  // ── PPTX ──
  function _decodeXmlText(value) {
    return String(value || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function _extractPptxParagraphs(xmlText) {
    const paragraphs = [];
    const parser = typeof DOMParser === 'function' ? new DOMParser() : null;

    if (parser) {
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const nodes = xml.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/drawingml/2006/main',
        'p'
      );
      for (const paragraph of Array.from(nodes)) {
        const texts = paragraph.getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/drawingml/2006/main',
          't'
        );
        const text = Array.from(texts).map(node => node.textContent || '').join('').trim();
        if (text) paragraphs.push(text);
      }
      return paragraphs;
    }

    // Lightweight fallback for unit tests/non-browser environments.
    const matches = String(xmlText || '').match(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g) || [];
    for (const paragraph of matches) {
      const texts = Array.from(
        paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)
      ).map(match => _decodeXmlText(match[1]));
      const text = texts.join('').trim();
      if (text) paragraphs.push(text);
    }
    return paragraphs;
  }

  async function parsePptx(file, onProgress) {
    if (!globalThis.JSZip) {
      throw new Error('JSZip não carregado. Não foi possível processar o PPTX no navegador.');
    }

    const buffer = await file.arrayBuffer();
    const zip = await globalThis.JSZip.loadAsync(buffer);
    const slideEntries = Object.keys(zip.files)
      .map(name => {
        const match = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
        return match ? { name, number: Number(match[1]) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.number - b.number);

    if (!slideEntries.length) {
      throw new Error('PPTX inválido ou sem slides.');
    }

    const title = file.name.replace(/\.[^.]+$/, '');
    let md = `# ${title}

**Arquivo:** \`${file.name}\` | **Slides:** ${slideEntries.length}

`;

    for (let i = 0; i < slideEntries.length; i++) {
      const entry = slideEntries[i];
      const xml = await zip.files[entry.name].async('string');
      const paragraphs = _extractPptxParagraphs(xml);

      md += `## Slide ${entry.number}

`;
      if (paragraphs.length) {
        md += paragraphs.map(text => `- ${text}`).join('\n') + '\n\n';
      } else {
        md += ' _Sem texto extraível neste slide._\n\n';
      }

      if (onProgress) onProgress((i + 1) / slideEntries.length);
      await _yieldTick();
    }

    return md.trimEnd();
  }

  // ── JSON ──
  async function parseJson(file) {
    const text = await file.text();
    const name = file.name.replace(/\.[^.]+$/, '');
    let md = `# ${name}\n\n`;
    try {
      const obj = JSON.parse(text);
      // If array of objects, render as table
      if (Array.isArray(obj) && obj.length && typeof obj[0] === 'object') {
        const headers = Object.keys(obj[0]);
        md += `**Registros:** ${obj.length} | **Campos:** ${headers.length}\n\n`;
        const colWidths = headers.map(h => h.length);
        const rows = obj.slice(0, 200).map(item =>
          headers.map(h => {
            const v = String(item[h] !== undefined ? item[h] : '');
            if (v.length > (colWidths[headers.indexOf(h)]||0)) colWidths[headers.indexOf(h)] = Math.min(v.length, 50);
            return v;
          })
        );
        const pad = (s, l) => s.slice(0, l).padEnd(l);
        md += '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
        md += '| ' + colWidths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |\n';
        for (const row of rows) {
          md += '| ' + headers.map((_, i) => pad(row[i], colWidths[i])).join(' | ') + ' |\n';
        }
        if (obj.length > 200) md += `\n_…e mais ${obj.length - 200} registros_\n`;
        md += '\n---\n\n';
      }
      md += '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
    } catch(e) {
      md += '```json\n' + text + '\n```';
    }
    return md;
  }

  // ── DISPATCH ──
  async function parseBrowser(item, onProgress) {
    const { file, ext } = item;
    if (ext === 'pdf') return parsePdf(file, onProgress);
    if (ext === 'docx' || ext === 'doc') return parseDocx(file);
    if (ext === 'xlsx' || ext === 'xls') return parseXlsx(file);
    if (ext === 'pptx') return parsePptx(file, onProgress);
    if (ext === 'csv') return parseCsv(file);
    if (ext === 'json') return parseJson(file);
    if (MARKITDOWN_ONLY_EXTS.has(ext)) throw new Error(`O formato .${ext} requer o backend Microsoft MarkItDown ativo.`);
    if (ext === 'txt' || ext === 'md') return parseTxt(file);
    if (CODE_LANGS[ext]) return parseCode(file);
    return parseTxt(file);
  }

  async function parse(item, onProgress) {
    const { file, ext } = item;

    // Prefer Microsoft MarkItDown when the optional backend is running.
    // Browser parsers remain the automatic fallback for offline/static usage.
    try {
      const remote = await MarkItDownEngine.convert(file, onProgress);
      if (remote) return remote.markdown;
    } catch (e) {
      console.warn('[MarkAI] MarkItDown conversion failed; using browser fallback:', e);
    }
    return parseBrowser(item, onProgress);
  }

  return { parse, parseBrowser, parsePptx };
})();




  return FileParserStrategy;
});