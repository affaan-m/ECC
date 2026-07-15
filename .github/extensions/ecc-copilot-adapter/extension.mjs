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

// Build dynamic tools list from agent.yaml commands section
import fs from 'fs';

function parseCommandsFromAgentYaml(path) {
  try {
    const text = fs.readFileSync(path, 'utf8');
    const lines = text.split(/\r?\n/);
    const cmds = [];
    let inCommands = false;
    for (const line of lines) {
      if (!inCommands && line.trim().startsWith('commands:')) {
        inCommands = true;
        continue;
      }
      if (inCommands) {
        const m = line.match(/^\s*-\s+(.+)$/);
        if (m) {
          const cmd = m[1].trim();
          // ignore empty
          if (cmd) cmds.push(cmd);
          continue;
        }
        // stop when reach non-indented or next top-level key
        if (/^\S/.test(line)) break;
      }
    }
    return cmds;
  } catch (e) {
    return [];
  }
}

const agentYamlPath = resolve(repoRoot, 'agent.yaml');
const dynamicCommands = parseCommandsFromAgentYaml(agentYamlPath);

function findScriptForBase(base) {
  const scriptsDir = resolve(repoRoot, 'scripts');
  try {
    const entries = fs.readdirSync(scriptsDir);
    // prefer exact matches
    const exact = entries.find(f => f.toLowerCase() === `${base}.js`.toLowerCase());
    if (exact) return resolve(scriptsDir, exact);
    const prefer = [`${base}-output.js`, `${base}_output.js`, `${base}.mjs`, `${base}-output.mjs`];
    for (const p of prefer) {
      const found = entries.find(f => f.toLowerCase() === p.toLowerCase());
      if (found) return resolve(scriptsDir, found);
    }
    // fallback: any file containing base and ending with .js or .mjs
    const anyMatch = entries.find(f => f.toLowerCase().includes(base.toLowerCase()) && (f.toLowerCase().endsWith('.js') || f.toLowerCase().endsWith('.mjs')));
    if (anyMatch) return resolve(scriptsDir, anyMatch);
  } catch (e) {
    return null;
  }
  return null;
}

function makeToolForCommand(cmd) {
  const toolName = `ecc-${cmd.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
  return {
    name: toolName,
    description: `Wrapper para o comando: ${cmd} (dry-run por padrão)` ,
    parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } }, run: { type: 'boolean' } } },
    handler: async (args) => {
      const a = args && args.args ? args.args : [];
      const runFlag = args && args.run ? true : false;
      const cmdParts = cmd.split(/\s+/);
      const base = cmdParts[0];
      const extraStatic = cmdParts.slice(1);
      const finalArgs = runFlag ? [base, ...extraStatic, ...a] : ['--dry-run', base, ...extraStatic, ...a];
      const res = await runEcc(finalArgs);
      // fallback to script if unknown command or non-zero exit and a candidate script exists
      const textOut = (res.stdout || res.stderr || '').toString();
      const shouldFallback = textOut.includes('Unknown command') || (res.code && res.code !== 0);
      if (shouldFallback) {
        const scriptPath = findScriptForBase(base);
        if (scriptPath) {
          try {
            const node = process.execPath;
            const child = spawn(node, [scriptPath, ...a], { cwd: repoRoot, windowsHide: true });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d) => (stdout += d.toString()));
            child.stderr.on('data', (d) => (stderr += d.toString()));
            const code = await new Promise((r) => child.on('close', r));
            // prefer stdout/stderr from fallback, otherwise return original res
            if (stdout || stderr) return stdout || stderr;
            return `Executado fallback script ${scriptPath} (exit ${code})`;
          } catch (e) {
            return res.stdout || res.stderr || (e && e.message) || `Erro ao executar ${cmd}`;
          }
        }
      }
      return res.stdout || res.stderr || `Finalizado com código ${res.code}`;
    },
  };
}

const dynamicTools = dynamicCommands.map(makeToolForCommand);

// Basic manual tools to keep important handlers
const manualTools = [
  {
    name: 'ecc-help',
    description: 'Mostra ajuda mínima do ecc',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const res = await runEcc(['--help']);
      return res.stdout || res.stderr || 'Comando executado';
    },
  },
  {
    name: 'ecc-run',
    description: 'Executa qualquer comando do ecc (passar args array)',
    parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } } },
    handler: async (args) => {
      const a = args && args.args ? args.args : [];
      const res = await runEcc(a);
      return { code: res.code, stdout: res.stdout, stderr: res.stderr };
    },
  },
  {
    name: 'ecc-skill-create',
    description: "Executa 'ecc skill-create' para gerar um skill scaffold (com fallback)",
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    handler: async (args) => {
      const name = args && args.name ? args.name : 'new-skill';
      const res = await runEcc(['skill-create', name]);
      const out = (res.stdout || res.stderr || '').toString();
      if (out.includes('Unknown command') || (res.code && res.code !== 0)) {
        const scriptPath = findScriptForBase('skill-create') || findScriptForBase('skill_create');
        if (scriptPath) {
          const node = process.execPath;
          const child = spawn(node, [scriptPath, name], { cwd: repoRoot, windowsHide: true });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d) => (stdout += d.toString()));
          child.stderr.on('data', (d) => (stderr += d.toString()));
          await new Promise((r) => child.on('close', r));
          return stdout || stderr || `Skill scaffold gerado (via fallback) para ${name}`;
        }
      }
      return res.stdout || res.stderr || `Skill criado com código ${res.code}`;
    },
  }
];

const session = await joinSession({
  tools: [...manualTools, ...dynamicTools]
});
