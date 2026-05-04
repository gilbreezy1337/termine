exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const PAT     = process.env.AIRTABLE_PAT;
  const BASE_ID = 'appflLzAciq6NMD0i';
  const TABLE   = 'Matchlogs_VIE';

  if (!PAT) return { statusCode: 500, body: JSON.stringify({ error: 'Token fehlt' }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiger Body' }) };
  }

  const { recordId, slots, places } = body;
  if (!recordId || !recordId.startsWith('rec')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Record ID' }) };
  }

  const fields = {};
  if (slots  !== undefined) fields['Termine_JSON']     = JSON.stringify(slots);
  if (places !== undefined) fields['Restaurants_JSON'] = JSON.stringify(places);

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${recordId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization:  'Bearer ' + PAT,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });
    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ error: data?.error?.message }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
