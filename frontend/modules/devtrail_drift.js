(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailDrift = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'markai-devtrail-drift-baseline-v1';

  function safe(value) {
    return value == null ? '' : String(value);
  }

  function normalizeEndpoint(value) {
    const raw = safe(value).trim();
    if (!raw) return '';
    try {
      const u = new URL(raw, 'http://markai.local');
      return u.pathname || raw.split('?')[0];
    } catch (_) {
      return raw.split('?')[0];
    }
  }

  function normalizeStep(step, index) {
    const selectors = step?.seletores || step?.selectors || {};
    const network = Array.isArray(step?.network_calls) ? step.network_calls : [];
    return {
      index,
      event: safe(step?.evento || step?.event),
      label: safe(step?.label || step?.descricao || step?.description),
      selector: safe(selectors.id || selectors.testid || selectors.cy || selectors.name || selectors.css || selectors.xpath),
      input_present: step?.input != null && safe(step.input) !== '',
      network: network.map(call => ({
        method: safe(call?.method).toUpperCase(),
        endpoint: normalizeEndpoint(call?.url || call?.endpoint),
        status: Number.isFinite(Number(call?.status)) ? Number(call.status) : null
      }))
    };
  }

  function stepsFrom(session) {
    const source = Array.isArray(session?.steps) ? session.steps
      : Array.isArray(session?.etapas) ? session.etapas : [];
    return source.map(normalizeStep);
  }

  function structuralSnapshot(session) {
    return {
      session_id: safe(session?.metadata?.session_id || session?.session_id),
      url: safe(session?.metadata?.url || session?.url),
      captured_at: safe(session?.metadata?.started_at || session?.started_at),
      steps: stepsFrom(session)
    };
  }

  function stepKey(step) {
    return [step.event, step.selector, step.label].join('|');
  }

  function networkKey(call) {
    return [call.method, call.endpoint].join(' ');
  }

  function compareNetwork(expected, actual) {
    const exp = new Set(expected.map(networkKey));
    const act = new Set(actual.map(networkKey));
    return {
      added: [...act].filter(k => !exp.has(k)),
      removed: [...exp].filter(k => !act.has(k)),
      status_changes: actual.filter(a => {
        const e = expected.find(x => networkKey(x) === networkKey(a));
        return e && e.status !== a.status;
      }).map(a => ({
        endpoint: a.endpoint,
        method: a.method,
        baseline_status: expected.find(x => networkKey(x) === networkKey(a))?.status ?? null,
        current_status: a.status
      }))
    };
  }

  function compare(baselineSession, currentSession) {
    const baseline = structuralSnapshot(baselineSession);
    const current = structuralSnapshot(currentSession);
    const changes = [];
    const max = Math.max(baseline.steps.length, current.steps.length);

    for (let i = 0; i < max; i += 1) {
      const b = baseline.steps[i];
      const c = current.steps[i];

      if (!b && c) {
        changes.push({ type: 'step_added', index: i, current: c });
        continue;
      }
      if (b && !c) {
        changes.push({ type: 'step_removed', index: i, baseline: b });
        continue;
      }

      if (stepKey(b) !== stepKey(c)) {
        const bPos = current.steps.findIndex(s => stepKey(s) === stepKey(b));
        const cPos = baseline.steps.findIndex(s => stepKey(s) === stepKey(c));
        changes.push({
          type: 'step_changed_or_reordered',
          index: i,
          baseline: b,
          current: c,
          baseline_found_at_current_index: bPos,
          current_found_at_baseline_index: cPos
        });
      }

      if (b.selector !== c.selector) {
        changes.push({ type: 'selector_drift', index: i, baseline: b.selector, current: c.selector });
      }
      if (b.event !== c.event) {
        changes.push({ type: 'event_drift', index: i, baseline: b.event, current: c.event });
      }
      if (b.input_present !== c.input_present) {
        changes.push({ type: 'input_presence_drift', index: i, baseline: b.input_present, current: c.input_present });
      }

      const net = compareNetwork(b.network, c.network);
      net.added.forEach(value => changes.push({ type: 'network_added', index: i, value }));
      net.removed.forEach(value => changes.push({ type: 'network_removed', index: i, value }));
      net.status_changes.forEach(value => changes.push({ type: 'network_status_drift', index: i, ...value }));
    }

    const baselineKeys = new Set(baseline.steps.map(stepKey));
    const currentKeys = new Set(current.steps.map(stepKey));
    const repeatedBaseline = baseline.steps.length - baselineKeys.size;
    const repeatedCurrent = current.steps.length - currentKeys.size;

    return {
      schema_version: '1.0',
      drift_type: 'devtrail-drift-regression',
      generated_at: new Date().toISOString(),
      baseline: {
        session_id: baseline.session_id,
        url: baseline.url,
        steps: baseline.steps.length
      },
      current: {
        session_id: current.session_id,
        url: current.url,
        steps: current.steps.length
      },
      metrics: {
        baseline_steps: baseline.steps.length,
        current_steps: current.steps.length,
        step_delta: current.steps.length - baseline.steps.length,
        changes: changes.length,
        selector_drifts: changes.filter(x => x.type === 'selector_drift').length,
        network_drifts: changes.filter(x => x.type.startsWith('network_')).length,
        ordering_drifts: changes.filter(x => x.type === 'step_changed_or_reordered').length,
        repeated_baseline_steps: repeatedBaseline,
        repeated_current_steps: repeatedCurrent
      },
      changes,
      interpretation: {
        status: changes.length ? 'divergente' : 'sem_drift_observado',
        note: changes.length
          ? 'Foram observadas diferenças estruturais entre a linha de base e a execução atual.'
          : 'Nenhuma diferença estrutural foi observada nos elementos comparados.',
        limitations: [
          'A análise compara apenas a evidência capturada pelo DevTrail.',
          'Mudanças visuais sem alteração dos eventos capturados podem não ser detectadas.',
          'Valores sensíveis não são armazenados nem comparados.'
        ]
      },
      security: {
        credentials_stored: false,
        sensitive_values_compared: false,
        policy: 'Não armazenar credenciais, tokens, cookies ou senhas.'
      }
    };
  }

  function buildBaseline(session) {
    return {
      schema_version: '1.0',
      baseline_type: 'devtrail-session-baseline',
      created_at: new Date().toISOString(),
      snapshot: structuralSnapshot(session),
      security: {
        credentials_stored: false,
        sensitive_values_compared: false
      }
    };
  }

  function toMarkdown(report) {
    if (!report) return '';
    const m = report.metrics || {};
    const lines = [
      '# Análise de Drift e Regressão DevTrail',
      '',
      '## 1. Resumo',
      `Status: **${report.interpretation?.status || 'não disponível'}**`,
      `Linha de base: ${report.baseline?.session_id || 'não informada'}`,
      `Execução atual: ${report.current?.session_id || 'não informada'}`,
      '',
      '## 2. Métricas',
      `- Etapas na linha de base: ${m.baseline_steps || 0}`,
      `- Etapas na execução atual: ${m.current_steps || 0}`,
      `- Variação de etapas: ${m.step_delta || 0}`,
      `- Alterações detectadas: ${m.changes || 0}`,
      `- Drift de seletores: ${m.selector_drifts || 0}`,
      `- Drift de rede: ${m.network_drifts || 0}`,
      `- Alterações de ordem/etapa: ${m.ordering_drifts || 0}`,
      '',
      '## 3. Alterações observadas'
    ];
    if (!report.changes?.length) lines.push('- Nenhuma alteração estrutural observada.');
    else report.changes.forEach((change, index) => {
      lines.push(`${index + 1}. **${change.type}** — etapa ${Number(change.index) + 1}`);
      if (change.value) lines.push(`   - ${change.value}`);
      if (change.baseline != null || change.current != null) {
        lines.push(`   - baseline: ${JSON.stringify(change.baseline ?? null)}`);
        lines.push(`   - atual: ${JSON.stringify(change.current ?? null)}`);
      }
    });
    lines.push(
      '',
      '## 4. Limitações',
      ...(report.interpretation?.limitations || []).map(item => `- ${item}`),
      '',
      '## 5. Segurança',
      '- Credenciais armazenadas: não',
      '- Valores sensíveis comparados: não',
      '- A comparação utiliza apenas a estrutura da evidência capturada.'
    );
    return lines.join('\n');
  }

  function saveBaseline(session, storage = globalThis.localStorage) {
    const baseline = buildBaseline(session);
    storage?.setItem(STORAGE_KEY, JSON.stringify(baseline));
    return baseline;
  }

  function loadBaseline(storage = globalThis.localStorage) {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearBaseline(storage = globalThis.localStorage) {
    storage?.removeItem(STORAGE_KEY);
  }

  function compareWithBaseline(session, storage = globalThis.localStorage) {
    const baseline = loadBaseline(storage);
    return baseline?.snapshot ? compare(baseline.snapshot, session) : null;
  }

  function install(options = {}) {
    const documentObj = options.documentObj || globalThis.document;
    const windowObj = options.windowObj || globalThis.window;
    if (!documentObj || !windowObj) return;

    const exportButton = documentObj.getElementById('btnDevTrailExportDrift');
    const baselineButton = documentObj.getElementById('btnDevTrailSetBaseline');
    const status = documentObj.getElementById('devtrailDriftStatus');
    let latest = null;

    const download = (filename, content, type) => {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = documentObj.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    function render() {
      const baseline = loadBaseline();
      if (status) status.textContent = baseline
        ? latest ? 'Drift analisado contra a linha de base salva.' : 'Linha de base disponível.'
        : 'Nenhuma linha de base definida.';
      if (exportButton) exportButton.disabled = !latest;
    }

    baselineButton?.addEventListener('click', () => {
      const session = windowObj.__markaiDevTrailLastSession;
      if (!session) {
        if (status) status.textContent = 'Finalize uma sessão DevTrail antes de definir a linha de base.';
        return;
      }
      saveBaseline(session);
      latest = null;
      render();
    });

    exportButton?.addEventListener('click', () => {
      if (!latest) return;
      download('devtrail-drift-regression.json', JSON.stringify(latest, null, 2), 'application/json;charset=utf-8');
      download('devtrail-drift-regression.md', toMarkdown(latest), 'text/markdown;charset=utf-8');
    });

    windowObj.addEventListener('message', event => {
      if (event.source !== windowObj || event.data?.source !== 'markai-devtrail' || event.data?.type !== 'DEVTRAIL_SESSION_FINALIZED') return;
      const session = event.data.payload?.json;
      if (!session) return;
      windowObj.__markaiDevTrailLastSession = session;
      const baseline = loadBaseline();
      if (baseline?.snapshot) {
        latest = compare(baseline.snapshot, session);
      }
      render();
    });

    render();
  }

  return {
    compare,
    buildBaseline,
    saveBaseline,
    loadBaseline,
    clearBaseline,
    compareWithBaseline,
    toMarkdown,
    install
  };
});
