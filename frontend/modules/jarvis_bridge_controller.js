(function () {
  'use strict';

  const CATEGORY_LABELS = {
    inbox: '00-Inbox — Captura inicial',
    projetos: '10-Projetos — Projetos',
    areas: '20-Areas — Rotinas e regras',
    colaboradores: '30-Rede-Colaboradores — Interfaces',
    entidades: '40-Entidades — Sistemas e entidades',
    recursos: '50-Recursos-e-Modelos — Modelos'
  };
  let sessionToken = '';
  let preparedDraft = null;

  function backendUrl() {
    return String(globalThis.MARKAI_CONFIG?.backendUrl || '').replace(/\/+$/, '');
  }

  function apiUrl(path) {
    const base = backendUrl();
    if (!base) throw new Error('O backend do MarkAI não está configurado.');
    return base + path;
  }

  function authHeaders() {
    return sessionToken ? { Authorization: 'Bearer ' + sessionToken } : {};
  }

  async function parseResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.detail || 'A operação não foi concluída.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function setStatus(message, type) {
    const el = document.getElementById('jarvisBridgeStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = type || 'info';
  }

  async function checkReadiness() {
    try {
      const response = await fetch(apiUrl('/api/jarvis/status'), { method: 'GET' });
      const status = await parseResponse(response);
      if (!status.authentication_configured) {
        setStatus('Integração JARVIS indisponível: autenticação ainda não configurada no servidor.', 'warning');
        return status;
      }
      if (!status.publishing_configured) {
        setStatus('Autenticação disponível, mas falta configurar a credencial de gravação do JARVIS no servidor.', 'warning');
        return status;
      }
      if (!sessionToken) {
        setStatus('Integração pronta. Conecte sua conta GitHub para publicar uma nota após revisar a prévia.', 'info');
      }
      return status;
    } catch (error) {
      setStatus('Não foi possível verificar a integração JARVIS: ' + error.message, 'error');
      return null;
    }
  }

  function captureDraft() {
    const title = document.getElementById('jarvisNoteTitle').value.trim();
    const category = document.getElementById('jarvisNoteCategory').value;
    const content = document.getElementById('markdownEditor')?.value || '';
    if (!content.trim()) throw new Error('Não há Markdown no editor para registrar.');
    if (content.length > 100000) throw new Error('O conteúdo excede o limite de 100 KB.');
    if (!title) throw new Error('Informe um título para a nota.');
    return { title, category, content };
  }

  async function prepare() {
    if (!sessionToken) {
      setStatus('Conecte sua conta GitHub antes de preparar a nota.', 'warning');
      return;
    }
    try {
      const draft = captureDraft();
      const response = await fetch(apiUrl('/api/jarvis/notes/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(draft)
      });
      const result = await parseResponse(response);
      preparedDraft = draft;
      document.getElementById('jarvisNotePreview').textContent =
        'Destino: ' + result.repository + '/' + result.path + '\n' +
        'Tamanho: ' + result.bytes + ' bytes\n\n' + draft.content;
      document.getElementById('btnJarvisPublish').disabled = false;
      setStatus('Prévia pronta. Revise o destino e o conteúdo antes de publicar.', 'success');
    } catch (error) {
      preparedDraft = null;
      document.getElementById('btnJarvisPublish').disabled = true;
      setStatus(error.message, error.status === 401 ? 'warning' : 'error');
    }
  }

  async function publish() {
    if (!sessionToken) {
      setStatus('Sessão ausente. Conecte novamente sua conta GitHub.', 'warning');
      return;
    }
    if (!preparedDraft) {
      setStatus('Prepare a prévia antes de publicar.', 'warning');
      return;
    }
    const currentContent = document.getElementById('markdownEditor')?.value || '';
    if (currentContent !== preparedDraft.content ||
        document.getElementById('jarvisNoteTitle').value.trim() !== preparedDraft.title ||
        document.getElementById('jarvisNoteCategory').value !== preparedDraft.category) {
      setStatus('O conteúdo ou destino mudou. Prepare a prévia novamente.', 'warning');
      return;
    }
    const path = document.getElementById('jarvisNotePreview').textContent.split('\n')[0];
    if (!window.confirm('Confirma a gravação desta nota no repositório privado do JARVIS?\n' + path)) return;
    try {
      const response = await fetch(apiUrl('/api/jarvis/notes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...preparedDraft, confirm_publish: true })
      });
      const result = await parseResponse(response);
      setStatus('Nota criada com sucesso: ' + result.path + ' — commit ' + String(result.commit || '').slice(0, 7), 'success');
      if (result.url) {
        const link = document.getElementById('jarvisBridgeResultLink');
        link.href = result.url;
        link.textContent = 'Abrir nota no GitHub';
        link.hidden = false;
      }
      preparedDraft = null;
      document.getElementById('btnJarvisPublish').disabled = true;
    } catch (error) {
      setStatus(error.message, error.status === 401 ? 'warning' : 'error');
    }
  }

  function connect() {
    window.location.assign(apiUrl('/api/jarvis/auth/start'));
  }

  function init() {
    const modal = document.getElementById('modalJarvis');
    const openButton = document.getElementById('btnTeachJarvis');
    if (!modal || !openButton) return;

    const hash = window.location.hash;
    const match = hash.match(/(?:^#|&)jarvis_session=([^&]+)/);
    if (match) {
      sessionToken = decodeURIComponent(match[1]);
      history.replaceState(null, document.title, window.location.pathname + window.location.search);
      setStatus('Conta GitHub autenticada nesta sessão. A sessão expira em 10 minutos.', 'success');
    }

    openButton.addEventListener('click', () => {
      const editor = document.getElementById('markdownEditor');
      const docName = document.getElementById('docName');
      const title = document.getElementById('jarvisNoteTitle');
      if (!title.value.trim()) {
        title.value = String(docName?.textContent || 'nota-markai').replace(/\.md$/i, '').trim() || 'nota-markai';
      }
      document.getElementById('jarvisNotePreview').textContent = editor?.value || '';
      document.getElementById('btnJarvisPublish').disabled = true;
      preparedDraft = null;
      if (!sessionToken) checkReadiness();
      modal.showModal();
    });
    document.getElementById('btnCloseJarvis').addEventListener('click', () => modal.close());
    document.getElementById('btnJarvisConnect').addEventListener('click', connect);
    document.getElementById('btnJarvisPrepare').addEventListener('click', prepare);
    document.getElementById('btnJarvisPublish').addEventListener('click', publish);
    if (!sessionToken) checkReadiness();
    modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
