# Google Cloud Run — backend público do MarkAI Converter

O portal do MarkAI Converter é publicado como aplicação estática no GitHub Pages. O backend FastAPI/MarkItDown deve permanecer separado e ser executado no **Google Cloud Run**.

## Arquitetura

\`\`\`
GitHub Pages
  ↓ HTTPS
frontend/config.js
  ↓
Google Cloud Run
  ↓
FastAPI / MarkItDown
  ├─ /api/health
  ├─ /api/convert
  ├─ /api/convert-url
  ├─ /api/youtube/*
  ├─ /api/analyze-video
  └─ /api/deep-extract
\`\`\`

O \`frontend/config.js\` contém somente a URL pública do backend. Nenhuma chave de API é armazenada no repositório.

## Endpoint atualmente configurado

\`https://markai-converter-v3-0-pro-690234982000.europe-west1.run.app\`

O frontend também aceita um endpoint diferente pelo parâmetro:

\`\`\`
https://felipe11shimizu.github.io/MarkAI-Converter-v3.0-Pro/?backend=https://SEU-BACKEND
\`\`\`

Isso permite validar uma nova revisão/serviço sem alterar o código do portal.

## Configuração mínima do Cloud Run

O serviço precisa:

- aceitar tráfego HTTPS público para que o GitHub Pages consiga chamá-lo;
- permitir a origem \`https://felipe11shimizu.github.io\` em \`MARKAI_CORS_ORIGINS\`;
- executar o \`Dockerfile\` do repositório;
- respeitar a variável \`PORT\` fornecida pelo Cloud Run;
- manter os limites de upload e timeout adequados aos arquivos do portal.

O Cloud Run disponibiliza um endpoint HTTPS estável para cada serviço. Para uma API pública, a documentação oficial orienta habilitar acesso não autenticado.

## Variáveis não secretas

Configuração inicial recomendada:

\`\`\`
MARKAI_CORS_ORIGINS=https://felipe11shimizu.github.io
MARKAI_OCR_ENABLED=true
MARKAI_OCR_MODEL=gpt-4o
MARKAI_MAX_UPLOAD_MB=100
MARKAI_MAX_URL_MB=20
MARKAI_YOUTUBE_VISUAL_ENABLED=true
\`\`\`

A análise visual do YouTube só deve permanecer habilitada se a chave correspondente estiver configurada.

## Secrets

As chaves utilizadas pelo backend **não devem entrar no GitHub, Dockerfile ou frontend**.

Use Google Secret Manager e injete os secrets no Cloud Run, por exemplo:

- \`OPENAI_API_KEY\` — usado pelo Deep OCR e pelos recursos de IA do backend;
- \`MARKAI_VIDEO_API_KEY\` — opcional, quando for mantida uma chave separada para análise de vídeo;
- outros secrets futuros devem seguir o mesmo padrão.

A documentação atual do Google Cloud recomenda Secret Manager para API keys e permite expor um secret ao container como variável de ambiente, fixando uma versão específica quando possível.

## Deploy manual

A partir da raiz do repositório:

\`\`\`bash
gcloud run deploy markai-converter-v3-0-pro \\
  --source . \\
  --region europe-west1 \\
  --allow-unauthenticated
\`\`\`

Para um serviço novo, substitua o nome e a região pelos valores do projeto Google Cloud.

Antes do primeiro deploy, habilite os serviços necessários do Google Cloud e configure a conta de serviço do Cloud Run com acesso aos secrets utilizados.

## Validação pós-deploy

1. Abra:

\`\`\`
https://SEU-BACKEND/api/health
\`\`\`

2. Confirme \`"ok": true\`.
3. Abra o portal no GitHub Pages.
4. Faça um Ctrl+F5.
5. Em **Configurações → Motor de Conversão**, confirme que o endpoint público foi carregado.
6. Teste conversão de um PDF.
7. Teste **Leitura profunda (OCR + IA)** em um PDF/DOCX/PPTX/XLSX.
8. Teste uma URL/YouTube.
9. Teste análise de vídeo somente depois de validar a conversão e a transcrição.

## Segurança operacional

O serviço público não deve receber uma chave Gemini do usuário no backend: a chave Gemini continua sendo configurada no próprio portal e usada pelo navegador.

O Deep OCR é diferente: ele chama o modelo pelo backend e, portanto, a credencial OpenAI precisa existir no Cloud Run. Essa credencial deve ficar no Secret Manager.

Antes de aumentar os limites de upload ou expor o serviço a tráfego amplo, devem ser mantidos os controles já existentes de tamanho, extensões, URL pública e arquivos temporários. Rate limiting e autenticação de usuário são evoluções posteriores para reduzir abuso/custo.

## CI/CD

Já existe CI do projeto para backend e frontend. O deploy do Cloud Run deve continuar separado da validação de código:

\`\`\`
commit/PR
  ↓
GitHub Actions — testes
  ↓
main
  ↓
Cloud Run — nova revisão
  ↓
/api/health
  ↓
GitHub Pages
\`\`\`

Se o projeto usar a integração nativa GitHub → Cloud Run, mantenha essa integração como mecanismo de deploy. Se migrar para GitHub Actions, prefira Workload Identity Federation em vez de uma chave JSON de conta de serviço.
