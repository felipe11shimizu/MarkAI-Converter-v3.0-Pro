(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIWorkspaceController = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({
    workspaceStore,
    getState,
    setState,
    queueManager,
    ui = {},
    timers = {}
  }) {
    if (!workspaceStore) throw new Error('WorkspaceController requires workspaceStore');
    if (typeof getState !== 'function') throw new Error('WorkspaceController requires getState');
    if (typeof setState !== 'function') throw new Error('WorkspaceController requires setState');

    const setWorkspaceStatus = text => ui.setWorkspaceStatus?.(text);
    const renderQueue = () => ui.renderQueue?.();
    const refreshProjects = projects => ui.refreshProjects?.(projects);
    const renderHistory = records => ui.renderHistory?.(records);
    const toast = (message, type) => ui.toast?.(message, type);
    const showCurrentDocument = item => ui.showCurrentDocument?.(item);
    const showEmptyWorkspace = () => ui.showEmptyWorkspace?.();

    let saveTimer = null;
    let saveChain = Promise.resolve();
    const setTimeoutFn = timers.setTimeout || globalThis.setTimeout;
    const clearTimeoutFn = timers.clearTimeout || globalThis.clearTimeout;

    async function syncQueue() {
      const projectId = getState().currentProjectId;
      if (!projectId) return;

      // Snapshot immediately, then serialize IndexedDB writes. Without this
      // chain, multiple conversions finishing close together could overlap
      // the "delete all + rewrite queue" persistence cycle and lose ordering.
      const queueSnapshot = (getState().queue || []).slice();
      saveChain = saveChain.catch(() => {}).then(async () => {
        try {
          await workspaceStore.saveQueue(projectId, queueSnapshot);
          if (getState().currentProjectId === projectId) {
            setWorkspaceStatus('Salvo localmente · ' + new Date().toLocaleTimeString('pt-BR'));
          }
        } catch (error) {
          console.warn('[MarkAI] Workspace save failed:', error);
          if (getState().currentProjectId === projectId) {
            setWorkspaceStatus('Erro ao salvar workspace');
          }
          throw error;
        }
      });
      return saveChain;
    }

    function scheduleSave(delay = 600) {
      if (saveTimer) clearTimeoutFn(saveTimer);
      saveTimer = setTimeoutFn(() => {
        saveTimer = null;
        syncQueue().catch(() => {});
      }, delay);
    }

    async function listProjects() {
      const projects = await workspaceStore.listProjects();
      refreshProjects(projects);
      return projects;
    }

    async function listHistory(mode = 'versions') {
      const projectId = getState().currentProjectId;
      if (!projectId) return [];
      const records = mode === 'ai'
        ? await workspaceStore.listAIHistory(projectId)
        : await workspaceStore.listVersions(projectId);
      renderHistory(records);
      return records;
    }

    async function init() {
      const project = await workspaceStore.init();
      if (!project || !project.id) {
        throw new Error('WorkspaceStore.init() did not return a valid project');
      }

      const persistedQueue = await workspaceStore.loadQueue(project.id);
      // File ingestion is bound before workspace initialization so mobile file
      // selection remains responsive. If files arrive while IndexedDB is
      // loading, preserve those in-memory items instead of replacing them
      // with the older persisted snapshot.
      const pendingQueue = getState().queue || [];
      const pendingIds = new Set(pendingQueue.map(item => item.id));
      const queue = [
        ...persistedQueue.filter(item => !pendingIds.has(item.id)),
        ...pendingQueue
      ];
      setState({ currentProjectId: project.id, queue });
      renderQueue();
      setWorkspaceStatus('Projeto: ' + project.name);
      const current = queue.find(item => item.status === 'done' && item.result);
      if (current) showCurrentDocument(current);
      await listProjects();
      return project;
    }

    async function selectProject(projectId) {
      if (!projectId || projectId === getState().currentProjectId) return null;
      await syncQueue();
      const queue = await workspaceStore.loadQueue(projectId);
      setState({ currentProjectId: projectId, queue, currentMd: queue.find(i => i.status === 'done' && i.result)?.result || '' });
      renderQueue();
      const current = queue.find(item => item.status === 'done' && item.result);
      if (current) showCurrentDocument(current);
      else showEmptyWorkspace();
      const projects = await listProjects();
      await listHistory('versions');
      const project = projects.find(item => item.id === projectId);
      setWorkspaceStatus('Projeto: ' + (project?.name || ''));
      toast('Projeto carregado.', 'success');
      return project || null;
    }

    async function createProject(name) {
      await syncQueue();
      const normalized = String(name || '').trim();
      if (!normalized) {
        toast('Informe o nome do projeto.', 'warning');
        return null;
      }
      const project = await workspaceStore.createProject(normalized);
      setState({ currentProjectId: project.id, queue: [], currentMd: '' });
      renderQueue();
      showEmptyWorkspace();
      await listProjects();
      await listHistory('versions');
      toast('Projeto criado e ativado.', 'success');
      return project;
    }

    async function renameProject(projectId, name) {
      const projects = await workspaceStore.listProjects();
      const project = projects.find(item => item.id === projectId);
      const normalized = String(name || '').trim();
      if (!project || !normalized) return null;
      project.name = normalized;
      await workspaceStore.updateProject(project);
      await listProjects();
      toast('Projeto renomeado.', 'success');
      return project;
    }

    async function deleteProject(projectId, confirmDelete) {
      const projects = await workspaceStore.listProjects();
      if (projects.length <= 1) {
        toast('Mantenha pelo menos um projeto.', 'warning');
        return null;
      }
      const project = projects.find(item => item.id === projectId);
      if (!project || (typeof confirmDelete === 'function' && !confirmDelete(project))) return null;
      await workspaceStore.deleteProject(projectId);
      const next = (await workspaceStore.listProjects())[0];
      const queue = await workspaceStore.loadQueue(next.id);
      setState({ currentProjectId: next.id, queue });
      renderQueue();
      const current = queue.find(item => item.status === 'done' && item.result);
      if (current) showCurrentDocument(current);
      else showEmptyWorkspace();
      await listProjects();
      await listHistory('versions');
      toast('Projeto excluído.', 'success');
      return next;
    }

    async function saveVersion(source = 'manual') {
      const state = getState();
      if (!state.currentProjectId || !state.currentMd) {
        toast('Não há conteúdo para versionar.', 'warning');
        return null;
      }
      const version = await workspaceStore.saveVersion(
        state.currentProjectId,
        null,
        state.currentFileName,
        state.currentMd,
        source,
        ''
      );
      const projects = await workspaceStore.listProjects();
      const project = projects.find(item => item.id === state.currentProjectId);
      if (project) await workspaceStore.updateProject(project);
      await listHistory('versions');
      setWorkspaceStatus('Versão salva · ' + new Date(version.createdAt).toLocaleTimeString('pt-BR'));
      toast('Versão do Markdown salva.', 'success');
      return version;
    }

    async function exportProject(projectId = getState().currentProjectId) {
      if (!projectId) return null;
      return workspaceStore.exportProject(projectId);
    }

    return {
      init,
      syncQueue,
      scheduleSave,
      listProjects,
      listHistory,
      selectProject,
      createProject,
      renameProject,
      deleteProject,
      saveVersion,
      exportProject
    };
  }

  return { create };
});
