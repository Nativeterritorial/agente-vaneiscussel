# Agente Imobiliária — Base

Template de agente WhatsApp para imobiliárias. Roda no Railway, conecta no WhatsApp via Z-API, qualifica leads, busca imóveis na planilha Google Sheets e transfere pro corretor humano nos momentos certos.

Construído com base no aprendizado dos agentes da Favero (n8n) e da NATIVE (Node.js).

## Como onboardar uma nova imobiliária (15 min)

### 1. Fork ou clone deste repo

No GitHub, crie um repo `agente-<nome-imobiliaria>` baseado neste template.

### 2. Crie a planilha de imóveis no Google Sheets

Use [planilha-imoveis-modelo.csv](planilha-imoveis-modelo.csv) como referência.

Colunas obrigatórias:
- `codigo, tipo, finalidade, bairro, cidade, dormitorios, suites, vagas, area_util, area_total, preco, descricao, caracteristicas, fotos, status, corretor_responsavel`

Publique a planilha:
- Arquivo → Compartilhar → Publicar na web → CSV → copiar URL

### 3. Crie `cliente.json`

Copie [cliente.example.json](cliente.example.json) → `cliente.json` e edite com:
- Nome da imobiliária, cidade, horário
- Nome do agente (Sofia, Léo, Bia...)
- Lista de corretores com telefones (formato `5554999991111`)
- URL da planilha publicada (passo 2)
- FAQ específica da imobiliária

### 4. Crie instância Z-API

- Conta nova ou novo número no Z-API
- Anote: `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN` (Account Security Token)

### 5. Deploy no Railway

- New Service → Deploy from GitHub → escolha o repo
- Adicione **Volume** mount path `/data`
- Adicione variáveis (Variables):
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ZAPI_INSTANCE=...
  ZAPI_TOKEN=...
  ZAPI_BASE=https://api.z-api.io/instances/INSTANCE/token/TOKEN
  ZAPI_CLIENT_TOKEN=...
  DATA_DIR=/data
  ```
- Settings → Networking → Generate Domain
- Copie a URL gerada (ex: `agente-imobiliaria-x-production.up.railway.app`)

### 6. Configure webhook Z-API

No painel Z-API:
- Webhook "Ao receber" → `https://SEU-DOMINIO.railway.app/webhook`
- Marca "Notificar mensagens enviadas pelo próprio número" pra silenciar agente quando corretor responder manual

### 7. Pronto

- Cliente manda mensagem → agente atende
- Agente busca imóveis na planilha → mostra 2-3
- Lead pede visita → transfere pro corretor responsável

## Manutenção

- **Atualizar imóveis:** edite a planilha. O agente recarrega a cada 5 min.
- **Adicionar/remover corretor:** edite `cliente.json` e faça push (Railway redeploya).
- **Mudar prompt/regras:** edite `system-prompt.js` ou as flags em `cliente.json` → push.
- **Pausa manual:** quando corretor responder pelo WhatsApp da imobiliária, agente fica 7 dias em silêncio na conversa. Pode reativar com `/agente on`.

## Próximos passos do template

- [ ] Recebimento e arquivamento de PDFs (ex: comprovante de renda)
- [ ] Agendamento integrado com Google Calendar
- [ ] Transcrição de áudio via Whisper
- [ ] Painel web de leads
- [ ] Multi-tenant (mesma deploy serve N imobiliárias)
