exports.handler = async function(event) {
  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  const PAT     = process.env.AIRTABLE_PAT;
  const BASE_ID = 'appflLzAciq6NMD0i';
  const TABLE   = 'Matchlogs_VIE';

  const formula = `FIND("${email}", LOWER({fldXermcL7ly0GeHv}))`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`
    + `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + PAT } });
  const data = await res.json();

  // Debug: zeig genau was zurückkommt
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
};
