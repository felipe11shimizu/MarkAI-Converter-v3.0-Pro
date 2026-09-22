# MarkAI Converter v3.1 Pro

Portal web para conversão, organização, edição, pré-visualização e consolidação de documentos em Markdown.

## Arquitetura híbrida

A versão 3.1 adiciona o **Microsoft MarkItDown** como motor principal opcional no backend, mantendo os conversores JavaScript existentes como fallback automático.

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

- `POST /api/convert-url` aceita YouTube diretamente pelo conversor de transcrição do MarkItDown.
- Para páginas e documentos públicos, o backend baixa o conteúdo com `httpx`, valida DNS/endereço IP e bloqueia destinos privados ou reservados.
- Redirecionamentos são controlados e limitados por `MARKAI_URL_MAX_REDIRECTS`.
- O conteúdo remoto possui limite de tamanho (`MARKAI_MAX_URL_MB`) e timeout (`MARKAI_URL_TIMEOUT_SECONDS`).
- HTML, PDF, TXT, Markdown, JSON, CSV e XML são identificados por `Content-Type` ou extensão antes de serem entregues ao MarkItDown.
- URLs com usuário/senha embutidos são rejeitadas.

Essa camada reduz a dependência de proxies públicos e concentra a política de acesso a URLs no backend. Para exposição pública, autenticação, rate limiting e isolamento do processo continuam recomendados.

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

Depois abra o `index.html` no navegador. Em **Configurações**, mantenha:

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
- `MARKAI_URL_MAX_REDIRECTS`: máximo de redirecionamentos. Padrão: 3.

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

- Adicionar suporte de OCR do pacote `markitdown-ocr` para documentos digitalizados e imagens.
- Adicionar PowerPoint, EPUB, ZIP e imagens como tipos de primeira classe na interface.
- Criar testes automatizados para cada formato.
- Criar fila de conversão server-side para lotes muito grandes.
- Adicionar autenticação/rate limiting antes de exposição pública.
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

### Fase 5 — Modularização — PRÓXIMA
Dividir o `script.js` em módulos de estado, fila, parsers, serviços, merge, IA e UI sem alterar o comportamento funcional.

### Fase 6 — CI/CD e testes de regressão — IMPLANTADA
- GitHub Actions.
- testes automatizados do backend.
- validação sintática do JavaScript.
- próximos incrementos: cobertura dos formatos, arquivos grandes e testes de segurança.
- GitHub Actions.
- testes dos principais formatos.
- testes de arquivos grandes.
- lint e validação JavaScript.
- testes de segurança.

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
