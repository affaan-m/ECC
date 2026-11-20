'use strict';

/**
 * UI Canvas shell stylesheet: Plan Canvas and dashboard tokens with the ECC
 * green accent, the device frames, and the inspector rows.
 */

const { TOKENS_CSS } = require('../plan-canvas/ui');

function uiCanvasCss() {
  return `${TOKENS_CSS}
  :root{--accent:#4acb8a;--accent-glow:rgba(74,203,138,0.15);--accent-dim:#2f9e68;--on-accent:#06130c}
  [data-theme="light"]{--accent:#15803d;--accent-glow:rgba(21,128,61,0.1);--accent-dim:#166534;--on-accent:#ffffff}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.4;overflow:hidden}
  ::selection{background:var(--accent);color:var(--on-accent)}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
  button,input,textarea{font-family:var(--font)}
  button{cursor:pointer}
  button:disabled{opacity:.45;cursor:default}
  code,.mono{font-family:var(--mono)}
  [hidden]{display:none!important}

  .bar{display:flex;align-items:center;gap:10px;height:54px;padding:0 14px;background:color-mix(in srgb,var(--bg2) 90%,transparent);border-bottom:1px solid var(--border);backdrop-filter:blur(16px)}
  .brand{display:flex;align-items:center;gap:9px;min-width:0;margin-right:6px}
  .brand .logo{width:26px;height:26px;flex:none;background:var(--bg3);border:1px solid var(--border-light);border-radius:7px;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:13px;font-weight:700;color:var(--accent)}
  .brand .name{font-size:13.5px;font-weight:600;white-space:nowrap}
  .brand .file{font-size:11.5px;color:var(--text2);font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:22vw}
  .bar .spacer{flex:1}
  .divider{width:1px;height:22px;background:var(--border)}

  .seg{display:inline-flex;align-items:center;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:2px;gap:2px}
  .seg button{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--text2);font-size:11.5px;font-weight:600;transition:all .12s}
  .seg button:hover{color:var(--text);background:var(--bg4)}
  .seg button[aria-pressed="true"]{background:var(--surface);color:var(--text);box-shadow:var(--shadow);outline:1px solid var(--border-light)}
  .seg.viewports button{padding:0 9px}
  .seg.viewports svg{display:block}

  .dims{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text2)}
  .dims input{width:58px;height:26px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);color:var(--text);font-family:var(--mono);font-size:11.5px;text-align:center;outline:none;-moz-appearance:textfield}
  .dims input::-webkit-outer-spin-button,.dims input::-webkit-inner-spin-button{-webkit-appearance:none}
  .dims input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
  .dims .x{color:var(--text3)}
  .dims .scale{font-family:var(--mono);font-size:10.5px;color:var(--teal);min-width:34px}
  .dims .icon-btn{height:26px;width:26px;padding:0;justify-content:center}

  .presence{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:99px;padding:3px 10px 3px 8px;white-space:nowrap;max-width:260px}
  .presence .label{overflow:hidden;text-overflow:ellipsis}
  .presence .dot{width:7px;height:7px;flex:none;border-radius:99px;background:var(--text3)}
  .presence[data-state="listening"] .dot{background:var(--green);box-shadow:0 0 0 3px var(--green-glow);animation:pulse 2s infinite}
  .presence[data-state="thinking"] .dot,.presence[data-state="typing"] .dot{background:var(--teal);box-shadow:0 0 0 3px var(--teal-glow);animation:pulse 1.2s infinite}
  .presence[data-state="queued"] .dot{background:var(--orange);box-shadow:0 0 0 3px var(--orange-glow)}
  .presence[data-state="ended"] .dot{background:var(--text3)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

  .icon-btn{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);font-size:11.5px;font-weight:500;display:inline-flex;align-items:center;gap:5px;transition:all .12s;white-space:nowrap}
  .icon-btn:hover:not(:disabled){border-color:var(--border-light);color:var(--text);background:var(--bg4)}
  .icon-btn.danger:hover:not(:disabled){border-color:var(--red);color:var(--red);background:var(--red-glow)}
  .icon-btn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:var(--accent-glow)}
  .icon-btn.confirm{border-color:var(--orange);color:var(--orange);background:var(--orange-glow)}
  .icon-btn.square{width:28px;padding:0;justify-content:center}
  .primary{height:30px;padding:0 14px;border:1px solid var(--accent-dim);border-radius:7px;background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:7px;box-shadow:var(--shadow);transition:background .12s,transform .12s}
  .primary:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 86%,#fff)}
  .primary:active:not(:disabled){transform:translateY(1px)}

  .layout{display:flex;height:calc(100% - 54px)}
  .stage{flex:1;min-width:0;position:relative;display:flex;flex-direction:column;background:var(--bg);background-image:radial-gradient(color-mix(in srgb,var(--border-light) 70%,transparent) 1px,transparent 1px);background-size:18px 18px}
  .stage .viewport{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:24px}
  .sizer{position:relative;flex:none}
  .device{position:absolute;top:0;left:0;transform-origin:top left;background:#fff;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.35),0 0 0 1px color-mix(in srgb,var(--border-light) 80%,transparent);overflow:hidden;transition:border-radius .15s}
  .device iframe{display:block;width:100%;height:100%;border:0;background:#fff}
  .device.mobile{border-radius:44px;border:12px solid #0b0c10;box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 0 1px #2a2d38,inset 0 0 0 1px #000}
  .device.mobile iframe{border-radius:32px}
  .device.desktop{border-radius:8px}
  .stage[data-mode="interact"] .device{outline:2px solid color-mix(in srgb,var(--green) 55%,transparent);outline-offset:3px}

  .statusbar{height:30px;flex:none;display:flex;align-items:center;gap:14px;padding:0 14px;border-top:1px solid var(--border);background:color-mix(in srgb,var(--bg2) 85%,transparent);font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden}
  .statusbar .hint{flex:1;overflow:hidden;text-overflow:ellipsis}
  .statusbar .hint.live{color:var(--accent)}
  .statusbar kbd{font-family:var(--mono);font-size:10px;background:var(--bg3);border:1px solid var(--border);border-bottom-width:2px;border-radius:4px;padding:0 5px;color:var(--text)}
  .statusbar .readout{font-family:var(--mono);font-size:10.5px;color:var(--text3)}

  .panel{width:372px;flex:none;display:flex;flex-direction:column;border-left:1px solid var(--border);background:var(--bg2);min-height:0}
  .panel section{display:flex;flex-direction:column;min-height:0}
  .panel h2{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:12px 14px 8px}
  .panel h2 .count{font-family:var(--mono);font-size:10px;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:99px;padding:1px 7px;letter-spacing:0;text-transform:none}
  .panel h2 .grow{flex:1}
  .mini{height:22px;padding:0 8px;border-radius:5px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);font-size:10.5px;font-weight:600;letter-spacing:0;text-transform:none;display:inline-flex;align-items:center;gap:4px}
  .mini:hover:not(:disabled){color:var(--text);border-color:var(--border-light)}
  .mini.danger:hover:not(:disabled){color:var(--red);border-color:var(--red);background:var(--red-glow)}
  .mini.go:not(:disabled){color:var(--accent);border-color:color-mix(in srgb,var(--accent) 55%,transparent);background:var(--accent-glow)}
  .mini.go:hover:not(:disabled){color:var(--on-accent);background:var(--accent);border-color:var(--accent)}
  .mini.confirm{color:var(--orange);border-color:var(--orange);background:var(--orange-glow)}

  .panel .inspector{flex:0 1 auto;min-height:140px;border-bottom:1px solid var(--border);max-height:56%;overflow-y:auto}
  .inspector .muted{padding:0 14px 14px;font-size:12px;color:var(--text3);line-height:1.55}
  .crumbs{display:flex;flex-wrap:wrap;gap:3px;padding:0 14px 8px}
  .crumbs button{height:20px;padding:0 7px;border-radius:4px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);font-family:var(--mono);font-size:10px}
  .crumbs button:hover{color:var(--text);border-color:var(--border-light)}
  .crumbs button[aria-current="true"]{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}
  .crumbs .sep{color:var(--text3);font-size:10px;align-self:center}
  .selhead{display:flex;align-items:center;gap:8px;padding:0 14px 10px;min-width:0}
  .selhead .tag{font-family:var(--mono);font-size:12px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
  .selhead .snippet{font-size:11.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
  .selhead .mini{flex:none}
  .inspector .hint{padding:2px 14px 12px;font-size:10px;color:var(--text3);line-height:1.5}
  .inspector .hint.err{color:var(--red)}

  .groups{display:flex;flex-direction:column;padding:0 0 4px}
  .group{padding:6px 14px 8px;border-top:1px solid var(--border)}
  .group .gh{font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);padding:2px 0 6px}
  .field{display:grid;grid-template-columns:78px minmax(0,1fr) 56px 18px;align-items:center;gap:8px;min-height:26px}
  .field .flabel{font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .field.set .flabel{color:var(--text)}
  .field.set .flabel::after{content:'';display:inline-block;width:5px;height:5px;margin:0 0 1px 5px;border-radius:99px;background:var(--accent);vertical-align:middle}
  .field.sub .flabel{padding-left:10px;color:var(--text3);font-family:var(--mono);font-size:10px}
  .field .ro{font-family:var(--mono);font-size:10.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .field .clear{width:18px;height:18px;padding:0;border:0;border-radius:4px;background:none;color:var(--text3);font-size:13px;line-height:1;visibility:hidden}
  .field:hover .clear.on,.field .clear.on:focus-visible{visibility:visible}
  .field .clear:hover{color:var(--red);background:var(--red-glow)}
  .csub{display:flex;flex-direction:column;gap:1px;margin:2px 0 6px 4px;padding:2px 0 2px 0;border-left:2px solid var(--border-light)}
  .cval{display:flex;align-items:center;gap:6px;min-width:0}
  .cval .num{flex:1;justify-content:flex-start}
  .num{height:22px;min-width:0;display:flex;align-items:center;justify-content:flex-end;padding:0 6px;border:1px solid transparent;border-radius:5px;font-family:var(--mono);font-size:10.5px;color:var(--text);cursor:text;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .num:hover,.num:focus-visible{border-color:var(--border);background:var(--bg3);outline:none}
  .num.mixed{color:var(--text2);font-style:italic}
  .numedit{height:22px;width:100%;min-width:0;border:1px solid var(--accent);border-radius:5px;background:var(--bg);color:var(--text);font-family:var(--mono);font-size:10.5px;text-align:right;padding:0 6px;outline:none;box-shadow:0 0 0 3px var(--accent-glow)}
  .cval .numedit,.field.text .numedit{text-align:left}
  .field.text{grid-template-columns:78px minmax(0,1fr) 18px}
  .field.text .num{justify-content:flex-start}
  .numedit.invalid{border-color:var(--red);box-shadow:0 0 0 3px var(--red-glow)}
  .swatch-btn{position:relative;width:22px;height:22px;flex:none;padding:0;border-radius:5px;border:1px solid var(--border-light);overflow:hidden;background-color:#fff;background-image:repeating-conic-gradient(#c9ccd3 0 25%,#fff 0 50%);background-size:8px 8px}
  .swatch-btn i{position:absolute;inset:0;display:block}
  .swatch-btn:hover{border-color:var(--text2)}
  .swatch-btn[aria-expanded="true"]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-glow)}
  .range{-webkit-appearance:none;appearance:none;width:100%;height:18px;margin:0;background:transparent;cursor:pointer;--pct:0%;--fill:var(--accent);--track:linear-gradient(to right,var(--fill) var(--pct),var(--bg4) var(--pct))}
  .range:focus{outline:none}
  .range::-webkit-slider-runnable-track{height:4px;border-radius:99px;background:var(--track);box-shadow:inset 0 0 0 1px var(--border)}
  .range::-moz-range-track{height:4px;border-radius:99px;background:var(--track);box-shadow:inset 0 0 0 1px var(--border)}
  .range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;margin-top:-4px;border-radius:99px;background:var(--text);border:2px solid var(--bg2);box-shadow:0 0 0 1px var(--border-light),0 1px 3px rgba(0,0,0,.4)}
  .range::-moz-range-thumb{width:8px;height:8px;border-radius:99px;background:var(--text);border:2px solid var(--bg2);box-shadow:0 0 0 1px var(--border-light)}
  .range:hover::-webkit-slider-thumb{box-shadow:0 0 0 1px var(--accent),0 1px 3px rgba(0,0,0,.4)}
  .range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 1px var(--accent),0 0 0 4px var(--accent-glow)}
  .range:focus-visible::-moz-range-thumb{box-shadow:0 0 0 1px var(--accent),0 0 0 4px var(--accent-glow)}
  .range.paint::-webkit-slider-runnable-track{height:8px}
  .range.paint::-moz-range-track{height:8px}
  .range.paint::-webkit-slider-thumb{margin-top:-2px}
  .range.hue{--track:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
  .range.alpha{--track:linear-gradient(to right,transparent,var(--swatch)),repeating-conic-gradient(#c9ccd3 0 25%,#fff 0 50%) 0 0/8px 8px}
  .aligns{display:inline-flex;gap:2px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:2px;justify-self:start}
  .aligns button{width:24px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--text2);display:inline-flex;align-items:center;justify-content:center}
  .aligns button:hover{color:var(--text);background:var(--bg4)}
  .aligns button[aria-pressed="true"]{color:var(--accent);background:var(--accent-glow)}

  #themeBtn .i-moon,[data-theme="light"] #themeBtn .i-sun{display:none}
  [data-theme="light"] #themeBtn .i-moon{display:block}
  #pauseBtn .i-play,#pauseBtn[aria-pressed="true"] .i-pause{display:none}
  #pauseBtn[aria-pressed="true"] .i-play{display:block}

  .panel .edits{flex:0 1 auto;min-height:96px;border-bottom:1px solid var(--border);max-height:22%;display:flex;flex-direction:column}
  .editlist{overflow-y:auto;padding:0 14px 10px;display:flex;flex-direction:column;gap:5px}
  .editlist .empty{font-size:11.5px;color:var(--text3);line-height:1.5}
  .edit{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:6px;background:var(--bg3);border:1px solid var(--border);border-left:2px solid var(--teal);font-size:11px;line-height:1.45;color:var(--text2)}
  .edit .k{flex:none;font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--teal);padding-top:2px;width:46px}
  .edit .s{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .edit.kind-remove{border-left-color:var(--red)}.edit.kind-remove .k{color:var(--red)}
  .edit.kind-text{border-left-color:var(--accent)}.edit.kind-text .k{color:var(--accent)}
  .edit.kind-style{border-left-color:var(--pink)}.edit.kind-style .k{color:var(--pink)}
  .edit.kind-move,.edit.kind-nudge{border-left-color:var(--orange)}.edit.kind-move .k,.edit.kind-nudge .k{color:var(--orange)}
  .edit.stale{opacity:.5;border-style:dashed}

  .panel .convo{flex:1 1 0;min-height:232px}
  .chat{flex:1;overflow-y:auto;padding:4px 14px 10px;display:flex;flex-direction:column;gap:8px}
  .msg{max-width:92%;padding:7px 10px;border-radius:10px;font-size:12.5px;white-space:pre-wrap;word-break:break-word}
  .msg.user{align-self:flex-end;background:var(--accent-glow);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);color:var(--text);border-bottom-right-radius:3px}
  .msg.agent{align-self:flex-start;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-bottom-left-radius:3px}
  .msg .meta{display:block;font-size:9.5px;color:var(--text3);margin-top:3px}
  .msg.kind-edits,.msg.kind-finish{border-left:2px solid var(--green)}
  .chat .empty{color:var(--text3);font-size:12px;text-align:center;margin-top:18px;line-height:1.6;padding:0 10px}
  .typing{align-self:flex-start;display:none;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border);border-bottom-left-radius:3px;border-radius:10px;padding:9px 12px}
  .typing.show{display:flex}
  .typing .dots{display:flex;align-items:center;gap:3px}
  .typing .dots i{width:6px;height:6px;border-radius:99px;background:var(--text2);animation:typing-bounce 1.4s infinite ease-in-out both}
  .typing .dots i:nth-child(1){animation-delay:-.32s}
  .typing .dots i:nth-child(2){animation-delay:-.16s}
  .typing .label{font-size:11px;color:var(--text3)}
  @keyframes typing-bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}
  .stalled{align-self:flex-start;display:none;gap:8px;background:var(--orange-glow);border:1px solid color-mix(in srgb,var(--orange) 35%,transparent);border-radius:10px;padding:8px 11px;font-size:11.5px;color:var(--text2);line-height:1.5}
  .stalled.show{display:flex}
  @media (prefers-reduced-motion:reduce){.typing .dots i{animation:none;opacity:.7}.presence .dot{animation:none}}

  .composer{padding:10px 14px 14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px}
  .anchor{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--text3)}
  .anchor code{font-size:10.5px;color:var(--teal);background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:1px 6px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .anchor button{border:0;background:none;color:var(--text3);font-size:13px;line-height:1}
  .anchor button:hover{color:var(--red)}
  .composer textarea{width:100%;min-height:58px;max-height:160px;resize:vertical;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:12.5px;outline:none;transition:all .15s}
  .composer textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
  .composer .row{display:flex;gap:8px;align-items:center}
  .composer .send{flex:1;height:32px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg4);color:var(--text);font-size:12.5px;font-weight:600;transition:all .12s}
  .composer .send:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
  .composer .status{font-size:10.5px;color:var(--text3);min-height:14px}

  .overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(6px);z-index:50}
  .overlay.show{display:flex}
  .overlay .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:28px 34px;text-align:center;max-width:380px}
  .overlay .card .ok{width:40px;height:40px;margin:0 auto 12px;border-radius:99px;background:var(--green-glow);color:var(--green);display:flex;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--green) 40%,transparent)}
  .overlay .card h3{font-size:15px;margin-bottom:6px}
  .overlay .card p{font-size:12.5px;color:var(--text2);line-height:1.55}
  .overlay .card code{font-size:11px;color:var(--teal)}
  `;
}

module.exports = { uiCanvasCss };
