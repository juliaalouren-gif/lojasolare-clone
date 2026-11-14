/**
 * Brevo (ex-Sendinblue) — sincronização de contatos para automação de
 * e-mail marketing. As automações (e-mails, atrasos, segmentação) são
 * montadas direto no painel da Brevo; aqui só mantemos os contatos e
 * listas atualizados conforme o cliente avança no funil.
 */

const BREVO_API_KEY = process.env.BREVO_API_KEY;

export const BREVO_LISTS = {
  CARRINHO_ABANDONADO: 3,
  PIX_PENDENTE: 4,
  CLIENTES_APROVADOS: 5,
};

/**
 * Cria ou atualiza um contato na Brevo e o adiciona às listas informadas.
 * Nunca lança erro para cima — falha na Brevo não pode derrubar o fluxo
 * principal de compra.
 */
export async function upsertBrevoContact({ email, name, phone, attributes = {}, listIds = [] }) {
  if (!BREVO_API_KEY) {
    console.warn('[Brevo] BREVO_API_KEY não configurada, pulando.');
    return;
  }
  if (!email) return; // Brevo identifica o contato pelo e-mail

  const nameParts = String(name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const smsPhone = phone ? '+55' + String(phone).replace(/\D/g, '') : undefined;

  const payload = {
    email,
    updateEnabled: true,
    attributes: {
      ...(firstName && { NOME: firstName }),
      ...(lastName && { SOBRENOME: lastName }),
      ...(smsPhone && { SMS: smsPhone, WHATSAPP: smsPhone }),
      ...attributes,
    },
    ...(listIds.length && { listIds }),
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      console.error('[Brevo] Erro ao sincronizar contato:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('[Brevo] Exceção ao sincronizar contato:', e.message);
  }
}
