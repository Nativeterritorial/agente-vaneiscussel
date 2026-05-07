// Carrega base de conhecimento (financiamento, MCMV, documentação, locação, FAQ, região) como system cacheado
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "conhecimento");

let _cache = null;

export function carregarConhecimento() {
  if (_cache) return _cache;
  const partes = [];
  partes.push("# BASE DE CONHECIMENTO IMOBILIÁRIO\n");
  partes.push("Use as informações abaixo pra responder dúvidas técnicas de leads sobre compra, venda, financiamento, locação e mercado da serra gaúcha. Cite a fonte sempre que possível e, em casos específicos, oriente o lead a falar com o corretor responsável.\n\n---\n\n");

  if (fs.existsSync(DIR)) {
    const arquivos = fs.readdirSync(DIR).filter(f => f.endsWith(".md")).sort();
    for (const arq of arquivos) {
      partes.push(fs.readFileSync(path.join(DIR, arq), "utf8"));
      partes.push("\n\n---\n\n");
    }
  }

  _cache = partes.join("");
  return _cache;
}

export function tamanhoEstimado() {
  const c = carregarConhecimento();
  return { caracteres: c.length, tokensEstimados: Math.round(c.length / 3.5) };
}
