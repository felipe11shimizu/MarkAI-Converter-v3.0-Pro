# Validação E2E de produção — MarkAI Converter

## Ambiente
- Portal: GitHub Pages
- Backend: Google Cloud Run
- Serviço: `markai-converter-v3-0-pro`
- Região: `europe-west1`
- Backend atual: `3.6.0`
- Commit de referência: `74eccc3a4fbc0a07fdf0cc276b22209223367096`

## Checklist funcional
### 1. Backend
- [ ] `/api/health` retorna `ok=true`.
- [ ] YouTube habilitado.
- [ ] Gemini YouTube habilitado.
- [ ] Modelo Gemini informado.
- [ ] CORS permite o portal publicado.

### 2. Portal público
- [ ] `frontend/config.js` carrega antes de `core_state.js`.
- [ ] endpoint público é preenchido automaticamente.
- [ ] endpoint salvo vazio/localhost é substituído no navegador público.
- [ ] `?backend=...` continua funcionando para testes.

### 3. YouTube
- [ ] URL pública é reconhecida.
- [ ] tentativa de transcript ocorre primeiro.
- [ ] falha do transcript aciona fallback `/api/youtube/gemini`.
- [ ] Gemini recebe a URL pública do vídeo.
- [ ] Markdown é carregado no editor.
- [ ] idioma/origem do resultado são exibidos.

### 4. Documentos
- [ ] conversão normal de PDF.
- [ ] conversão normal de DOCX/PPTX/XLSX.
- [ ] leitura profunda somente quando OCR/IA estiver configurado.
- [ ] falha de OCR não substitui silenciosamente o resultado anterior.

### 5. Downloads
- [ ] Markdown individual.
- [ ] ZIP da fila.
- [ ] exportação JSON.
- [ ] exportação Markdown do DevTrail.
- [ ] nomes e extensões preservados.
- [ ] nenhum download é salvo com UUID quando a aplicação fornece nome explícito.

### 6. DevTrail
- [ ] extensão carregada como unpacked.
- [ ] painel operacional abre.
- [ ] sessão pode iniciar/parar.
- [ ] scanner DOM funciona.
- [ ] mapa é construído.
- [ ] ciclo controlado respeita autorização.
- [ ] kill switch encerra a sessão.
- [ ] exportações funcionam.

## Regra de correção
Falhas encontradas nesta validação devem ser corrigidas isoladamente, em branch própria, com teste/regressão e CI antes do merge.