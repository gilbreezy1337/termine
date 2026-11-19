const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MON=['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DAYS=['So','Mo','Di','Mi','Do','Fr','Sa'];
const fmt = ds => { const d=new Date(ds+'T12:00:00'); return `${DAYS[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`; };

const SEATABLE_SERVER = 'https://cloud.seatable.io';
const TABLE = 'MatchLogs_VIE';
let cachedAuth = null;
async function getAuth(t) {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) return cachedAuth;
  const res = await fetch(`${SEATABLE_SERVER}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: 'Bearer ' + t } });
  if (!res.ok) throw new Error('SeaTable auth failed: ' + res.status);
  const d = await res.json();
  cachedAuth = { access_token: d.access_token, dtable_uuid: d.dtable_uuid, expiresAt: Date.now() + 24*60*60*1000 };
  return cachedAuth;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const TOKEN = process.env.SEATABLE_TOKEN, KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.MAIL_FROM || 'IMMO LUNCH CLUB <lunch@mail.immolunchclub.com>';
  const SITE = process.env.SITE_URL || 'https://termin-abstimmung.netlify.app';
  if (!TOKEN || !KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Server nicht konfiguriert (Token/Mail-Key fehlt)' }) };

  let body; try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiger Body' }) }; }
  const { recordId, senderEmail } = body;
  if (typeof recordId !== 'string' || !/^[A-Za-z0-9_-]{10,40}$/.test(recordId)) return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Record ID' }) };

  try {
    const auth = await getAuth(TOKEN);
    const r = await fetch(`${SEATABLE_SERVER}/api-gateway/api/v2/dtables/${auth.dtable_uuid}/rows/${recordId}/?table_name=${encodeURIComponent(TABLE)}&convert_keys=true`, { headers: { Authorization: 'Bearer ' + auth.access_token } });
    const f = await r.json();
    if (!r.ok) return { statusCode: r.status, body: JSON.stringify({ error: f?.error_message || f?.error_msg || 'SeaTable-Fehler' }) };
    const raw = f['matches'] || '';
    const members = parseMembers(raw);
    if (!members.length) return { statusCode: 400, body: JSON.stringify({ error: 'Keine Mitglieder gefunden' }) };
    const pj = v => { try { return JSON.parse(v || '[]'); } catch(e) { return []; } };
    const slots = pj(f['Termine_JSON']).sort((a,b)=>new Date(a.date+'T'+a.time)-new Date(b.date+'T'+b.time));
    const places = pj(f['Restaurants_JSON']);
    const first = i => (members[i] ? members[i].name.split(' ')[0] : '?');
    const who = votes => (votes||[]).map((v,i)=>v?first(i):null).filter(Boolean).join(', ') || '–';
    const sender = members.find(m => m.email === String(senderEmail||'').toLowerCase());

    const slotRows = slots.length ? slots.map(s => {
      const n=(s.votes||[]).filter(Boolean).length;
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b>${esc(fmt(s.date))}</b><br><span style="font-size:16px;color:#555">${esc(s.time)} Uhr</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right"><b style="color:#2387E4">${n}/3</b><br><span style="font-size:12px;color:#888">${esc(who(s.votes))}</span></td></tr>`;
    }).join('') : '<tr><td style="color:#888;padding:8px 0">Noch keine Terminvorschläge.</td></tr>';
    const placeRows = places.length ? places.map(p => {
      const n=(p.votes||[]).filter(Boolean).length;
      const link = /^https:\/\/www\.google\.com\/maps\//.test(p.mapsUrl||'') ? `<br><a href="${esc(p.mapsUrl)}" style="color:#2387E4;font-size:12px">In Google Maps öffnen</a>` : '';
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b>${esc(p.name)}</b>${p.addr&&p.addr!=='Wien'?`<br><span style="font-size:12px;color:#888">${esc(p.addr)}</span>`:''}${link}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right"><b style="color:#2387E4">${n}/3</b><br><span style="font-size:12px;color:#888">${esc(who(p.votes))}</span></td></tr>`;
    }).join('') : '<tr><td style="color:#888;padding:8px 0">Noch keine Restaurantvorschläge.</td></tr>';

    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
<div style="border-bottom:3px solid #2387E4;padding-bottom:10px;margin-bottom:18px;font-weight:800;letter-spacing:.06em;color:#2387E4">IMMO LUNCH CLUB</div>
<p style="font-size:15px">${sender?esc(sender.name)+' hat':'Es gibt'} neue Einträge für euren Mittagstermin (${esc(members.map(m=>m.name).join(', '))}).</p>
<h3 style="color:#2387E4;text-transform:uppercase;margin:22px 0 4px">Termine</h3><table style="width:100%;border-collapse:collapse">${slotRows}</table>
<h3 style="color:#2387E4;text-transform:uppercase;margin:22px 0 4px">Restaurants</h3><table style="width:100%;border-collapse:collapse">${placeRows}</table>
<p style="margin:26px 0"><a href="${esc(SITE)}" style="background:#2387E4;color:#fff;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:bold">Jetzt abstimmen</a></p>
<p style="font-size:12px;color:#aaa">Einfach mit deiner E-Mail-Adresse einloggen.</p></div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: members.map(m=>m.email), subject: 'Immo Lunch Club: Neues zu eurem Mittagstermin', html })
    });
    const out = await res.json();
    if (!res.ok) return { statusCode: 502, body: JSON.stringify({ error: out.message || 'Mailversand fehlgeschlagen' }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent: members.length }) };
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
    const name = chunk.slice(0, pi).trim().replace(/^[,\s]+/, '');
    const email = chunk.slice(pi + 1).replace(/\).*$/, '').trim().toLowerCase();
    if (email.includes('@')) out.push({ name, email });
  });
  return out;
}
