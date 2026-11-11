// Demo mode (index.html?demo): a pretend Moonraker + Klipper + INDX in the page,
// so the real UI can be tried in any browser with no printer. Same interface as
// Moonraker in moonraker.js. It acts out the screen's macros (load, purge,
// unload, prints) roughly, with shortened timings. ?tools=<n> sets the tool count.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (s) => `// action:${s}`;
const PRESETS = { TPU: 230, PLA: 210, PETG: 240, ASA: 250 };
const BED = { TPU: 35, PLA: 55, PETG: 80, ASA: 100 };

// Flat isometric "part" thumbnails, drawn here so the demo needs no files.
function thumb(cols, shape) {
  const c = cols.map((x) => '#' + x);
  const box = (x, y, w, h, d, col) => `
    <polygon points="${x},${y} ${x + w},${y - w / 2} ${x + w + d},${y - w / 2 + d / 2} ${x + d},${y + d / 2}" fill="${col}"/>
    <polygon points="${x},${y} ${x + d},${y + d / 2} ${x + d},${y + d / 2 + h} ${x},${y + h}" fill="${col}" opacity=".75"/>
    <polygon points="${x + d},${y + d / 2} ${x + w + d},${y - w / 2 + d / 2} ${x + w + d},${y - w / 2 + d / 2 + h} ${x + d},${y + d / 2 + h}" fill="${col}" opacity=".55"/>`;
  let body = '';
  if (shape === 'cube') body = box(95, 140, 60, 60, 60, c[0]);
  else if (shape === 'stack') c.forEach((col, i) => { body += box(70 + i * 4, 190 - i * 34, 80, 30, 80, col); });
  else if (shape === 'flat') c.forEach((col, i) => { body += box(40 + (i % 2) * 90, 150 + Math.floor(i / 2) * 50 - (i % 2) * 20, 60, 8, 50, col); });
  else body = box(60, 160, 110, 22, 40, c[0]) + box(110, 120, 20, 70, 20, c[0]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${body}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

const now = () => Date.now() / 1000;
const FILES = [
  { path: 'Calibration_cube_PLA_15m.gcode', age: 3600, time: 900, tools: [0], types: ['PLA'], cols: ['f08cb8'], shape: 'cube', layers: 100 },
  { path: 'Four_colour_stack_PLA_1h12m.gcode', age: 86400, time: 4320, tools: [0, 1, 2, 3], types: ['PLA', 'PLA', 'PLA', 'PLA'], cols: ['f08cb8', '1f6fd1', 'f0b450', 'e9edf2'], shape: 'stack', layers: 160 },
  { path: 'Spool_holder_PETG_2h40m.gcode', age: 3 * 86400, time: 9600, tools: [4], types: ['', '', '', '', 'PETG'], cols: ['', '', '', '', '2e9e5b'], shape: 'bracket', layers: 210 },
  { path: 'Useful/Cable_clips_ASA_25m.gcode', age: 5 * 86400, time: 1500, tools: [5], types: ['', '', '', '', '', 'ASA'], cols: ['', '', '', '', '', '8b9097'], shape: 'bracket', layers: 40 },
  { path: 'Useful/Filament_swatches_x4_48m.gcode', age: 9 * 86400, time: 2880, tools: [0, 1, 2, 3], types: ['PLA', 'PLA', 'PLA', 'PLA'], cols: ['f08cb8', '1f6fd1', 'f0b450', 'e9edf2'], shape: 'flat', layers: 12 }
];

export class FakeMoonraker {
  constructor(url, objects, on) {
    this.on = on;
    const qs = new URLSearchParams(location.search);
    const n = Math.max(1, Math.min(16, +(qs.get('tools') || 8)));
    const mats = ['PLA', 'PLA', 'PLA', 'PLA', 'PETG', '', '', ''], cols = ['f08cb8', '1f6fd1', 'f0b450', 'e9edf2', '2e9e5b', '', '', ''];
    this.status = {
      print_stats: { state: 'standby', filename: '', print_duration: 0, total_duration: 0, filament_used: 0, info: { current_layer: null, total_layer: null } },
      virtual_sdcard: { progress: 0, is_active: false }, display_status: { message: null }, pause_resume: { is_paused: false },
      toolhead: { homed_axes: 'xyz' },
      gcode_move: { homing_origin: [0, 0, 0, 0], speed_factor: 1, extrude_factor: 1, gcode_position: [0, 0, 10, 0] },
      extruder: { temperature: 24, target: 0 }, heater_bed: { temperature: 23, target: 0 }, 'temperature_sensor chamber': { temperature: 22.4 },
      save_variables: { variables: { active_tool: -1, global_z_offset: 0, tool_materials: Array.from({ length: n }, (_, i) => mats[i] || ''), tool_colours: Array.from({ length: n }, (_, i) => cols[i] || '') } },
      'gcode_macro TOOL_POSITIONS': { tool_count: n }, webhooks: { state: 'ready', state_message: '' }, configfile: { save_config_pending: false }
    };
    this.klippy = 'ready';
    this.job = null;
    setTimeout(() => { on.conn('open'); this.push(this.status); on.klippy('ready', ''); }, 300);
    setInterval(() => this.tick(), 250);
  }

  // ---- plumbing ----
  push(changed) {
    for (const [k, v] of Object.entries(changed)) this.status[k] = Object.assign(this.status[k] || {}, v);
    this.on.status(this.status, changed);
  }
  set(obj, fields) { this.push({ [obj]: fields }); }
  vars(v) { this.set('save_variables', { variables: Object.assign({}, this.status.save_variables.variables, v) }); }
  say(line) { this.on.gcode(line); }
  m117(msg) { this.set('display_status', { message: msg }); }
  fail(msg) { this.say(`!! ${msg}`); throw new Error(msg); }
  listVar(name, t, val) { const a = this.status.save_variables.variables[name].slice(); a[t] = val; this.vars({ [name]: a }); }

  tick() {
    const ch = {};
    for (const h of ['extruder', 'heater_bed']) {
      const o = this.status[h], d = o.target - o.temperature, tgt = o.target || 22;
      const step = o.target ? Math.sign(d) * Math.min(Math.abs(d), h === 'extruder' ? 9 : 3) : (tgt - o.temperature) * 0.04;
      if (Math.abs(tgt - o.temperature) > 0.05) ch[h] = { temperature: +(o.temperature + step + (Math.random() - 0.5) * 0.2).toFixed(2) };
    }
    if (Object.keys(ch).length) this.push(ch);
  }

  async heat(target, bed) {
    this.set('extruder', { target });
    if (bed != null) this.set('heater_bed', { target: bed });
    while (Math.abs(this.status.extruder.temperature - target) > 2) {
      const e = this.status.extruder, b = this.status.heater_bed;
      this.say(`B:${b.temperature.toFixed(1)} /${b.target.toFixed(1)} T0:${e.temperature.toFixed(1)} /${target.toFixed(1)}`);
      await sleep(500);
    }
  }
  async pickup(t) {
    const act = this.status.save_variables.variables.active_tool;
    if (act === t) return;
    if (act >= 0) { this.m117(`Parking T${act}`); await sleep(900); }
    this.m117(`Picking up T${t}`); await sleep(1100);
    this.say(`echo: T${t} seated: load cell -1400 g against the empty head`);
    this.vars({ active_tool: t });
  }
  async park() {
    const act = this.status.save_variables.variables.active_tool;
    if (act < 0) return;
    await sleep(1000);
    this.vars({ active_tool: -1 });
    this.m117(`T${act} parked`);
  }
  purgePrompt(t, type, loaded) {
    const printing = ['printing', 'paused'].includes(this.status.print_stats.state);
    this.say(P('prompt_end'));
    this.say(P(loaded ? `prompt_begin T${t} loaded - ${type}` : `prompt_begin Purge T${t} - ${type}`));
    this.say(P(`prompt_text T${t} is at ${this.status.extruder.target}°C. Purge until it runs clean.`));
    this.say(P('prompt_text Purge'));
    this.say(P('prompt_button_group_start'));
    for (const mm of [10, 25, 50]) this.say(P(`prompt_button ${mm} mm|_PURGE_RUN TOOL=${t} TYPE=${type} MM=${mm}|secondary`));
    this.say(P('prompt_button_group_end'));
    this.say(P(`prompt_footer_button ${printing ? 'Done' : 'Done - cool and park'}|_PURGE_DONE TOOL=${t}|primary`));
    this.say(P('prompt_show'));
  }

  // ---- RPC ----
  async call(method, params = {}) {
    await sleep(40);
    switch (method) {
      case 'server.connection.identify': return {};
      case 'server.info': return { klippy_state: this.klippy };
      case 'printer.objects.subscribe': return { status: this.status };
      case 'printer.objects.query': return { status: { webhooks: this.status.webhooks } };
      case 'server.gcode_store': return { gcode_store: [] };
      case 'server.files.list': return FILES.map((f) => ({ path: f.path, modified: now() - f.age, size: 1e6 }));
      case 'server.files.metadata': {
        const f = FILES.find((x) => x.path === params.filename);
        if (!f) throw new Error('File not found');
        const w = []; f.tools.forEach((t) => { w[t] = 12; });
        return { modified: now() - f.age, estimated_time: f.time, filament_type: JSON.stringify(f.types), filament_colors: f.cols.map((c) => (c ? '#' + c : '')),
          filament_weights: Array.from(w, (x) => x || 0), filament_weight_total: 12 * f.tools.length, layer_height: 0.2, first_layer_height: 0.2, object_height: f.layers * 0.2,
          thumbnails: [{ width: 300, height: 300, relative_path: thumb(f.tools.map((t) => f.cols[t]), f.shape) }] };
      }
      case 'printer.emergency_stop':
        this.stopJob();
        this.klippy = 'shutdown';
        this.set('extruder', { target: 0 }); this.set('heater_bed', { target: 0 });
        this.set('webhooks', { state: 'shutdown', state_message: 'Shutdown due to M112 command' });
        this.on.klippy('shutdown', 'Shutdown due to M112 command');
        return {};
      case 'printer.firmware_restart':
        this.on.klippy('startup', 'Klipper is starting');
        await sleep(2000);
        this.klippy = 'ready';
        this.set('webhooks', { state: 'ready', state_message: '' });
        this.set('toolhead', { homed_axes: '' });
        this.set('print_stats', { state: 'standby' });
        this.on.klippy('ready', '');
        return {};
      case 'printer.print.start': this.startJob(params.filename); return {};
      case 'printer.print.pause': this.set('print_stats', { state: 'paused' }); this.set('pause_resume', { is_paused: true }); this.m117('Paused'); return {};
      case 'printer.print.resume': this.set('print_stats', { state: 'printing' }); this.set('pause_resume', { is_paused: false }); this.m117('Resumed'); return {};
      case 'printer.print.cancel': this.stopJob('cancelled'); return {};
      case 'printer.gcode.script': return this.gcode(params.script);
    }
    return {};
  }

  // ---- G-code: the screen's macros, acted out ----
  async gcode(script) {
    for (const line of String(script).split('\n')) await this.run(line.trim());
    return 'ok';
  }
  async run(line) {
    const [cmd] = line.split(/\s+/);
    const arg = (k) => { const m = line.match(new RegExp(`\\b${k}=(\\S*)`, 'i')); return m ? m[1] : undefined; };
    const v = this.status.save_variables.variables;
    const t = +arg('TOOL');
    switch (cmd.toUpperCase()) {
      case 'G28': this.m117('Homing'); await sleep(2500); this.set('toolhead', { homed_axes: 'xyz' }); this.m117('Homed'); return;
      case 'M84': this.set('toolhead', { homed_axes: '' }); return;
      case 'M220': this.set('gcode_move', { speed_factor: +arg('S') / 100 }); return;
      case 'M221': this.set('gcode_move', { extrude_factor: +arg('S') / 100 }); return;
      case 'SET_GCODE_OFFSET': {
        const o = this.status.gcode_move.homing_origin.slice();
        if (arg('Z_ADJUST') !== undefined) o[2] = +(o[2] + +arg('Z_ADJUST')).toFixed(3);
        else if (arg('Z') !== undefined) o[2] = +arg('Z');
        this.set('gcode_move', { homing_origin: o }); return;
      }
      case 'Z_OFFSET_APPLY_PROBE': this.say('// (demo) Z offset folded into the probe offset'); return;
      case 'SAVE_CONFIG': this.say('// (demo) SAVE_CONFIG would restart Klipper here'); return;
      case 'RESPOND': if (/action:prompt_end/.test(line)) this.say(P('prompt_end')); return;
      case '_SET_TOOL_VAR': this.listVar(arg('VAR').toLowerCase(), t, arg('VALUE') || ''); return;
      case '_LOAD_TOOL_MATERIAL':
        this.say(P('prompt_end')); this.say(P(`prompt_begin Load T${t}`));
        this.say(P('prompt_text Pick the filament - this sets the load temperature, the safety model and the bed warmup.'));
        for (const m of Object.keys(PRESETS)) this.say(P(`prompt_button ${m}  (bed ${BED[m]}C)|_LOAD_TOOL_RUN TOOL=${t} TYPE=${m}|primary`));
        this.say(P('prompt_footer_button Cancel|RESPOND TYPE=command MSG=action:prompt_end|error'));
        this.say(P('prompt_show'));
        return;
      case '_LOAD_TOOL_RUN': {
        const type = arg('TYPE');
        this.say(P('prompt_end'));
        if (this.status.heater_bed.target < BED[type]) this.set('heater_bed', { target: BED[type] });
        await this.pickup(t);
        this.say(`echo: LOAD_FILAMENT: heating T${t} to ${PRESETS[type]} C...`);
        await this.heat(PRESETS[type]);
        this.say('// INDX: loading filament'); await sleep(1500);
        this.say('// INDX filament loaded after 26.5 mm; primed 93.3 mm.');
        this.listVar('tool_materials', t, type);
        this.purgePrompt(t, type, true);
        return;
      }
      case 'PURGE_TOOL': {
        const type = v.tool_materials[t];
        if (this.status.print_stats.state === 'printing') this.fail('PURGE_TOOL: a print is running. Pause it first.');
        if (!type) this.fail(`PURGE_TOOL: T${t} has no recorded material. Use PURGE_TOOL TOOL=${t} TYPE=<material>.`);
        this.say(P('prompt_end'));
        await this.pickup(t);
        this.m117(`Heating T${t} to ${PRESETS[type] || 250}C...`);
        await this.heat(PRESETS[type] || 250);
        this.purgePrompt(t, type, false);
        return;
      }
      case '_PURGE_RUN':
        this.say(P('prompt_end'));
        this.m117(`Purging T${t} ${arg('MM')} mm...`); await sleep(+arg('MM') * 60);
        this.m117(`Purged T${t}`);
        this.purgePrompt(t, arg('TYPE'), false);
        return;
      case '_PURGE_DONE':
        this.say(P('prompt_end'));
        if (!['printing', 'paused'].includes(this.status.print_stats.state)) { this.set('extruder', { target: 0 }); await this.park(); }
        return;
      case '_UNLOAD_TOOL_RUN':
        this.say(P('prompt_end'));
        await this.pickup(t);
        this.m117(`Heating T${t} to unload 250C...`);
        await this.heat(250);
        this.m117(`Unloading T${t}...`); await sleep(2000);
        this.listVar('tool_materials', t, '');
        this.set('extruder', { target: 0 }); this.set('heater_bed', { target: 0 });
        await this.park();
        this.m117(`Unloaded T${t} - heaters off`);
        return;
      case 'SCREEN_SLEEP': this.say('// kleanscreen:sleep'); return;
      case 'SCREEN_WAKE': this.say('// kleanscreen:wake'); return;
    }
  }

  // ---- a pretend print: heat, home, purge line, a long first layer (so the
  // Z offset row can be tried), then quick layers ----
  startJob(filename) {
    const f = FILES.find((x) => x.path === filename);
    if (!f) throw new Error('File not found');
    const job = (this.job = { f, start: Date.now(), alive: true });
    this.set('gcode_move', { homing_origin: [0, 0, 0, 0], speed_factor: 1, extrude_factor: 1 });
    this.set('print_stats', { state: 'printing', filename, print_duration: 0, total_duration: 0, filament_used: 0, info: { current_layer: null, total_layer: f.layers } });
    this.set('virtual_sdcard', { progress: 0, is_active: true });
    (async () => {
      const step = async (msg, ms) => { if (!job.alive) throw 0; this.m117(msg); await sleep(ms); };
      const wait = async () => { while (this.status.print_stats.state === 'paused') await sleep(250); if (!job.alive) throw 0; };
      try {
        this.set('heater_bed', { target: BED[f.types[f.tools[0]]] || 60 });
        await step('Heating bed', 2000);
        await step('Homing', 1500);
        await step('Levelling the bed', 1500);
        await this.pickup(f.tools[0]);
        this.set('extruder', { target: PRESETS[f.types[f.tools[0]]] || 220 });
        await step('Purge line', 2000);
        await step('Printing', 0);
        for (let layer = 1; layer <= f.layers; layer++) {
          await wait();
          if (layer > 1 && f.tools.length > 1 && layer % 6 === 0) await this.pickup(f.tools[layer / 6 % f.tools.length]);
          const el = (Date.now() - job.start) / 1000;
          this.set('print_stats', { info: { current_layer: layer, total_layer: f.layers }, filament_used: layer * 40, print_duration: el * 6, total_duration: el * 6 });
          this.set('virtual_sdcard', { progress: layer / f.layers });
          this.set('gcode_move', { gcode_position: [0, 0, layer * 0.2, 0] });
          await sleep(layer === 1 ? 25000 : 900);
        }
        if (job.alive) this.stopJob('complete');
      } catch (e) { /* cancelled */ }
    })();
  }
  stopJob(state) {
    if (!this.job) return;
    this.job.alive = false; this.job = null;
    this.set('extruder', { target: 0 }); this.set('heater_bed', { target: 0 });
    this.set('pause_resume', { is_paused: false });
    this.set('virtual_sdcard', { is_active: false });
    if (state) { this.set('print_stats', { state }); this.m117(state === 'complete' ? 'Print finished' : 'Print cancelled'); }
    this.park();
  }
}
