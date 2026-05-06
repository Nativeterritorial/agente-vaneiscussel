// Tools que o agente chama: buscar_imoveis, transferir_corretor, salvar_lead, agendar_visita
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buscar_imoveis } from "./imoveis.js";
import { getCliente } from "./config.js";

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

export async function zapiSendText(phone, message) {
  const base = process.env.ZAPI_BASE || `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}`;
  const headers = { "Content-Type": "application/json" };
  if (process.env.ZAPI_CLIENT_TOKEN) headers["Client-Token"] = process.env.ZAPI_CLIENT_TOKEN;
  const r = await fetch(`${base}/send-text`, { method: "POST", headers, body: JSON.stringify({ phone, message }) });
  if (!r.ok) console.error(`Z-API erro ${r.status}: ${await r.text()}`);
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
];

export async function executarTool(name, input) {
  switch (name) {
    case "buscar_imoveis": return await buscar_imoveis(input);
    case "transferir_corretor": return await transferir_corretor(input);
    case "salvar_lead": return salvar_lead(input);
    default: return { erro: `Tool desconhecida: ${name}` };
  }
}
