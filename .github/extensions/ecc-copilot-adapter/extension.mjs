// Extension: ecc-copilot-adapter
// Adapter para expor comandos 'ecc' como extensões do Copilot

import { joinSession } from "@github/copilot-sdk/extension";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// sobe 4 níveis: ...\.github\extensions\ecc-copilot-adapter -> repo root
const repoRoot = resolve(__dirname, "..", "..", "..", "..");

async function runEcc(args = []) {
  return new Promise((resolvePromise) => {
    const node = process.execPath; // executável node atual
    const script = resolve(repoRoot, "scripts", "ecc.js");
    const child = spawn(node, [script, ...args], { cwd: repoRoot, windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

const session = await joinSession({
  tools: [
    {
      name: "ecc-help",
      description: "Mostra ajuda mínima do ecc",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const res = await runEcc(["--help"]);
        return res.stdout || res.stderr || "Comando executado";
      },
    },
    {
      name: "ecc-plan",
      description: "Executa o comando 'plan' do ecc (mapeia para 'ecc plan')",
      parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } } } },
      handler: async (args) => {
        const a = args && args.args ? args.args : [];
        const res = await runEcc(["plan", ...a]);
        return res.stdout || res.stderr || `Finalizado com código ${res.code}`;
      },
    },
    {
      name: "ecc-code-review",
      description: "Executa 'ecc code-review' com argumentos opcionais",
      parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } } } },
      handler: async (args) => {
        const a = args && args.args ? args.args : [];
        const res = await runEcc(["code-review", ...a]);
        return res.stdout || res.stderr || `Finalizado com código ${res.code}`;
      },
    },
    {
      name: "ecc-skill-create",
      description: "Executa 'ecc skill-create' para gerar um skill scaffold (com fallback para script direto)",
      parameters: { type: "object", properties: { name: { type: "string" } } },
      handler: async (args) => {
        const name = args && args.name ? args.name : "new-skill";
        // Primeiro, tente rodar via CLI 'ecc'
        const res = await runEcc(["skill-create", name]);
        const out = (res.stdout || res.stderr || '').toString();
        if (out.includes('Unknown command') || res.code !== 0) {
          // Fallback: executar script direto scripts/skill-create-output.js
          const node = process.execPath;
          const script = resolve(repoRoot, 'scripts', 'skill-create-output.js');
          const child = spawn(node, [script, name], { cwd: repoRoot, windowsHide: true });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d) => (stdout += d.toString()));
          child.stderr.on('data', (d) => (stderr += d.toString()));
          await new Promise((r) => child.on('close', r));
          return stdout || stderr || `Skill scaffold gerado (via fallback) para ${name}`;
        }
        return res.stdout || res.stderr || `Skill criado com código ${res.code}`;
      },
    },
    {
      name: "ecc-run",
      description: "Executa qualquer comando do ecc (passar args array)",
      parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } } } },
      handler: async (args) => {
        const a = args && args.args ? args.args : [];
        const res = await runEcc(a);
        return { code: res.code, stdout: res.stdout, stderr: res.stderr };
      },
    },
  ],
});
