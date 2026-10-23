---
title: "Integração MarkAI Converter ↔ JARVIS Segundo Cérebro"
type: architecture
status: proposal
created: 2026-10-23
updated: 2026-10-23
tags: [jarvis, markdown, github, integration, security]
---

# Integração MarkAI Converter ↔ JARVIS Segundo Cérebro

## Objetivo

Permitir que o usuário transforme conversas, documentos, transcrições e conteúdos editados no MarkAI em notas Markdown revisadas e as registre no repositório privado `felipe11shimizu/jarvis-segundo-cerebro`.

## Estado verificado

- MarkAI Converter v3.6 Pro está no repositório `felipe11shimizu/MarkAI-Converter-v3.0-Pro`, branch `main`.
- O frontend já trabalha com Markdown, formatação de conversas, editor, fila, Workspace local via IndexedDB e exportação de documentos/ZIP.
- O backend FastAPI está configurado por `frontend/config.js` e já concentra operações de conversão.
- O repositório JARVIS é privado. O backend de produção não deve receber credenciais GitHub no frontend nem expor tokens em arquivos públicos.
- Não existe, nesta verificação, integração de gravação GitHub MarkAI → JARVIS confirmada.

## Fluxo funcional proposto

1. O usuário converte, formata ou edita conteúdo no MarkAI.
2. O usuário aciona explicitamente **Ensinar ao JARVIS**.
3. A interface mostra prévia do Markdown, título, categoria, destino sugerido, origem e classificação de sensibilidade.
4. O usuário revisa e confirma o conteúdo e o destino.
5. O backend autentica o usuário e envia o Markdown para o repositório privado por API oficial do GitHub.
6. O backend cria uma nota com nome de arquivo seguro e metadados de origem/data; nunca sobrescreve silenciosamente uma nota existente.
7. A interface exibe confirmação com link do arquivo e SHA do commit, ou erro acionável.

## Arquitetura de segurança obrigatória

- Não colocar PAT, GitHub App private key, OAuth client secret ou qualquer segredo em `index.html`, `script.js`, `frontend/config.js`, localStorage, arquivos Markdown ou logs.
- Usar autenticação GitHub no backend, preferencialmente GitHub App/OAuth com escopo mínimo e autorização explícita para o repositório-alvo.
- O backend deve aceitar apenas o repositório JARVIS configurado no servidor; o cliente não pode enviar owner/repo arbitrários.
- Não permitir gravação anônima no endpoint público. Exigir sessão autenticada e proteção contra CSRF/replay conforme o fluxo escolhido.
- Validar tamanho, tipo, título, caminho, conteúdo e destino; bloquear path traversal e sobrescrita sem confirmação.
- Sanitizar metadados e não interpretar conteúdo do Markdown como instruções executáveis.
- Não enviar automaticamente toda a fila ou Workspace. Apenas o documento explicitamente selecionado pelo usuário.
- Exibir uma prévia e exigir confirmação antes de publicar conteúdo no repositório privado.
- Excluir dados pessoais, credenciais, tokens e informação sigilosa; não armazenar conteúdo de produção sem autorização institucional.
- Registrar logs mínimos sem incluir o conteúdo completo do Markdown nem tokens.

## Categorias de destino

- `00-Inbox/`: captura inicial ainda não classificada.
- `10-Projetos/`: conhecimento específico de projeto.
- `20-Areas/`: rotinas e regras operacionais contínuas.
- `30-Rede-Colaboradores/`: colaboração e interfaces.
- `40-Entidades/`: entidades profissionais e sistemas.
- `50-Recursos-e-Modelos/`: modelos reutilizáveis.
- `90-Indices-Globais/`: decisões e riscos; somente com confirmação e governança apropriadas.

## Sequência de implementação

### Fase 1 — Contrato e segurança
- Escolher o fluxo de autenticação GitHub no backend.
- Configurar credenciais exclusivamente no ambiente de execução/Secret Manager.
- Definir os escopos mínimos e restringir a integração ao repositório JARVIS.
- Criar testes de autorização, destinos proibidos, limites, duplicidade e ausência de segredos.

### Fase 2 — Backend
- Implementar endpoint autenticado para validar a sessão e obter o usuário autorizado.
- Implementar endpoint de prévia/validação sem escrita.
- Implementar criação de arquivo Markdown usando a API de Contents do GitHub.
- Tratar conflitos com nome alternativo ou confirmação explícita; nunca substituir em silêncio.

### Fase 3 — Interface MarkAI
- Adicionar botão “Ensinar ao JARVIS” no editor de Markdown.
- Adicionar modal de prévia com título, categoria, destino e metadados.
- Exigir confirmação de gravação e mostrar resultado/link do arquivo.
- Manter exportação local como alternativa se a conexão não estiver configurada.

### Fase 4 — Testes e publicação
- Testar usuário não autenticado, usuário autorizado, conteúdo vazio, arquivo duplicado, caminho inválido, tamanho excessivo e falha da API GitHub.
- Rodar a suíte de testes existente e acrescentar testes de contrato.
- Validar deployment e segredos no Cloud Run antes de ativar o recurso em produção.

## Dependências pendentes

- Decidir/configurar GitHub App ou OAuth app para autenticação segura.
- Configurar secrets no backend de produção (fora do repositório).
- Confirmar política de acesso ao repositório JARVIS e o fluxo de revisão/publicação.
- Implementar e testar o código; este documento, por si só, não ativa a integração.

## Critério de conclusão

A integração só será considerada ativa após autenticação real, gravação de uma nota de teste aprovada no repositório privado, leitura de retorno do arquivo e confirmação do commit, com a suíte de testes passando.