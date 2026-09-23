(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIConversionController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ queueManager, markItDownEngine, fileParserStrategy, conversionQuality, getState, setState, ui, workspace }) {
    if (!queueManager || !markItDownEngine || !fileParserStrategy || !conversionQuality || !getState || !setState || !ui) {
      throw new Error('ConversionController requires queue, engines, state and UI dependencies.');
    }

    async function convertItem(id) {
      const item = queueManager.getById(id);
      if (!item) return null;
      queueManager.update(id, { status: 'converting' });
      ui.renderQueue();
      ui.setStatus('Convertendo ' + item.name + '…', 'busy');
      ui.setProgress(0.1);
      try {
        let result = null, engine = 'browser', conversionMeta = null;
        if (await markItDownEngine.isAvailable()) {
          try {
            const remote = await markItDownEngine.convert(item.file, p => ui.setProgress(p));
            if (remote?.markdown) {
              result = remote.markdown;
              engine = 'markitdown';
              conversionMeta = remote.meta || null;
            }
          } catch (remoteError) {
            console.warn('[MarkAI] Fallback local:', remoteError);
          }
        }
        if (!result) result = await fileParserStrategy.parseBrowser(item, p => ui.setProgress(p));
        queueManager.update(id, { status: 'done', result, engine, conversionMeta });
        if (workspace) workspace.scheduleSave();
        ui.renderQueue();
        ui.setProgress(1);
        ui.loadMarkdown(result, item.name.replace(/\.[^.]+$/, '') + '.md');
        ui.setStatus(item.name + ' convertido', 'idle');
        ui.toast('✓ ' + item.name + ' convertido com sucesso!', 'success');
        return result;
      } catch (e) {
        queueManager.update(id, { status: 'error' });
        ui.renderQueue();
        ui.setProgress(0, false);
        ui.setStatus('Erro na conversão', 'error');
        ui.toast('Erro: ' + e.message, 'error');
        return null;
      }
    }

    async function convertAll() {
      const items = queueManager.getOrdered();
      if (!items.length) {
        ui.toast('Nenhum arquivo na fila.', 'warning');
        return;
      }
      let last = null;
      for (const item of items) {
        if (item.status !== 'done') {
          await convertItem(item.id);
          last = item.id;
        }
      }
      if (!last) ui.toast('Todos os arquivos já convertidos.', 'info');
    }

    async function mergeAll() {
      const items = queueManager.getOrdered();
      if (!items.length) {
        ui.toast('Nenhum arquivo na fila.', 'warning');
        return;
      }
      ui.showProcessing('Juntando arquivos…', 'Processando ' + items.length + ' arquivos');
      ui.setStatus('Fazendo merge…', 'busy');
      try {
        const result = await getState().mergeEngine.merge((p, name) => {
          ui.setProcessingSub('Convertendo: ' + name);
        });
        ui.hideProcessing();
        ui.loadMarkdown(result.markdown, result.fileName);
        ui.setProgress(1);
        ui.setStatus('Merge concluído', 'idle');
        ui.toast('Arquivos juntados com sucesso.', 'success');
        return result;
      } catch (e) {
        ui.hideProcessing();
        ui.toast('Erro no merge: ' + e.message, 'error');
        return null;
      }
    }

    async function compareItem(id) {
      const item = queueManager.getById(id);
      if (!item) return null;
      const unsupported = ['pptx','epub','zip','png','jpg','jpeg','gif','webp','wav','mp3','m4a'];
      if (unsupported.includes(item.ext)) {
        ui.toast('Este formato não possui parser local para comparação.', 'warning');
        return null;
      }
      ui.showProcessing('Comparando motores…', item.name);
      try {
        const settled = await Promise.allSettled([
          markItDownEngine.convert(item.file),
          fileParserStrategy.parseBrowser(item)
        ]);
        const remote = settled[0].status === 'fulfilled' ? settled[0].value : null;
        const local = settled[1].status === 'fulfilled' ? settled[1].value : null;
        if (!remote?.markdown && !local) throw new Error('Nenhum dos motores conseguiu converter o arquivo.');
        const rmd = remote?.markdown || '', bmd = local || '';
        const rm = conversionQuality.metrics(rmd), bm = conversionQuality.metrics(bmd);
        const diff = conversionQuality.diffScore(rmd, bmd);
        ui.showComparison(item, rmd, bmd, rm, bm, diff);
        setState({ compareState: { id, markitdown: rmd, browser: bmd } });
        ui.hideProcessing();
        return { markitdown: rmd, browser: bmd, diff };
      } catch (e) {
        ui.hideProcessing();
        ui.toast('Erro na comparação: ' + e.message, 'error');
        return null;
      }
    }

    return { convertItem, convertAll, mergeAll, compareItem };
  }

  return { create };
});