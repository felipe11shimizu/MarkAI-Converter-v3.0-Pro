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
