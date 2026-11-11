// Parser for Mainsail's action:prompt_* protocol, fed one gcode response line at a time.
// Returns a change notice: {show: prompt} when a prompt is ready, {end: true} when closed.
export class PromptParser {
  constructor() { this.cur = null; this.group = null; }

  feed(line) {
    const m = /^(?:\/\/ )?action:prompt_(\w+)\s?(.*)$/.exec(line.trim());
    if (!m) return null;
    const [, cmd, arg] = m;
    switch (cmd) {
      case 'begin':
        this.cur = { title: arg, items: [], footer: [] };
        this.group = null;
        return null;
      case 'end':
        this.cur = null; this.group = null;
        return { end: true };
      case 'show':
        if (!this.cur) return null;
        return { show: this.cur };
    }
    if (!this.cur) return null;
    switch (cmd) {
      case 'text': this.cur.items.push({ type: 'text', text: arg }); break;
      case 'button': {
        const b = button(arg);
        if (this.group) this.group.buttons.push(b); else this.cur.items.push({ type: 'button', ...b });
        break;
      }
      case 'button_group_start': this.group = { type: 'group', buttons: [] }; this.cur.items.push(this.group); break;
      case 'button_group_end': this.group = null; break;
      case 'footer_button': this.cur.footer.push(button(arg)); break;
    }
    return null;
  }
}

// "label|gcode|style": gcode defaults to the label, style to secondary (Mainsail's rules)
function button(arg) {
  const [label, gcode, style] = arg.split('|');
  return { label: label.trim(), gcode: (gcode || label).trim(), style: (style || 'secondary').trim() };
}
