(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAISettingsController = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({
    getSettings,
    setSettings,
    saveSettings,
    ui
  } = {}) {
    if (typeof getSettings !== 'function' ||
        typeof setSettings !== 'function' ||
        typeof saveSettings !== 'function' ||
        !ui) {
      throw new TypeError('SettingsController requires state, persistence, and UI dependencies.');
    }

    const defaults = {
      aiProvider: 'gemini',
      aiModel: 'gemini-1.5-flash',
      apiKey: '',
      markitdownEnabled: true,
      markitdownEndpoint: globalThis.MarkAICore?.getDefaultBackendEndpoint?.() || '',
      syntaxHL: true,
      autoPreview: true
    };

    function normalize(settings = {}) {
      return {
        ...defaults,
        ...(settings || {}),
        aiProvider: settings.aiProvider || defaults.aiProvider,
        aiModel: settings.aiModel || defaults.aiModel,
        markitdownEndpoint: settings.markitdownEndpoint ?? defaults.markitdownEndpoint
      };
    }

    function sync() {
      const settings = normalize(getSettings());
      ui.setSettingsForm(settings);
      ui.filterAIModels(settings.aiProvider);
      return settings;
    }

    function read() {
      return normalize({
        ...getSettings(),
        ...ui.readSettingsForm()
      });
    }

    function save() {
      const settings = read();
      setSettings(settings);
      saveSettings();
      ui.closeSettings();
      ui.toast('✓ Configurações salvas!', 'success');
      return settings;
    }

    function clearApiKey() {
      const settings = normalize(getSettings());
      settings.apiKey = '';
      ui.setApiKeyValue('');
      setSettings(settings);
      saveSettings();
      ui.toast('Chave removida.', 'info');
      return settings;
    }

    function toggleApiKey() {
      return ui.toggleApiKeyVisibility();
    }

    function bind() {
      ui.bindSettingsEvents({
        open: sync,
        close: () => ui.closeSettings(),
        backdrop: () => ui.closeSettings(),
        save,
        clearApiKey,
        toggleApiKey,
        providerChange: event => ui.filterAIModels(event.target.value)
      });
    }

    return { sync, read, save, clearApiKey, toggleApiKey, bind };
  }

  return { create };
});
