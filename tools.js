// Tools que o agente chama: buscar_imoveis, transferir_corretor, salvar_lead, agendar_visita
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buscar_imoveis } from "./imoveis.js";
import { getCliente } from "./config.js";
import { verificar_disponibilidade as calVerificar, agendar_visita as calAgendar, cancelar_evento as calCancelar } from "./calendar.js";
import { registrarVisita, atualizarVisita, getEstado, setEstado } from "./estado.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const LEADS_FILE = path.join(DATA_DIR, "leads.jsonl");
const PAUSA_FILE = path.join(DATA_DIR, "pausas.json");

export function pausarLead(telefone, horas) {
  if (!telefone) return;
  const pausas = fs.existsSync(PAUSA_FILE) ? JSON.parse(fs.readFileSync(PAUSA_FILE, "utf8")) : {};
  pausas[telefone] = Date.now() + horas * 60 * 60 * 1000;
  fs.writeFileSync(PAUSA_FILE, JSON.stringify(pausas, null, 2));
}

export function despausarLead(telefone) {
  if (!fs.existsSync(PAUSA_FILE)) return;
  const pausas = JSON.parse(fs.readFileSync(PAUSA_FILE, "utf8"));
  if (pausas[telefone]) { delete pausas[telefone]; fs.writeFileSync(PAUSA_FILE, JSON.stringify(pausas, null, 2)); }
}

export function leadEstaPausado(telefone) {
  if (!fs.existsSync(PAUSA_FILE)) return false;
  const pausas = JSON.parse(fs.readFileSync(PAUSA_FILE, "utf8"));
  const ate = pausas[telefone];
  if (!ate) return false;
  if (Date.now() > ate) { delete pausas[telefone]; fs.writeFileSync(PAUSA_FILE, JSON.stringify(pausas, null, 2)); return false; }
  return true;
}

export async function zapiTranscreverAudio({ messageId, audioUrl }) {
  const base = process.env.ZAPI_BASE || `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}`;
  const headers = { "Content-Type": "application/json" };
  if (process.env.ZAPI_CLIENT_TOKEN) headers["Client-Token"] = process.env.ZAPI_CLIENT_TOKEN;
  const tentativas = [];
  if (messageId) tentativas.push({ messageId });
  if (audioUrl) tentativas.push({ audioUrl });
  for (const body of tentativas) {
    try {
      const r = await fetch(`${base}/transcribe-audio`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.transcription) return j.transcription;
      if (j.text) return j.text;
    } catch {}
  }
  return null;
}

// Memória curta de mensagens enviadas pelo agente pra distinguir echo (fromMe via Z-API) de digitação manual humana
const _enviosRecentes = new Map();
const ECHO_JANELA_MS = 60 * 1000;

export function foiEnviadaPorNos(phone) {
  const ts = _enviosRecentes.get(phone);
  return ts && (Date.now() - ts) < ECHO_JANELA_MS;
}

export async function zapiSendText(phone, message) {
  const base = process.env.ZAPI_BASE || `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}`;
  const headers = { "Content-Type": "application/json" };
  if (process.env.ZAPI_CLIENT_TOKEN) headers["Client-Token"] = process.env.ZAPI_CLIENT_TOKEN;
  const r = await fetch(`${base}/send-text`, { method: "POST", headers, body: JSON.stringify({ phone, message }) });
  if (!r.ok) console.error(`Z-API erro ${r.status}: ${await r.text()}`);
  _enviosRecentes.set(phone, Date.now());
  return r.ok;
}

function escolherCorretor(imovelCorretorNome) {
  const cfg = getCliente();
  if (imovelCorretorNome) {
    const m = (cfg.corretores || []).find(c => c.nome.toLowerCase() === imovelCorretorNome.toLowerCase());
    if (m) return m;
  }
  const padrao = cfg.corretor_padrao;
  return (cfg.corretores || []).find(c => c.telefone === padrao) || (cfg.corretores || [])[0] || { nome: "Corretor", telefone: padrao };
}

export async function transferir_corretor({ nome_lead, telefone_lead, resumo, imovel_codigo, corretor_nome }) {
  const cfg = getCliente();
  const corretor = escolherCorretor(corretor_nome);
  const horas = cfg.transferencia?.pausa_apos_transferir_horas || 6;

  const texto = `🔔 *Lead transferido — ${cfg.agente?.nome || "Agente"}*\n\n*Nome:* ${nome_lead || "—"}\n*Telefone:* ${telefone_lead || "—"}${imovel_codigo ? `\n*Imóvel de interesse:* ${imovel_codigo}` : ""}\n\n*Resumo:* ${resumo}`;
  await zapiSendText(corretor.telefone, texto);

  fs.appendFileSync(LEADS_FILE, JSON.stringify({
    ts: new Date().toISOString(),
    cliente: cfg.imobiliaria?.nome,
    status: "TRANSFERIDO",
    corretor: corretor.nome,
    nome_lead, telefone_lead, imovel_codigo, resumo,
  }) + "\n");

  if (telefone_lead) pausarLead(telefone_lead, horas);

  return { ok: true, corretor_nome: corretor.nome, mensagem_sugerida: cfg.transferencia?.mensagem_pre_transferencia || `Beleza! Vou já chamar o ${corretor.nome} pra te atender 👍` };
}

export function salvar_lead(dados) {
  const cfg = getCliente();
  fs.appendFileSync(LEADS_FILE, JSON.stringify({
    ts: new Date().toISOString(),
    cliente: cfg.imobiliaria?.nome,
    status: "QUALIFICADO",
    ...dados,
  }) + "\n");
  if (dados.telefone) {
    const patch = {};
    if (dados.nome) patch.nome_lead = dados.nome;
    const pref = [];
    if (dados.tipo) pref.push(dados.tipo);
    if (dados.dormitorios) pref.push(`${dados.dormitorios}d`);
    if (dados.bairro) pref.push(`bairro ${dados.bairro}`);
    if (dados.orcamento) pref.push(`até R$ ${Number(dados.orcamento).toLocaleString("pt-BR")}`);
    if (dados.finalidade) pref.push(dados.finalidade);
    if (pref.length) patch.preferencia = pref.join(", ");
    setEstado(dados.telefone, patch);
  }
  return { ok: true };
}

export const TOOL_DEFS = [
  {
    name: "buscar_imoveis",
    description: "Busca imóveis ATIVOS na planilha da imobiliária que batem com os filtros do lead. Use quando tiver coletado ao menos finalidade + tipo + (bairro OU orçamento).",
    input_schema: {
      type: "object",
      properties: {
        finalidade: { type: "string", enum: ["Venda", "Aluguel"], description: "Comprar ou alugar" },
        tipo: { type: "string", description: "Apartamento, Casa, Terreno, Sala comercial, etc" },
        bairro: { type: "string" },
        dormitorios_min: { type: "number" },
        preco_max: { type: "number" },
        preco_min: { type: "number" },
      },
    },
  },
  {
    name: "transferir_corretor",
    description: "Transfere o lead pro corretor humano. Use quando: pedir agendamento, alta intenção, dúvida fora da planilha, pedido explícito.",
    input_schema: {
      type: "object",
      properties: {
        nome_lead: { type: "string" },
        telefone_lead: { type: "string" },
        imovel_codigo: { type: "string", description: "Código do imóvel de interesse, se aplicável" },
        corretor_nome: { type: "string", description: "Nome do corretor responsável daquele imóvel (se a planilha indicar). Caso não saiba, omita." },
        resumo: { type: "string", description: "Resumo curto: o que o lead procura, status, urgência, imóvel de interesse" },
      },
      required: ["resumo"],
    },
  },
  {
    name: "salvar_lead",
    description: "Salva ou atualiza dados qualificados do lead na base. Chame conforme coleta dados durante a conversa.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        telefone: { type: "string" },
        finalidade: { type: "string" },
        tipo: { type: "string" },
        bairro: { type: "string" },
        dormitorios: { type: "number" },
        orcamento: { type: "number" },
        urgencia: { type: "string" },
      },
    },
  },
  {
    name: "verificar_disponibilidade_agenda",
    description: "Verifica se um horário está livre na agenda do corretor. Use quando o lead sugerir um horário pra visita. Sempre verifique ANTES de agendar.",
    input_schema: {
      type: "object",
      properties: {
        corretor_nome: { type: "string", description: "Nome do corretor (Vanei). Omita se for único corretor." },
        data_hora_inicio: { type: "string", description: "Formato YYYY-MM-DD HH:MM (ex: 2026-05-08 14:00)" },
        duracao_minutos: { type: "number", description: "Duração em minutos. Padrão 60." },
      },
      required: ["data_hora_inicio"],
    },
  },
  {
    name: "cancelar_visita",
    description: "Cancela uma visita previamente agendada. Use quando o lead disser que não vai conseguir, quer desmarcar, ou pedir pra remarcar (nesse caso cancela e depois agenda novo). Libera o horário na agenda do corretor automaticamente.",
    input_schema: {
      type: "object",
      properties: {
        telefone_lead: { type: "string" },
        motivo: { type: "string", description: "Motivo do cancelamento se o lead disser (ex: 'imprevisto', 'remarcar pra outro horário')" },
        corretor_nome: { type: "string", description: "Omita se único corretor" },
      },
    },
  },
  {
    name: "agendar_visita",
    description: "Agenda visita ao imóvel no Google Calendar do corretor. Use APÓS confirmar que o horário está livre (verificar_disponibilidade_agenda). Cria evento e notifica o corretor por WhatsApp.",
    input_schema: {
      type: "object",
      properties: {
        corretor_nome: { type: "string", description: "Nome do corretor (omita se único)" },
        data_hora_inicio: { type: "string", description: "YYYY-MM-DD HH:MM" },
        duracao_minutos: { type: "number", description: "Padrão 60" },
        nome_lead: { type: "string" },
        telefone_lead: { type: "string" },
        imovel_codigo: { type: "string" },
        local: { type: "string", description: "Endereço aproximado do imóvel" },
        observacoes: { type: "string", description: "Detalhes extras (urgência, ponto de encontro, etc)" },
      },
      required: ["data_hora_inicio", "imovel_codigo"],
    },
  },
];

function getCalendarIdDoCorretor(corretorNome) {
  const cfg = getCliente();
  if (corretorNome) {
    const c = (cfg.corretores || []).find(x => x.nome.toLowerCase() === corretorNome.toLowerCase());
    if (c?.calendar_id) return { calendar_id: c.calendar_id, corretor: c };
  }
  const primeiro = (cfg.corretores || [])[0];
  return primeiro?.calendar_id ? { calendar_id: primeiro.calendar_id, corretor: primeiro } : null;
}

async function verificar_disponibilidade_agenda({ corretor_nome, data_hora_inicio, duracao_minutos }) {
  const r = getCalendarIdDoCorretor(corretor_nome);
  if (!r) return { erro: "Corretor sem agenda configurada." };
  return await calVerificar({ calendar_id: r.calendar_id, data_hora_inicio, duracao_minutos });
}

async function agendar_visita_full({ corretor_nome, data_hora_inicio, duracao_minutos, nome_lead, telefone_lead, imovel_codigo, local, observacoes }) {
  const r = getCalendarIdDoCorretor(corretor_nome);
  if (!r) return { erro: "Corretor sem agenda configurada." };
  const cfg = getCliente();
  const titulo = `Visita ${imovel_codigo || ""} - ${nome_lead || telefone_lead || "Lead"}`.trim();
  const descricao = `Visita agendada via agente ${cfg.agente?.nome || "Bia"}\nLead: ${nome_lead || "—"}\nTelefone: ${telefone_lead || "—"}\nImóvel: ${imovel_codigo || "—"}${observacoes ? `\n\nObs: ${observacoes}` : ""}`;
  const res = await calAgendar({ calendar_id: r.calendar_id, data_hora_inicio, duracao_minutos, titulo, descricao, local });

  if (res.ok) {
    // Notifica o corretor por WhatsApp
    const aviso = `📅 *Nova visita agendada!*\n\n*Imóvel:* ${imovel_codigo || "—"}\n*Lead:* ${nome_lead || "—"} (${telefone_lead || "—"})\n*Quando:* ${new Date(res.inicio).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${local ? `\n*Local:* ${local}` : ""}${observacoes ? `\n*Obs:* ${observacoes}` : ""}\n\nEvento criado no Google Calendar 👍`;
    try { await zapiSendText(r.corretor.telefone, aviso); } catch {}
    fs.appendFileSync(LEADS_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      cliente: cfg.imobiliaria?.nome,
      status: "VISITA_AGENDADA",
      corretor: r.corretor.nome,
      nome_lead, telefone_lead, imovel_codigo,
      quando: res.inicio,
    }) + "\n");
    if (telefone_lead) {
      registrarVisita(telefone_lead, {
        event_id: res.event_id,
        inicio: res.inicio,
        fim: res.fim,
        imovel_codigo,
        nome_lead,
        local,
      });
      if (nome_lead) setEstado(telefone_lead, { nome_lead });
    }
  }
  return res;
}

async function cancelar_visita_full({ telefone_lead, event_id, motivo, corretor_nome }) {
  const r = getCalendarIdDoCorretor(corretor_nome);
  if (!r) return { erro: "Corretor sem agenda configurada." };

  // Se não veio event_id, tenta achar pela última visita agendada do telefone
  let evtId = event_id;
  let visita = null;
  if (telefone_lead) {
    const e = getEstado(telefone_lead);
    visita = (e.visitas || []).filter(v => v.status === "agendada").slice(-1)[0];
    if (!evtId && visita) evtId = visita.event_id;
  }
  if (!evtId) return { erro: "Nenhuma visita agendada encontrada pra cancelar." };

  try {
    await calCancelar({ calendar_id: r.calendar_id, event_id: evtId });
  } catch (e) {
    console.warn(`[cancelar] erro deletando evento: ${e.message}`);
  }

  if (telefone_lead) atualizarVisita(telefone_lead, evtId, { status: "cancelada", cancelada_em: new Date().toISOString(), motivo });

  // Notifica corretor
  const cfg = getCliente();
  const aviso = `❌ *Visita cancelada*\n\n*Imóvel:* ${visita?.imovel_codigo || "—"}\n*Lead:* ${visita?.nome_lead || "—"} (${telefone_lead || "—"})\n*Era pra:* ${visita ? new Date(visita.inicio).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}${motivo ? `\n*Motivo:* ${motivo}` : ""}\n\nHorário liberado na agenda.`;
  try { await zapiSendText(r.corretor.telefone, aviso); } catch {}

  fs.appendFileSync(LEADS_FILE, JSON.stringify({
    ts: new Date().toISOString(),
    cliente: cfg.imobiliaria?.nome,
    status: "VISITA_CANCELADA",
    nome_lead: visita?.nome_lead, telefone_lead, imovel_codigo: visita?.imovel_codigo, motivo,
  }) + "\n");

  return { ok: true, mensagem_sugerida: "Beleza, cancelei aqui pra você. Quando quiser remarcar, me avisa que eu confiro novos horários 👍" };
}

export async function executarTool(name, input) {
  switch (name) {
    case "buscar_imoveis": return await buscar_imoveis(input);
    case "transferir_corretor": return await transferir_corretor(input);
    case "salvar_lead": return salvar_lead(input);
    case "verificar_disponibilidade_agenda": return await verificar_disponibilidade_agenda(input);
    case "agendar_visita": return await agendar_visita_full(input);
    case "cancelar_visita": return await cancelar_visita_full(input);
    default: return { erro: `Tool desconhecida: ${name}` };
  }
}
