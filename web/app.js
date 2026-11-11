// KLeanScreen: a small touchscreen UI for the Voron Trident (Kalico + INDX).
// Views are template strings; morph() patches the live DOM so updates don't
// rebuild it. Taps go through one delegated handler via data-act/data-arg.
import { Moonraker } from './moonraker.js';
import { PromptParser } from './prompt.js';

const qs = new URLSearchParams(location.search);
const HOST = qs.get('moonraker') || '127.0.0.1:7125';
const HTTP = `http://${HOST}`;
const BLANK_S = +(qs.get('blank') || 600);     // blank after this many seconds without a tap

const OBJECTS = {
  print_stats: null, virtual_sdcard: ['progress', 'is_active'], display_status: null, pause_resume: ['is_paused'],
  toolhead: ['homed_axes'], gcode_move: ['homing_origin', 'speed_factor', 'extrude_factor'],
  extruder: ['temperature', 'target'], heater_bed: ['temperature', 'target'],
  'temperature_sensor chamber': ['temperature'], save_variables: null,
  'gcode_macro TOOL_POSITIONS': ['tool_count'], webhooks: null
};

const PALETTE = [
  ['White', 'f4f4f2'], ['Off-white', 'e9e2cf'], ['Light grey', 'c3c6cb'], ['Grey', '8b9097'],
  ['Dark grey', '50545b'], ['Black', '1d1d1f'], ['Silver', 'a9adb3'], ['Gold', 'c9a23f'],
  ['Red', 'd33a2c'], ['Dark red', '8e1f1f'], ['Orange', 'f07a1a'], ['Burnt orange', 'b8561d'],
  ['Yellow', 'f5d02e'], ['Lemon', 'eee86a'], ['Lime', '9ccc3c'], ['Green', '3aa655'],
  ['Dark green', '1f6b3a'], ['Olive', '6f7339'], ['Teal', '1c9a95'], ['Cyan', '34b8e0'],
  ['Sky blue', '7fb6ea'], ['Blue', '2f6fd0'], ['Navy', '1f2f66'], ['Purple', '7a49b5'],
  ['Lavender', 'b59ae0'], ['Magenta', 'c43c9a'], ['Pink', 'f08cb8'], ['Brown', '7a4a2a'],
  ['Tan', 'c9a77c'], ['Beige', 'e0cfae'], ['Clear', 'd6e4ea'], ['Smoke', '5f6670']
];

const S = {
  conn: 'connecting', klippy: 'startup', klippyMsg: '', st: {},
  prompt: null, heldPrompt: null,
  screen: 'home', sheet: -1, ask: null, speed: false, colour: null,
  busy: null, toast: null, files: null, meta: {}, pick: null, log: [],
  blank: false, lastTap: Date.now(), finishedAt: null
};

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deg = (v) => (v == null ? '–' : Math.round(v) + '°');
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const dur = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${pad(m)}m` : `${m}m`; };
const base = (p) => p.split('/').pop().replace(/\.gcode$/i, '');
const hex = (c) => (c ? '#' + String(c).replace(/^#/, '') : 'transparent');
const ICON = {
  stop: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><polygon points="8,2.5 16,2.5 21.5,8 21.5,16 16,21.5 8,21.5 2.5,16 2.5,8"/><path d="M12 7v6M12 16.5v.5" stroke-linecap="round"/></svg>',
  home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  file: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M10 11v6l5-3z"/></svg>',
  power: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>',
  pause: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
  sliders: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  spinner: '<svg class="spin" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#4da3ff" stroke-width="2.5" stroke-linecap="round"><path d="M12 3a9 9 0 1 1-9 9"/></svg>'
};

// ---------- derived printer state ----------
function P() {
  const st = S.st;
  const ps = st.print_stats || {};
  const vars = (st.save_variables || {}).variables || {};
  const n = (st['gcode_macro TOOL_POSITIONS'] || {}).tool_count || 8;
  const mats = Array.isArray(vars.tool_materials) ? vars.tool_materials : null;
  const cols = Array.isArray(vars.tool_colours) ? vars.tool_colours : [];
  const homed = /x/.test((st.toolhead || {}).homed_axes || '') && /y/.test(st.toolhead.homed_axes) && /z/.test(st.toolhead.homed_axes);
  return {
    n, mats, cols, homed,
    active: vars.active_tool ?? -1,
    state: ps.state || 'standby',
    printing: ps.state === 'printing' || ps.state === 'paused',
    paused: ps.state === 'paused',
    file: ps.filename || '',
    layer: (ps.info || {}).current_layer, layers: (ps.info || {}).total_layer,
    printDur: ps.print_duration || 0, totalDur: ps.total_duration || 0,
    progress: (st.virtual_sdcard || {}).progress || 0,
    ext: st.extruder || {}, bed: st.heater_bed || {}, chamber: (st['temperature_sensor chamber'] || {}).temperature,
    zoff: ((st.gcode_move || {}).homing_origin || [0, 0, 0])[2] || 0,
    speed: Math.round(((st.gcode_move || {}).speed_factor ?? 1) * 100),
    flow: Math.round(((st.gcode_move || {}).extrude_factor ?? 1) * 100)
  };
}
const matOf = (p, i) => (p.mats ? (p.mats[i] || '') : null);   // null = not recorded yet

// ---------- file metadata ----------
function fileInfo(path) {
  const m = S.meta[path];
  if (!m) return null;
  let types = m.filament_type;
  if (typeof types === 'string') { try { types = JSON.parse(types); } catch (e) { types = types.split(/[;,]/); } }
  types = (types || []).map((t) => String(t).trim().toUpperCase());
  const colors = m.filament_colors || m.extruder_colors || [];
  const w = m.filament_weights || [];
  let tools = w.map((g, i) => (g > 0 ? i : -1)).filter((i) => i >= 0);
  if (!tools.length && (m.referenced_tools || []).length) tools = m.referenced_tools;
  if (!tools.length) tools = [0];
  const thumbs = (m.thumbnails || []).slice().sort((a, b) => b.width - a.width);
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  return {
    tools: tools.map((t) => ({ t, color: colors[t], type: types[t] || types[0] || '' })),
    time: m.estimated_time, grams: m.filament_weight_total, modified: m.modified,
    thumb: thumbs.length ? `${HTTP}/server/files/gcodes/${encodeURI(dir + thumbs[0].relative_path)}` : null
  };
}
async function loadMeta(path) {
  if (S.meta[path] !== undefined) return;
  S.meta[path] = null;
  try { S.meta[path] = await mr.call('server.files.metadata', { filename: path }); } catch (e) { delete S.meta[path]; return; }
  render();
}
function chipWarn(p, t, type) { const m = matOf(p, t); return m !== null && m !== type; }

// ---------- views ----------
function topbar(p) {
  const at = p.active;
  let status = p.homed ? 'Ready · homed' : 'Ready · not homed', cls = '';
  if (S.conn !== 'open') { status = 'Connecting…'; cls = 's-stop'; }
  else if (S.klippy === 'shutdown' || S.klippy === 'error') { status = 'Shutdown'; cls = 's-stop'; }
  else if (S.klippy !== 'ready') { status = 'Klipper starting'; cls = 's-stop'; }
  else if (p.paused) { status = 'Paused'; cls = 's-pause'; }
  else if (p.printing) { cls = 's-print'; status = !p.layer ? 'Starting print' : p.layer === 1 ? 'Printing · first layer' : `Printing · ${Math.round(p.progress * 100)}%`; }
  const tt = (h) => deg(h.temperature) + (h.target > 0 ? ' / ' + deg(h.target) : '');
  return `<header>
    <div class="chip"><span class="sw" style="width:14px;height:14px;background:${at >= 0 ? hex(p.cols[at]) : 'transparent'}"></span><b>${at >= 0 ? 'T' + at : 'No tool'}</b><span>${at >= 0 ? tt(p.ext) : ''}</span></div>
    <div class="chip"><span class="lbl">Bed</span><span>${tt(p.bed)}</span></div>
    <div class="chip"><span class="lbl">Chamber</span><span>${deg(p.chamber)}</span></div>
    <div style="flex:1"></div>
    <div class="status ${cls}">${status}</div>
    <button class="btn stop" data-act="estop" ${S.klippy === 'shutdown' ? 'disabled' : ''}>${ICON.stop}STOP</button>
  </header>`;
}

function home(p) {
  const tiles = [];
  for (let i = 0; i < p.n; i++) {
    const m = matOf(p, i);
    const on = p.active === i;
    tiles.push(`<button class="tile${on ? ' on' : ''}${m ? '' : ' empty'}" data-act="sheet" data-arg="${i}">
      <div class="row1"><span class="t">T${i}</span><span class="where">${on ? 'On head' : 'Docked'}</span></div>
      <div class="row2"><span class="mat"><span class="sw" style="background:${m ? hex(p.cols[i]) : 'transparent'}"></span>${m === null ? '—' : m || 'Empty'}</span><span class="where">${on ? deg(p.ext.temperature) : ''}</span></div>
    </button>`);
  }
  return `<div class="home"><div class="tiles">${tiles.join('')}</div>
    <div class="homerow">
      <button class="btn pbtn" style="flex:1" data-act="home">${ICON.home}<span>Home</span><span class="psub">${p.homed ? 'XYZ homed' : 'not homed'}</span></button>
      <button class="btn primary" style="flex:1.6;font-size:21px" data-act="files">${ICON.file}Print a file</button>
      <button class="btn pbtn" style="flex:1" data-act="motorsoff">${ICON.power}<span>Motors off</span></button>
    </div></div>`;
}

function sheet(p) {
  const i = S.sheet, m = matOf(p, i), on = i === p.active;
  const lock = p.printing && !(p.paused && on);       // mid-print only the tool on the head, and only while paused
  return `<div class="scrim" data-act="close"><div class="card" style="width:520px" data-act="none">
    <div class="cardhead"><h2><span class="sw" style="display:inline-block;width:18px;height:18px;margin-right:10px;vertical-align:-2px;background:${m ? hex(p.cols[i]) : 'transparent'}"></span>T${i} · ${m === null ? 'material not recorded' : m || 'Empty'}</h2><span class="small">${on ? 'on the head' : 'docked'}</span></div>
    <div class="grid1">
      <button class="btn primary pbtn" data-act="load" data-arg="${i}" ${lock ? 'disabled' : ''}><span>Load</span><span class="psub">pick the material, heat and load</span></button>
      <div class="grid2">
        <button class="btn pbtn" data-act="unload" data-arg="${i}" ${lock || m === '' ? 'disabled' : ''}><span>Unload</span><span class="psub">heat, ram and pull</span></button>
        <button class="btn pbtn" data-act="purge" data-arg="${i}" ${lock || !m ? 'disabled' : ''}><span>Purge</span><span class="psub">extrude a bit more</span></button>
      </div>
    </div>
    <div class="footer"><button class="btn ghost" data-act="colour" data-arg="${i}" style="min-width:0">Set colour</button><div style="flex:1"></div><button class="btn ghost" data-act="close">Close</button></div>
  </div></div>`;
}

function promptView() {
  const pr = S.prompt;
  const items = pr.items;
  const gi = items.findIndex((x) => x.type === 'group');
  const first = items.find((x) => x.gcode) || (gi >= 0 ? items[gi].buttons[0] : null) || pr.footer[0];
  const tag = first ? first.gcode.split(/\s/)[0].replace(/^_+/, '') : '';
  const btn = (b, i, where) => {
    const lab = /^(.*?)\s+\((.*)\)$/.exec(b.label);
    const cls = { primary: 'primary', error: 'danger', warning: 'warnbtn', info: 'primary' }[b.style] || '';
    return `<button class="btn ${cls}${lab ? ' pbtn' : ''}" data-act="pbtn" data-arg="${where}:${i}">${lab ? `<span>${esc(lab[1])}</span><span class="psub">${esc(lab[2])}</span>` : esc(b.label)}</button>`;
  };
  // inline layout: a heading text, then one button group, then footer -> one row
  const inline = gi > 0 && items[gi - 1].type === 'text' && pr.footer.length && gi === items.length - 1;
  let body = '';
  const texts = (inline ? items.slice(0, gi - 1) : items).filter((x) => x.type === 'text').map((x) => `<p>${esc(x.text)}</p>`).join('');
  if (inline) {
    body = `${texts}<div class="inline"><div class="grp"><span class="k">${esc(items[gi - 1].text)}</span><div class="btns">${items[gi].buttons.map((b, j) => btn(b, j, 'g' + gi)).join('')}</div></div>
      <div class="done">${pr.footer.map((b, j) => btn(b, j, 'f')).join('')}</div></div>`;
  } else {
    const flat = [];
    items.forEach((x, k) => { if (x.type === 'button') flat.push(btn(x, k, 'i')); if (x.type === 'group') x.buttons.forEach((b, j) => flat.push(btn(b, j, 'g' + k))); });
    body = `${texts}${flat.length ? `<div class="${flat.length > 1 ? 'grid2' : 'grid1'}">${flat.join('')}</div>` : ''}
      ${pr.footer.length ? `<div class="footer">${pr.footer.map((b, j) => btn(b, j, 'f')).join('')}</div>` : ''}`;
  }
  return `<div class="scrim"><div class="card" style="width:640px">
    <div class="cardhead"><h2>${esc(pr.title)}</h2>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</div>${body}</div></div>`;
}

function askView() {
  const a = S.ask;
  return `<div class="scrim"><div class="card" style="width:520px">
    <h2>${esc(a.title)}</h2>${a.text ? `<p>${esc(a.text)}</p>` : ''}
    <div class="grid2">${a.buttons.map((b, i) => `<button class="btn ${b.cls || ''}" style="height:60px" data-act="askbtn" data-arg="${i}">${esc(b.label)}</button>`).join('')}</div>
  </div></div>`;
}

function colourView(p) {
  const t = S.colour.tool, cur = String(p.cols[t] || '').toLowerCase();
  return `<div class="scrim"><div class="card" style="width:720px">
    <div class="cardhead"><h2>T${t} colour</h2><span class="small">${S.colour.loading ? 'heating and loading meanwhile' : 'shown on the tiles and file chips'}</span></div>
    <div class="swgrid">${PALETTE.map(([name, c]) => `<button class="swb${c === cur ? ' sel' : ''}" style="background:#${c}" data-act="pickcolour" data-arg="${c}" aria-label="${name}"></button>`).join('')}</div>
    <div class="footer"><button class="btn ghost" data-act="skipcolour">Skip</button></div>
  </div></div>`;
}

function speedView(p) {
  return `<div class="scrim" data-act="closespeed"><div class="card" style="width:560px" data-act="none">
    <h2>Speed and flow</h2>
    <div class="zrow" style="background:var(--surface);box-shadow:none"><div class="zv"><div class="k">Speed</div><div class="vb">${p.speed}%</div></div>
      <button class="btn" data-act="speed" data-arg="-10">−10</button><button class="btn" data-act="speed" data-arg="10">+10</button></div>
    <div class="zrow" style="background:var(--surface);box-shadow:none"><div class="zv"><div class="k">Flow</div><div class="vb">${p.flow}%</div></div>
      <button class="btn" data-act="flow" data-arg="-1">−1</button><button class="btn" data-act="flow" data-arg="1">+1</button></div>
    <div class="footer"><button class="btn ghost" data-act="speedreset">Reset</button><button class="btn primary" data-act="closespeed">Done</button></div>
  </div></div>`;
}

function chipsFor(p, info, outlineActive) {
  return info.tools.map((x) => `<span class="mini${chipWarn(p, x.t, x.type) ? ' warn' : ''}${outlineActive && x.t === p.active ? ' on' : ''}"><span class="sw" style="width:11px;height:11px;background:${hex(x.color)}"></span>T${x.t}</span>`).join('');
}
function thumbImg(info) { return info && info.thumb ? `<img src="${esc(info.thumb)}" alt="">` : ''; }

function printing(p) {
  if (p.file) loadMeta(p.file);
  const info = p.file ? fileInfo(p.file) : null;
  const est = info && info.time;
  const left = est ? Math.max(0, est - p.printDur) : (p.progress > 0.02 ? p.printDur / p.progress - p.printDur : null);
  const ready = p.layer > 0;
  const log = S.log.slice(0, 12).map((m, i) => `<div class="msg${i === 0 ? ' now' : ''}"><span class="mt">${m.time}</span><span>${esc(m.text)}</span></div>`).join('');
  const z = p.zoff.toFixed(3).replace(/^(-?)0\./, '$10.').replace(/^(\d)/, '+$1').replace('+0.000', '0.000');
  return `<div class="printing">
    <div class="pleft"><div class="thumb" style="width:290px;height:290px">${thumbImg(info)}</div>
      <div class="pname">${esc(base(p.file))}</div><div class="chips">${info ? chipsFor(p, info, true) : ''}</div></div>
    <div class="pright">
      <div class="pct"><b>${Math.round(p.progress * 100)}%</b><span class="small" style="font-size:17px">${ready ? `Layer ${p.layer}${p.layers ? ' / ' + p.layers : ''}` : 'Getting ready'}</span></div>
      <div class="bar${p.paused ? ' paused' : ''}"><i style="width:${(p.progress * 100).toFixed(1)}%"></i></div>
      <div class="stats3">
        <div class="stat"><span class="k">Elapsed</span><span class="v">${dur(p.totalDur)}</span></div>
        <div class="stat"><span class="k">Left</span><span class="v">${left == null ? '–' : dur(left)}</span></div>
        <div class="stat"><span class="k">ETA</span><span class="v">${left == null ? '–' : hhmm(new Date(Date.now() + left * 1000))}</span></div>
      </div>
      ${p.layer === 1 ? `<div class="zrow"><div class="zv"><div class="k">Z offset</div><div class="vb">${z}</div></div>
        ${['-0.05', '-0.01', '+0.01', '+0.05'].map((d) => `<button class="btn" data-act="z" data-arg="${d}">${d.replace('-', '−')}</button>`).join('')}</div>` : ''}
      <div class="log">${log || '<div class="msg">No messages yet</div>'}</div>
      ${p.paused ? `<div class="pgrid">
          <button class="btn primary" data-act="resume">${ICON.play}Resume</button>
          <button class="btn redtext" data-act="cancel">Cancel print</button>
          <button class="btn" data-act="load" data-arg="${p.active}" ${p.active < 0 ? 'disabled' : ''}>Load T${Math.max(p.active, 0)}</button>
          <button class="btn" data-act="unload" data-arg="${p.active}" ${p.active < 0 ? 'disabled' : ''}>Unload T${Math.max(p.active, 0)}</button></div>`
        : `<div class="prow"><button class="btn" data-act="pause">${ICON.pause}Pause</button>
          <button class="btn" data-act="speedsheet">${ICON.sliders}Speed/flow</button>
          <button class="btn ghost redtext" data-act="cancel">Cancel</button></div>`}
    </div></div>`;
}

function age(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return 'Today ' + hhmm(d);
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + hhmm(d);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function filesView(p) {
  let body;
  if (S.files === null) body = '<div class="empty-note">Loading files…</div>';
  else if (!S.files.length) body = '<div class="empty-note">No G-code files</div>';
  else body = S.files.map((f) => {
    loadMeta(f.path);
    const info = fileInfo(f.path);
    return `<button class="ftile" data-act="pickfile" data-arg="${esc(f.path)}">
      <div class="thumb">${thumbImg(info)}</div><div class="fname">${esc(base(f.path))}</div>
      <div class="small">${age(f.modified)}${info && info.time ? ' · ' + dur(info.time) : ''}</div>
      <div class="chips">${info ? chipsFor(p, info, false) : ''}</div></button>`;
  }).join('');
  return `<div class="files"><div class="fhead"><button class="btn ghost" data-act="back" style="min-width:110px">Back</button><h2>Print a file</h2></div>
    <div class="list">${body}</div></div>`;
}

function confirmView(p) {
  const path = S.pick, info = fileInfo(path);
  let warn = false;
  const rows = info ? info.tools.map((x) => {
    const m = matOf(p, x.t), bad = chipWarn(p, x.t, x.type);
    warn = warn || bad;
    return `<div class="need${bad ? ' warn' : ''}">
      <div class="half"><b style="width:30px">T${x.t}</b><span class="sw" style="background:${hex(x.color)}"></span>${esc(x.type)}</div>
      <div class="half"><span class="small" style="color:inherit;opacity:.8">Loaded</span><span class="sw" style="background:${m ? hex(p.cols[x.t]) : 'transparent'}"></span>${m === null ? 'not recorded' : esc(m || 'Empty')}</div></div>`;
  }).join('') : '';
  return `<div class="confirm">
    <div class="thumb" style="width:260px;height:260px">${thumbImg(info)}</div>
    <div style="flex:1;display:flex;flex-direction:column;gap:10px;min-width:0">
      <div class="pname" style="font-size:22px">${esc(base(path))}</div>
      <div class="small" style="font-size:15px">${info ? [info.time ? dur(info.time) : '', info.grams ? Math.round(info.grams) + ' g' : '', info.modified ? 'sliced ' + age(info.modified) : ''].filter(Boolean).join(' · ') : 'Reading file…'}</div>
      <div class="k">File wants · Loaded</div>
      <div class="needs">${rows}</div>
      <div class="footer"><button class="btn ghost" data-act="files" style="min-width:140px">Back</button>
        <button class="btn ${warn ? 'warnbtn' : 'primary'}" data-act="print" style="min-width:220px" ${info ? '' : 'disabled'}>${warn ? 'Print anyway' : 'Print'}</button></div>
    </div></div>`;
}

function pageView() {
  if (S.conn !== 'open') return `<div class="page"><h1>Connecting to Moonraker</h1><p>${esc(HOST)}</p></div>`;
  if (S.klippy === 'shutdown' || S.klippy === 'error') {
    const estop = /emergency/i.test(S.klippyMsg) || S.klippy === 'shutdown';
    return `<div class="page"><h1>${estop ? 'Emergency stop' : 'Klipper error'}</h1><p>${esc(S.klippyMsg.split('\n').slice(0, 4).join('\n'))}</p>
      <button class="btn primary" data-act="fwrestart">Firmware restart</button></div>`;
  }
  return `<div class="page"><h1>Klipper is starting</h1><p>${esc(S.klippyMsg)}</p></div>`;
}

function busyView() {
  const b = S.busy;
  return `<div class="scrim"><div class="card" style="width:520px">
    <div class="cardhead"><div style="display:flex;gap:14px;align-items:center">${ICON.spinner}<h2>${esc(b.title)}</h2></div>
      <button class="btn ghost" data-act="hidebusy" style="min-height:40px;font-size:15px">Hide</button></div>
    <p>${esc(b.detail || (S.log[0] || {}).text || 'Working…')}</p>
    <div class="bar"><div class="indet"></div></div></div></div>`;
}

// Taps redraw on the next frame. Status pushes (Moonraker sends them every 250 ms,
// mostly sub-degree temperature changes) redraw at most twice a second, and the
// DOM is only patched when the generated HTML actually changed.
// ---------- screen blanking ----------
// The HDMI5's backlight ignores the HDMI signal (docs/buildlog.html#hdmi5), and an
// undriven panel glows grey, so "sleep" is a black page with the output left on;
// touch keeps working. During a print a dim status line moves once a minute so
// nothing static sits on the panel. The first tap only wakes the screen.
function blankView(p) {
  let text = '';
  if (p.printing) {
    const info = p.file ? fileInfo(p.file) : null;
    const est = info && info.time;
    const left = est ? Math.max(0, est - p.printDur) : null;
    text = (p.paused ? 'Paused · ' : '') + Math.round(p.progress * 100) + '%' +
      (p.layer ? ` · Layer ${p.layer}${p.layers ? '/' + p.layers : ''}` : '') +
      (left != null && !p.paused ? ' · ETA ' + hhmm(new Date(Date.now() + left * 1000)) : '');
  } else if (p.state === 'complete' && S.finishedAt) {
    text = 'Print finished ' + S.finishedAt;
  }
  const minute = Math.floor(Date.now() / 60000);
  const r = (k) => ((Math.sin(minute * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  return `<div class="blank" data-act="wake">${text ? `<div class="blanktext" style="left:${Math.round(30 + r(1) * 400)}px;top:${Math.round(30 + r(2) * 380)}px">${esc(text)}</div>` : ''}</div>`;
}
function sleepScreen() { if (!S.prompt && !S.ask && !S.colour) { S.blank = true; S.sheet = -1; S.speed = false; render(); } }
function wake() { S.lastTap = Date.now(); if (S.blank) { S.blank = false; render(); } }
setInterval(() => {
  if (S.blank) renderLazy();                                  // minute drift and ETA
  else if (Date.now() - S.lastTap > BLANK_S * 1000) sleepScreen();
}, 10000);
document.addEventListener('pointerdown', () => { S.lastTap = Date.now(); }, true);

let raf = 0, lazyT = 0, lastHtml = '';
function render() { if (!raf) raf = requestAnimationFrame(draw); }
function renderLazy() { if (!lazyT && !raf) lazyT = setTimeout(() => { lazyT = 0; render(); }, 500); }
function draw() {
  raf = 0;
  clearTimeout(lazyT); lazyT = 0;
  const p = P();
  if (S.blank) {       // skip building the hidden screens while blanked
    const html = blankView(p);
    if (html !== lastHtml) { lastHtml = html; morph(document.getElementById('app'), html); }
    return;
  }
  let mainView;
  if (S.conn !== 'open' || S.klippy !== 'ready') mainView = pageView();
  else if (p.printing) mainView = printing(p);
  else if (S.screen === 'files') mainView = filesView(p);
  else if (S.screen === 'confirm' && S.pick) mainView = confirmView(p);
  else mainView = home(p);
  const ready = S.conn === 'open' && S.klippy === 'ready';
  let over = '';
  if (ready) {
    if (S.sheet >= 0 && !p.printing) over += sheet(p);
    if (S.speed && p.printing) over += speedView(p);
    if (S.colour) over += colourView(p);
    else if (S.prompt) over += promptView();
    if (S.ask) over += askView();
    if (S.busy && !S.busy.hidden && !S.prompt && !S.colour && !S.ask) over += busyView();
  }
  const toast = S.toast ? `<div class="toast${S.toast.err ? ' err' : ''}">${esc(S.toast.text)}</div>` : '';
  const html = topbar(p) + `<main>${mainView}${over}${toast}</main>`;
  if (html === lastHtml) return;
  lastHtml = html;
  morph(document.getElementById('app'), html);
}

// ---------- DOM patcher ----------
function morph(root, html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  patchKids(root, t.content);
}
function patchKids(a, b) {
  const an = [...a.childNodes], bn = [...b.childNodes];
  bn.forEach((nb, i) => { if (i < an.length) patch(an[i], nb); else a.appendChild(nb); });
  for (let i = bn.length; i < an.length; i++) an[i].remove();
}
function patch(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.data !== b.data) a.data = b.data; return; }
  if (a.nodeType !== 1) return;
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  if (a.nodeName === 'BUTTON') a.disabled = b.hasAttribute('disabled');
  patchKids(a, b);
}

// ---------- actions ----------
function toast(text, err) {
  S.toast = { text, err };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { S.toast = null; render(); }, err ? 6000 : 2800);
  render();
}

const BUSY_NAMES = { G28: 'Homing', _LOAD_TOOL_RUN: 'Loading', _UNLOAD_TOOL_RUN: 'Unloading', PURGE_TOOL: 'Purging', _PURGE_RUN: 'Purging', _PURGE_DONE: 'Parking', M84: 'Motors off' };
let busySeq = 0;
async function gcode(script, title) {
  const seq = ++busySeq;
  const cmd = script.split(/\s/)[0];
  const t = setTimeout(() => { if (seq === busySeq) { S.busy = { title: title || BUSY_NAMES[cmd] || cmd }; render(); } }, 600);
  try { await mr.gcode(script); }
  catch (e) { toast(e.message.replace(/^.*CommandError: /, ''), true); }
  finally { clearTimeout(t); if (seq === busySeq) { S.busy = null; render(); } }
}

function ask(title, text, buttons) { S.ask = { title, text, buttons }; render(); }
function needHome(p, next) {
  if (p.homed) { next(); return; }
  ask('Is the bed clear?', "Z isn't homed, so this homes first and probes the bed centre.", [
    { label: 'Cancel', cls: 'ghost' }, { label: 'Bed is clear', cls: 'primary', run: next }]);
}

const ACT = {
  none() {},
  wake() { wake(); },
  estop() { mr.call('printer.emergency_stop').catch(() => {}); },
  fwrestart() { mr.call('printer.firmware_restart').catch((e) => toast(e.message, true)); },
  sheet(i) { S.sheet = +i; },
  close() { S.sheet = -1; },
  load(i) { const p = P(); S.sheet = -1; needHome(p, () => gcode(`_LOAD_TOOL_MATERIAL TOOL=${i}`)); },
  unload(i) { const p = P(); S.sheet = -1; needHome(p, () => gcode(`_UNLOAD_TOOL_RUN TOOL=${i}`, `Unloading T${i}`)); },
  purge(i) { const p = P(); S.sheet = -1; needHome(p, () => gcode(`PURGE_TOOL TOOL=${i} CLEAR=1`, `Heating T${i}`)); },
  colour(i) { S.sheet = -1; S.colour = { tool: +i }; },
  pickcolour(c) {
    const t = S.colour.tool;
    mr.gcode(`_SET_TOOL_VAR VAR=tool_colours TOOL=${t} VALUE=${c}`).catch((e) => toast(e.message, true));
    endColour();
  },
  skipcolour() { endColour(); },
  home() { const p = P(); needHome(p, () => gcode('G28')); },
  motorsoff() { ask('Turn the motors off?', 'The axes will need homing again.', [{ label: 'Keep on', cls: 'ghost' }, { label: 'Motors off', cls: 'primary', run: () => gcode('M84') }]); },
  files() { S.screen = 'files'; S.pick = null; loadFiles(); },
  back() { S.screen = 'home'; },
  pickfile(path) { S.pick = path; S.screen = 'confirm'; loadMeta(path); },
  print() { const f = S.pick; S.screen = 'home'; S.pick = null; S.log = []; mr.call('printer.print.start', { filename: f }).catch((e) => toast(e.message, true)); },
  pause() { mr.call('printer.print.pause').catch((e) => toast(e.message, true)); },
  resume() { mr.call('printer.print.resume').catch((e) => toast(e.message, true)); },
  cancel() { ask('Cancel print?', 'This stops the print. It cannot be resumed.', [{ label: 'Keep printing', cls: 'ghost' }, { label: 'Cancel print', cls: 'danger', run: () => mr.call('printer.print.cancel').catch((e) => toast(e.message, true)) }]); },
  z(d) { mr.gcode(`SET_GCODE_OFFSET Z_ADJUST=${d} MOVE=1`).catch((e) => toast(e.message, true)); },
  speedsheet() { S.speed = true; },
  closespeed() { S.speed = false; },
  speed(d) { const p = P(); mr.gcode(`M220 S${Math.max(10, p.speed + +d)}`).catch(() => {}); },
  flow(d) { const p = P(); mr.gcode(`M221 S${Math.max(50, p.flow + +d)}`).catch(() => {}); },
  speedreset() { mr.gcode('M220 S100\nM221 S100').catch(() => {}); },
  askbtn(i) { const b = S.ask.buttons[+i]; S.ask = null; if (b.run) b.run(); },
  hidebusy() { if (S.busy) S.busy.hidden = true; },
  pbtn(where) {
    // where: "f:<footer index>", "i:<item index>" or "g<item index>:<button in group>"
    const [k, j] = where.split(':');
    const pr = S.prompt;
    if (!pr) return;
    const btn = k === 'f' ? pr.footer[+j] : k === 'i' ? pr.items[+j] : pr.items[+k.slice(1)].buttons[+j];
    const m = /^_LOAD_TOOL_RUN\s+TOOL=(\d+)/i.exec(btn.gcode);
    if (m) { S.prompt = null; S.colour = { tool: +m[1], loading: true }; }   // colour step while it heats
    gcode(btn.gcode);
  }
};

function endColour() {
  S.colour = null;
  if (S.heldPrompt) { S.prompt = S.heldPrompt; S.heldPrompt = null; }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.dataset.act === 'none') { e.stopPropagation(); return; }
  if (el.classList.contains('scrim') && e.target !== el) return;   // taps inside a card don't close it
  const fn = ACT[el.dataset.act];
  if (fn) { fn(el.dataset.arg); render(); }
});

async function loadFiles() {
  S.files = null; render();
  try {
    const r = await mr.call('server.files.list', { root: 'gcodes' });
    S.files = r.filter((f) => /\.gcode$/i.test(f.path) && !f.path.startsWith('.')).sort((a, b) => b.modified - a.modified).slice(0, 60);
  } catch (e) { S.files = []; toast(e.message, true); }
  render();
}

// ---------- log of M117 / display_status messages (Klipper keeps only the latest) ----------
function addLog(text, when) {
  if (!text || (S.log[0] && S.log[0].text === text)) return;
  S.log.unshift({ text, time: hhmm(when || new Date()) });
  S.log.length = Math.min(S.log.length, 40);
}
async function seedLog() {
  try {
    const r = await mr.call('server.gcode_store', { count: 200 });
    const ms = r.gcode_store.filter((g) => /^M117\s/i.test(g.message)).slice(-12);
    S.log = [];
    for (const g of ms) addLog(g.message.replace(/^M117\s+/i, ''), new Date(g.time * 1000));
  } catch (e) { /* not fatal */ }
}

// ---------- wiring ----------
const parser = new PromptParser();
const mr = new Moonraker(`ws://${HOST}/websocket`, OBJECTS, {
  conn(c) { S.conn = c; if (c === 'open') seedLog(); render(); },
  klippy(state, msg) { S.klippy = state; S.klippyMsg = msg || ''; if (state !== 'ready') wake(); render(); },
  status(st, changed) {
    S.st = st;
    const ds = changed.display_status;
    if (ds && ds.message) addLog(ds.message);
    const ps = changed.print_stats;
    if (ps && ps.state === 'paused') wake();                       // needs attention
    if (ps && ps.state === 'complete') S.finishedAt = hhmm(new Date());
    if (ps && ps.state === 'printing') S.finishedAt = null;
    renderLazy();
  },
  gcode(line) {
    const r = parser.feed(line);
    if (r && r.show) { if (S.colour) S.heldPrompt = r.show; else S.prompt = r.show; S.sheet = -1; wake(); }
    if (/^\/\/ kleanscreen:sleep\b/.test(line)) sleepScreen();     // SCREEN_SLEEP / SCREEN_WAKE macros
    if (/^\/\/ kleanscreen:wake\b/.test(line)) wake();
    if (r && r.end) { S.prompt = null; S.heldPrompt = null; }
    if (/^!! /.test(line)) toast(line.slice(3), true);
    if (S.busy && !/^\/\/ action:|^ok/.test(line)) S.busy.detail = line.replace(/^\/\/ /, '');
    render();
  }
});
window.KLEAN = { S, render };     // for debugging from the kiosk's cmd.js hook
render();
