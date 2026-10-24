# Integridade de dados e robustez de processamento

Status: controles implementados parcialmente na branch `feature/jarvis-bridge-backend`. Este documento separa garantias existentes de itens ainda não validados em produção.

## 1. Fontes de persistência

- **Workspace do MarkAI:** IndexedDB no navegador do usuário. Não é um banco central nem sincroniza automaticamente entre dispositivos. Dados locais podem ser removidos pelo navegador, perfil ou limpeza de armazenamento.
- **Conhecimento do JARVIS:** arquivos Markdown no repositório privado GitHub `felipe11shimizu/jarvis-segundo-cerebro`; o histórico de commits fornece rastreabilidade das notas publicadas.
- **Backend FastAPI:** processa conversões e chamadas de integração; arquivos temporários locais não devem ser tratados como armazenamento durável.
- Não foi introduzido banco relacional central. Não se deve afirmar que existe backup central do Workspace.

## 2. Controles implementados nesta branch

### IndexedDB / Workspace
- Abertura do banco reinicializa a promessa de conexão quando falha e fecha a conexão em `versionchange`.
- Operações de escrita aguardam o término da transação, não apenas o sucesso de uma requisição individual.
- `saveQueue` substitui a fila em uma única transação entre `documents` e `projects`: se a transação falhar, o navegador deve reverter o conjunto em vez de deixar a fila parcialmente apagada.
- `saveQueue` valida o formato da fila, IDs obrigatórios e duplicidade de IDs antes de iniciar a transação.
- A gravação da fila exige projeto existente, evitando registros órfãos.
- `deleteProject` apaga projeto, documentos, versões e histórico de IA numa única transação entre stores.

### Publicação MarkAI → JARVIS
- Repositório de destino e categorias são definidos no backend; o cliente não pode escolher outro repositório.
- A publicação exige sessão autenticada, conteúdo não vazio, limite de 100 KB e confirmação explícita.
- A implementação recusa sobrescrever arquivo com o mesmo caminho e retorna conflito quando já existe.
- A credencial GitHub de escrita é lida apenas do ambiente do servidor; não deve ser enviada ao navegador.
- A criação do arquivo e o commit são uma única operação na API de conteúdo do GitHub. Não há gravação de teste em produção ainda.

### Processamento
- O backend já define limites de tamanho, timeouts e limites de redirecionamento em rotas de conversão/URL/vídeo. Esses limites precisam ser testados por endpoint; sua existência em código, isoladamente, não comprova robustez operacional.
- O recurso JARVIS é opt-in: não publica automaticamente fila, histórico de IA ou Workspace completo.

## 3. Riscos e itens obrigatórios antes de produção

1. **Recuperação do Workspace:** implementar e testar exportação/importação com validação de schema e integridade; orientar backup local periódico. IndexedDB não substitui backup.
2. **Testes reais de transação:** usar um navegador headless e IndexedDB real para simular quota/abort, falha de escrita, concorrência entre abas, fechamento/upgrade e verificar que a fila anterior permanece íntegra.
3. **Migrações:** quando `DB_VERSION` mudar, incluir migração explícita, compatibilidade com dados antigos e testes de upgrade; nunca apagar stores sem estratégia de migração.
4. **Observabilidade:** medir duração, tamanho e taxa de falha por etapa; não registrar conteúdo de documentos, tokens, prompts ou dados pessoais nos logs.
5. **Filas de processamento:** definir estados explícitos (`pending`, `processing`, `succeeded`, `failed`), tentativas limitadas, backoff, cancelamento e prevenção de processamento duplicado antes de implementar processamento assíncrono durável.
6. **Limites de recursos:** testar uploads grandes, arquivos malformados, conversões que excedam timeout, respostas remotas sem `Content-Length`, redirecionamentos e consumo de memória/CPU.
7. **SSRF/DNS:** validar destinos remotos em cada redirecionamento e testar proteção contra IPs privados/reservados e mudanças de resolução DNS. Não considerar a validação atual prova suficiente contra DNS rebinding sem teste dedicado.
8. **Autenticação JARVIS:** configurar OAuth e segredos no Secret Manager, limitar o token de escrita ao repositório, executar testes ponta a ponta e revisar expiração/revogação de sessão antes de ativar.
9. **Concorrência de publicação:** testar duas tentativas simultâneas para o mesmo caminho e garantir que uma única criação seja aceita, sem sobrescrita.
10. **Recuperação/continuidade:** documentar como restaurar Markdown via histórico Git e como recuperar Workspace local a partir de exportação.

## 4. Critérios de aceite

- CI backend e frontend verdes na revisão final.
- Testes automatizados de contrato e integração passando.
- Testes de navegador confirmam atomicidade da fila e deleção do projeto.
- Nenhuma credencial presente em frontend, logs ou arquivos versionados.
- Teste ponta a ponta em ambiente controlado confirma autenticação, prévia, confirmação, conflito de duplicidade e leitura do commit criado.
- Falhas de processamento não deixam documentos em estado enganoso nem apagam dados anteriores.
- Produção só é ativada após configuração, revisão de segurança e aprovação explícita.

## 5. Limite da evidência

A aprovação do CI demonstra apenas que os testes incluídos passaram naquele commit. Ela não equivale a teste de carga, recuperação de dados, segurança ofensiva, disponibilidade do Cloud Run ou validação de ponta a ponta em produção.
