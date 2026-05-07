// Tarefas agendadas: lembretes de visita (24h antes, 1h antes), nudge de lead frio
import { listarTodasVisitasAgendadas, atualizarVisita, listarLeadsFrios, marcarFrioNudgeEnviado, getEstado } from "./estado.js";
import { zapiSendText } from "./tools.js";
import { getCliente } from "./config.js";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

function dataPtBr(iso) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function rodarLembretesVisita() {
  const cfg = getCliente();
  const corretor = (cfg.corretores || [])[0];
  const visitas = listarTodasVisitasAgendadas();
  const agora = Date.now();
  let enviados = 0;

  for (const v of visitas) {
    const inicioMs = new Date(v.inicio).getTime();
    const faltam = inicioMs - agora;
    if (faltam < -2 * HORA_MS) continue; // visita já passou há tempo, ignora

    // Lembrete 24h antes (janela de 23-25h antes do início)
    if (!v.lembrete_24h_enviado && faltam < 25 * HORA_MS && faltam > 23 * HORA_MS) {
      const msgLead = `Oi${v.lead ? ", " + v.lead.split(" ")[0] : ""}! 👋 Lembrando da nossa visita amanhã às ${dataPtBr(v.inicio).slice(-5)} no imóvel ${v.imovel_codigo}. Tudo certo pra você?`;
      try { await zapiSendText(v.telefone, msgLead); enviados++; } catch (e) { console.error("[lembrete 24h] erro:", e.message); }
      atualizarVisita(v.telefone, v.event_id, { lembrete_24h_enviado: true });
    }

    // Lembrete 1h antes (janela 30-90min antes)
    if (!v.lembrete_1h_enviado && faltam < 90 * 60 * 1000 && faltam > 30 * 60 * 1000) {
      const msgLead = `Oi! ⏰ Tá na hora — visita em 1h no imóvel ${v.imovel_codigo}.${v.local ? ` Local: ${v.local}.` : ""} O Vanei te encontra lá 👍`;
      try { await zapiSendText(v.telefone, msgLead); enviados++; } catch (e) { console.error("[lembrete 1h] erro:", e.message); }
      // Avisa o corretor também
      if (corretor?.telefone) {
        const msgCor = `⏰ *Lembrete 1h* — visita ${v.imovel_codigo} com ${v.lead || v.telefone} às ${dataPtBr(v.inicio).slice(-5)}.${v.local ? ` Local: ${v.local}.` : ""}`;
        try { await zapiSendText(corretor.telefone, msgCor); } catch {}
      }
      atualizarVisita(v.telefone, v.event_id, { lembrete_1h_enviado: true });
    }
  }
  if (enviados > 0) console.log(`[scheduler] ${enviados} lembrete(s) de visita enviado(s)`);
}

async function rodarNudgeLeadsFrios() {
  const cfg = getCliente();
  const frios = listarLeadsFrios(7);
  let enviados = 0;
  for (const f of frios) {
    const e = getEstado(f.telefone);
    // Só nudge se tinha alguma interação minimamente qualificada (preferência ou nome) OU se já viu imóveis
    if (!e.preferencia && !(e.imoveis_mostrados?.length) && !e.nome_lead) continue;

    const primeiroNome = (e.nome_lead || "").split(" ")[0];
    const oQueProcura = e.preferencia ? ` (${e.preferencia})` : "";
    const msg = `Oi${primeiroNome ? ", " + primeiroNome : ""}! 👋 Faz uns dias que não falamos. Ainda tá procurando imóvel${oQueProcura}? Apareceram opções novas, posso te mandar 😊`;
    try { await zapiSendText(f.telefone, msg); enviados++; } catch (err) { console.error("[nudge] erro:", err.message); }
    marcarFrioNudgeEnviado(f.telefone);
  }
  if (enviados > 0) console.log(`[scheduler] ${enviados} nudge(s) pra lead frio enviado(s)`);
}

export async function rodarScheduler() {
  try { await rodarLembretesVisita(); } catch (e) { console.error("[scheduler] lembretes:", e.message); }
  try { await rodarNudgeLeadsFrios(); } catch (e) { console.error("[scheduler] frios:", e.message); }
}

export function agendarScheduler() {
  // Roda a cada 15 min
  const intervalo = 15 * 60 * 1000;
  setInterval(() => rodarScheduler().catch(e => console.error("[scheduler] erro:", e.message)), intervalo);
  console.log("[scheduler] agendado a cada 15min (lembretes visita + nudge lead frio)");
  // Roda 1x logo após start
  setTimeout(() => rodarScheduler().catch(e => console.error("[scheduler] erro:", e.message)), 30_000);
}
