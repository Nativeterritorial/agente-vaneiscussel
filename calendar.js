// Google Calendar API via OAuth2 (refresh token)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

let _accessToken = null;
let _expiresAt = 0;

async function getAccessToken() {
  if (Date.now() < _expiresAt - 60_000 && _accessToken) return _accessToken;
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error("Google Calendar não configurado (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN ausentes)");
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google OAuth refresh falhou: ${JSON.stringify(j)}`);
  _accessToken = j.access_token;
  _expiresAt = Date.now() + (j.expires_in || 3600) * 1000;
  return _accessToken;
}

async function gcal(path, init = {}) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) };
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Calendar ${path} ${r.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

// Aceita "2026-05-08 14:00" ou ISO. Trata timezone São Paulo (-03:00).
function parseDataHora(s) {
  if (!s) return null;
  const limpo = String(s).trim().replace(/\//g, "-");
  // ISO completo
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(limpo)) return new Date(limpo);
  // YYYY-MM-DD HH:MM ou YYYY-MM-DD HH:MM:SS
  const m = limpo.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/);
  if (m) {
    const [_, y, mo, d, hh, mm] = m;
    return new Date(`${y}-${mo}-${d}T${hh}:${mm}:00-03:00`);
  }
  // DD-MM-YYYY HH:MM
  const m2 = limpo.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);
  if (m2) {
    const [_, d, mo, y, hh, mm] = m2;
    return new Date(`${y}-${mo}-${d}T${hh}:${mm}:00-03:00`);
  }
  return new Date(limpo);
}

export async function verificar_disponibilidade({ calendar_id, data_hora_inicio, duracao_minutos = 60 }) {
  const inicio = parseDataHora(data_hora_inicio);
  if (!inicio || isNaN(inicio.getTime())) return { erro: "Data/hora inválida. Use formato YYYY-MM-DD HH:MM (ex: 2026-05-08 14:00)" };
  const fim = new Date(inicio.getTime() + duracao_minutos * 60_000);

  const cal = encodeURIComponent(calendar_id);
  const params = new URLSearchParams({
    timeMin: inicio.toISOString(),
    timeMax: fim.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const j = await gcal(`/calendars/${cal}/events?${params}`);
  const eventos = j.items || [];
  return {
    livre: eventos.length === 0,
    eventos_em_conflito: eventos.length,
    detalhe_conflito: eventos.map(e => ({
      titulo: e.summary,
      inicio: e.start?.dateTime || e.start?.date,
      fim: e.end?.dateTime || e.end?.date,
    })),
    inicio_iso: inicio.toISOString(),
    fim_iso: fim.toISOString(),
  };
}

export async function cancelar_evento({ calendar_id, event_id }) {
  if (!calendar_id || !event_id) return { erro: "calendar_id e event_id obrigatórios" };
  const cal = encodeURIComponent(calendar_id);
  await gcal(`/calendars/${cal}/events/${encodeURIComponent(event_id)}`, { method: "DELETE" });
  return { ok: true };
}

export async function agendar_visita({ calendar_id, data_hora_inicio, duracao_minutos = 60, titulo, descricao, local }) {
  const inicio = parseDataHora(data_hora_inicio);
  if (!inicio || isNaN(inicio.getTime())) return { erro: "Data/hora inválida. Use formato YYYY-MM-DD HH:MM" };
  const fim = new Date(inicio.getTime() + duracao_minutos * 60_000);

  // Confere conflito antes de criar
  const disp = await verificar_disponibilidade({ calendar_id, data_hora_inicio, duracao_minutos });
  if (!disp.livre) {
    return { ok: false, motivo: "horario_ocupado", eventos_em_conflito: disp.detalhe_conflito };
  }

  const cal = encodeURIComponent(calendar_id);
  const evento = {
    summary: titulo || "Visita imóvel",
    description: descricao || "",
    location: local || "",
    start: { dateTime: inicio.toISOString(), timeZone: "America/Sao_Paulo" },
    end: { dateTime: fim.toISOString(), timeZone: "America/Sao_Paulo" },
  };
  const j = await gcal(`/calendars/${cal}/events`, { method: "POST", body: JSON.stringify(evento) });
  return {
    ok: true,
    event_id: j.id,
    link: j.htmlLink,
    inicio: j.start?.dateTime,
    fim: j.end?.dateTime,
  };
}
