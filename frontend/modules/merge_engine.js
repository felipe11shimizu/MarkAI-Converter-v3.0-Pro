(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIMergeEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ queueManager, fileParserStrategy, renderQueue } = {}) {
    if (!queueManager || typeof queueManager.getOrdered !== 'function' || typeof queueManager.update !== 'function') {
      throw new TypeError('MergeEngine requires a compatible queueManager.');
    }
    if (!fileParserStrategy || typeof fileParserStrategy.parse !== 'function') {
      throw new TypeError('MergeEngine requires a compatible fileParserStrategy.');
    }

    async function merge(onProgress) {
      const items = queueManager.getOrdered();
      if (!items.length) throw new Error('Fila vazia.');
      let combined = '# Documento Combinado\n\n';
      combined += '*Gerado por MarkAI Converter v3.0 Pro*\n';
      combined += '*'+new Date().toLocaleString('pt-BR')+'*\n\n';
      combined += '**Arquivos:** '+items.length+'\n\n---\n\n';

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (onProgress) onProgress((i + 0.5) / items.length, item.name);
        let result = item.result;
        if (!result) {
          queueManager.update(item.id, { status: 'converting' });
          if (renderQueue) renderQueue();
          try {
            result = await fileParserStrategy.parse(item);
            queueManager.update(item.id, { status: 'done', result });
            if (renderQueue) renderQueue();
          } catch (e) {
            queueManager.update(item.id, { status: 'error' });
            if (renderQueue) renderQueue();
            result = '_Erro ao converter: '+item.name+'_';
          }
        }
        combined += '---\n\n## '+(i + 1)+'. '+item.name+'\n\n';
        combined += String(result || '').trim()+'\n\n';
        if (onProgress) onProgress((i + 1) / items.length, item.name);
      }
      return combined.trimEnd();
    }

    return { merge };
  }

  return { create };
});
