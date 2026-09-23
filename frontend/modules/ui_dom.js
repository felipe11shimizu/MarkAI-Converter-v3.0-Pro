(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIUIDom = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EXT_LABELS = {
    pdf:'PDF', docx:'DOCX', doc:'DOC', pptx:'PPTX', xlsx:'XLSX', xls:'XLS',
    csv:'CSV', json:'JSON', xml:'XML', txt:'TXT', md:'MD', epub:'EPUB', zip:'ZIP',
    png:'IMG', jpg:'IMG', jpeg:'IMG', gif:'IMG', webp:'IMG', wav:'AUDIO', mp3:'AUDIO', m4a:'AUDIO',
    py:'PY', js:'JS', ts:'TS', jsx:'JSX', tsx:'TSX',
    html:'HTML', css:'CSS', scss:'SCSS', sql:'SQL',
    sh:'SH', rb:'RB', go:'GO', rs:'RS', java:'JAVA',
    cpp:'C++', c:'C', cs:'C#', php:'PHP', swift:'SWIFT', kt:'KT',
    yaml:'YAML', yml:'YML'
  };

  const CODE_EXTS = new Set([
    'py','js','ts','jsx','tsx','html','htm','css','scss','less',
    'sql','sh','bash','rb','go','rs','java','kt','cpp','c','cs',
    'php','swift','yaml','yml','xml','toml','ini','r','lua','pl','vue','svelte'
  ]);

  function extClass(ext) {
    return 'ext-' + String(ext || '').toLowerCase();
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1048576).toFixed(1) + ' MB';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function sanitizeMarkdownHtml(markdown) {
    const source = String(markdown || '');
    const rendered = root.marked.parse(source);
    if (root.DOMPurify) {
      return root.DOMPurify.sanitize(rendered, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel']
      });
    }
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = source;
    pre.appendChild(code);
    return pre.outerHTML;
  }

  function create() {
    const $ = id => document.getElementById(id);
    const els = {
      dropZone: $('dropZone'), fileInput: $('fileInput'), browseBtn: $('browseBtn'),
      queuePanel: $('queuePanel'), queueList: $('queueList'), queueCount: $('queueCount'),
      btnClearQueue: $('btnClearQueue'), btnMergeAll: $('btnMergeAll'), btnConvertAll: $('btnConvertAll'), btnDownloadZip: $('btnDownloadZip'),
      urlInput: $('urlInput'), btnFetchUrl: $('btnFetchUrl'),
      youtubeControls: $('youtubeControls'), youtubeLanguage: $('youtubeLanguage'), youtubeTranslate: $('youtubeTranslate'),
      btnYoutubeTranscribe: $('btnYoutubeTranscribe'), btnYoutubeLanguages: $('btnYoutubeLanguages'), youtubeStatus: $('youtubeStatus'),
      chatInput: $('chatInput'), btnFormatChat: $('btnFormatChat'),
      emptyState: $('emptyState'), workspaceContent: $('workspaceContent'),
      docName: $('docName'),
      statWords: $('statWords'), statLines: $('statLines'), statChars: $('statChars'),
      btnEnhanceAI: $('btnEnhanceAI'), btnCopy: $('btnCopy'), btnCompare: $('btnCompare'),
      btnDownload: $('btnDownload'), btnReset: $('btnReset'),
      progressWrap: $('progressWrap'), progressBar: $('progressBar'),
      markdownEditor: $('markdownEditor'),
      markdownPreview: $('markdownPreview'),
      markdownEditorSplit: $('markdownEditorSplit'),
      markdownPreviewSplit: $('markdownPreviewSplit'),
      panelRaw: $('panelRaw'), panelPreview: $('panelPreview'), panelSplit: $('panelSplit'),
      tabRaw: $('tabRaw'), tabPreview: $('tabPreview'), tabSplit: $('tabSplit'),
      procOverlay: $('procOverlay'), procLabel: $('procLabel'), procSub: $('procSub'),
      statusDot: $('statusDot'), statusText: $('statusText'),
      btnSettings: $('btnSettings'), modalSettings: $('modalSettings'),
      btnCloseSettings: $('btnCloseSettings'), btnSaveSettings: $('btnSaveSettings'),
      btnClearApiKey: $('btnClearApiKey'), btnToggleKey: $('btnToggleKey'),
      btnWorkspace: $('btnWorkspace'), btnWorkspaceToolbar: $('btnWorkspaceToolbar'),
      workspaceProjectSelect: $('workspaceProjectSelect'), btnWorkspaceSave: $('btnWorkspaceSave'), btnWorkspaceVersion: $('btnWorkspaceVersion'),
      btnWorkspaceExport: $('btnWorkspaceExport'), workspaceStatus: $('workspaceStatus'),
      modalWorkspace: $('modalWorkspace'), btnCloseWorkspace: $('btnCloseWorkspace'), btnWorkspaceDone: $('btnWorkspaceDone'),
      workspaceProjectName: $('workspaceProjectName'), btnCreateWorkspaceProject: $('btnCreateWorkspaceProject'),
      workspaceProjectList: $('workspaceProjectList'), btnRenameWorkspaceProject: $('btnRenameWorkspaceProject'),
      btnDeleteWorkspaceProject: $('btnDeleteWorkspaceProject'), btnExportWorkspaceJson: $('btnExportWorkspaceJson'),
      btnExportWorkspaceZip: $('btnExportWorkspaceZip'), workspaceHistoryCount: $('workspaceHistoryCount'),
      workspaceHistoryList: $('workspaceHistoryList'), workspaceTabVersions: $('workspaceTabVersions'), workspaceTabAI: $('workspaceTabAI'),
      aiProvider: $('aiProvider'), aiModel: $('aiModel'), aiApiKey: $('aiApiKey'),
      workspaceAIPrompt: $('workspaceAIPrompt'),
      toggleSyntaxHL: $('toggleSyntaxHL'), toggleAutoPreview: $('toggleAutoPreview'),
      modalPreview: $('modalPreview'), btnClosePreview: $('btnClosePreview'),
      previewFileName: $('previewFileName'), previewContent: $('previewContent'),
      btnUsePreview: $('btnUsePreview'), btnPreviewRaw: $('btnPreviewRaw'),
      modalCompare: $('modalCompare'), btnCloseCompare: $('btnCloseCompare'), compareFileName: $('compareFileName'),
      compareMarkitdown: $('compareMarkitdown'), compareBrowser: $('compareBrowser'),
      compareMarkitdownStats: $('compareMarkitdownStats'), compareBrowserStats: $('compareBrowserStats'),
      btnUseMarkItDown: $('btnUseMarkItDown'), btnUseBrowser: $('btnUseBrowser'),
      toastContainer: $('toastContainer')
    };
    return { $, els };
  }

  return {
    EXT_LABELS,
    CODE_EXTS,
    create,
    extClass,
    formatSize,
    escapeHtml,
    sanitizeMarkdownHtml
  };
});