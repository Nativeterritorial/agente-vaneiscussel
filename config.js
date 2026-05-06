// Carrega config do cliente (cliente.json) e expõe pro resto do código
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLIENTE_FILE = process.env.CLIENTE_CONFIG || path.join(__dirname, "cliente.json");

let _cliente = null;

export function getCliente() {
  if (_cliente) return _cliente;
  if (!fs.existsSync(CLIENTE_FILE)) {
    throw new Error(`Arquivo de configuração não encontrado: ${CLIENTE_FILE}. Copie cliente.example.json para cliente.json e edite.`);
  }
  _cliente = JSON.parse(fs.readFileSync(CLIENTE_FILE, "utf8"));
  return _cliente;
}

export function recarregarCliente() {
  _cliente = null;
  return getCliente();
}
