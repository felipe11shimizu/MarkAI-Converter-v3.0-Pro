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

### Fase 16.3 — Captura e normalização Network/CDP
Implementado em `feat/devtrail-autonomous-agent-phase-3-network`:
- `extension/autonomous_network_capture.js`;
- captura de `Network.requestWillBeSent` e `Network.responseReceived`;
- recuperação opcional de corpo via `Network.getResponseBody`;
- normalização de URL, método, status, MIME, payload, headers e latência;
- filtragem de ruído e conteúdo binário;
- redaction de credenciais, cookies, tokens e chaves;
- captura restrita à aba da sessão autônoma;
- limite de histórico de 2.000 eventos;
- teste dedicado e validação no CI.


### Fase 16.4 — Correlação DOM + Network
Implementado em `feat/devtrail-autonomous-agent-phase-4-correlation`:
- `extension/autonomous_event_correlator.js`;
- correlação temporal de eventos DOM com chamadas Network da mesma sessão;
- janela padrão de 5 segundos após cada evento DOM;
- ordenação cronológica e limite por evento;
- normalização de eventos e resumo determinístico;
- exposição via `DEVTRAIL_AUTONOMOUS_CORRELATE`;
- isolamento por `tabId` e exigência de sessão autônoma ativa;
- teste dedicado e validação no CI.

A correlação não altera o recorder reativo existente e não executa ações no alvo.


### Fase 16.5 — Agregação `system_map.json`
Implementado em `feat/devtrail-autonomous-agent-phase-5-system-map`:
- `extension/autonomous_system_map.js`;
- agregação de páginas, elementos, ações, Network, fluxos e diagnósticos;
- deduplicação determinística por identidade;
- referências entre ações e chamadas Network;
- totais consolidados;
- exposição via `DEVTRAIL_AUTONOMOUS_BUILD_MAP`;
- teste dedicado e validação no CI.

### Fase 16.6 — Geração `system_map.md`
Implementada em `feat/devtrail-autonomous-agent-phase-6-system-map-md`:
- `extension/autonomous_system_map_markdown.js`;
- renderização determinística do mapa em Markdown;
- resumo de sessão, páginas, elementos, ações, Network, fluxos e diagnósticos;
- escaping básico para células Markdown;
- preservação das regras de redaction e segurança;
- exposição via `DEVTRAIL_AUTONOMOUS_BUILD_MAP_MD`;
- teste dedicado e validação no CI.

### Fase 16.7 — Planner de exploração autônoma
Implementado em branch de correção da Fase 16.7:
- `extension/autonomous_planner.js`;
- planejamento determinístico sem execução de ações;
- priorização de elementos visíveis e interativos;
- exclusão de elementos ocultos/desabilitados;
- prevenção de repetição de elementos já observados;
- limites explícitos de ações, navegação e inputs;
- todas as ações planejadas exigem validação;
- exposição via `DEVTRAIL_AUTONOMOUS_PLAN`;
- carregamento explícito do planner no `background.js`;
- teste dedicado e validação no CI.

O planner permanece em modo `observe-plan-only`: não executa clique, digitação ou navegação.

### Fase 16.8 — Executor autônomo controlado
Implementado em branch `feat/devtrail-autonomous-executor-phase-8`:
- `extension/autonomous_executor.js`;
- validação de sessão e correspondência de `sessionId`;
- execução limitada à aba alvo da sessão;
- exigência explícita de autorização para executar;
- limite de ações por execução;
- somente ações `click`, `navigate` e `input`;
- navegação e inputs desabilitáveis por configuração;
- inputs desabilitados por padrão e exigem valor explícito;
- bloqueio de campos `password`;
- cada ação exige `requires_validation=true`;
- execução via `chrome.scripting.executeScript`, sem JavaScript arbitrário fornecido pelo plano;
- resultado individual por ação e parada quando a sessão deixa de estar ativa;
- mensagem `DEVTRAIL_AUTONOMOUS_EXECUTE`;
- teste dedicado e validação no CI.

O executor permanece atrás de guardrails explícitos e não executa nada sem `execute: true`.

### Fase 16.9 — Validação pós-ação e prevenção de loops
Implementada na branch `feat/devtrail-autonomous-validation-phase-9`:
- executor versão `1.1`;
- snapshot seguro do DOM/URL antes e depois de cada ação;
- validação de mudança de URL, presença do elemento, estado, geometria e comprimento textual;
- fingerprints determinísticos para identificar estados repetidos;
- limite configurável de repetição, padrão 2 e máximo 5;
- parada com `LOOP_DETECTED` ao detectar repetição do mesmo estado de ação;
- atraso de validação configurável, padrão 100 ms e máximo 2 s;
- preservados os guardrails da Fase 16.8;
- teste dedicado cobrindo mudança pós-ação e prevenção de loops.

### Decisão arquitetural
A validação permanece dentro do executor e usa somente `chrome.scripting.executeScript` com funções fixas. O plano continua sem capacidade de fornecer JavaScript arbitrário. Os snapshots coletam apenas metadados seguros do DOM, URL e estado visual básico do alvo.

### Próximos passos
1. Teste integrado do ciclo Planner → Executor → novo DOM/Network snapshot.
2. Kill switch operacional e limites de sessão.
3. Validação E2E final do agente autônomo.

### Fase 16.10 — Ciclo integrado Planner → Executor → Snapshot
Implementada na branch `feat/devtrail-autonomous-cycle-phase-10`:
- `extension/autonomous_cycle.js`;
- ciclo único que gera plano, executa sob autorização explícita e captura novo snapshot DOM;
- coleta delta de Network da sessão entre o início e o fim da execução;
- exposição via `DEVTRAIL_AUTONOMOUS_CYCLE` no agente;
- validação da aba alvo e sessão continuam obrigatórias;
- execução permanece limitada pelos guardrails do executor;
- scanner DOM é usado como etapa pós-ação;
- teste integrado dedicado e inclusão no CI;
- `background.js` carrega o novo módulo explicitamente.

### Decisão arquitetural
O ciclo não substitui Planner, Executor, Scanner ou captura Network. Ele apenas orquestra os contratos existentes, mantendo cada componente testável isoladamente. O ciclo só executa quando `execute: true` é informado.

### Próximos passos
1. Kill switch operacional e limites de sessão.
2. E2E final do agente autônomo.

### Fase 16.11 — Kill switch e limites operacionais
Implementada na branch `feat/devtrail-autonomous-guardrails-phase-11`:
- kill switch explícito via `DEVTRAIL_AUTONOMOUS_KILL`;
- limite padrão de sessão de 15 minutos, configurável até 30 minutos;
- limite padrão de 10 ciclos autônomos por sessão, máximo 50;
- limite padrão de 50 ações executadas por sessão, máximo 200;
- bloqueio de ciclo concorrente;
- bloqueio quando o kill switch está ativo;
- bloqueio quando os limites de ciclos ou ações foram atingidos;
- contadores de ciclos e ações expostos no estado/resultado;
- encerramento automático ao atingir o tempo máximo de sessão;
- testes do agente cobrindo kill switch e limites;
- preservados os guardrails das fases 16.8, 16.9 e 16.10.

### Decisão arquitetural
Os limites são aplicados no agente, acima do executor, para impedir que múltiplas chamadas ao ciclo contornem o limite individual de ações do executor. O kill switch utiliza o mesmo caminho de `stop()`, garantindo liberação do debugger e limpeza da sessão.

### Próximos passos
1. Validação E2E final do agente autônomo.
2. Teste operacional no Chrome/portal com uma página real.

### Fase 16.12 — E2E final do agente autônomo
Implementada na branch `feat/devtrail-autonomous-e2e-phase-12`:
- teste `tests/test_devtrail_autonomous_final_e2e.js` cobrindo o fluxo completo;
- inicialização da sessão e attach CDP;
- habilitação Network/Runtime/Page;
- construção do System Map a partir do snapshot DOM;
- Planner real gerando ação a partir do mapa;
- Executor real realizando ação controlada com validação pós-ação;
- novo DOM Snapshot após a ação;
- contadores de ciclo/ações;
- kill switch e encerramento limpo da sessão;
- inclusão do teste e syntax check no CI.

### Critério de conclusão
Com o CI verde desta fase, a cadeia autônoma fica coberta de ponta a ponta em teste determinístico: `START → CDP → DOM Map → Planner → Executor → pós-ação → novo Snapshot → limites → KILL`.

### Próximos passos
- Após o merge, executar validação operacional manual da extensão no Chrome contra uma página HTTP/HTTPS real.
- Corrigir somente problemas observados nessa validação, preservando o baseline testado.

### Fase 16.13 — Painel operacional do agente autônomo
Implementada na branch `feat/devtrail-autonomous-control-panel-phase-13`:
- `extension/popup.html` como painel operacional da extensão;
- `extension/popup.js` com ações Iniciar, Mapear DOM, Construir mapa, Executar ciclo, Status e Kill Switch;
- descoberta automática da aba ativa com possibilidade de informar `tabId` manualmente;
- execução sempre através das mensagens do agente, preservando os guardrails existentes;
- `DEVTRAIL_AUTONOMOUS_STATUS` e `DEVTRAIL_AUTONOMOUS_STOP` expostos diretamente pelo agente;
- `manifest.json` aponta `popup.html` como popup da extensão;
- teste estático do painel e syntax check incluídos no CI.

### Próximos passos
1. CI verde da Fase 16.13.
2. Carregar a extensão como "Load unpacked" no Chrome e validar uma página HTTP/HTTPS real.
3. Corrigir somente problemas observados no teste operacional.

### Fase 16.14 — Persistência de evidências do ciclo autônomo
Implementada na branch `feat/devtrail-autonomous-evidence-persistence-phase-14`:
- o snapshot DOM pós-ação do ciclo agora é incorporado ao `systemMap` persistente da sessão;
- eventos Network novos produzidos durante o ciclo também são incorporados ao mapa;
- nova operação `addNetworkEvents` com deduplicação determinística;
- resultado do ciclo informa o que foi persistido e os totais atuais do mapa;
- teste do System Map ampliado para validar inserção e atualização de evidência Network;
- não altera o contrato do Planner, Executor ou Cycle;
- mantém redaction e limites da captura Network existentes.

### Decisão arquitetural
O ciclo continua recebendo um mapa finalizado para planejamento, mas a persistência da evidência ocorre no objeto `systemMap` original mantido pelo agente. Assim, ciclos sucessivos acumulam evidências sem depender de estado global externo.

### Próximos passos
1. CI da Fase 16.14.
2. Teste operacional no Chrome usando o painel da Fase 16.13.
3. Ajustes finais somente se o teste real revelar incompatibilidades.

### Fase 16.15 — Exportação operacional de evidências
Implementada na branch `feat/devtrail-operational-export-phase-15`:
- nova mensagem `DEVTRAIL_AUTONOMOUS_EXPORT`;
- exportação do `systemMap` atual em JSON;
- exportação do mesmo mapa em Markdown determinístico;
- controles de exportação adicionados ao painel operacional;
- downloads locais no navegador, sem envio externo dos dados;
- teste do painel atualizado;
- nenhum novo mecanismo de execução foi introduzido.

### Decisão arquitetural
A exportação ocorre sobre o mapa já mantido pela sessão. O popup apenas solicita o formato e grava localmente o conteúdo retornado; não altera a coleta, execução ou redaction.

### Próximos passos
1. CI da Fase 16.15.
2. Teste operacional completo no Chrome.
3. Consolidar o agente autônomo como módulo operacional estável após a validação real.


### Fase 17 — Leitura profunda OCR + IA para documentos
Implementada em branch `feat/deep-document-ocr-reader`:
- criado endpoint `POST /api/deep-extract` para PDF, DOCX, PPTX e XLSX;
- criado motor dedicado `MarkItDown(enable_plugins=True, llm_client, llm_model, llm_prompt)` para forçar a rota OCR/visão quando o usuário solicitar leitura profunda;
- prompt especializado para preservar texto integral, estrutura, tabelas, cabeçalhos, rodapés, carimbos e conteúdo de páginas escaneadas, sem resumir ou inventar texto;
- exposto `deepExtract()` no `MarkItDownEngine` do frontend;
- adicionada ação `deepExtractItem()` ao `ConversionController`;
- botão `Leitura profunda (OCR + IA)` no preview e ação de OCR na fila para formatos compatíveis;
- resultado registra `engine=markitdown-ocr-deep` e `extractionMode=deep-ocr-ai`;
- falha do OCR não substitui silenciosamente o resultado anterior: o usuário recebe mensagem explícita;
- testes de API, conversão e contrato do portal atualizados.

### Decisão arquitetural
A conversão normal continua rápida e preserva o fluxo atual. A leitura profunda é um segundo estágio deliberadamente acionado pelo usuário quando identificar conteúdo ausente ou insuficiente. O estágio utiliza o plugin `markitdown-ocr`, que suporta OCR de imagens incorporadas e fallback de página inteira para PDFs escaneados, usando LLM Vision. O frontend não envia o documento diretamente ao provedor de IA; o arquivo é enviado ao backend configurado, que executa o estágio OCR.

### Próximos passos
1. CI da Fase 17.
2. Teste real com o PDF judicial anexado, verificando se o texto das páginas 1–5 é recuperado integralmente.
3. Ajustar somente se a execução real revelar perda de layout, tabelas ou texto.
