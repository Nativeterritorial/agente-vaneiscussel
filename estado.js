// Gerencia estado por telefone: nome, última conversa, visitas agendadas, imóveis vistos
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const ESTADO_FILE = path.join(DATA_DIR, "estado.json");

let _cache = null;

export function carregarTudo() {
  if (_cache) return _cache;
  _cache = fs.existsSync(ESTADO_FILE) ? JSON.parse(fs.readFileSync(ESTADO_FILE, "utf8")) : {};
  return _cache;
}

export function salvar() {
  if (_cache) fs.writeFileSync(ESTADO_FILE, JSON.stringify(_cache, null, 2));
}

export function getEstado(telefone) {
  const tudo = carregarTudo();
  if (!tudo[telefone]) tudo[telefone] = {};
  return tudo[telefone];
}

export function setEstado(telefone, patch) {
  const e = getEstado(telefone);
  Object.assign(e, patch);
  e.ultima_interacao = new Date().toISOString();
  salvar();
}

export function registrarImovelMostrado(telefone, codigo) {
  const e = getEstado(telefone);
  if (!e.imoveis_mostrados) e.imoveis_mostrados = [];
  if (!e.imoveis_mostrados.includes(codigo)) e.imoveis_mostrados.push(codigo);
  salvar();
}

export function registrarVisita(telefone, visita) {
  const e = getEstado(telefone);
  if (!e.visitas) e.visitas = [];
  e.visitas.push({ ...visita, lembrete_24h_enviado: false, lembrete_1h_enviado: false, status: "agendada" });
  salvar();
}

export function atualizarVisita(telefone, eventId, patch) {
  const e = getEstado(telefone);
  if (!e.visitas) return;
  const v = e.visitas.find(x => x.event_id === eventId);
  if (v) { Object.assign(v, patch); salvar(); }
}

export function listarTodasVisitasAgendadas() {
  const tudo = carregarTudo();
  const out = [];
  for (const [tel, e] of Object.entries(tudo)) {
    for (const v of (e.visitas || [])) {
      if (v.status === "agendada") out.push({ telefone: tel, lead: e.nome_lead, ...v });
    }
  }
  return out;
}

export function listarLeadsFrios(diasMin = 7) {
  const tudo = carregarTudo();
  const agora = Date.now();
  const out = [];
  for (const [tel, e] of Object.entries(tudo)) {
    if (!e.ultima_interacao || e.frio_nudge_enviado) continue;
    const dias = (agora - new Date(e.ultima_interacao).getTime()) / 86400000;
    if (dias >= diasMin) out.push({ telefone: tel, ...e, dias_inativo: Math.floor(dias) });
  }
  return out;
}

export function marcarFrioNudgeEnviado(telefone) {
  setEstado(telefone, { frio_nudge_enviado: true, frio_nudge_em: new Date().toISOString() });
}

export function montarMemoriaLead(telefone) {
  const e = getEstado(telefone);
  const partes = [];
  if (e.nome_lead) partes.push(`- Nome do lead: ${e.nome_lead}`);
  if (e.preferencia) partes.push(`- O que procura: ${e.preferencia}`);
  if (e.imoveis_mostrados?.length) partes.push(`- Já mostrou os imóveis: ${e.imoveis_mostrados.join(", ")}`);
  if (e.visitas?.length) {
    const ag = e.visitas.filter(v => v.status === "agendada");
    if (ag.length) partes.push(`- Visitas agendadas: ${ag.map(v => `${v.imovel_codigo} em ${new Date(v.inicio).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`).join("; ")}`);
  }
  if (e.ultima_interacao) {
    const dias = Math.floor((Date.now() - new Date(e.ultima_interacao).getTime()) / 86400000);
    if (dias > 0) partes.push(`- Última conversa: ${dias} dia(s) atrás`);
  }
  if (partes.length === 0) return "";
  return `# MEMÓRIA DESTE LEAD (use pra retomar a conversa naturalmente, não pergunte coisa que já sabe)\n${partes.join("\n")}\n\nSe faz mais de 5 dias que falaram, dê boas-vindas calorosa ("Oi de novo${e.nome_lead ? ", " + e.nome_lead.split(" ")[0] : ""}!").`;
}
