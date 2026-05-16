# Guia de Setup — Clone Solare

## Visão Geral

Este projeto usa:
- **Vercel** — hospedagem do site + API serverless
- **Supabase** — banco de dados (tabela `orders`)
- **Mercado Pago** — processamento de pagamentos (PIX + Cartão)
- **Resend** — envio de emails transacionais
- **Twilio** — SMS de confirmação (opcional)

---

## Passo 1 — Supabase

1. Acesse [supabase.com](https://supabase.com) → **New Project**
2. Defina nome, senha do banco e região (preferencialmente São Paulo)
3. Aguarde o projeto inicializar (~1 min)
4. Acesse **SQL Editor → New Query**
5. Cole o conteúdo de `supabase-schema.sql` e clique em **Run**
6. Vá em **Project Settings → API** e copie:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret → `SUPABASE_SERVICE_ROLE_KEY`

---

## Passo 2 — Mercado Pago

1. Acesse [mercadopago.com.br](https://mercadopago.com.br) com a nova conta
2. Vá em **Suas integrações → Credenciais de produção**
3. Copie:
   - **Access Token** → `MP_ACCESS_TOKEN`
   - **Public Key** → `MP_PUBLIC_KEY`
4. Configure o **Webhook** (após fazer o deploy no Vercel):
   - URL: `https://seudominio.com.br/api/mp-webhook`
   - Eventos: `payment`
   - Copie o **Secret** gerado → `MP_WEBHOOK_SECRET`

---

## Passo 3 — Resend (emails)

1. Acesse [resend.com](https://resend.com) → **API Keys → Create API Key**
2. Copie a chave → `RESEND_API_KEY`
3. Vá em **Domains → Add Domain** e verifique seu domínio
4. Defina `FROM_EMAIL` como `pedidos@seudominio.com.br`

---

## Passo 4 — Deploy no Vercel

1. Acesse [vercel.com](https://vercel.com) → **Add New Project → Import Git Repository**
2. Faça push deste projeto para um repositório GitHub novo (conta diferente ou repo privado)
3. Importe o repositório no Vercel
4. Em **Environment Variables**, adicione todas as variáveis do `.env.example` preenchidas
5. Clique em **Deploy**

### Atualizar o CORS (vercel.json)

Abra `vercel.json` e substitua `SEU_DOMINIO_AQUI` pelo seu domínio real:

```json
{ "key": "Access-Control-Allow-Origin", "value": "https://seudominio.com.br" }
```

Faça commit + push após essa alteração.

---

## Passo 5 — Configurar Webhook no MP

Após o deploy estar no ar:

1. No painel do Mercado Pago → **Suas integrações → Webhooks**
2. Adicione a URL: `https://seudominio.com.br/api/mp-webhook`
3. Selecione o evento **Pagamentos**
4. Copie o **Signing Secret** e adicione como `MP_WEBHOOK_SECRET` nas env vars do Vercel
5. Redeploy (ou aguarde o próximo deploy automático)

---

## Variáveis de Ambiente (resumo)

| Variável | Onde pegar | Obrigatória |
|---|---|---|
| `SITE_URL` | Seu domínio | ✅ |
| `SUPABASE_URL` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | ✅ |
| `MP_ACCESS_TOKEN` | Mercado Pago → Credenciais | ✅ |
| `MP_PUBLIC_KEY` | Mercado Pago → Credenciais | ✅ |
| `MP_WEBHOOK_SECRET` | Mercado Pago → Webhook | ✅ |
| `RESEND_API_KEY` | resend.com → API Keys | ✅ |
| `FROM_EMAIL` | Seu e-mail verificado no Resend | ✅ |
| `WHATSAPP_NUMBER` | Seu número de suporte | ✅ |
| `TWILIO_ACCOUNT_SID` | twilio.com | Opcional |
| `TWILIO_AUTH_TOKEN` | twilio.com | Opcional |
| `TWILIO_PHONE_FROM` | twilio.com | Opcional |
| `META_PIXEL_TOKEN` | Facebook → Events Manager | Opcional |

---

## Checklist Final

- [ ] Schema criado no Supabase
- [ ] Credenciais do MP preenchidas no Vercel
- [ ] `SITE_URL` configurada
- [ ] `vercel.json` com seu domínio no CORS
- [ ] Webhook do MP apontando para `/api/mp-webhook`
- [ ] Domínio verificado no Resend
- [ ] Teste de compra com PIX (sandbox ou valor mínimo real)
