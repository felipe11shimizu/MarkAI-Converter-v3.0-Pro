# MarkAI Converter v3.6 Pro

Portal web para conversão, organização, edição, pré-visualização e consolidação de documentos em Markdown.

## Arquitetura híbrida

A versão 3.6 consolida o **Microsoft MarkItDown** como motor principal opcional no backend, mantendo os conversores JavaScript existentes como fallback automático.

Fluxo:

1. Usuário adiciona o arquivo no portal.
2. O frontend verifica rapidamente se o backend MarkItDown está disponível.
3. Se estiver disponível, o arquivo é enviado para `POST /api/convert`.
4. O backend converte com `MarkItDown.convert_local()`.
5. O Markdown retornado entra na mesma fila, preview, editor, merge, ZIP e fluxo de IA já existentes.
6. Se o backend estiver indisponível ou falhar, o conversor original do navegador assume automaticamente.

O projeto, portanto, continua funcionando como aplicação estática mesmo sem Python/MarkItDown.

## Motor de URLs

A partir da v3.3, a ingestão de URLs também passa pelo backend MarkItDown. O frontend não depende mais de proxies CORS públicos para esse fluxo.

- \`POST /api/convert-url\` mantém a ingestão genérica e usa o motor dedicado de YouTube como primeira tentativa para URLs do YouTube.
- \`POST /api/youtube/resolve\` normaliza uma URL e retorna Video ID, URL canônica e tipo.
- \`POST /api/youtube/transcripts\` lista as faixas de legenda disponíveis, indicando idioma, legenda manual/automática e possibilidade de tradução.
- \`POST /api/youtube/transcribe\` retorna transcript normalizado com timestamps, qualidade e Markdown.
- O provider principal é \`youtube-transcript-api\` e existe fallback para o conversor YouTube do MarkItDown no endpoint genérico.
- O provider separa URL, descoberta de legendas, normalização, qualidade e geração de Markdown para permitir evolução sem acoplamento.
- Cache em memória é aplicado ao transcript por vídeo/idioma/tradução, controlado por \`MARKAI_YOUTUBE_CACHE_TTL_SECONDS\`.
- Para ambientes em que o IP de execução sofre bloqueios do YouTube, proxies HTTP/HTTPS podem ser configurados por \`MARKAI_YOUTUBE_HTTP_PROXY\` e \`MARKAI_YOUTUBE_HTTPS_PROXY\`.

## O que o MarkItDown acrescenta

O MarkItDown é uma biblioteca Python da Microsoft voltada à conversão de arquivos para Markdown para uso em LLMs e análise de conteúdo. A documentação oficial informa suporte a PDF, PowerPoint, Word, Excel, imagens, áudio, HTML, CSV, JSON, XML, ZIP, EPUB e outros formatos. 

Referência oficial: https://github.com/microsoft/markitdown

## Principais melhorias desta versão

- Motor MarkItDown integrado sem remover os parsers existentes.
- Fallback automático para conversão no navegador.
- Endpoint configurável em **Configurações → Motor de Conversão**.
- Health check do backend com cache de 30 segundos.
- Limite de upload configurável por variável de ambiente.
- Uso de `convert_local()` no backend para restringir a conversão a arquivos locais temporários.
- Sanitização do HTML gerado pelo Markdown com DOMPurify.
- IDs da fila usando `crypto.randomUUID()` quando disponível.
- Correção do estado de `_previewRawMode`.
- Correção do cálculo de classe de extensão.
- Novos formatos disponibilizados na seleção de arquivos para aproveitar o MarkItDown.

## Portal publicado e acesso por celular

O portal é uma aplicação estática; recursos de **URL, YouTube e análise de vídeo** dependem do backend FastAPI. O valor padrão `http://localhost:8000` funciona somente quando o navegador e o backend estão na mesma máquina.

Para usar o portal publicado em outro dispositivo, configure o endpoint público em **Configurações → Motor de Conversão**. Também é possível abrir o portal com o parâmetro `?backend=https://SEU-BACKEND`; esse valor é usado como padrão quando não existe configuração salva no navegador.

Exemplo:

```
https://SEU-USUARIO.github.io/MarkAI-Converter-v3.0-Pro/?backend=https://SEU-BACKEND
```

O backend público deve permitir a origem do portal em `MARKAI_CORS_ORIGINS`. Para análise visual de YouTube, além disso, é necessário habilitar `MARKAI_YOUTUBE_VISUAL_ENABLED=true` e configurar uma chave de IA para a análise de vídeo.

## Executar o backend

Requer Python 3.10+.

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.app:app --reload --port 8000
```

### Windows CMD

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.app:app --reload --port 8000
```

Teste:

```
http://localhost:8000/api/health
```

Depois sirva a pasta do projeto por um servidor HTTP local (por exemplo, `python -m http.server 5500`) e abra `http://localhost:5500` no navegador. Em **Configurações**, mantenha:

```
Microsoft MarkItDown: ativado
Endpoint: http://localhost:8000
```

## Configuração do backend

Variáveis disponíveis:

- `MARKAI_MAX_UPLOAD_MB`: limite de upload. Padrão: 100 MB.
- `MARKAI_CORS_ORIGINS`: origens permitidas separadas por vírgula.
- `MARKAI_MAX_URL_MB`: limite para conteúdo remoto. Padrão: 20 MB.
- `MARKAI_URL_TIMEOUT_SECONDS`: timeout de acesso remoto. Padrão: 30 segundos.
- `MARKAI_URL_MAX_REDIRECTS`: máximo de redirecionamentos.
- `MARKAI_YOUTUBE_CACHE_TTL_SECONDS`: TTL do cache de transcripts. Padrão: 900 segundos.
- `MARKAI_YOUTUBE_HTTP_PROXY`: proxy HTTP opcional para o provider YouTube.
- `MARKAI_YOUTUBE_HTTPS_PROXY`: proxy HTTPS opcional para o provider YouTube.
- `MARKAI_YOUTUBE_VISUAL_ENABLED`: habilita a obtenção do vídeo do YouTube para análise visual. Padrão: `false`.
- `MARKAI_YOUTUBE_VISUAL_MAX_MB`: limite do arquivo de vídeo visual. Padrão: 150 MB.
- `MARKAI_YOUTUBE_VISUAL_MAX_DURATION_SECONDS`: duração máxima para análise visual. Padrão: 2700 segundos.
- `MARKAI_YOUTUBE_VISUAL_MAX_HEIGHT`: altura máxima do vídeo baixado para análise visual. Padrão: 480 px.

Exemplo:

```powershell
$env:MARKAI_MAX_UPLOAD_MB="200"
$env:MARKAI_CORS_ORIGINS="http://localhost:8000,http://127.0.0.1:5500"
uvicorn backend.app:app --reload --port 8000
```

## Segurança

O backend não aceita caminhos enviados pelo cliente; o nome do arquivo é reduzido ao nome-base e o conteúdo é gravado em arquivo temporário antes da conversão. O endpoint usa `convert_local()` em vez de permitir que a entrada do usuário seja tratada como uma URI arbitrária.

Para implantação pública, ainda é necessário adicionar autenticação, rate limiting, controle de origem mais restritivo, limites de memória/CPU, logs estruturados e isolamento do processo. A própria documentação do MarkItDown alerta que o processo de conversão possui os privilégios do processo que o executa e recomenda validação/restrição de entradas não confiáveis.

## IA

As funções de melhoria de Markdown por Gemini/OpenAI continuam independentes do MarkItDown. O MarkItDown é o **motor de ingestão/conversão**; a IA continua sendo a camada opcional de **pós-processamento**.

Arquitetura conceitual:

```
Arquivo
   ↓
MarkItDown (preferencial)
   ↓
Markdown normalizado
   ↓
Merge / Editor / Preview
   ↓
IA opcional
   ↓
Markdown final
   ↓
Download / ZIP
```

## Próximos passos recomendados

- Expandir testes automatizados por formato e cenários de arquivos grandes.
- Adicionar testes de segurança de frontend/DOM e regressão do Workspace.
- Adicionar autenticação e rate limiting antes de exposição pública.
- Criar fila de conversão server-side para lotes muito grandes.
- Migrar gradualmente o frontend monolítico de `script.js` para módulos.


## Roadmap de implantação

### Fase 1 — Fundação e segurança — IMPLANTADA
- MarkItDown como motor preferencial com fallback local.
- `convert_local()` no backend.
- allowlist de extensões, limite de upload e CORS configurável.
- DOMPurify no preview.
- IDs da fila com `crypto.randomUUID()`.
- health check e testes automatizados.

### Fase 2 — Motor documental avançado — IMPLANTADA
- Suporte via MarkItDown para PowerPoint, EPUB, ZIP, imagens e áudio, além dos formatos já existentes.
- endpoint `POST /api/convert-batch` para lotes.
- métricas básicas de conversão: tempo, caracteres, linhas, headings, tabelas e links.
- OCR opcional com `markitdown-ocr`, controlado por variável de ambiente.

O OCR oficial do ecossistema MarkItDown utiliza LLM Vision para PDF, DOCX, PPTX e XLSX. Ele é opt-in neste projeto porque adiciona custo e dependência de credenciais.

### Fase 3 — Qualidade e comparação — IMPLANTADA
- Exibir métricas de qualidade no frontend.
- Comparar MarkItDown x parser local lado a lado.
- Exibir divergência aproximada entre os resultados.
- Permitir selecionar e aplicar o resultado desejado.
- Identificar o motor utilizado na conversão da fila.

### Fase 3.5 — URL Engine — IMPLANTADA
- YouTube integrado ao MarkItDown pelo backend.
- Conversão de páginas/documentos remotos pelo backend, sem proxies CORS públicos.
- Validação de esquema, DNS/IP público, credenciais embutidas, tamanho, timeout e redirecionamentos.
- Testes automatizados para URL remota e bloqueio de destinos privados.

### Fase 4 — Workspace — IMPLANTADA
- Projetos persistentes no navegador via IndexedDB.
- Seleção, criação, renomeação e exclusão de projetos.
- Persistência da fila, ordem dos arquivos, resultados e motor utilizado.
- Versionamento manual do Markdown e versões geradas após IA.
- Prompt de IA por projeto e histórico de prompts/resultados.
- Histórico separado de versões e execuções de IA.
- Exportação do projeto em JSON ou ZIP, incluindo Markdown e versões.

### Fase 5 — YouTube Transcript Engine — IMPLANTADA
- parser de URL para watch, youtu.be, shorts, live e embed.
- provider dedicado `youtube-transcript-api` com fallback para MarkItDown no endpoint genérico.
- seleção de idiomas, tradução opcional, timestamps e normalização de segmentos.
- métricas de qualidade e cache em memória.
- endpoints `/api/youtube/resolve`, `/api/youtube/transcripts` e `/api/youtube/transcribe`.
- controles de YouTube no frontend.

### Fase 6 — Video Intelligence e automação — EM EVOLUÇÃO
- análise multimodal de vídeos locais com identificação de ações de tela.
- obtenção opcional de vídeos públicos do YouTube para análise visual via provider `yt-dlp`.
- correlação entre segmentos da transcrição e frames da mesma linha do tempo.
- identificação de sistema, tela, elementos, coordenadas, seletores, decisões, erros e pré/pós-condições.
- geração inicial de PyAutoGUI, Playwright, Selenium e RPA.
- modo YouTube separa transcrição leve da análise visual; quando a legenda falha, a análise visual pode continuar usando ASR, desde que a configuração de IA esteja disponível.
- matriz de evidência fala × frame × ação × decisão com correlação determinística no frontend.
- score operacional por etapa combinando confiança do modelo, evidência observável, qualidade do alvo e condições.
- validador de automação por plataforma com estados Pronta / Revisar / Bloqueada.
- bloqueio de geração para etapas sem revisão, com alertas somente após revisão explícita e bloqueios sempre impeditivos.
- proteção de dados sensíveis com placeholder {{DADO_SENSIVEL}} no editor e nas exportações JSON.


### Fase 7 — Modularização — EM EVOLUÇÃO
A modularização foi iniciada sem alterar o contrato funcional da aplicação:
- `frontend/modules/core_state.js`: estado reativo e gerenciamento da fila.
- `frontend/modules/markitdown_engine.js`: serviço de comunicação com o backend MarkItDown.
- `frontend/modules/workspace_store.js`: persistência IndexedDB de projetos, documentos, versões e histórico de IA.
- `frontend/modules/file_parser.js`: parsers locais de texto, código, PDF, DOCX, CSV, XLSX e JSON, com fallback do MarkItDown.
- `frontend/modules/url_fetcher.js`: serviço de ingestão e identificação de URLs.
- `frontend/modules/merge_engine.js`: orquestração da consolidação da fila.
- `frontend/modules/ai_engine.js`: serviço de pós-processamento com provedores de IA.
- `frontend/modules/conversion_quality.js`: métricas e comparação de qualidade.
- `frontend/modules/chat_formatter.js`: normalização de conversas em Markdown.
- `frontend/modules/ui_dom.js`: camada de apresentação responsável por referências DOM, helpers de escape/sanitização e metadados visuais.
- `video_automation_validator.js`: validador de automação já isolado anteriormente.
- `script.js` permanece como controlador de compatibilidade durante a migração, consumindo módulos por interfaces globais estáveis.
- A regra de dependência é unidirecional: infraestrutura/serviços não dependem da UI; controladores de UI dependem de serviços; o bootstrap apenas compõe as dependências.
- Extrações devem preservar contratos funcionais e ser acompanhadas de testes determinísticos no Node.js.
- Próxima frente: dividir o UIManager por casos de uso/controladores (workspace, queue/conversion, youtube/video, editor/preview, settings) e reduzir script.js a bootstrap + composição.

### Fase 6 — CI/CD e testes de regressão — IMPLANTADA
- testes determinísticos do validador de automação no Node.js executados no GitHub Actions.
- validação sintática do motor principal, do módulo de validação e cobertura dos cenários de locator, coordenada, ação incompatível, dado sensível e confiança.
- GitHub Actions.
- testes automatizados do backend.
- validação sintática do JavaScript.
- próximos incrementos: cobertura ampliada dos formatos, arquivos grandes e testes de segurança.

### OCR: observação operacional
A documentação atual do MarkItDown recomenda restringir entradas não confiáveis e usar a API mais estreita possível; este backend usa `convert_local()` e arquivos temporários.

O plugin OCR é recente e possui issues abertas em cenários específicos de PDF/DOCX. Por isso o recurso permanece opcional e o conversor convencional continua disponível como fallback.

### Configuração OCR

```powershell
$env:MARKAI_OCR_ENABLED="true"
$env:MARKAI_OCR_MODEL="gpt-4o"
$env:OPENAI_API_KEY="SUA_CHAVE"
uvicorn backend.app:app --reload --port 8000
```


### Validação adicional
- Os módulos UMD extraídos possuem exportação CommonJS para testes Node e exportação global para execução no navegador.
- `MergeEngine` foi desacoplado do `UIManager` por injeção de `renderQueue`, evitando dependência circular de inicialização.

### Arquitetura-alvo da Fase 7

```text
                 Presentation / UI
                 DOM · controllers · views
                           │
                 Application / Use Cases
                 convert · merge · workspace
                 enhance · youtube · export
                           │
                    Domain / Contracts
                 queue · document · result
                 validation · quality
                           │
                 Infrastructure / Adapters
                 IndexedDB · HTTP · MarkItDown
                 Gemini/OpenAI · parsers
```

Princípios:
1. Dependência aponta para dentro: serviços não importam UIManager.
2. Injeção de dependências: HTTP, armazenamento, relógio e renderização podem ser substituídos nos testes.
3. Casos de uso explícitos: convertFile, mergeQueue, enhanceMarkdown, saveWorkspace e generateAutomation não devem depender diretamente de eventos DOM.
4. Estado centralizado: AppState é a fonte de verdade; controllers traduzem eventos da interface para ações.
5. Adapters finos: WorkspaceStore, MarkItDownEngine, URLFetcher e AIEngine isolam APIs externas.
6. UI sem regra de negócio: DOM/renderização não decide política de conversão, validação ou persistência.
7. Bootstrap único: index.html carrega módulos; um bootstrap futuro compõe as dependências e inicializa a aplicação.
8. Migração incremental: cada extração mantém a aplicação executável e adiciona teste de contrato antes da próxima extração.

O primeiro passo dessa arquitetura foi concluído com a extração de frontend/modules/ui_dom.js, removendo referências DOM e helpers de apresentação do núcleo do UIManager sem alterar o fluxo funcional.