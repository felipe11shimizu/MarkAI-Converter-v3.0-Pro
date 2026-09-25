# MarkAI Converter — Project State

## Baseline estável
- Branch: `main`
- Commit: `17a1d964a7506f9ab07f4991e0a0ea781754d571`
- Data do baseline: 2026-09-25
- CI do baseline: aprovado
- Fase 16.8 integrada

## Estado atual
A Fase 16.8 — Executor autônomo controlado está integrada na `main`.

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

## Fase 16 — Agente Autônomo de Exploração e Mapeamento

### Fases 16.1–16.8 — concluídas
- agente autônomo isolado e sessão CDP;
- scanner DOM semântico;
- captura Network/CDP com redaction;
- correlação DOM + Network;
- system_map JSON;
- system_map Markdown;
- planner determinístico observe-plan-only;
- executor controlado com guardrails.

### Fase 16.9 — Validação pós-ação e prevenção de loops
Implementada na branch `feat/devtrail-autonomous-validation-phase-9`:
- versão do executor elevada para `1.1`;
- snapshot DOM/URL antes e depois de cada ação;
- validação de mudança de URL, presença do elemento, estado, geometria e comprimento textual;
- fingerprints determinísticos para detectar estados repetidos;
- limite configurável de repetição, padrão 2 e máximo 5;
- parada imediata com `LOOP_DETECTED` quando o mesmo estado de ação se repete além do limite;
- atraso de validação configurável, padrão 100 ms e máximo 2 s;
- preservados os guardrails da Fase 16.8;
- teste dedicado cobrindo mudança pós-ação e loop.

### Decisão arquitetural
A validação pós-ação é feita dentro do executor usando somente `chrome.scripting.executeScript` com função fixa. O plano continua sem capacidade de fornecer JavaScript arbitrário. A validação observa apenas metadados seguros do DOM, URL e estado visual básico do alvo.

### Próximos passos
1. Integrar Planner → Executor → novo DOM/Network snapshot em teste de ciclo.
2. Adicionar kill switch operacional e limites de sessão.
3. Executar validação E2E final do agente autônomo.
