(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIWorkspaceUIController = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({
    workspaceController,
    workspaceStore,
    getState,
    ui = {},
    documentRef = globalThis.document,
    windowRef = globalThis
  } = {}) {
    if (!workspaceController) throw new Error('WorkspaceUIController requires workspaceController');
    if (!workspaceStore) throw new Error('WorkspaceUIController requires workspaceStore');
    if (typeof getState !== 'function') throw new Error('WorkspaceUIController requires getState');

    const $ = id => documentRef?.getElementById(id);
    const toast = (message, type) => ui.toast?.(message, type);
    const historyMode = () => ui.getHistoryMode?.() || 'versions';

    async function openWorkspace() {
      try {
        await workspaceController.listProjects();
        await workspaceController.listHistory(historyMode());
        $('modalWorkspace')?.showModal();
      } catch (error) {
        toast('Erro ao abrir workspace: ' + error.message, 'error');
      }
    }

    async function createProject() {
      const input = $('workspaceProjectName');
      const name = input?.value?.trim() || windowRef.prompt?.('Nome do novo projeto:');
      if (!name?.trim()) return;
      try {
        await workspaceController.createProject(name);
        if (input) input.value = '';
      } catch (error) {
        toast('Erro ao criar projeto: ' + error.message, 'error');
      }
    }

    async function renameProject() {
      const projectId = getState().currentProjectId;
      const project = (await workspaceStore.listProjects()).find(item => item.id === projectId);
      if (!project) return;
      const name = windowRef.prompt?.('Novo nome do projeto:', project.name);
      if (!name?.trim()) return;
      await workspaceController.renameProject(projectId, name);
    }

    async function deleteProject() {
      const projectId = getState().currentProjectId;
      await workspaceController.deleteProject(
        projectId,
        project => windowRef.confirm?.('Excluir o projeto "' + project.name + '" e todo o histórico local?')
      );
    }

    async function exportJson() {
      const projectId = getState().currentProjectId;
      if (!projectId) return;
      const payload = await workspaceController.exportProject(projectId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = documentRef.createElement('a');
      anchor.href = url;
      anchor.download = (payload.project?.name || 'workspace').replace(/[^a-z0-9_-]+/gi, '_') + '.json';
      anchor.click();
      URL.revokeObjectURL(url);
    }

    async function exportZip() {
      const projectId = getState().currentProjectId;
      if (!projectId || !windowRef.JSZip) {
        toast('Exportação ZIP indisponível.', 'warning');
        return;
      }
      const payload = await workspaceController.exportProject(projectId);
      const zip = new windowRef.JSZip();
      zip.file('workspace.json', JSON.stringify(payload, null, 2));
      (payload.documents || []).forEach(item => {
        if (item.result) zip.file('documents/' + (item.name || item.id) .replace(/[^a-z0-9._-]+/gi, '_') + '.md', item.result);
      });
      (payload.versions || []).forEach((item, index) => {
        zip.file('versions/' + String(index + 1).padStart(4, '0') + '-' + (item.name || 'documento.md').replace(/[^a-z0-9._-]+/gi, '_'), item.markdown || '');
      });
      zip.file('ai_history.json', JSON.stringify(payload.aiHistory || [], null, 2));
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const anchor = documentRef.createElement('a');
      anchor.href = url;
      anchor.download = (payload.project?.name || 'workspace').replace(/[^a-z0-9_-]+/gi, '_') + '.zip';
      anchor.click();
      URL.revokeObjectURL(url);
    }

    async function loadVersion(event) {
      const item = event.target.closest?.('[data-history-id]');
      if (!item || historyMode() !== 'versions') return;
      const records = await workspaceStore.listVersions(getState().currentProjectId);
      const version = records.find(record => record.id === item.dataset.historyId);
      if (!version?.markdown) return;
      ui.loadMarkdown?.(version.markdown, version.name || 'documento.md');
      $('modalWorkspace')?.close();
      toast('Versão carregada no editor.', 'success');
    }

    async function selectHistoryMode(mode) {
      ui.setHistoryMode?.(mode);
      $('workspaceTabVersions')?.classList.toggle('active', mode === 'versions');
      $('workspaceTabAI')?.classList.toggle('active', mode === 'ai');
      await workspaceController.listHistory(mode);
    }

    function bind() {
      $('btnWorkspace')?.addEventListener('click', openWorkspace);
      $('btnWorkspaceToolbar')?.addEventListener('click', openWorkspace);
      $('btnCloseWorkspace')?.addEventListener('click', () => $('modalWorkspace')?.close());
      $('btnWorkspaceDone')?.addEventListener('click', () => $('modalWorkspace')?.close());
      $('modalWorkspace')?.addEventListener('click', event => {
        if (event.target === $('modalWorkspace')) $('modalWorkspace')?.close();
      });
      $('workspaceProjectSelect')?.addEventListener('change', event => workspaceController.selectProject(event.target.value));
      $('btnWorkspaceSave')?.addEventListener('click', async () => {
        await workspaceController.syncQueue();
        toast('Workspace salvo.', 'success');
      });
      $('btnWorkspaceVersion')?.addEventListener('click', () => workspaceController.saveVersion('manual'));
      $('btnWorkspaceExport')?.addEventListener('click', exportZip);
      $('btnCreateWorkspaceProject')?.addEventListener('click', createProject);
      $('workspaceProjectName')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') createProject();
      });
      $('workspaceProjectList')?.addEventListener('click', event => {
        const item = event.target.closest?.('[data-project-id]');
        if (item) workspaceController.selectProject(item.dataset.projectId);
      });
      $('btnRenameWorkspaceProject')?.addEventListener('click', renameProject);
      $('btnDeleteWorkspaceProject')?.addEventListener('click', deleteProject);
      $('btnExportWorkspaceJson')?.addEventListener('click', exportJson);
      $('btnExportWorkspaceZip')?.addEventListener('click', exportZip);
      $('workspaceTabVersions')?.addEventListener('click', () => selectHistoryMode('versions'));
      $('workspaceTabAI')?.addEventListener('click', () => selectHistoryMode('ai'));
      $('workspaceHistoryList')?.addEventListener('click', loadVersion);
    }

    return { bind, openWorkspace, createProject, renameProject, deleteProject, exportJson, exportZip, selectHistoryMode };
  }

  return { create };
});
