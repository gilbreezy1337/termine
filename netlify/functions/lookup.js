exports.handler = async function(event) {
  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige E-Mail' }) };
  }

  const PAT     = process.env.AIRTABLE_PAT;
  const BASE_ID = 'appflLzAciq6NMD0i';
  const TABLE   = 'Matchlogs_VIE';
  const FLD_TERMINE     = 'fldIBr03MFzpv3atR';
  const FLD_RESTAURANTS = 'fldX8VgpiyLv1B12v';

  if (!PAT) return { statusCode: 500, body: JSON.stringify({ error: 'Token fehlt' }) };

  try {
    // Alle Records laden mit Feld-IDs als Keys
    let allRecords = [];
    let offset = '';
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`
        + `?pageSize=100&cellValuesByFieldId=true${offset ? '&offset=' + offset : ''}`;
      const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + PAT } });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ error: data?.error?.message }) };
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || '';
    } while (offset);

    // Neueste zuerst
    allRecords.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

    // Email in allen Feldern suchen
    let found = null;
    for (const rec of allRecords) {
      for (const val of Object.values(rec.fields || {})) {
        if (typeof val === 'string' && val.toLowerCase().includes(email)) {
          found = rec; break;
        }
      }
      if (found) break;
    }

    if (!found) return { statusCode: 404, body: JSON.stringify({ found: false }) };

    const f = found.fields;

    // Members-Feld finden
    let membersRaw = '', dateRaw = found.createdTime;
    for (const [key, val] of Object.entries(f)) {
      if (typeof val === 'string' && val.includes('@') && val.includes('(')) membersRaw = val;
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val) && key !== FLD_TERMINE && key !== FLD_RESTAURANTS) dateRaw = val;
    }

    let slots = [], places = [];
    try { slots  = JSON.parse(f[FLD_TERMINE]      || '[]'); } catch(e) {}
    try { places = JSON.parse(f[FLD_RESTAURANTS]  || '[]'); } catch(e) {}

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found:   true,
        id:      found.id,
        date:    dateRaw.slice(0, 10),
        members: parseMembers(membersRaw),
        slots,
        places
      })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

function parseMembers(raw) {
  const out = [];
  raw.split(/\)\s*,\s*/).forEach(chunk => {
    chunk = chunk.trim();
    const pi = chunk.lastIndexOf('(');
    if (pi < 0) return;
    const name  = chunk.slice(0, pi).trim().replace(/^[,\s]+/, '');
    const email = chunk.slice(pi + 1).replace(/\).*$/, '').trim().toLowerCase();
    if (email.includes('@')) out.push({ name, email });
  });
  return out;
}
