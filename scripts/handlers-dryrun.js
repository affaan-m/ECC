// scripts/handlers-dryrun.js
// Script simples para executar --dry-run em todos os comandos listados em agent.yaml
// Saída em português, projetado para checagem rápida de handlers expostos pela extensão.

import { spawnSync } from 'child_process';
import { resolve } from 'path';
import fs from 'fs';

const repoRoot = resolve(new URL(import.meta.url).pathname.split('/').slice(1).join('\\').replace(/%3A/, ':'), '..', '..', '..');
// Above path resolution is platform-dependent; fallback to process.cwd() when uncertain
const root = process.env.ECC_REPO_ROOT || process.cwd();

function parseCommands(agentYamlPath) {
  try {
    const text = fs.readFileSync(agentYamlPath, 'utf8');
    const lines = text.split(/\r?\n/);
    const cmds = [];
    let inCommands = false;
    for (const line of lines) {
      if (!inCommands && line.trim().startsWith('commands:')) { inCommands = true; continue; }
      if (inCommands) {
        const m = line.match(/^\s*-\s+(.+)$/);
        if (m) { cmds.push(m[1].trim()); continue; }
        if (/^\S/.test(line)) break;
      }
    }
    return cmds;
  } catch (e) {
    console.error('Erro ao ler agent.yaml:', e.message);
    return [];
  }
}

function runDryRunFor(cmd) {
  const parts = cmd.split(/\s+/);
  const base = parts[0];
  const args = ['--dry-run', base, ...parts.slice(1)];
  const node = process.execPath;
  const script = resolve(root, 'scripts', 'ecc.js');
  const res = spawnSync(node, [script, ...args], { cwd: root, encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

async function main() {
  const agentYamlPath = resolve(root, 'agent.yaml');
  console.log('Iniciando verificação dry-run dos comandos do agent.yaml (PT-BR)');
  const cmds = parseCommands(agentYamlPath);
  if (!cmds.length) { console.log('Nenhum comando encontrado em agent.yaml. Saindo.'); process.exit(1); }
  for (const c of cmds) {
    console.log('\n=== Comando:', c, '===');
    try {
      const r = runDryRunFor(c);
      if (r.stdout) console.log('STDOUT:\n', r.stdout.trim());
      if (r.stderr) console.log('STDERR:\n', r.stderr.trim());
      console.log('Código de saída:', r.code);
    } catch (e) {
      console.error('Erro ao executar dry-run para', c, e && e.message);
    }
  }
  console.log('\nVerificação concluída.');
}

main();
