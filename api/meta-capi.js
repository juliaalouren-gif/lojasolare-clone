/**
 * Meta Conversions API (server-side pixel)
 * Pixel ID: 878359704804021
 */
import crypto from 'crypto';

const PIXEL_ID = '878359704804021';
const ACCESS_TOKEN = process.env.META_PIXEL_TOKEN;

function hash(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

/**
 * Send one or more events to Meta CAPI.
 * userData PII is automatically hashed.
 */
export async function sendMetaEvent({
  eventName,
  eventSourceUrl,
  userData = {},
  customData = {},
  eventId,
}) {
  if (!ACCESS_TOKEN) {
    console.warn('[Meta CAPI] META_PIXEL_TOKEN not set, skipping.');
    return;
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: eventSourceUrl || process.env.SITE_URL || '',
        ...(eventId && { event_id: eventId }),
        user_data: {
          ...(userData.email && { em: hash(userData.email) }),
          ...(userData.phone && { ph: hash('+55' + userData.phone.replace(/\D/g, '')) }),
          ...(userData.firstName && { fn: hash(userData.firstName) }),
          ...(userData.lastName && { ln: hash(userData.lastName) }),
          ...(userData.cpf && { external_id: hash(userData.cpf.replace(/\D/g, '')) }),
          ...(userData.city && { ct: hash(userData.city) }),
          ...(userData.state && { st: hash(userData.state.toLowerCase()) }),
          ...(userData.zip && { zp: hash(userData.zip.replace(/\D/g, '')) }),
          country: hash('br'),
        },
        custom_data: customData,
      },
    ],
    access_token: ACCESS_TOKEN,
  };

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${PIXEL_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[Meta CAPI] Error:', JSON.stringify(data));
    } else {
      console.log('[Meta CAPI]', eventName, 'sent. events_received:', data.events_received);
    }
  } catch (e) {
    console.error('[Meta CAPI] Exception:', e.message);
  }
}
