exports.handler = async function(event) {
  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige E-Mail' }) };
  }

  const PAT     = process.env.AIRTABLE_PAT;
  const BASE_ID = 'appflLzAciq6NMD0i';
  const TABLE   = 'Matchlogs_VIE';

  if (!PAT) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Token fehlt' }) };
  }

  // Alle Felder laden — kein field-ID-Filter — funktioniert immer
  const formula = `FIND("${email.replace(/"/g, '')}", LOWER({fldXermcL7ly0GeHv}))`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`
    + `?filterByFormula=${encodeURIComponent(formula)}`
    + `&sort%5B0%5D%5Bfield%5D=fldxAaFiiC7xve8cj&sort%5B0%5D%5Bdirection%5D=desc`
    + `&maxRecords=1`;

  try {
    const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + PAT } });
    const data = await res.json();

    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: data?.error?.message || 'Airtable-Fehler' }) };
    }
    if (!data.records?.length) {
      return { statusCode: 404, body: JSON.stringify({ found: false }) };
    }

    const rec    = data.records[0];
    const fields = rec.fields;

    // Felder automatisch erkennen — unabhängig von ID oder Name als Key
    let membersRaw = '';
    let dateRaw    = '';

    for (const [key, val] of Object.entries(fields)) {
      if (typeof val === 'string' && val.includes('@') && val.includes('(')) {
        membersRaw = val;
      }
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val) && !dateRaw) {
        dateRaw = val;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found: true,
        id: rec.id,
        date: dateRaw.slice(0, 10),
        members: parseMembers(membersRaw)
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
