const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || '';

export async function sendWhatsApp(phone, message) {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN) {
    console.warn('[WhatsApp] ZAPI credentials not set — skipping');
    return null;
  }

  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean || clean.length < 10) {
    console.warn('[WhatsApp] Invalid phone:', phone);
    return null;
  }

  const formatted = clean.startsWith('55') ? clean : `55${clean}`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (ZAPI_CLIENT_TOKEN) headers['Client-Token'] = ZAPI_CLIENT_TOKEN;

    const res = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone: formatted, message }),
      }
    );

    const result = await res.json();
    if (!res.ok) {
      console.error('[WhatsApp] Error:', result);
      return null;
    }
    console.log('[WhatsApp] Sent to', formatted);
    return result;
  } catch (err) {
    console.error('[WhatsApp] Exception:', err);
    return null;
  }
}
