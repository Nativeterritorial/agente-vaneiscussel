// Recebe mídia (PDF/imagem) do lead, lê com Vision e responde
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export function extrairMidiaDoWebhook(body) {
  if (body.image && (body.image.imageUrl || body.image.url)) {
    return { tipo: "image", url: body.image.imageUrl || body.image.url, fileName: body.image.fileName || `imagem-${Date.now()}.jpg`, mimeType: body.image.mimeType || "image/jpeg", caption: body.image.caption };
  }
  if (body.document && (body.document.documentUrl || body.document.url)) {
    return { tipo: "document", url: body.document.documentUrl || body.document.url, fileName: body.document.fileName || `documento-${Date.now()}.pdf`, mimeType: body.document.mimeType || "application/pdf", caption: body.document.caption };
  }
  return null;
}

export async function baixarMidia(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar mídia ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function analisarComVision(buffer, mimeType, contexto = "") {
  const isPdf = mimeType === "application/pdf";
  const sourceBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: mimeType.startsWith("image/") ? mimeType : "image/jpeg", data: buffer.toString("base64") } };

  const r = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: [
        sourceBlock,
        {
          type: "text",
          text: `Você é a Bia, atendente da imobiliária Vanei Scussel. Um lead enviou este documento/imagem.

Contexto: ${contexto || "(nenhum)"}

Identifique o tipo e extraia dados úteis pra qualificação imobiliária.

Tipos comuns:
- comprovante_renda → extrair: salário/renda, fonte, vínculo (CLT/autônomo/PJ)
- documento_identidade (RG/CPF/CNH) → extrair: nome completo, CPF
- comprovante_residencia → extrair: nome, endereço, cidade
- holerite → extrair: salário bruto/líquido, empresa, função
- IR → extrair: rendimento total ano, restituição/imposto
- print_imovel_outro_site → extrair: tipo, dormitórios, preço, características desejadas
- foto_imovel_atual → cliente mostrando o imóvel que tem (provavelmente quer vender ou avaliar)
- matricula → extrair: nº matrícula, cartório, proprietário, área, ônus
- contrato → extrair: partes, valor, datas
- outro

REGRAS DE SAÍDA (CRÍTICO):
- Responda APENAS o JSON puro, sem markdown.
- "resumo_curto" deve ter MÁXIMO 200 caracteres em português, em linguagem natural pra mandar pro cliente no WhatsApp.
- Se for comprovante de renda, calcule capacidade de financiamento aproximada (renda × 0.30 × 100 = valor ~financiável).
- Se identificar dados de contato (nome, CPF), inclua em campos.
- Não invente dados.

Schema:
{
  "tipo": "comprovante_renda|documento_identidade|comprovante_residencia|holerite|IR|print_imovel_outro_site|foto_imovel_atual|matricula|contrato|outro",
  "campos": { },
  "capacidade_financiamento_estimada": null,
  "resumo_curto": "string max 200 chars",
  "alertas": [ "string" ],
  "sugestao_resposta_lead": "string — o que a Bia pode dizer pro lead em 1-2 frases"
}`,
        },
      ],
    }],
  });

  const txt = r.content.filter(b => b.type === "text").map(b => b.text).join("");
  return parseJson(txt);
}

function parseJson(txt) {
  let limpo = txt.trim();
  limpo = limpo.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  const cand = ini >= 0 && fim > ini ? limpo.slice(ini, fim + 1) : limpo;
  try {
    return JSON.parse(cand);
  } catch (e) {
    console.warn(`[vision] JSON parse falhou: ${e.message}`);
    return { tipo: "outro", campos: {}, resumo_curto: "documento recebido (análise indisponível)", alertas: [], sugestao_resposta_lead: "Recebi seu arquivo, vou repassar pro Vanei dar uma olhada 👍", erro_parse: true };
  }
}
