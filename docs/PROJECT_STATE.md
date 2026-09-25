# MarkAI Converter — Project State

## Baseline estável
- Branch: `main`
- Commit: `069a56bd677b45329bf97afa755c6df5e2688ac6`
- Data do baseline: 2026-09-23
- CI do baseline: aprovado
- PR #4: integrado
- PR #3: permanece integrado e preservado

## Estado atual
A Fase 14.5 — painel de qualidade da evidência foi integrada na `main` e validada pelo CI.
As fases recentes de Video Intelligence foram concluídas:
- Fase 14 — otimização de análise por transcrição;
- Fase 14.2 — análise visual adaptativa;
- Fase 14.3 — correlação precisa de evidências;
- Fase 14.4 — qualidade determinística da correlação;
- Fase 14.5 — painel de qualidade da evidência.

O DevTrail também possui a cadeia consolidada das fases 1–13, incluindo especificação, prontidão, pacote RPA, plano de replay, validação, auditoria, drift/regressão e E2E.

A arquitetura atual possui, entre outros:
- QueueUIController
- WorkspaceUIController
- ConversionController
- WorkspaceController
- WorkspaceStore
- MergeEngine
- EditorController
- YouTubeController
- SettingsController
- VideoAutomationController
- VideoEvidenceTimeline
- módulos de auditoria, replay, drift e pacote DevTrail

## Regras de continuidade
1. `main` deve permanecer estável.
2. Toda evolução deve partir do último commit validado de `main`.
3. Desenvolvimento em branch própria.
4. Alterações pequenas e isoladas.
5. Teste/regressão deve acompanhar cada mudança.
6. CI obrigatório antes de integração.
7. Não alterar PRs já integrados para corrigir trabalho novo.
8. Registrar decisões arquiteturais e pendências neste arquivo.
9. Antes de remover ou substituir comportamento existente, identificar a cobertura de teste correspondente.

## Próxima etapa
**Fase 8 — Auditoria pós-Fase 7 e planejamento técnico.**

### Objetivos da auditoria
- mapear funcionalidades existentes;
- identificar responsabilidades ainda concentradas em `script.js`;
- identificar duplicidade de lógica;
- verificar cobertura de testes por módulo;
- identificar fluxos críticos sem teste;
- revisar contratos entre Controllers, Engines, State e UI;
- levantar riscos de regressão;
- definir próximos micro-PRs.

## Mapa funcional inicial
- Importação: drag/drop, file picker, múltiplos arquivos
- Conversão: individual, lote, qualidade
- Fila: ordenar, remover, preview, download, ZIP
- Merge: combinação e persistência
- Workspace: projetos, versões, histórico IA, JSON/ZIP
- Editor
- Comparação
- IA
- YouTube
- Automação de vídeo
- Configurações
- Backend/API

## Critério de conclusão da Fase 8
Não iniciar uma grande funcionalidade nova enquanto a auditoria não produzir:
- inventário funcional;
- mapa de responsabilidades;
- lacunas de testes;
- riscos prioritários;
- roadmap de micro-PRs;
- baseline documentado.

## Histórico recente
- PR #3: `refactor: modularize workspace and queue UI`
- PR #4: `fix: persist workspace after queue merge`
- Correções posteriores: delegação de merge/conversão, injeção de timer, testes de ZIP, prevenção de nomes duplicados, teste do file picker e remoção de dependência obsoleta de MergeEngine no QueueUIController.


## Fase 16 — Agente Autônomo de Exploração e Mapeamento

### Passo 1 — Arquitetura e isolamento
- Criado `extension/autonomous_agent.js` como núcleo isolado do agente autônomo.
- Mantido o gravador reativo existente em `extension/background.js` sem compartilhar estado interno.
- Criado namespace de mensagens `DEVTRAIL_AUTONOMOUS_*`.
- Criado gerenciamento de sessão com estados `idle`, `attaching`, `ready`, `stopping` e `error`.
- O núcleo possui tratamento de erro CDP e cleanup de sessão.
- Em falha de `chrome.debugger.attach`, o agente não executa `detach`, evitando interferência sobre uma sessão CDP pertencente ao modo reativo.
- O núcleo ainda não executa exploração DOM nem coleta Network; essas responsabilidades entram nos Passos 2 e 3.

### Validação
- Adicionado `tests/test_devtrail_autonomous_agent.js`.
- Cobertos: instalação única do listener, início/finalização de sessão, prevenção de sessão duplicada, habilitação dos domínios CDP e isolamento em falha de attach.
- CI passa a validar sintaxe do novo módulo e executar o contrato do agente.

### Fase 16.2 — Scanner semântico do DOM
Implementado em branch `feat/devtrail-autonomous-agent-phase-2-dom`:
- `extension/autonomous_dom_scanner.js`;
- descoberta de links, botões, campos, selects, textareas, roles, contenteditable e summary;
- seletor estável por id/data-testid/name/aria-label com fallback estrutural;
- estado visível/desabilitado e bounding box;
- metadados de página e viewport;
- proteção contra captura de texto/placeholder/valor de campos `password`;
- execução remota via `chrome.scripting.executeScript`;
- operação `DEVTRAIL_AUTONOMOUS_SCAN_DOM` somente para a aba da sessão autônoma ativa;
- teste dedicado `tests/test_devtrail_autonomous_dom_scanner.js`;
- validação de sintaxe e teste incluídos no CI.

### Próximos passos
1. Captura e normalização Network/CDP.
2. Correlação de eventos DOM + Network.
3. Agregação e exportação `system_map.json` / `system_map.md`.
