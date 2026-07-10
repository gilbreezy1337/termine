// v5 - SeaTable API-Gateway + Caching
const SEATABLE_SERVER = 'https://cloud.seatable.io';
const TABLE = 'MatchLogs_VIE';

// ── Caches (überleben zwischen Aufrufen, solange die Function "warm" ist) ──
let cachedAuth = null;              // { access_token, dtable_uuid, expiresAt }
let cachedRows = null;              // { rows, fetchedAt }
const AUTH_TTL = 24 * 60 * 60 * 1000;   // 24h (Token gilt ~3 Tage)
const ROWS_TTL = 2 * 60 * 1000;         // 2 Min – Gruppen ändern sich nur 1x/Monat,
                                        // Votes dürfen max. 2 Min "alt" angezeigt werden

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

async function getRows(auth) {
  if (cachedRows && Date.now() - cachedRows.fetchedAt < ROWS_TTL) return cachedRows.rows;
  const rows = [];
  let start = 0;
  const limit = 1000;
  while (true) {
    const url = `${SEATABLE_SERVER}/api-gateway/api/v2/dtables/${auth.dtable_uuid}/rows/`
      + `?table_name=${encodeURIComponent(TABLE)}&start=${start}&limit=${limit}&convert_keys=true`;
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + auth.access_token }
    });
    if (!res.ok) throw new Error(`getRows failed: ${res.status}`);
    const data = await res.json();
    rows.push(...(data.rows || []));
    if ((data.rows || []).length < limit) break;
    start += limit;
  }
  cachedRows = { rows, fetchedAt: Date.now() };
  return rows;
}

// Beide Datumsformate beginnen mit YYYY-MM-DD → für Sortierung reicht der Präfix
function dateKey(row) {
  const d = row['date'] || row['_ctime'] || '';
  const m = String(d).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '0000-00-00';
}

exports.handler = async function(event) {
  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige E-Mail' }) };
  }

  const TOKEN = process.env.SEATABLE_TOKEN;
  if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: 'Token fehlt' }) };

  try {
    const auth = await getAuth(TOKEN);
    const allRows = await getRows(auth);

    // Neueste zuerst (nach Datum, bei Gleichstand nach Erstellzeit)
    const sorted = [...allRows].sort((a, b) => {
      const dk = dateKey(b).localeCompare(dateKey(a));
      return dk !== 0 ? dk : String(b['_ctime'] || '').localeCompare(String(a['_ctime'] || ''));
    });

    let found = null;
    for (const row of sorted) {
      const matches = row['matches'];
      if (typeof matches === 'string' && matches.toLowerCase().includes(email)) {
        found = row;
        break;
      }
    }

    if (!found) return { statusCode: 404, body: JSON.stringify({ found: false, version: 'v5' }) };

    let slots = [], places = [];
    try { slots = JSON.parse(found['Termine_JSON'] || '[]'); } catch (e) {}
    try { places = JSON.parse(found['Restaurants_JSON'] || '[]'); } catch (e) {}

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found: true,
        version: 'v5',
        id: found['_id'],
        date: dateKey(found),
        members: parseMembers(found['matches'] || ''),
        slots,
        places
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, version: 'v5' }) };
  }
};

function parseMembers(raw) {
  const out = [];
  raw.split(/\)\s*,\s*/).forEach(chunk => {
    chunk = chunk.trim();
    const pi = chunk.lastIndexOf('(');
    if (pi < 0) return;
    const name = chunk.slice(0, pi).trim().replace(/^[,\s]+/, '');
    const email = chunk.slice(pi + 1).replace(/\).*$/, '').trim().toLowerCase();
    if (email.includes('@')) out.push({ name, email });
  });
  return out;
}
