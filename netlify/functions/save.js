// v5 - SeaTable API-Gateway
const SEATABLE_SERVER = 'https://cloud.seatable.io';
const TABLE = 'MatchLogs_VIE';

let cachedAuth = null;
const AUTH_TTL = 24 * 60 * 60 * 1000;

async function getAuth(baseToken) {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) return cachedAuth;
  const res = await fetch(`${SEATABLE_SERVER}/api/v2.1/dtable/app-access-token/`, {
    headers: { Authorization: 'Bearer ' + baseToken }
  });
  if (!res.ok) throw new Error('SeaTable auth failed: ' + res.status);
  const data = await res.json();
  cachedAuth = {
    access_token: data.access_token,
    dtable_uuid: data.dtable_uuid,
    expiresAt: Date.now() + AUTH_TTL
  };
  return cachedAuth;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const TOKEN = process.env.SEATABLE_TOKEN;
  if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: 'Token fehlt' }) };

  let body;
  try { body = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiger Body' }) };
  }

  const { recordId, slots, places } = body;
  // SeaTable-Zeilen-IDs sind ~22 Zeichen lang (kein "rec"-Präfix wie bei Airtable)
  if (!recordId || typeof recordId !== 'string' || recordId.length < 10) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Record ID' }) };
  }

  const row = {};
  if (slots !== undefined) row['Termine_JSON'] = JSON.stringify(slots);
  if (places !== undefined) row['Restaurants_JSON'] = JSON.stringify(places);
  if (Object.keys(row).length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nichts zu speichern' }) };
  }

  try {
    const auth = await getAuth(TOKEN);
    const res = await fetch(
      `${SEATABLE_SERVER}/api-gateway/api/v2/dtables/${auth.dtable_uuid}/rows/`,
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + auth.access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          table_name: TABLE,
          updates: [{ row_id: recordId, row }]
        })
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: data?.error_message || data?.error_msg || 'SeaTable-Fehler' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
