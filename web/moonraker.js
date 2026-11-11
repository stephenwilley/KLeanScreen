// Moonraker websocket JSON-RPC client: reconnects, subscribes, merges status.
export class Moonraker {
  constructor(url, objects, on) {
    this.url = url;
    this.objects = objects;
    this.on = on;            // {conn(state), status(full, changed), klippy(state, msg), gcode(line)}
    this.id = 0;
    this.pending = new Map();
    this.status = {};
    this.connect();
  }

  connect() {
    this.on.conn('connecting');
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => {
      this.on.conn('open');
      this.call('server.connection.identify', {
        client_name: 'KLeanScreen', version: '0.1', type: 'display', url: 'https://git.esstec.ca/stephen/KLeanScreen'
      }).catch(() => {});
      this.startKlippy();
    };
    ws.onmessage = (ev) => this.message(JSON.parse(ev.data));
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('Disconnected from Moonraker'));
      this.pending.clear();
      clearTimeout(this.pollTimer);
      this.on.conn('closed');
      setTimeout(() => this.connect(), 2000);
    };
  }

  call(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) { reject(new Error('Not connected to Moonraker')); return; }
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
    });
  }

  gcode(script) { return this.call('printer.gcode.script', { script }); }

  message(m) {
    if (m.id !== undefined && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message || 'Moonraker error'));
      else p.resolve(m.result);
      return;
    }
    switch (m.method) {
      case 'notify_status_update': this.merge(m.params[0]); break;
      case 'notify_gcode_response': this.on.gcode(m.params[0]); break;
      case 'notify_klippy_ready': this.startKlippy(); break;
      case 'notify_klippy_shutdown': this.on.klippy('shutdown'); this.queryWebhooks(); break;
      case 'notify_klippy_disconnected': this.on.klippy('disconnected'); this.pollKlippy(); break;
    }
  }

  merge(changed) {
    for (const [obj, fields] of Object.entries(changed)) {
      this.status[obj] = Object.assign(this.status[obj] || {}, fields);
    }
    this.on.status(this.status, changed);
  }

  async startKlippy() {
    clearTimeout(this.pollTimer);
    try {
      const info = await this.call('server.info');
      if (info.klippy_state !== 'ready') {
        this.on.klippy(info.klippy_state, info.state_message || '');
        if (info.klippy_state === 'shutdown' || info.klippy_state === 'error') this.queryWebhooks();
        this.pollKlippy();
        return;
      }
      const r = await this.call('printer.objects.subscribe', { objects: this.objects });
      this.status = {};
      this.merge(r.status);
      this.on.klippy('ready', '');
    } catch (e) {
      this.pollKlippy();
    }
  }

  pollKlippy() {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.startKlippy(), 2000);
  }

  async queryWebhooks() {
    try {
      const r = await this.call('printer.objects.query', { objects: { webhooks: null } });
      const w = r.status.webhooks || {};
      this.on.klippy(w.state || 'shutdown', w.state_message || '');
    } catch (e) { /* klippy may be gone; server.info polling covers it */ }
  }
}
