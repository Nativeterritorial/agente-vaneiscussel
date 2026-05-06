// Servidor webhook do agente imobiliário
import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

import { getCliente } from "./config.js";
import { montarSystemPrompt } from "./system-prompt.js";
import { TOOL_DEFS, executarTool, leadEstaPausado, pausarLead, despausarLead, zapiSendText } from "./tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const cliente = getCliente();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
app.use(express.json({ limit: "10mb" }));

const HISTORICO_FILE = path.join(DATA_DIR, "conversas.json");
const ESTADO_FILE = path.join(DATA_DIR, "estado.json");

const historico = fs.existsSync(HISTORICO_FILE) ? JSON.parse(fs.readFileSync(HISTORICO_FILE, "utf8")) : {};
const estado = fs.existsSync(ESTADO_FILE) ? JSON.parse(fs.readFileSync(ESTADO_FILE, "utf8")) : {};

function salvarHistorico() { fs.writeFileSync(HISTORICO_FILE, JSON.stringify(historico, null, 2)); }
function salvarEstado() { fs.writeFileSync(ESTADO_FILE, JSON.stringify(estado, null, 2)); }

console.log(`🤖 Agente "${cliente.agente?.nome}" — ${cliente.imobiliaria?.nome}`);

const SYSTEM_PROMPT = montarSystemPrompt();

function systemBlocks() {
  return [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
}

async function rodarAgente(telefone, nomeLead, mensagem) {
  if (!historico[telefone]) historico[telefone] = [];
  const conv = historico[telefone];
  conv.push({ role: "user", content: mensagem });

  let respostaFinal = "";
  let iter = 0;

  while (iter++ < 6) {
    const r = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemBlocks(),
      tools: TOOL_DEFS,
      messages: conv,
    });

    const cacheHit = r.usage.cache_read_input_tokens > 0;
    console.log(`[${telefone}] iter=${iter} stop=${r.stop_reason} ${cacheHit ? "cache✓" : "cache✗"} in=${r.usage.input_tokens} out=${r.usage.output_tokens}`);

    conv.push({ role: "assistant", content: r.content });

    if (r.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of r.content) {
        if (block.type === "tool_use") {
          console.log(`  → tool: ${block.name}(${JSON.stringify(block.input).slice(0, 200)})`);
          const result = await executarTool(block.name, { ...block.input, telefone_lead: block.input.telefone_lead || telefone, nome_lead: block.input.nome_lead || nomeLead });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      conv.push({ role: "user", content: toolResults });
      continue;
    }

    respostaFinal = r.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    break;
  }

  salvarHistorico();
  return respostaFinal;
}

app.post("/webhook", async (req, res) => {
  res.status(200).send("ok");
  try {
    const body = req.body || {};
    if (body.isGroup) return;

    const telefone = body.phone;
    const nomeLead = body.senderName || body.chatName || "";
    if (!telefone) return;

    // Mensagens fromMe (operador respondendo manualmente) → silencia agente 7 dias
    if (body.fromMe) {
      const texto = body.text?.message || body.message || body.body || "";
      if (/\b(\/agente\s+on|reativar agente)\b/i.test(texto)) {
        despausarLead(telefone);
        console.log(`[${telefone}] agente reativado`);
        return;
      }
      pausarLead(telefone, 24 * 7);
      console.log(`[${telefone}] mensagem manual da equipe — agente pausado 7d`);
      return;
    }

    // Bloqueia mensagens que vêm dos próprios corretores (caso encaminhem algo)
    const telefonesEquipe = (cliente.corretores || []).map(c => String(c.telefone || "").replace(/\D/g, "").slice(-10));
    const telNorm = String(telefone).replace(/\D/g, "").slice(-10);
    if (telefonesEquipe.includes(telNorm)) {
      console.log(`[${telefone}] mensagem de corretor — ignorando`);
      return;
    }

    if (leadEstaPausado(telefone)) {
      console.log(`[${telefone}] pausado — ignorando`);
      return;
    }

    const mensagem = body.text?.message || body.message || body.body || body.audio?.transcription || "";
    if (!mensagem) {
      // Mídia/áudio sem transcrição: avisa o corretor
      console.log(`[${telefone}] mensagem sem texto — ignorando por enquanto`);
      return;
    }

    console.log(`[${telefone}] ${nomeLead}: ${mensagem}`);
    const resposta = await rodarAgente(telefone, nomeLead, mensagem);
    if (resposta) {
      await zapiSendText(telefone, resposta);
      console.log(`[${telefone}] ${cliente.agente?.nome}: ${resposta}`);
    }
  } catch (e) {
    console.error("Erro no webhook:", e);
  }
});

app.get("/health", (_req, res) => res.json({
  ok: true,
  imobiliaria: cliente.imobiliaria?.nome,
  agente: cliente.agente?.nome,
  conversas: Object.keys(historico).length,
  dataDir: DATA_DIR,
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 ${cliente.agente?.nome} rodando em http://localhost:${PORT}`);
  console.log(`   DATA_DIR: ${DATA_DIR}`);
});
