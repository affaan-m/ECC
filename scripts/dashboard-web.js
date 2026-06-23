#!/usr/bin/env node
/**
 * ECC Capabilities Dashboard — agents, skills, commands, MCPs, rules & hooks
 * With multi-language, routing, search suggestions, recently viewed, fine UI
 *
 * Usage: node scripts/dashboard-web.js [port]
 * Open http://localhost:3456
 *
 * Contribution: https://github.com/affaan-m/ECC
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

function parsePort(v) {
  const n = parseInt(String(v), 10);
  if (isNaN(n) || n < 1 || n > 65535) { console.error('[ECC] Invalid port: ' + v + ' — using 3456'); return 3456; }
  return n;
}
const PORT = parsePort(process.argv[2] || process.env.ECC_DASHBOARD_PORT || '3456');
const ROOT = path.resolve(__dirname, '..');

function readFrontmatter(p) {
  try {
    const c = fs.readFileSync(p, 'utf8');
    const m = c.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const fm = {};
    for (const l of m[1].split('\n')) {
      const s = l.indexOf(':'); if (s <= 0) continue;
      let k = l.slice(0, s).trim(), v = l.slice(s + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v.startsWith('[') && v.endsWith(']')) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1).split(',').map(x => x.trim().replace(/["']/g, '')); } }
      fm[k] = v;
    }
    fm._body = c.replace(/^---[\s\S]*?---\n*/, '').trim();
    return fm;
  } catch { return {}; }
}
function readSkill(p) { try { const c = fs.readFileSync(p, 'utf8'); const fm = readFrontmatter(p); return { d: fm.description || '', b: c.replace(/^---[\s\S]*?---\n*/, '').trim() }; } catch { return { d: '', b: '' }; } }

function loadAgents(_root) {
  const root = _root || ROOT;
  const dir = path.join(root, 'agents'); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => {
    const fm = readFrontmatter(path.join(dir, f));
    return { n: fm.name || f.replace('.md', ''), d: fm.description || '', m: fm.model || 'default', t: Array.isArray(fm.tools) ? fm.tools : [], b: (fm._body || '').slice(0, 1200), f };
  });
}
function loadSkills(_root) {
  const root = _root || ROOT;
  const dir = path.join(root, 'skills'); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(d => { try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; } }).sort().map(d => {
    const r = readSkill(path.join(dir, d, 'SKILL.md')); return { n: d, d: r.d, b: r.b.slice(0, 1000) };
  });
}
function loadCommands(_root) {
  const root = _root || ROOT;
  const dir = path.join(root, 'commands'); if (!fs.existsSync(dir)) return [];
  const cm = { plan: 'Planning', 'plan-': 'Planning', 'prp-': 'Git & PR', pr: 'Git & PR', 'review-': 'Review', 'code-': 'Review', build: 'Build', fix: 'Build', test: 'Testing', 'e2e': 'Testing', coverage: 'Testing', quality: 'Testing', session: 'Session', save: 'Session', resume: 'Session', skill: 'Knowledge', learn: 'Knowledge', instinct: 'Knowledge', evolve: 'Knowledge', ecc: 'System', hookify: 'System', model: 'System', setup: 'System', multi: 'Multi-Agent', security: 'Security', harness: 'Security', 'go-': 'Languages', 'rust-': 'Languages', 'cpp-': 'Languages', 'kotlin-': 'Languages', 'flutter-': 'Languages', 'react-': 'Languages', 'python-': 'Languages', 'fastapi-': 'Languages', 'gradle-': 'Languages', gan: 'GAN', marketing: 'Marketing', jira: 'Project', pm2: 'Process', cost: 'Analytics', promote: 'Project', aside: 'Other', santa: 'Fun' };
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => {
    const fm = readFrontmatter(path.join(dir, f));
    const n = '/' + f.replace('.md', ''); let c = 'Other';
    for (const [p, cat] of Object.entries(cm)) if (f.startsWith(p)) { c = cat; break; }
    return { n, f, d: fm.description || fm['argument-hint'] || '', c, b: (fm._body || '').slice(0, 600) };
  });
}
function loadRules(_root) {
  const root = _root || ROOT;
  const dir = path.join(root, 'rules'); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(d => { try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; } }).sort().map(l => ({ l, f: fs.readdirSync(path.join(dir, l)).filter(f => f.endsWith('.md')).sort().map(f => f.replace('.md', '')) }));
}
function loadMcps(_root) {
  const root = _root || ROOT;
  const r = [];
  const m = path.join(root, '.mcp.json');
  if (fs.existsSync(m)) { try { const d = JSON.parse(fs.readFileSync(m, 'utf8')); r.push({ f: '.mcp.json', s: Object.entries(d.mcpServers || {}).map(([k, v]) => ({ n: k, cmd: typeof v === 'object' ? (v.command || v.url || '') : String(v), args: v.args || [], env: v.env ? Object.keys(v.env).reduce((a,k)=>{a[k]='••••••'; return a;}, {}) : {}, type: v.type || 'stdio' })) }); } catch (e) { console.error('[ECC] Failed to parse .mcp.json:', e.message); } }
  const dir = path.join(root, 'mcp-configs');
  if (fs.existsSync(dir)) { for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) { try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); r.push({ f, s: Object.entries(d.mcpServers || {}).map(([k, v]) => ({ n: k, cmd: typeof v === 'object' ? (v.command || v.url || '') : String(v), args: v.args || [], env: v.env ? Object.keys(v.env).reduce((a,k)=>{a[k]='••••••'; return a;}, {}) : {}, type: v.type || 'stdio' })) }); } catch (e) { console.error('[ECC] Failed to parse mcp-configs/' + f + ':', e.message); } } }
  return r;
}
function loadHooks(_root) {
  const root = _root || ROOT;
  const p = path.join(root, 'hooks', 'hooks.json'); if (!fs.existsSync(p)) return [];
  try { const d = JSON.parse(fs.readFileSync(p, 'utf8')); const h = []; for (const [ev, es] of Object.entries(d.hooks || {})) for (const e of es || []) h.push({ ev, m: e.matcher || '*', id: e.id || '', d: e.description || '' }); return h; } catch (e) { console.error('[ECC] Failed to parse hooks/hooks.json:', e.message); return []; }
}

const LANG = {
  en: { name:'English', title:'ECC Capabilities', search:'Search agents, skills, commands...', agents:'Agents', skills:'Skills', commands:'Commands', rules:'Rules', mcps:'MCPs', hooks:'Hooks', ruleSets:'Rule Sets', mcpConfigs:'MCP Configs', all:'All', reviewers:'Reviewers', buildResolvers:'Build Resolvers', architects:'Architects', security:'Security', testing:'Testing', patterns:'Patterns', design:'Design', research:'Research', data:'Data', agent:'Agent', devops:'DevOps', description:'Description', details:'Details', tools:'Tools', copied:'Copied', noMcps:'No MCP configs found', checkMcps:'Check mcp-configs/ directory', noHooks:'No hooks configured', recentlyViewed:'Recently Viewed', clearHistory:'Clear', ruleFiles:'rule files', more:'more', servers:'servers', skill:'Skill', workflow:'workflow', event:'Event', matcher:'Matcher', id:'ID', contribution:'Contribution to ECC' },
  pt: { name:'Português', title:'Recursos do ECC', search:'Pesquisar agentes, skills, comandos...', agents:'Agentes', skills:'Skills', commands:'Comandos', rules:'Regras', mcps:'MCPs', hooks:'Hooks', ruleSets:'Conjuntos de Regras', mcpConfigs:'Configs MCP', all:'Todos', reviewers:'Revisores', buildResolvers:'Resolvedores', architects:'Arquitetos', security:'Segurança', testing:'Testes', patterns:'Padrões', design:'Design', research:'Pesquisa', data:'Dados', agent:'Agente', devops:'DevOps', description:'Descrição', details:'Detalhes', tools:'Ferramentas', copied:'Copiado', noMcps:'Nenhuma config MCP encontrada', checkMcps:'Verifique mcp-configs/', noHooks:'Nenhum hook configurado', recentlyViewed:'Vistos Recentemente', clearHistory:'Limpar', ruleFiles:'arquivos de regras', more:'mais', servers:'servidores', skill:'Skill', workflow:'workflow', event:'Evento', matcher:'Corresp.', id:'ID', contribution:'Contribuição ao ECC' },
  zh: { name:'简体中文', title:'ECC 能力', search:'搜索代理、技能、命令...', agents:'代理', skills:'技能', commands:'命令', rules:'规则', mcps:'MCP', hooks:'钩子', ruleSets:'规则集', mcpConfigs:'MCP 配置', all:'全部', reviewers:'审查者', buildResolvers:'构建解析器', architects:'架构师', security:'安全', testing:'测试', patterns:'模式', design:'设计', research:'研究', data:'数据', agent:'代理', devops:'运维', description:'描述', details:'详情', tools:'工具', copied:'已复制', noMcps:'未找到 MCP 配置', checkMcps:'检查 mcp-configs/ 目录', noHooks:'未配置钩子', recentlyViewed:'最近查看', clearHistory:'清除', ruleFiles:'规则文件', more:'更多', servers:'服务器', skill:'技能', workflow:'工作流', event:'事件', matcher:'匹配器', id:'ID', contribution:'对 ECC 的贡献' },
  zht: { name:'繁體中文', title:'ECC 能力', search:'搜索代理、技能、命令...', agents:'代理', skills:'技能', commands:'命令', rules:'規則', mcps:'MCP', hooks:'鉤子', ruleSets:'規則集', mcpConfigs:'MCP 配置', all:'全部', reviewers:'審查者', buildResolvers:'構建解析器', architects:'架構師', security:'安全', testing:'測試', patterns:'模式', design:'設計', research:'研究', data:'數據', agent:'代理', devops:'運維', description:'描述', details:'詳情', tools:'工具', copied:'已複製', noMcps:'未找到 MCP 配置', checkMcps:'檢查 mcp-configs/ 目錄', noHooks:'未配置鉤子', recentlyViewed:'最近查看', clearHistory:'清除', ruleFiles:'規則文件', more:'更多', servers:'服務器', skill:'技能', workflow:'工作流', event:'事件', matcher:'匹配器', id:'ID', contribution:'對 ECC 的貢獻' },
  ja: { name:'日本語', title:'ECC 機能一覧', search:'エージェント、スキル、コマンドを検索...', agents:'エージェント', skills:'スキル', commands:'コマンド', rules:'ルール', mcps:'MCP', hooks:'フック', ruleSets:'ルールセット', mcpConfigs:'MCP設定', all:'すべて', reviewers:'レビュアー', buildResolvers:'ビルド解決', architects:'アーキテクト', security:'セキュリティ', testing:'テスト', patterns:'パターン', design:'デザイン', research:'研究', data:'データ', agent:'エージェント', devops:'DevOps', description:'説明', details:'詳細', tools:'ツール', copied:'コピーしました', noMcps:'MCP設定が見つかりません', checkMcps:'mcp-configs/を確認', noHooks:'フックが設定されていません', recentlyViewed:'最近見た項目', clearHistory:'クリア', ruleFiles:'ルールファイル', more:'もっと見る', servers:'サーバー', skill:'スキル', workflow:'ワークフロー', event:'イベント', matcher:'マッチャー', id:'ID', contribution:'ECCへの貢献' },
  ko: { name:'한국어', title:'ECC 기능', search:'에이전트, 스킬, 명령어 검색...', agents:'에이전트', skills:'스킬', commands:'명령어', rules:'규칙', mcps:'MCP', hooks:'훅', ruleSets:'규칙 세트', mcpConfigs:'MCP 설정', all:'전체', reviewers:'리뷰어', buildResolvers:'빌드 해결사', architects:'아키텍트', security:'보안', testing:'테스트', patterns:'패턴', design:'디자인', research:'연구', data:'데이터', agent:'에이전트', devops:'DevOps', description:'설명', details:'세부정보', tools:'도구', copied:'복사됨', noMcps:'MCP 설정을 찾을 수 없음', checkMcps:'mcp-configs/ 확인', noHooks:'훅이 설정되지 않음', recentlyViewed:'최근 본 항목', clearHistory:'지우기', ruleFiles:'규칙 파일', more:'더보기', servers:'서버', skill:'스킬', workflow:'워크플로우', event:'이벤트', matcher:'매처', id:'ID', contribution:'ECC에 기여' },
  tr: { name:'Türkçe', title:'ECC Yetenekleri', search:'Ajan, beceri, komut ara...', agents:'Ajanlar', skills:'Beceriler', commands:'Komutlar', rules:'Kurallar', mcps:'MCP\'ler', hooks:'Kancalar', ruleSets:'Kural Setleri', mcpConfigs:'MCP Yapılandırmaları', all:'Tümü', reviewers:'İnceleyenler', buildResolvers:'Derleme Çözücüler', architects:'Mimarlar', security:'Güvenlik', testing:'Test', patterns:'Desenler', design:'Tasarım', research:'Araştırma', data:'Veri', agent:'Ajan', devops:'DevOps', description:'Açıklama', details:'Detaylar', tools:'Araçlar', copied:'Kopyalandı', noMcps:'MCP yapılandırması bulunamadı', checkMcps:'mcp-configs/ dizinini kontrol edin', noHooks:'Kanca yapılandırılmamış', recentlyViewed:'Son Görüntülenenler', clearHistory:'Temizle', ruleFiles:'kural dosyası', more:'daha fazla', servers:'sunucu', skill:'Beceri', workflow:'iş akışı', event:'Olay', matcher:'Eşleştirici', id:'ID', contribution:'ECC\'ye Katkı' },
  ru: { name:'Русский', title:'Возможности ECC', search:'Поиск агентов, навыков, команд...', agents:'Агенты', skills:'Навыки', commands:'Команды', rules:'Правила', mcps:'MCP', hooks:'Хуки', ruleSets:'Наборы правил', mcpConfigs:'MCP конфиги', all:'Все', reviewers:'Ревьюеры', buildResolvers:'Сборщики', architects:'Архитекторы', security:'Безопасность', testing:'Тестирование', patterns:'Паттерны', design:'Дизайн', research:'Исследования', data:'Данные', agent:'Агент', devops:'DevOps', description:'Описание', details:'Детали', tools:'Инструменты', copied:'Скопировано', noMcps:'MCP конфиги не найдены', checkMcps:'Проверьте mcp-configs/', noHooks:'Хуки не настроены', recentlyViewed:'Недавние', clearHistory:'Очистить', ruleFiles:'файлов правил', more:'ещё', servers:'серверов', skill:'Навык', workflow:'воркфлоу', event:'Событие', matcher:'Матчер', id:'ID', contribution:'Вклад в ECC' },
  vi: { name:'Tiếng Việt', title:'Năng lực ECC', search:'Tìm kiếm agent, kỹ năng, lệnh...', agents:'Agent', skills:'Kỹ năng', commands:'Lệnh', rules:'Luật', mcps:'MCP', hooks:'Hook', ruleSets:'Bộ luật', mcpConfigs:'Cấu hình MCP', all:'Tất cả', reviewers:'Người đánh giá', buildResolvers:'Trình giải quyết build', architects:'Kiến trúc sư', security:'Bảo mật', testing:'Kiểm thử', patterns:'Mẫu', design:'Thiết kế', research:'Nghiên cứu', data:'Dữ liệu', agent:'Agent', devops:'DevOps', description:'Mô tả', details:'Chi tiết', tools:'Công cụ', copied:'Đã sao chép', noMcps:'Không tìm thấy cấu hình MCP', checkMcps:'Kiểm tra mcp-configs/', noHooks:'Chưa có hook nào', recentlyViewed:'Đã xem gần đây', clearHistory:'Xóa', ruleFiles:'tệp luật', more:'thêm', servers:'máy chủ', skill:'Kỹ năng', workflow:'quy trình', event:'Sự kiện', matcher:'Bộ so khớp', id:'ID', contribution:'Đóng góp cho ECC' },
  th: { name:'ไทย', title:'ความสามารถ ECC', search:'ค้นหาเอเจนต์ ทักษะ คำสั่ง...', agents:'เอเจนต์', skills:'ทักษะ', commands:'คำสั่ง', rules:'กฎ', mcps:'MCP', hooks:'ฮุค', ruleSets:'ชุดกฎ', mcpConfigs:'การตั้งค่า MCP', all:'ทั้งหมด', reviewers:'ผู้ตรวจสอบ', buildResolvers:'ตัวแก้ไขบิลด์', architects:'สถาปนิก', security:'ความปลอดภัย', testing:'การทดสอบ', patterns:'รูปแบบ', design:'ออกแบบ', research:'วิจัย', data:'ข้อมูล', agent:'เอเจนต์', devops:'DevOps', description:'คำอธิบาย', details:'รายละเอียด', tools:'เครื่องมือ', copied:'คัดลอกแล้ว', noMcps:'ไม่พบการตั้งค่า MCP', checkMcps:'ตรวจสอบ mcp-configs/', noHooks:'ไม่มีการตั้งค่าฮุค', recentlyViewed:'ที่ดูล่าสุด', clearHistory:'ล้าง', ruleFiles:'ไฟล์กฎ', more:'เพิ่มเติม', servers:'เซิร์ฟเวอร์', skill:'ทักษะ', workflow:'เวิร์กโฟลว์', event:'เหตุการณ์', matcher:'ตัวจับคู่', id:'ID', contribution:'มีส่วนร่วมกับ ECC' },
  de: { name:'Deutsch', title:'ECC-Funktionen', search:'Agenten, Fähigkeiten, Befehle suchen...', agents:'Agenten', skills:'Fähigkeiten', commands:'Befehle', rules:'Regeln', mcps:'MCPs', hooks:'Hooks', ruleSets:'Regelsätze', mcpConfigs:'MCP-Konfigurationen', all:'Alle', reviewers:'Prüfer', buildResolvers:'Build-Resolver', architects:'Architekten', security:'Sicherheit', testing:'Tests', patterns:'Muster', design:'Design', research:'Forschung', data:'Daten', agent:'Agent', devops:'DevOps', description:'Beschreibung', details:'Details', tools:'Werkzeuge', copied:'Kopiert', noMcps:'Keine MCP-Konfigurationen gefunden', checkMcps:'Prüfen Sie mcp-configs/', noHooks:'Keine Hooks konfiguriert', recentlyViewed:'Zuletzt angesehen', clearHistory:'Löschen', ruleFiles:'Regeldateien', more:'mehr', servers:'Server', skill:'Fähigkeit', workflow:'Workflow', event:'Ereignis', matcher:'Matcher', id:'ID', contribution:'Beitrag zu ECC' },
};
const LANG_KEYS = Object.keys(LANG);

function renderHTML(data) {
  // data passed from Node.js - use for static template values
  const ag = JSON.stringify(data.agents).replace(/</g, '\\u003c');
  const sk = JSON.stringify(data.skills).replace(/</g, '\\u003c');
  const co = JSON.stringify(data.commands).replace(/</g, '\\u003c');
  const ru = JSON.stringify(data.rules).replace(/</g, '\\u003c');
  const mc = JSON.stringify(data.mcps).replace(/</g, '\\u003c');
  const ho = JSON.stringify(data.hooks).replace(/</g, '\\u003c');
  const ll = JSON.stringify(LANG).replace(/</g, '\\u003c');
  const lc = JSON.stringify(LANG_KEYS);

  /* eslint-disable no-useless-escape */
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>ECC Capabilities</title>
<style>
  :root {
    --bg: #080a0e; --bg2: #0d0f14; --bg3: #13161e; --bg4: #191d2a;
    --surface: #101218; --surface-hover: #171a24; --border: #1d2130; --border-light: #272c3e;
    --text: #dfe2e9; --text2: #80859a; --text3: #4c5168;
    --accent: #6885e8; --accent-glow: rgba(104,133,232,0.15); --accent-dim: #3d5ab8;
    --green: #4acb8a; --green-glow: rgba(74,203,138,0.15);
    --orange: #eca85a; --orange-glow: rgba(236,168,90,0.15);
    --pink: #e26a9e; --pink-glow: rgba(226,106,158,0.15);
    --red: #e86060; --red-glow: rgba(232,96,96,0.15);
    --teal: #4acbbe; --teal-glow: rgba(74,203,190,0.15);
    --radius: 8px; --radius-sm: 5px;
    --font: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, sans-serif;
    --mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', monospace;
    --shadow: 0 1px 2px rgba(0,0,0,0.4);
    --shadow-lg: 0 8px 32px rgba(0,0,0,0.6);
  }
  [data-theme="light"] {
    --bg: #f4f5f7; --bg2: #ffffff; --bg3: #eaecef; --bg4: #dfe2e6;
    --surface: #ffffff; --surface-hover: #f4f5f7; --border: #cdd1d9; --border-light: #dde1e8;
    --text: #181b23; --text2: #585e6e; --text3: #9197a8;
    --accent: #4560d0; --accent-glow: rgba(69,96,208,0.08); --accent-dim: #2f44a0;
    --green: #16a34a; --green-glow: rgba(22,163,74,0.08);
    --orange: #d97706; --orange-glow: rgba(217,119,6,0.08);
    --pink: #c73877; --pink-glow: rgba(199,56,119,0.08);
    --red: #dc2626; --red-glow: rgba(220,38,38,0.08);
    --teal: #0d9488; --teal-glow: rgba(13,148,136,0.08);
    --shadow: 0 1px 2px rgba(0,0,0,0.04);
    --shadow-lg: 0 8px 32px rgba(0,0,0,0.08);
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;line-height:1.4}
  ::selection{background:var(--accent);color:#fff}
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}

  .header{background:color-mix(in srgb,var(--bg2) 85%,transparent);border-bottom:1px solid var(--border);padding:0 28px;display:flex;align-items:center;height:54px;gap:12px;position:sticky;top:0;z-index:100;backdrop-filter:blur(16px)}
  .brand{display:flex;align-items:center;gap:9px;cursor:pointer;user-select:none;flex-shrink:0}
  .brand .logo{width:26px;height:26px;background:linear-gradient(135deg,var(--accent),var(--pink));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;transition:transform .15s}
  .brand:hover .logo{transform:scale(1.05)}
  .brand h1{font-size:14px;font-weight:600;letter-spacing:-.01em}
  .brand .ver{font-size:9px;font-weight:500;color:var(--text3);background:var(--bg3);padding:1px 6px;border-radius:3px;margin-left:2px;letter-spacing:0}
  .header-center{flex:1;min-width:0}
  .header-right{display:flex;align-items:center;gap:6px;flex-shrink:0}

  .search{position:relative;width:260px}
  .search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text3);pointer-events:none}
  .search input{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:6px 10px 6px 30px;color:var(--text);font-size:12.5px;outline:none;transition:all .2s;font-family:var(--font)}
  .search input:focus{border-color:var(--accent);background:var(--bg2);box-shadow:0 0 0 3px var(--accent-glow)}
  .search input::placeholder{color:var(--text3)}
  .search .hint{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:9px;color:var(--text3);background:var(--bg4);padding:1px 4px;border-radius:3px;pointer-events:none;line-height:1.4}

  .suggest{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-lg);max-height:360px;overflow-y:auto;display:none;z-index:200}
  .suggest.show{display:block}
  .suggest .sg{padding:4px 0}
  .suggest .sg-label{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);padding:5px 10px 2px}
  .suggest .si{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;transition:background .1s;font-size:12px;color:var(--text)}
  .suggest .si:hover,.suggest .si.active{background:var(--surface-hover)}
  .suggest .si .ic{width:18px;height:18px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0}
  .suggest .si .ic.a{background:var(--accent-glow);color:var(--accent)}
  .suggest .si .ic.s{background:var(--green-glow);color:var(--green)}
  .suggest .si .ic.c{background:var(--orange-glow);color:var(--orange)}
  .suggest .si .sn{font-weight:500}
  .suggest .si .sd{font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .suggest .si .stg{font-size:9px;color:var(--text3);background:var(--bg3);padding:0 5px;border-radius:3px}

  .icon-btn{width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s;font-size:13px}
  .icon-btn:hover{border-color:var(--border-light);color:var(--text);background:var(--bg4)}
  .icon-btn:active{transform:scale(.93)}

  .lang-wrap{position:relative}
  .lang-btn{font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;transition:all .12s;display:flex;align-items:center;gap:4px;font-family:var(--font)}
  .lang-btn:hover{border-color:var(--border-light);color:var(--text)}
  .lang-drop{position:absolute;top:calc(100% + 4px);right:0;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-lg);min-width:180px;display:none;z-index:200;max-height:280px;overflow-y:auto}
  .lang-drop.show{display:block}
  .lang-drop .li{padding:6px 12px;cursor:pointer;font-size:12px;color:var(--text2);transition:background .1s}
  .lang-drop .li:hover{background:var(--surface-hover);color:var(--text)}
  .lang-drop .li.active{color:var(--accent);background:var(--accent-glow)}

  .nav{display:flex;background:color-mix(in srgb,var(--bg2) 80%,transparent);border-bottom:1px solid var(--border);padding:0 28px;gap:2px;position:sticky;top:54px;z-index:99;overflow-x:auto;backdrop-filter:blur(12px)}
  .nav-it{padding:10px 16px;cursor:pointer;font-size:12.5px;font-weight:500;color:var(--text2);border-bottom:2px solid transparent;transition:all .12s;white-space:nowrap;background:none;border-top:none;border-left:none;border-right:none;display:flex;align-items:center;gap:5px;font-family:var(--font)}
  .nav-it:hover{color:var(--text);background:var(--accent-glow)}
  .nav-it.active{color:var(--accent);border-bottom-color:var(--accent)}
  .nav-it .ct{font-size:9px;font-weight:500;padding:0 5px;border-radius:3px;background:var(--bg3);color:var(--text3);line-height:1.5}
  .nav-it.active .ct{background:var(--accent-glow);color:var(--accent)}

  .out{max-width:1280px;margin:0 auto;padding:18px 28px;min-height:calc(100vh - 110px)}

  .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:16px}
  .stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 8px;text-align:center;cursor:pointer;transition:all .12s}
  .stat:hover{border-color:var(--border-light);transform:translateY(-1px);box-shadow:var(--shadow)}
  .stat:active{transform:translateY(0)}
  .stat .num{font-size:20px;font-weight:700;line-height:1.2}
  .stat .lbl{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-top:1px;font-weight:500}
  .stat.c0 .num{color:var(--accent)}.stat.c1 .num{color:var(--green)}.stat.c2 .num{color:var(--orange)}
  .stat.c3 .num{color:var(--pink)}.stat.c4 .num{color:var(--teal)}.stat.c5 .num{color:var(--red)}

  .panel{display:none;animation:fadeIn .12s ease}
  .panel.active{display:block}
  @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}

  .recent-bar{display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:8px 12px;background:var(--accent-glow);border:1px solid rgba(104,133,232,0.3);border-radius:var(--radius);font-size:12px;flex-wrap:wrap}
  .recent-bar .rb-lbl{font-weight:600;color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .recent-bar .rb-items{display:flex;gap:4px;flex-wrap:wrap;flex:1}
  .recent-bar .rb-item{font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bg3);cursor:pointer;transition:all .12s;color:var(--text2)}
  .recent-bar .rb-item:hover{background:var(--accent-glow);color:var(--accent)}
  .recent-bar .rb-clear{font-size:10px;color:var(--text3);cursor:pointer;padding:2px 6px;border-radius:3px;transition:all .12s;flex-shrink:0}
  .recent-bar .rb-clear:hover{color:var(--red);background:var(--red-glow)}

  .filters{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:12px}
  .filters button{font-size:10.5px;font-weight:500;padding:3px 10px;border-radius:5px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;transition:all .12s;font-family:var(--font)}
  .filters button:hover{border-color:var(--border-light);color:var(--text)}
  .filters button.active{background:var(--accent-glow);border-color:var(--accent);color:var(--accent)}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:6px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;cursor:pointer;transition:all .12s;position:relative}
  .card:hover{border-color:var(--border-light);background:var(--surface-hover);box-shadow:var(--shadow)}
  .card:active{transform:scale(.995)}
  .card .top{display:flex;align-items:flex-start;justify-content:space-between;gap:6px}
  .card .top .il{display:flex;align-items:center;gap:6px;min-width:0}
  .card .top .il .ic{width:20px;height:20px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0}
  .card .top .il .ic.i0{background:var(--accent-glow);color:var(--accent)}
  .card .top .il .ic.i1{background:var(--green-glow);color:var(--green)}
  .card .top .il .ic.i2{background:var(--orange-glow);color:var(--orange)}
  .card .top .il .ic.i3{background:var(--pink-glow);color:var(--pink)}
  .card .top .il .ic.i4{background:var(--teal-glow);color:var(--teal)}
  .card .top .il .ic.i5{background:var(--red-glow);color:var(--red)}
  .card .top .il .nm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .card .top .bd{font-size:9px;font-weight:600;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.03em;flex-shrink:0}
  .card .top .bd.opus{background:var(--pink-glow);color:var(--pink)}
  .card .top .bd.sonnet{background:var(--accent-glow);color:var(--accent)}
  .card .top .bd.haiku{background:var(--green-glow);color:var(--green)}
  .card .desc{font-size:11.5px;color:var(--text2);margin-top:4px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card .tags{margin-top:6px;display:flex;flex-wrap:wrap;gap:2px}
  .card .tags .t{font-size:9px;font-weight:500;padding:1px 5px;border-radius:3px;background:var(--bg3);color:var(--text3)}
  .card .ar{position:absolute;bottom:10px;right:12px;font-size:9px;color:var(--text3);opacity:0;transition:opacity .12s}
  .card:hover .ar{opacity:1}

  .cmd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:4px}
  .cmd-it{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 10px;display:flex;align-items:center;gap:8px;transition:all .12s;cursor:pointer}
  .cmd-it:hover{border-color:var(--border-light);background:var(--surface-hover)}
  .cmd-it .cl{flex:1;min-width:0}
  .cmd-it .cn{font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--accent)}
  .cmd-it .cd{font-size:10.5px;color:var(--text2);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cmd-it .cc{font-size:9px;color:var(--text3);font-weight:500}
  .cmd-it .cpy{flex-shrink:0;width:24px;height:24px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text3);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s;font-size:11px}
  .cmd-it .cpy:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-glow)}
  .cmd-it .cpy.done{border-color:var(--green);color:var(--green);background:var(--green-glow)}

  .rules-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px}
  .rule-cd{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;cursor:pointer;transition:all .12s}
  .rule-cd:hover{border-color:var(--border-light);box-shadow:var(--shadow)}
  .rule-cd h3{font-size:12.5px;font-weight:600;color:var(--accent);text-transform:capitalize;margin-bottom:5px;display:flex;align-items:center;gap:5px}
  .rule-cd .rf{font-size:10.5px;color:var(--text2);padding:1.5px 0;display:flex;align-items:center;gap:4px}
  .rule-cd .rf::before{content:'';width:2.5px;height:2.5px;border-radius:50%;background:var(--text3);flex-shrink:0}

  .mcp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:6px}
  .mcp-cd{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;cursor:pointer;transition:all .12s}
  .mcp-cd:hover{border-color:var(--border-light);box-shadow:var(--shadow)}
  .mcp-cd h3{font-size:11.5px;font-weight:600;margin-bottom:5px;color:var(--text);display:flex;align-items:center;gap:5px}
  .mcp-cd .st{display:inline-block;font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:var(--bg3);color:var(--text2);margin:1.5px;font-family:var(--mono);max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .mcp-cd .st small{color:var(--text3);font-weight:400;margin-left:3px;font-family:var(--font)}

  .hw{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}
  .ht{width:100%;border-collapse:collapse;font-size:11.5px}
  .ht th{text-align:left;font-weight:600;color:var(--text3);padding:8px 10px;border-bottom:1px solid var(--border);font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;background:var(--bg2)}
  .ht td{padding:6px 10px;border-bottom:1px solid var(--border);cursor:pointer}
  .ht tr:last-child td{border-bottom:none}
  .ht tr:hover td{background:var(--surface-hover)}
  .ht .ev{color:var(--accent);font-weight:500;font-size:10.5px}
  .ht .mt{font-family:var(--mono);font-size:9.5px;background:var(--bg3);padding:1px 4px;border-radius:2px;color:var(--text2)}

  .page{max-width:800px;margin:0 auto;padding:24px 28px 60px;animation:fadeIn .15s ease}
  .page .back{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:5px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:11px;transition:all .12s;margin-bottom:16px;font-family:var(--font)}
  .page .back:hover{border-color:var(--border-light);color:var(--text)}
  .page h2{font-size:20px;font-weight:700;letter-spacing:-.01em;margin-bottom:2px}
  .page .sub{font-size:12px;color:var(--text3);margin-bottom:16px}
  .page .sec{margin-top:16px}
  .page .sec h3{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:5px}
  .page .sec p,.page .sec .tx{font-size:13px;color:var(--text2);line-height:1.55}
  .page .sec .tt{display:inline-block;font-size:10px;font-weight:500;padding:2px 7px;border-radius:3px;background:var(--bg3);color:var(--accent);margin:1.5px;font-family:var(--mono)}
  .page .sec pre.pb{background:var(--bg3);padding:10px 12px;border-radius:6px;font-family:var(--font);font-size:12px;line-height:1.5;color:var(--text2);max-height:300px;overflow-y:auto;white-space:pre-wrap}
  .page .copy-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:5px;border:1px solid var(--accent);background:var(--accent-glow);color:var(--accent);cursor:pointer;font-size:11.5px;font-weight:500;transition:all .12s;font-family:var(--mono);margin-top:6px}
  .page .copy-btn:hover{background:var(--accent);color:#fff}
  .page .copy-btn.done{border-color:var(--green);background:var(--green-glow);color:var(--green)}

  .svr-list{margin-top:8px}
  .svr-it{padding:10px 0;border-bottom:1px solid var(--border)}
  .svr-it:last-child{border-bottom:none}
  .svr-it .svr-n{font-size:13px;font-weight:600;display:flex;align-items:center;gap:5px}
  .svr-it .svr-cmd{font-size:10.5px;color:var(--text3);font-family:var(--mono);margin-top:2px;word-break:break-all}
  .svr-it .svr-tags{margin-top:4px;display:flex;gap:3px;flex-wrap:wrap}
  .svr-it .svr-tags .stg{font-size:9px;padding:1px 5px;border-radius:3px;background:var(--bg3);color:var(--text3)}

  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(70px);background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 16px;font-size:12.5px;color:var(--text);box-shadow:var(--shadow-lg);z-index:300;opacity:0;transition:all .25s ease;pointer-events:none;display:flex;align-items:center;gap:7px}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  .toast .ck{width:16px;height:16px;border-radius:50%;background:var(--green-glow);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0}

  .empty{text-align:center;padding:50px 20px}
  .empty .eic{font-size:32px;margin-bottom:10px;opacity:.25}
  .empty h3{font-size:14px;color:var(--text2);margin-bottom:3px;font-weight:500}
  .empty p{font-size:11px;color:var(--text3)}

  .footer{text-align:center;padding:16px;color:var(--text3);font-size:10.5px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}
  .footer a{color:var(--accent)}
  .footer .dt{width:2.5px;height:2.5px;border-radius:50%;background:var(--text3);flex-shrink:0}

  @media(max-width:768px){
    .header{padding:0 14px;gap:8px}
    .brand .ver{display:none}
    .search{width:160px}
    .search .hint{display:none}
    .nav{padding:0 14px}
    .nav-it{padding:8px 10px;font-size:11.5px}
    .out{padding:10px 14px}
    .stats{grid-template-columns:repeat(3,1fr)}
    .grid{grid-template-columns:1fr}
    .cmd-grid{grid-template-columns:1fr}
    .page{padding:14px 16px 40px}
  }
  @media(max-width:480px){
    .stats{grid-template-columns:repeat(2,1fr)}
    .search{width:120px}
  }
</style>
</head>
<body>
<div class="header">
  <div class="brand" id="brand-link">
    <div class="logo">E</div>
    <h1><span id="t-title">ECC Capabilities</span> <span class="ver">v2.0.0-rc.1</span></h1>
  </div>
  <div class="header-center"></div>
  <div class="header-right">
    <div class="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input type="text" id="search" placeholder="" oninput="onSearchInput(this.value)" onclick="showSuggestions()" onkeydown="onSearchKey(event)" autocomplete="off" spellcheck="false">
      <span class="hint">⌘K</span>
      <div class="suggest" id="suggest"></div>
    </div>
    <div class="lang-wrap">
      <button class="lang-btn" onclick="toggleLang()"> <span id="lang-label">EN</span></button>
      <div class="lang-drop" id="lang-drop"></div>
    </div>
    <button class="icon-btn" onclick="toggleTheme()" title="Toggle theme"></button>
  </div>
</div>

<div class="nav" id="nav">
  <button class="nav-it active" data-tab="agents" onclick="showTab('agents',this)"><span id="nav-agents"> Agents</span> <span class="ct" id="nav-ct-agents"></span></button>
  <button class="nav-it" data-tab="skills" onclick="showTab('skills',this)"><span id="nav-skills"> Skills</span> <span class="ct" id="nav-ct-skills"></span></button>
  <button class="nav-it" data-tab="commands" onclick="showTab('commands',this)"><span id="nav-commands"> Commands</span> <span class="ct" id="nav-ct-commands"></span></button>
  <button class="nav-it" data-tab="rules" onclick="showTab('rules',this)"><span id="nav-rules"> Rules</span> <span class="ct" id="nav-ct-rules"></span></button>
  <button class="nav-it" data-tab="mcps" onclick="showTab('mcps',this)"><span id="nav-mcps"> MCPs</span> <span class="ct" id="nav-ct-mcps"></span></button>
  <button class="nav-it" data-tab="hooks" onclick="showTab('hooks',this)"><span id="nav-hooks"> Hooks</span> <span class="ct" id="nav-ct-hooks"></span></button>
</div>

<div class="out" id="app"></div>

<div class="toast" id="toast"><span class="ck">✓</span> <span id="toast-msg"></span></div>
<div class="footer">
  <a href="https://github.com/affaan-m/ECC" target="_blank">github.com/affaan-m/ECC</a>
  <span class="dt"></span>
  <span>ECC v2.0.0-rc.1</span>
  <span class="dt"></span>
  <span id="t-contribution">Contribution to ECC</span>
  <span class="dt"></span>
  <span>Dashboard :${PORT}</span>
</div>

<script>
const AGENTS = ${ag};
const SKILLS = ${sk};
const COMMANDS = ${co};
const RULES = ${ru};
const MCPS = ${mc};
const HOOKS = ${ho};
const L = ${ll};
const LANG_KEYS = ${lc};

let lang = localStorage.getItem('ecc-lang') || 'en';
let suggIdx = -1;

function t(key) { return (L[lang] && L[lang][key]) || L.en[key] || key; }

function toast(msg) {
  const el = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1600);
}
function copy(text, btn) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => {});
  else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
  toast(t('copied') + ' ' + text);
  if (btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 1000); }
}

// Recently viewed
function recents() { try { return JSON.parse(localStorage.getItem('ecc-recent') || '[]'); } catch { return []; } }
function addRecent(type, name) {
  if (!name || !/^[\\w\\-./@]+$/.test(name)) return;
  let r = recents().filter(x => !(x.t === type && x.n === name));
  r.unshift({ t: type, n: name, at: Date.now() });
  if (r.length > 8) r = r.slice(0, 8);
  localStorage.setItem('ecc-recent', JSON.stringify(r));
}
function clearRecents() { localStorage.removeItem('ecc-recent'); location.hash=''; location.reload(); }

function aType(name) {
  if (name.includes('reviewer')||name.includes('-review')) return 'reviewer';
  if (name.includes('build')||name.includes('resolver')) return 'builder';
  if (name.includes('architect')) return 'architect';
  if (name.includes('security')) return 'security';
  return 'other';
}

// Language
function setLang(l) {
  lang = l; localStorage.setItem('ecc-lang', l);
  document.querySelectorAll('.lang-drop .li').forEach(el => el.classList.toggle('active', el.dataset.lang === l));
  document.getElementById('lang-label').textContent = (L[l]||L.en).name.split(' ')[0].slice(0,2).toUpperCase();
  document.getElementById('lang-drop').classList.remove('show');
  applyLang();
  if (!location.hash || location.hash==='#/') renderMain();
  else handleRoute();
}
function toggleLang() { document.getElementById('lang-drop').classList.toggle('show'); }
function applyLang() {
  document.getElementById('t-title').textContent = t('title');
  document.getElementById('t-contribution').textContent = t('contribution');
  document.getElementById('search').placeholder = t('search');
  // Update label text only — counter spans are separate siblings
  document.getElementById('nav-agents').childNodes[0].textContent = ' ' + t('agents');
  document.getElementById('nav-skills').childNodes[0].textContent = ' ' + t('skills');
  document.getElementById('nav-commands').childNodes[0].textContent = ' ' + t('commands');
  document.getElementById('nav-rules').childNodes[0].textContent = ' ' + t('rules');
  document.getElementById('nav-mcps').childNodes[0].textContent = ' ' + t('mcps');
  document.getElementById('nav-hooks').childNodes[0].textContent = ' ' + t('hooks');
  // Update counter spans by their own IDs (avoids duplicate IDs in DOM)
  document.getElementById('nav-ct-agents').textContent = AGENTS.length;
  document.getElementById('nav-ct-skills').textContent = SKILLS.length;
  document.getElementById('nav-ct-commands').textContent = COMMANDS.length;
  document.getElementById('nav-ct-rules').textContent = RULES.length;
  document.getElementById('nav-ct-mcps').textContent = MCPS.length;
  document.getElementById('nav-ct-hooks').textContent = HOOKS.length;
}
// Build lang dropdown
(function(){
  const dd = document.getElementById('lang-drop');
  dd.innerHTML = LANG_KEYS.map(c => '<div class="li'+(c==='en'?' active':'')+'" data-lang="'+c+'" onclick="setLang(\\''+c+'\\')">'+L[c].name+'</div>').join('');
})();

document.addEventListener('click', (e) => {
  if (!e.target.closest('.lang-wrap')) document.getElementById('lang-drop').classList.remove('show');
  if (!e.target.closest('.search')) document.getElementById('suggest').classList.remove('show');
});

// Theme
function toggleTheme() {
  const h = document.documentElement;
  h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ecc-theme', h.dataset.theme);
}
if (localStorage.getItem('ecc-theme')) document.documentElement.dataset.theme = localStorage.getItem('ecc-theme');

// Routing
function handleRoute() {
  const hash = location.hash.slice(1);
  if (!hash || hash === '/') { renderMain(); return; }
  const parts = hash.split('/').filter(Boolean);
  if (parts.length < 2) { renderMain(); return; }
  renderPage(parts[0], decodeURIComponent(parts.slice(1).join('/')));
}
window.addEventListener('hashchange', handleRoute);

// Render Main Dashboard
function renderMain() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="stats" id="stats-bar"></div><div class="panel active" id="panel-agents"></div><div class="panel" id="panel-skills"></div><div class="panel" id="panel-commands"></div><div class="panel" id="panel-rules"></div><div class="panel" id="panel-mcps"></div><div class="panel" id="panel-hooks"></div>';

  document.getElementById('stats-bar').innerHTML =
    '<div class="stat c0" onclick="showTab(\\'agents\\',document.querySelector(\\'.nav-it[data-tab=\\\\"agents\\\"]\\'))"><div class="num">'+AGENTS.length+'</div><div class="lbl">'+t('agents')+'</div></div>' +
    '<div class="stat c1" onclick="showTab(\\'skills\\',document.querySelector(\\'.nav-it[data-tab=\\\\"skills\\\"]\\'))"><div class="num">'+SKILLS.length+'</div><div class="lbl">'+t('skills')+'</div></div>' +
    '<div class="stat c2" onclick="showTab(\\'commands\\',document.querySelector(\\'.nav-it[data-tab=\\\\"commands\\\"]\\'))"><div class="num">'+COMMANDS.length+'</div><div class="lbl">'+t('commands')+'</div></div>' +
    '<div class="stat c3" onclick="showTab(\\'rules\\',document.querySelector(\\'.nav-it[data-tab=\\\\"rules\\\"]\\'))"><div class="num">'+RULES.length+'</div><div class="lbl">'+t('ruleSets')+'</div></div>' +
    '<div class="stat c4" onclick="showTab(\\'mcps\\',document.querySelector(\\'.nav-it[data-tab=\\\\"mcps\\\"]\\'))"><div class="num">'+MCPS.length+'</div><div class="lbl">'+t('mcpConfigs')+'</div></div>' +
    '<div class="stat c5" onclick="showTab(\\'hooks\\',document.querySelector(\\'.nav-it[data-tab=\\\\"hooks\\\"]\\'))"><div class="num">'+HOOKS.length+'</div><div class="lbl">'+t('hooks')+'</div></div>';

  const recent = recents().filter(r => r.n && /^[\\w\\-./@]+$/.test(r.n));
  if (recent.length) {
    const icons = {agents:'',skills:'',commands:'',rules:'',mcps:'',hooks:''};
    const rb = document.createElement('div');
    rb.className = 'recent-bar';
    rb.innerHTML = '<span class="rb-lbl">'+t('recentlyViewed')+'</span><span class="rb-items"></span><span class="rb-clear" onclick="clearRecents()">✕ '+t('clearHistory')+'</span>';
    const items = rb.querySelector('.rb-items');
    recent.forEach(r => {
      const el = document.createElement('span');
      el.className = 'rb-item';
      el.textContent = (icons[r.t]||'•')+' '+r.n;
      el.onclick = () => { location.hash = '#/'+r.t+'/'+encodeURIComponent(r.n); };
      items.appendChild(el);
    });
    document.getElementById('stats-bar').after(rb);
  }

  document.querySelectorAll('.nav-it').forEach(n => n.classList.toggle('active', n.dataset.tab === 'agents'));
  renderAgents(AGENTS); renderSkills(SKILLS); renderCommands(COMMANDS);
  renderRules(RULES); renderMcps(MCPS); renderHooks(HOOKS);
}

function showTab(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-it').forEach(n => n.classList.remove('active'));
  const p = document.getElementById('panel-'+name);
  if (p) p.classList.add('active');
  if (btn) btn.classList.add('active');
  location.hash = '';
}

// Render functions
const ICONS = ['⊙','⊡','⊞','⊕','⊠','⊟'];
function iBg(i) { return 'i' + (i % 6); }

function renderAgents(list) {
  const el = document.getElementById('panel-agents');
  if (!el) return;
  const cats = ['all','reviewer','builder','architect','security'];
  const lbls = [t('all'),' '+t('reviewers'),' '+t('buildResolvers'),' '+t('architects'),' '+t('security')];
  el.innerHTML = '<div class="filters" id="af">'+cats.map((c,i)=>'<button'+(i===0?' class="active"':'')+' onclick="filterAgents(\\''+c+'\\',this)">'+lbls[i]+'</button>').join('')+
    '</div><div class="grid" id="ag">'+
    list.map((a,i)=>{const m=(a.m||'').toLowerCase(),bd=m.includes('opus')?'opus':m.includes('sonnet')?'sonnet':m.includes('haiku')?'haiku':'';const tag=aType(a.n),ic=tag==='reviewer'?0:tag==='builder'?1:tag==='architect'?2:tag==='security'?3:4;
    return '<div class="card" data-tag="'+tag+'" data-model="'+a.m+'" onclick="location.hash=\\'#/agents/'+encodeURIComponent(a.n)+'\\'">'+
      '<div class="top"><div class="il"><div class="ic '+iBg(ic)+'">'+ICONS[ic]+'</div><span class="nm">'+esc(a.n)+'</span></div>'+(bd?'<span class="bd '+bd+'">'+a.m+'</span>':'')+'</div>'+
      '<div class="desc">'+esc(a.d.slice(0,150))+'</div>'+
      '<div class="tags">'+a.t.slice(0,5).map(t=>'<span class="t">'+esc(t)+'</span>').join('')+'</div><span class="ar"></span></div>';}).join('')+'</div>';
}
function renderSkills(list) {
  const el = document.getElementById('panel-skills'); if (!el) return;
  el.innerHTML = '<div class="filters" id="sf">'+['all','sec','test','pattern','design','research','data','agent','devops'].map((c,i)=>'<button'+(i===0?' class="active"':'')+' onclick="filterSkills(\\''+c+'\\',this)">'+[t('all'),' '+t('security'),' '+t('testing'),' '+t('patterns'),' '+t('design'),' '+t('research'),' '+t('data'),' '+t('agent'),' '+t('devops')][i]+'</button>').join('')+
    '</div><div class="grid" id="sg">'+list.map((s,i)=>'<div class="card" onclick="location.hash=\\'#/skills/'+encodeURIComponent(s.n)+'\\'">'+
      '<div class="top"><div class="il"><div class="ic '+iBg(i%6)+'">'+ICONS[i%6]+'</div><span class="nm">'+esc(s.n)+'</span></div></div>'+
      '<div class="desc">'+esc(s.d||'—')+'</div><span class="ar"></span></div>').join('')+'</div>';
}
function renderCommands(list) {
  const el = document.getElementById('panel-commands'); if (!el) return;
  const cats = [...new Set(list.map(c=>c.c))];
  const filters = document.createElement('div');
  filters.className = 'filters'; filters.id = 'cf';
  const allBtn = document.createElement('button');
  allBtn.className = 'active'; allBtn.textContent = t('all');
  allBtn.onclick = () => filterCommands('all', allBtn);
  filters.appendChild(allBtn);
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.onclick = () => filterCommands(cat, btn);
    filters.appendChild(btn);
  });
  el.innerHTML = '';
  el.appendChild(filters);
  const grid = document.createElement('div');
  grid.className = 'cmd-grid'; grid.id = 'cg';
  list.forEach(c => {
    const div = document.createElement('div');
    div.className = 'cmd-it';
    div.onclick = () => { location.hash = '#/commands/'+encodeURIComponent(c.n.replace('/','')); };
    div.innerHTML = '<div class="cl"><div class="cn">'+esc(c.n)+'</div><div class="cd">'+esc(c.d||'—')+'</div><div class="cc">'+esc(c.c)+'</div></div>'+
      '<button class="cpy" title="Copy">⊡</button>';
    div.querySelector('.cpy').onclick = (e) => { e.stopPropagation(); copy(c.n, e.target); };
    grid.appendChild(div);
  });
  el.appendChild(grid);
}
function renderRules(list) {
  const el = document.getElementById('panel-rules'); if (!el) return;
  const grid = document.createElement('div');
  grid.className = 'rules-grid';
  list.forEach(r => {
    const div = document.createElement('div');
    div.className = 'rule-cd';
    div.onclick = () => { location.hash = '#/rules/'+encodeURIComponent(r.l); };
    let html = '<h3>'+esc(r.l)+'</h3>';
    r.f.slice(0,8).forEach(f => { html += '<div class="rf">'+esc(f)+'</div>'; });
    if (r.f.length > 8) html += '<div class="rf" style="color:var(--text3);font-size:9.5px;margin-top:3px">+ '+(r.f.length-8)+' '+t('more')+'</div>';
    div.innerHTML = html;
    grid.appendChild(div);
  });
  el.innerHTML = '';
  el.appendChild(grid);
}
function renderMcps(list) {
  const el = document.getElementById('panel-mcps'); if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="empty"><div class="eic"></div><h3>'+esc(t('noMcps'))+'</h3><p>'+esc(t('checkMcps'))+'</p></div>'; return; }
  const grid = document.createElement('div'); grid.className = 'mcp-grid';
  list.forEach(m => {
    const div = document.createElement('div'); div.className = 'mcp-cd';
    div.onclick = () => { location.hash = '#/mcps/'+encodeURIComponent(m.f); };
    div.innerHTML = '<h3> '+esc(m.f)+'</h3>'+m.s.map(s => '<span class="st">'+esc(s.n)+' <small>'+esc((s.cmd||'').slice(0,40))+'</small></span>').join('');
    grid.appendChild(div);
  });
  el.innerHTML = ''; el.appendChild(grid);
}
function renderHooks(list) {
  const el = document.getElementById('panel-hooks'); if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="empty"><div class="eic"></div><h3>'+esc(t('noHooks'))+'</h3></div>'; return; }
  const wrap = document.createElement('div'); wrap.className = 'hw';
  const tbl = document.createElement('table'); tbl.className = 'ht';
  tbl.innerHTML = '<thead><tr><th>'+esc(t('event'))+'</th><th>'+esc(t('matcher'))+'</th><th>'+esc(t('description'))+'</th><th>'+esc(t('id'))+'</th></tr></thead><tbody></tbody>';
  const tbody = tbl.querySelector('tbody');
  list.forEach(h => {
    const tr = document.createElement('tr');
    tr.onclick = () => { location.hash = '#/hooks/'+encodeURIComponent(h.id); };
    tr.innerHTML = '<td class="ev">'+esc(h.ev)+'</td><td><span class="mt">'+esc(h.m)+'</span></td><td>'+esc(h.d)+'</td><td style="color:var(--text3);font-size:9.5px">'+esc(h.id)+'</td>';
    tbody.appendChild(tr);
  });
  wrap.appendChild(tbl);
  el.innerHTML = '';
  el.appendChild(wrap);
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Detail Pages
function renderPage(type, name) {
  addRecent(type, name);
  const app = document.getElementById('app');
  let html = '';
  if (type === 'agents') {
    const a = AGENTS.find(x=>x.n===name); if (!a) { app.innerHTML='<div class="empty"><h3>Agent not found</h3></div>'; return; }
    const m=(a.m||'').toLowerCase(),bd=m.includes('opus')?'opus':m.includes('sonnet')?'sonnet':m.includes('haiku')?'haiku':'';
    html='<div class="page"><button class="back" onclick="location.hash=\\'\\'">← '+t('agents')+'</button><h2>'+esc(a.n)+'</h2><div class="sub">'+(bd?'<span class="bd '+bd+'" style="display:inline-block;margin-right:6px">'+a.m+'</span>':'')+a.t.length+' tools</div>'+
      '<div class="sec"><h3>'+t('description')+'</h3><p>'+esc(a.d)+'</p></div>'+(a.t.length?'<div class="sec"><h3>'+t('tools')+'</h3>'+a.t.map(t=>'<span class="tt">'+esc(t)+'</span>').join('')+'</div>':'')+
      (a.b?'<div class="sec"><h3>'+t('details')+'</h3><pre class="pb">'+esc(a.b)+'</pre></div>':'')+'</div>';
  } else if (type === 'skills') {
    const s=SKILLS.find(x=>x.n===name); if(!s){app.innerHTML='<div class="empty"><h3>Skill not found</h3></div>';return;}
    html='<div class="page"><button class="back" onclick="location.hash=\\'\\'">← '+t('skills')+'</button><h2>'+esc(s.n)+'</h2><div class="sub">'+t('skill')+'</div>'+
      '<div class="sec"><h3>'+t('description')+'</h3><p>'+esc(s.d||'—')+'</p></div>'+(s.b?'<div class="sec"><h3>'+t('details')+'</h3><pre class="pb">'+esc(s.b)+'</pre></div>':'')+'</div>';
  } else if (type === 'commands') {
    const c=COMMANDS.find(x=>x.n==='/'+name); if(!c){app.innerHTML='<div class="empty"><h3>Command not found</h3></div>';return;}
    html='<div class="page"><button class="back" onclick="location.hash=\\'\\'">← '+t('commands')+'</button><h2>'+esc(c.n)+'</h2><div class="sub">'+esc(c.c)+'</div>'+
      '<div class="sec"><h3>'+t('description')+'</h3><p>'+esc(c.d||'—')+'</p></div>'+
      '<div class="sec"><button class="copy-btn" data-cmd="'+esc(c.n)+'">⊡ Copy '+esc(c.n)+'</button></div>'+(c.b?'<div class="sec"><h3>'+t('details')+'</h3><pre class="pb">'+esc(c.b)+'</pre></div>':'')+'</div>';
  } else if (type === 'rules') {
    const r=RULES.find(x=>x.l===name); if(!r){app.innerHTML='<div class="empty"><h3>Rules not found</h3></div>';return;}
    html='<div class="page"><button class="back" onclick="location.hash=\\'\\'">← '+t('rules')+'</button><h2>'+esc(r.l)+'</h2><div class="sub">'+r.f.length+' '+t('ruleFiles')+'</div>'+
      '<div class="sec">'+r.f.map(f=>'<div style="padding:3px 0;font-size:13px;color:var(--text2);display:flex;align-items:center;gap:6px"><span style="color:var(--text3)">—</span>'+esc(f)+'</div>').join('')+'</div></div>';
  } else if (type === 'mcps') {
    const m=MCPS.find(x=>x.f===name); if(!m){app.innerHTML='<div class="empty"><h3>MCP config not found</h3></div>';return;}
    html='<div class="page"><button class="back" onclick="location.hash=\\'\\'">← '+t('mcps')+'</button><h2>'+esc(m.f)+'</h2><div class="sub">'+m.s.length+' '+t('servers')+'</div>'+
      '<div class="svr-list">'+m.s.map(s=>'<div class="svr-it"><div class="svr-n">'+esc(s.n)+'</div><div class="svr-cmd">'+esc(s.cmd||'')+(s.args&&s.args.length?' '+s.args.join(' '):'')+'</div>'+
      '<div class="svr-tags">'+(s.type?'<span class="stg">'+esc(s.type)+'</span>':'')+(s.env&&Object.keys(s.env).length?Object.entries(s.env).map(([k,v])=>'<span class="stg">'+esc(k)+'='+esc(v)+'</span>').join(''):'')+'</div></div>').join('')+'</div></div>';
  } else if (type === 'hooks') {
    const h=HOOKS.find(x=>x.id===name); if(!h){app.innerHTML='<div class="empty"><h3>Hook not found</h3></div>';return;}
    html='<div class="page"><button class="back" onclick="location.hash=\\'\\'">← '+t('hooks')+'</button><h2 style="font-family:var(--mono);font-size:15px">'+esc(h.id)+'</h2><div class="sub">'+esc(h.ev)+' · <span class="mt" style="font-size:11px;background:var(--bg3);padding:1px 5px;border-radius:3px">'+esc(h.m)+'</span></div>'+
      '<div class="sec"><p>'+esc(h.d)+'</p></div></div>';
  }
  app.innerHTML = html;
  // Attach copy handlers for detail page copy buttons
  app.querySelectorAll('.copy-btn[data-cmd]').forEach(btn => {
    const cmd = btn.getAttribute('data-cmd');
    btn.onclick = () => copy(cmd, btn);
  });
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-it').forEach(n=>n.classList.remove('active'));
}

// Filters
function filterAgents(tag, btn) {
  document.querySelectorAll('#af .active').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  document.querySelectorAll('#ag .card').forEach(c=>{if(tag==='all'){c.style.display='';return}
    if(['opus','sonnet','haiku'].includes(tag)){c.style.display=c.dataset.model.toLowerCase().includes(tag)?'':'none';return}
    c.style.display=c.dataset.tag===tag?'':'none';});
}
function filterSkills(tag, btn) {
  document.querySelectorAll('#sf .active').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  document.querySelectorAll('#sg .card').forEach(c=>{if(tag==='all'){c.style.display='';return}
    const nm=c.querySelector('.nm').textContent.toLowerCase(),dc=(c.querySelector('.desc')?.textContent||'').toLowerCase();
    c.style.display=(nm.includes(tag)||dc.includes(tag))?'':'none';});
}
function filterCommands(cat, btn) {
  document.querySelectorAll('#cf .active').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  document.querySelectorAll('#cg .cmd-it').forEach(c=>{c.style.display=(cat==='all'||c.querySelector('.cc').textContent===cat)?'':'none';});
}

// Search
function onSearchInput(q) {
  q = q.toLowerCase().trim();
  const fa=q?AGENTS.filter(a=>a.n.toLowerCase().includes(q)||a.d.toLowerCase().includes(q)||(a.t||[]).some(t=>t.toLowerCase().includes(q))):AGENTS;
  const fs=q?SKILLS.filter(s=>s.n.toLowerCase().includes(q)||s.d.toLowerCase().includes(q)):SKILLS;
  const fc=q?COMMANDS.filter(c=>c.n.toLowerCase().includes(q)||c.d.toLowerCase().includes(q)||c.c.toLowerCase().includes(q)):COMMANDS;
  renderAgents(fa); renderSkills(fs); renderCommands(fc);
  document.querySelectorAll('#af .active, #sf .active, #cf .active').forEach(b=>b.classList.remove('active'));
  ['#af button','#sf button','#cf button'].forEach(s=>{const b=document.querySelector(s);if(b)b.classList.add('active')});
  showSuggestions();
}
function showSuggestions() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const sug = document.getElementById('suggest');
  if (!q) { sug.classList.remove('show'); return; }
  const results = [];
  AGENTS.filter(a=>a.n.toLowerCase().includes(q)||a.d.toLowerCase().includes(q)).slice(0,4).forEach(a=>results.push({t:'agents',n:a.n,d:a.d.slice(0,60),ic:'a',e:'⊙'}));
  SKILLS.filter(s=>s.n.toLowerCase().includes(q)||s.d.toLowerCase().includes(q)).slice(0,4).forEach(s=>results.push({t:'skills',n:s.n,d:s.d.slice(0,60),ic:'s',e:'⊞'}));
  COMMANDS.filter(c=>c.n.toLowerCase().includes(q)||c.d.toLowerCase().includes(q)).slice(0,4).forEach(c=>results.push({t:'commands',n:c.n,d:c.d.slice(0,60),ic:'c',e:'⊡'}));
  if (!results.length) { sug.classList.remove('show'); return; }
  const groups = {};
  results.forEach(r=>{if(!groups[r.t])groups[r.t]=[];groups[r.t].push(r);});
  sug.innerHTML = Object.entries(groups).map(([type,items]) =>
    '<div class="sg"><div class="sg-label">'+(type==='agents'?' '+t('agents'):type==='skills'?' '+t('skills'):' '+t('commands'))+'</div>'+
    items.map(r=>'<div class="si" onclick="location.hash=\\'#/'+r.t+'/'+encodeURIComponent(r.n)+'\\';document.getElementById(\\'suggest\\').classList.remove(\\'show\\');document.getElementById(\\'search\\').blur()">'+
      '<span class="ic '+r.ic+'">'+r.e+'</span><span class="sn">'+esc(r.n)+'</span><span class="sd">'+esc(r.d)+'</span></div>').join('')+'</div>'
  ).join('');
  sug.classList.add('show'); suggIdx = -1;
}
function onSearchKey(e) {
  const items = document.querySelectorAll('#suggest .si');
  if (e.key==='ArrowDown'){e.preventDefault();suggIdx=Math.min(suggIdx+1,items.length-1);items.forEach((el,i)=>el.classList.toggle('active',i===suggIdx));}
  else if(e.key==='ArrowUp'){e.preventDefault();suggIdx=Math.max(suggIdx-1,-1);items.forEach((el,i)=>el.classList.toggle('active',i===suggIdx));}
  else if(e.key==='Enter'&&suggIdx>=0&&items[suggIdx])items[suggIdx].click();
  else if(e.key==='Escape'){document.getElementById('suggest').classList.remove('show');document.getElementById('search').blur();}
}

// Keyboard
document.addEventListener('keydown', e => { if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();document.getElementById('search').focus();} });

// Init
setLang(lang);
handleRoute();
</script>
</body></html>`;
  /* eslint-enable no-useless-escape */
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agents: loadAgents(), skills: loadSkills(), commands: loadCommands(), rules: loadRules(), mcps: loadMcps(), hooks: loadHooks() }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderHTML({ agents: loadAgents(), skills: loadSkills(), commands: loadCommands(), rules: loadRules(), mcps: loadMcps(), hooks: loadHooks() }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n    ECC Capabilities  →  http://localhost:${PORT}\n`);
    try { const { spawn } = require('child_process'); const p = process.platform; const c = p === 'darwin' ? 'open' : p === 'win32' ? 'start' : 'xdg-open'; if (c === 'start') spawn('cmd', ['/c', 'start', `http://localhost:${PORT}`], { stdio: 'ignore' }); else spawn(c, [`http://localhost:${PORT}`], { stdio: 'ignore' }); } catch { /* best-effort auto-open */ }
  });
}

module.exports = { parsePort, readFrontmatter, readSkill, loadAgents, loadSkills, loadCommands, loadRules, loadMcps, loadHooks, renderHTML, LANG, LANG_KEYS, server };
