// Carrega planilha de imóveis (Google Sheets exportado como CSV) e busca/filtra
import { parse } from "csv-parse/sync";
import { getCliente } from "./config.js";

let _imoveisCache = null;
let _imoveisCacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export async function carregarImoveis() {
  if (_imoveisCache && Date.now() - _imoveisCacheTs < CACHE_TTL_MS) return _imoveisCache;
  const cfg = getCliente();
  const url = cfg.planilha_imoveis?.url;
  if (!url) throw new Error("planilha_imoveis.url não configurado em cliente.json");

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar planilha (${r.status})`);
  const csv = await r.text();
  const linhas = parse(csv, { columns: true, skip_empty_lines: true, trim: true });

  _imoveisCache = linhas.map(l => ({
    ...l,
    preco: Number((l.preco || "0").replace(/[^\d]/g, "")) || 0,
    dormitorios: Number(l.dormitorios) || 0,
    suites: Number(l.suites) || 0,
    vagas: Number(l.vagas) || 0,
    area_util: Number((l.area_util || "0").replace(/[^\d.]/g, "")) || 0,
    area_total: Number((l.area_total || "0").replace(/[^\d.]/g, "")) || 0,
  }));
  _imoveisCacheTs = Date.now();
  return _imoveisCache;
}

function normalizar(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

export async function buscar_imoveis({ finalidade, tipo, bairro, dormitorios_min, preco_max, preco_min }) {
  const todos = await carregarImoveis();
  const cfg = getCliente();
  const max = cfg.regras_negocio?.max_imoveis_por_resposta || 3;

  const ativos = todos.filter(i => /ativ/i.test(i.status || ""));

  const filtrados = ativos.filter(i => {
    if (finalidade && !normalizar(i.finalidade).includes(normalizar(finalidade))) return false;
    if (tipo && !normalizar(i.tipo).includes(normalizar(tipo))) return false;
    if (bairro && !normalizar(i.bairro).includes(normalizar(bairro))) return false;
    if (dormitorios_min && i.dormitorios < Number(dormitorios_min)) return false;
    if (preco_max && i.preco > Number(preco_max)) return false;
    if (preco_min && i.preco < Number(preco_min)) return false;
    return true;
  });

  // ordena: prioriza mais próximo dos critérios, depois por preço crescente
  filtrados.sort((a, b) => a.preco - b.preco);

  const resumo = filtrados.slice(0, max).map(i => ({
    codigo: i.codigo,
    tipo: i.tipo,
    finalidade: i.finalidade,
    bairro: i.bairro,
    cidade: i.cidade,
    dormitorios: i.dormitorios,
    suites: i.suites,
    vagas: i.vagas,
    area_util_m2: i.area_util,
    preco: i.preco,
    descricao: i.descricao,
    caracteristicas: i.caracteristicas,
    fotos: i.fotos,
    corretor_responsavel: i.corretor_responsavel,
  }));

  return {
    total_encontrados: filtrados.length,
    mostrando: resumo.length,
    imoveis: resumo,
    sugestao_se_vazio: filtrados.length === 0 ? "Sugira ao lead procurar em bairros vizinhos, ajustar dormitórios, ou expandir orçamento." : null,
  };
}
