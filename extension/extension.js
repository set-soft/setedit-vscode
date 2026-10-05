// Borland Kit 0.2: macros por COMANDOS (no por efectos), bloques persistentes, bloque <-> disco.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ------------------------------------------------------------ utilidades JSONC
// kinds: 0 = código, 1 = string, 2 = comentario
function mask(t) {
  const k = new Uint8Array(t.length);
  const n = t.length;
  let i = 0;
  while (i < n) {
    const c = t[i];
    if (c === '"') {
      k[i] = 1; i++;
      while (i < n) {
        if (t[i] === '\\') { k[i] = 1; if (i + 1 < n) k[i + 1] = 1; i += 2; continue; }
        k[i] = 1;
        if (t[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && t[i + 1] === '/') { while (i < n && t[i] !== '\n') { k[i] = 2; i++; } continue; }
    if (c === '/' && t[i + 1] === '*') {
      k[i] = 2; k[i + 1] = 2; i += 2;
      while (i < n && !(t[i] === '*' && t[i + 1] === '/')) { k[i] = 2; i++; }
      if (i < n) { k[i] = 2; k[i + 1] = 2; i += 2; }
      continue;
    }
    i++;
  }
  return k;
}

function parseJsonc(t, k) {
  const out = t.split('');
  for (let i = 0; i < out.length; i++) if (k[i] === 2 && out[i] !== '\n') out[i] = ' ';
  for (let i = 0; i < out.length; i++) {
    if (k[i] === 0 && out[i] === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === ']' || out[j] === '}') out[i] = ' ';
    }
  }
  return JSON.parse(out.join(''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function activate(context) {
  // ================================================================ MACROS
  // Se graba la lista de comandos ejecutados a través de borlandKit.exec
  // (los atajos "envueltos" que genera borlandKit.installKeybindings) y el
  // texto tipeado (se captura sobreescribiendo el comando 'type' mientras se graba).
  let macro = context.globalState.get('borlandKit.macro2', []);
  const rec = { on: false, steps: [] };
  let replaying = false;
  let typeReg = null;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = '$(record) REC';
  status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');

  function pushType(text) {
    const last = rec.steps[rec.steps.length - 1];
    if (last && last.t === 'type') last.text += text;
    else rec.steps.push({ t: 'type', text });
  }

  function macroStart() {
    if (rec.on) return;
    rec.steps = [];
    rec.on = true;
    status.show();
    try {
      typeReg = vscode.commands.registerCommand('type', (args) => {
        if (rec.on && !replaying && args && typeof args.text === 'string') pushType(args.text);
        return vscode.commands.executeCommand('default:type', args);
      });
    } catch (e) {
      typeReg = null;
      vscode.window.showWarningMessage('No se pudo capturar el tipeo (otra extensión controla "type"). Los comandos sí se graban.');
    }
  }

  function macroStop() {
    if (!rec.on) return;
    rec.on = false;
    status.hide();
    if (typeReg) { typeReg.dispose(); typeReg = null; }
    macro = rec.steps;
    context.globalState.update('borlandKit.macro2', macro);
    vscode.window.setStatusBarMessage(`Macro grabada: ${macro.length} pasos`, 3000);
  }

  const runCommand = (cmd, args) =>
    vscode.commands.executeCommand(cmd, ...(args !== undefined ? [args] : []));

  async function exec(arg) {
    const cmd = typeof arg === 'string' ? arg : arg && arg.command;
    if (!cmd) return;
    const args = typeof arg === 'object' ? arg.args : undefined;
    if (rec.on && !replaying) rec.steps.push({ t: 'cmd', c: cmd, a: args });
    return runCommand(cmd, args);
  }

  async function macroPlay(times = 1) {
    if (rec.on) { vscode.window.showWarningMessage('Detené la grabación antes de reproducir.'); return; }
    if (!macro.length) { vscode.window.showInformationMessage('No hay macro grabada.'); return; }
    replaying = true;
    try {
      for (let n = 0; n < times; n++) {
        for (const st of macro) {
          if (st.t === 'cmd') await runCommand(st.c, st.a);
          else if (st.t === 'type') await vscode.commands.executeCommand('default:type', { text: st.text });
        }
      }
    } finally {
      replaying = false;
    }
  }

  // --------------------------------------- generación de atajos "grabables"
  const S = '// >>> borland-kit (generado, no editar) >>>';
  const E = '// <<< borland-kit <<<';

  function builtinKeys() {
    const vert = 'editorTextFocus && !suggestWidgetVisible && !parameterHintsVisible';
    const any = 'editorTextFocus';
    const ro = 'editorTextFocus && !editorReadonly';
    const t = [
      ['left', 'cursorLeft', any], ['right', 'cursorRight', any],
      ['up', 'cursorUp', vert], ['down', 'cursorDown', vert],
      ['shift+left', 'cursorLeftSelect', any], ['shift+right', 'cursorRightSelect', any],
      ['shift+up', 'cursorUpSelect', vert], ['shift+down', 'cursorDownSelect', vert],
      ['home', 'cursorHome', any], ['end', 'cursorEnd', any],
      ['shift+home', 'cursorHomeSelect', any], ['shift+end', 'cursorEndSelect', any],
      ['ctrl+home', 'cursorTop', any], ['ctrl+end', 'cursorBottom', any],
      ['ctrl+shift+home', 'cursorTopSelect', any], ['ctrl+shift+end', 'cursorBottomSelect', any],
      ['pageup', 'cursorPageUp', vert], ['pagedown', 'cursorPageDown', vert],
      ['shift+pageup', 'cursorPageUpSelect', vert], ['shift+pagedown', 'cursorPageDownSelect', vert],
      ['ctrl+left', 'cursorWordLeft', any], ['ctrl+right', 'cursorWordRight', any],
      ['ctrl+shift+left', 'cursorWordLeftSelect', any], ['ctrl+shift+right', 'cursorWordRightSelect', any],
      ['backspace', 'deleteLeft', ro], ['shift+backspace', 'deleteLeft', ro],
      ['delete', 'deleteRight', ro],
      ['ctrl+backspace', 'deleteWordLeft', ro], ['ctrl+delete', 'deleteWordRight', ro],
    ];
    return t.map(([key, command, when]) => wrap(key, command, undefined, when));
  }

  function wrap(key, command, args, when) {
    const o = { key, command: 'borlandKit.exec', args: { command } };
    if (args !== undefined) o.args.args = args;
    if (when) o.when = when;
    return o;
  }

  async function installKeybindings() {
    const file = path.resolve(context.globalStorageUri.fsPath, '..', '..', 'keybindings.json');
    const ok = await vscode.window.showWarningMessage(
      `Se va a agregar un bloque generado al final de ${file} (con backup .borland-kit.bak). ¿Continuar?`,
      { modal: true }, 'Continuar');
    if (ok !== 'Continuar') return;

    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[\n]\n';
    const i = text.indexOf(S), j = text.indexOf(E);
    if (i >= 0 && j > i) {
      const ls = text.lastIndexOf('\n', i) + 1;
      let le = text.indexOf('\n', j);
      le = le < 0 ? text.length : le + 1;
      text = text.slice(0, ls) + text.slice(le);
    }
    const kinds = mask(text);
    let user;
    try { user = parseJsonc(text, kinds); } catch (e) {
      vscode.window.showErrorMessage(`No pude interpretar keybindings.json: ${e.message}`);
      return;
    }
    let lastClose = -1;
    for (let p = text.length - 1; p >= 0; p--) if (kinds[p] === 0 && text[p] === ']') { lastClose = p; break; }
    if (lastClose < 0) { vscode.window.showErrorMessage('keybindings.json no tiene un arreglo válido.'); return; }

    const exclude = vscode.workspace.getConfiguration('borlandKit').get('excludeFromWrapping', []);
    const blockKeys = (context.extension.packageJSON.contributes.keybindings || [])
      .filter((b) => b.command.startsWith('borlandKit.block'))
      .map((b) => wrap(b.key, b.command, undefined, b.when));
    const userWrapped = (Array.isArray(user) ? user : [])
      .filter((e) => e && typeof e.key === 'string' && typeof e.command === 'string'
        && !e.command.startsWith('-') && !e.command.startsWith('borlandKit.')
        && !exclude.some((x) => e.command.startsWith(x)))
      .map((e) => wrap(e.key, e.command, e.args, e.when));

    // Orden: built-in, bloques, y por último los del usuario (el último gana).
    const all = [...builtinKeys(), ...blockKeys, ...userWrapped];
    const body = all.map((o) => '    ' + JSON.stringify(o)).join(',\n');
    const region = `\n    ${S}\n${body}\n    ${E}\n`;

    let lastBrace = -1;
    for (let p = lastClose - 1; p >= 0; p--) if (kinds[p] === 0 && text[p] === '}') { lastBrace = p; break; }
    let needComma = false;
    if (lastBrace >= 0) {
      needComma = true;
      for (let p = lastBrace + 1; p < lastClose; p++) if (kinds[p] === 0 && text[p] === ',') { needComma = false; break; }
    }
    let out = text.slice(0, lastClose) + region + text.slice(lastClose);
    if (needComma) out = out.slice(0, lastBrace + 1) + ',' + out.slice(lastBrace + 1);

    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.borland-kit.bak');
    fs.writeFileSync(file, out);
    vscode.window.showInformationMessage(`Atajos grabables instalados (${all.length}). Volvé a ejecutar este comando si cambiás keybindings.json.`);
  }

  // ================================================================ BLOQUES
  const blocks = new Map(); // uri -> { b, e }
  const deco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
    overviewRulerColor: new vscode.ThemeColor('editor.selectionBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  let lastPath = '';

  const key = (doc) => doc.uri.toString();
  const getMarks = (doc) => {
    const k = key(doc);
    if (!blocks.has(k)) blocks.set(k, { b: null, e: null });
    return blocks.get(k);
  };
  const validBlock = (doc) => {
    const m = blocks.get(key(doc));
    return m && m.b != null && m.e != null && m.b < m.e ? m : null;
  };
  const off = (ed) => ed.document.offsetAt(ed.selection.active);
  const rng = (doc, b, e) => new vscode.Range(doc.positionAt(b), doc.positionAt(e));
  const lenInDoc = (doc, text) =>
    doc.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n').length : text.replace(/\r\n/g, '\n').length;

  function refresh(ed) {
    const m = validBlock(ed.document);
    ed.setDecorations(deco, m ? [rng(ed.document, m.b, m.e)] : []);
  }
  function refreshAll() { vscode.window.visibleTextEditors.forEach(refresh); }

  function adjustMark(m, changes, isEnd) {
    let shift = 0;
    for (const c of changes) {
      const s = c.rangeOffset;
      const e = s + c.rangeLength;
      const d = c.text.length - c.rangeLength;
      if (e < m || (e === m && !(isEnd && c.rangeLength === 0))) shift += d;
      else if (s < m) return s + shift + (isEnd ? c.text.length : 0);
    }
    return m + shift;
  }

  function adjustBlocks(e) {
    const m = blocks.get(key(e.document));
    if (!m || !e.contentChanges.length) return;
    const ch = [...e.contentChanges].sort((x, y) => x.rangeOffset - y.rangeOffset);
    if (m.b != null) m.b = adjustMark(m.b, ch, false);
    if (m.e != null) m.e = adjustMark(m.e, ch, true);
    if (m.b != null && m.e != null && m.b >= m.e) { m.b = null; m.e = null; }
    refreshAll();
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(adjustBlocks),
    vscode.window.onDidChangeActiveTextEditor(refreshAll),
    vscode.workspace.onDidCloseTextDocument((d) => blocks.delete(key(d)))
  );

  function needBlock(ed) {
    const m = validBlock(ed.document);
    if (!m) vscode.window.showWarningMessage('No hay bloque marcado (Ctrl+K B / Ctrl+K K).');
    return m;
  }
  function setBlock(ed, b, e) {
    const m = getMarks(ed.document);
    m.b = b; m.e = e;
    refreshAll();
  }
  function resolvePath(input, doc) {
    let p = input.trim();
    if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
    if (!path.isAbsolute(p)) {
      const base = !doc.isUntitled
        ? path.dirname(doc.fileName)
        : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath) || os.homedir();
      p = path.join(base, p);
    }
    return p;
  }

  const edCmds = {
    blockBegin: (ed) => {
      const m = getMarks(ed.document);
      m.b = off(ed);
      if (m.e != null && m.e <= m.b) m.e = null;
      refreshAll();
    },
    blockEnd: (ed) => {
      const m = getMarks(ed.document);
      m.e = off(ed);
      if (m.b != null && m.b >= m.e) m.b = null;
      refreshAll();
    },
    blockHide: (ed) => setBlock(ed, null, null),
    blockSelect: (ed) => {
      const m = needBlock(ed); if (!m) return;
      ed.selection = new vscode.Selection(ed.document.positionAt(m.b), ed.document.positionAt(m.e));
    },
    blockCopy: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const text = doc.getText(rng(doc, m.b, m.e));
      const p = off(ed);
      await ed.edit((eb) => eb.insert(doc.positionAt(p), text));
      setBlock(ed, p, p + text.length);
    },
    blockMove: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const p = off(ed);
      if (p > m.b && p < m.e) { vscode.window.showWarningMessage('El cursor está dentro del bloque.'); return; }
      const text = doc.getText(rng(doc, m.b, m.e));
      const len = m.e - m.b;
      const b = m.b, e = m.e;
      await ed.edit((eb) => {
        eb.delete(rng(doc, b, e));
        eb.insert(doc.positionAt(p), text);
      });
      const ns = p >= e ? p - len : p;
      setBlock(ed, ns, ns + len);
    },
    blockDelete: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const r = rng(ed.document, m.b, m.e);
      await ed.edit((eb) => eb.delete(r));
      setBlock(ed, null, null);
    },
    blockWrite: async (ed) => {
      const doc = ed.document;
      const m = validBlock(doc);
      let text;
      if (m) text = doc.getText(rng(doc, m.b, m.e));
      else if (!ed.selection.isEmpty) text = ed.selections.map((s) => doc.getText(s)).join(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
      else { vscode.window.showWarningMessage('No hay bloque ni selección para escribir.'); return; }
      const input = await vscode.window.showInputBox({ prompt: 'Escribir bloque en archivo', value: lastPath });
      if (!input) return;
      const target = resolvePath(input, doc);
      if (fs.existsSync(target)) {
        const ans = await vscode.window.showWarningMessage(`${target} ya existe. ¿Sobrescribir?`, { modal: true }, 'Sobrescribir');
        if (ans !== 'Sobrescribir') return;
      }
      try {
        fs.writeFileSync(target, text);
        lastPath = input;
        vscode.window.setStatusBarMessage(`Bloque escrito en ${target}`, 3000);
      } catch (err) {
        vscode.window.showErrorMessage(`No se pudo escribir: ${err.message}`);
      }
    },
    blockRead: async (ed) => {
      const doc = ed.document;
      const input = await vscode.window.showInputBox({ prompt: 'Leer archivo en la posición del cursor', value: lastPath });
      if (!input) return;
      let text;
      try {
        text = fs.readFileSync(resolvePath(input, doc), 'utf8');
      } catch (err) {
        vscode.window.showErrorMessage(`No se pudo leer: ${err.message}`);
        return;
      }
      lastPath = input;
      const p = off(ed);
      await ed.edit((eb) => eb.insert(doc.positionAt(p), text));
      setBlock(ed, p, p + lenInDoc(doc, text));
    },
  };

  const plain = {
    macroStart, macroStop, exec, installKeybindings,
    macroPlay: () => macroPlay(1),
    macroPlayN: async () => {
      const v = await vscode.window.showInputBox({ prompt: 'Repeticiones', value: '2' });
      const n = parseInt(v, 10);
      if (n > 0) await macroPlay(n);
    },
  };

  for (const [name, fn] of Object.entries(plain)) {
    context.subscriptions.push(vscode.commands.registerCommand(`borlandKit.${name}`, (...a) => fn(...a)));
  }
  for (const [name, fn] of Object.entries(edCmds)) {
    context.subscriptions.push(vscode.commands.registerCommand(`borlandKit.${name}`, () => {
      const ed = vscode.window.activeTextEditor;
      if (ed) return fn(ed);
    }));
  }
  context.subscriptions.push(status, deco, { dispose: () => typeReg && typeReg.dispose() });
}

function deactivate() {}
module.exports = { activate, deactivate };
