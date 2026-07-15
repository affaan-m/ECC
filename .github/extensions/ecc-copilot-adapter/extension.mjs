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
      name: "ecc-planner",
      description: "Executa tarefas de planejamento via 'ecc plan' (usa --dry-run por padrão).\nParâmetros: { args: string[], run: boolean } (run=true executa de fato)",
      parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } }, run: { type: "boolean" } } },
      handler: async (args) => {
        const a = args && args.args ? args.args : [];
        const runFlag = args && args.run ? true : false;
        const cmd = runFlag ? ["plan", ...a] : ["--dry-run", "plan", ...a];
        const res = await runEcc(cmd);
        return res.stdout || res.stderr || `Finalizado com código ${res.code}`;
      },
    },
    {
      name: "ecc-security-reviewer",
      description: "Executa varredura de segurança via 'ecc security-scan' (usa --dry-run por padrão). Parâmetros: { args: string[], run: boolean }",
      parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } }, run: { type: "boolean" } } },
      handler: async (args) => {
        const a = args && args.args ? args.args : [];
        const runFlag = args && args.run ? true : false;
        const cmd = runFlag ? ["security-ioc-scan", ...a] : ["--dry-run", "security-ioc-scan", ...a];
        const res = await runEcc(cmd);
        return res.stdout || res.stderr || `Finalizado com código ${res.code}`;
      },
    },
    {
      name: "ecc-tdd-guide",
      description: "Simplifica execução de fluxo TDD. Usa 'npm test' via ecc (dry-run por padrão). Parâmetros: { run: boolean }",
      parameters: { type: "object", properties: { run: { type: "boolean" } } },
      handler: async (args) => {
        const runFlag = args && args.run ? true : false;
        if (!runFlag) {
          // dry-run: exibir instrução e ajuda
          const res = await runEcc(["--dry-run", "test"]);
          return res.stdout || res.stderr || 'dry-run concluído';
        }
        // risco: executar test pode ser pesado; expos como opcional
        const res = await runEcc(["test"]);
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
    {
      name: "ecc-plan-canvas",
      description: "Executa o script de plan-canvas (ajuda disponível via --help)",
      parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } } } },
      handler: async (args) => {
        const a = args && args.args ? args.args : [];
        // chamar script diretamente para garantir comportamento
        const node = process.execPath;
        const script = resolve(repoRoot, 'scripts', 'plan-canvas.js');
        const child = spawn(node, [script, ...a], { cwd: repoRoot, windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        await new Promise((r) => child.on('close', r));
        return stdout || stderr || `plan-canvas finalizado`;
      },
    },
    {
      name: "ecc-code-review-pr",
      description: "Executa code-review para um pull request específico. Parâmetros: { pr_number: number, repo: string (opcional) }",
      parameters: { type: "object", properties: { pr_number: { type: "number" }, repo: { type: "string" } } },
      handler: async (args) => {
        const pr = args && args.pr_number ? args.pr_number : null;
        const repo = args && args.repo ? args.repo : null;
        const cmd = [];
        if (repo) cmd.push('--repo', repo);
        if (pr) cmd.push('--pr', pr.toString());
        // use code-review subcommand
        const res = await runEcc(['code-review', ...cmd]);
        return res.stdout || res.stderr || `Finalizado com código ${res.code}`;
      },
    },
    {
      name: "ecc-update-docs",
      description: "Executa o comando 'update-docs' do ecc para atualizar documentação gerada",
      parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } } } },
      handler: async (args) => {
        const a = args && args.args ? args.args : [];
        const res = await runEcc(['update-docs', ...a]);
        return res.stdout || res.stderr || `Finalizado com código ${res.code}`;
      },
    },
  ],
});
