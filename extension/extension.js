// Borland Kit 0.2: macros por COMANDOS (no por efectos), bloques persistentes, bloque <-> disco.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

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
  let execActive = 0;          // >0 mientras se ejecuta un comando vía exec/reproducción
  let blockSelSuppressed = false;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = '$(record) REC';
  status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');

  const blockStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  blockStatus.tooltip = 'Información del bloque persistente: clic para llevarlo a la vista';
  blockStatus.command = 'borlandKit.blockView';

  const persistentSel = () => vscode.workspace.getConfiguration('borlandKit').get('persistentSelection', true);
  // Comandos que, si la selección es el bloque, la colapsan primero:
  // - borrado: no deben borrar el bloque;
  // - movimiento sin Shift: deben partir de la posición del cursor y no del
  //   borde de la selección (comportamiento nativo de VSCodium).
  const COLLAPSE_CMDS = new Set([
    'deleteLeft', 'deleteRight', 'deleteWordLeft', 'deleteWordRight',
    'cursorLeft', 'cursorRight', 'cursorUp', 'cursorDown',
    'cursorHome', 'cursorEnd', 'cursorPageUp', 'cursorPageDown',
    'cursorWordLeft', 'cursorWordRight',
    'cursorWordStartLeft', 'cursorWordStartRight', 'cursorWordEndLeft', 'cursorWordEndRight',
  ]);

  // Si la selección actual ES el bloque, se colapsa antes de escribir/borrar:
  // así el bloque no se reemplaza ni se borra por tipear.
  function collapseIfBlock() {
    if (!persistentSel()) return;
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selections.length !== 1 || ed.selection.isEmpty) return;
    const m = validBlock(ed.document);
    if (!m) return;
    const doc = ed.document;
    if (doc.offsetAt(ed.selection.start) === m.b && doc.offsetAt(ed.selection.end) === m.e) {
      const a = ed.selection.active;
      ed.selection = new vscode.Selection(a, a);
    }
  }

  function pushType(text) {
    const last = rec.steps[rec.steps.length - 1];
    if (last && last.t === 'type') last.text += text;
    else rec.steps.push({ t: 'type', text });
  }

  // 'type' se sobreescribe siempre: graba el tipeo y evita reemplazar el bloque.
  try {
    context.subscriptions.push(vscode.commands.registerCommand('type', (args) => {
      if (rec.on && !replaying && args && typeof args.text === 'string') pushType(args.text);
      collapseIfBlock();
      return vscode.commands.executeCommand('default:type', args);
    }));
  } catch (e) {
    vscode.window.showWarningMessage('Borland Kit: otra extensión controla "type"; el tipeo no se grabará en macros.');
  }

  function macroStart() {
    if (rec.on) return;
    rec.steps = [];
    rec.on = true;
    status.show();
  }

  function macroStop() {
    if (!rec.on) return;
    rec.on = false;
    status.hide();
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
    if (COLLAPSE_CMDS.has(cmd)) collapseIfBlock();
    execActive++;
    try { return await runCommand(cmd, args); } finally { execActive--; }
  }

  async function macroPlay(times = 1) {
    if (rec.on) { vscode.window.showWarningMessage('Detené la grabación antes de reproducir.'); return; }
    if (!macro.length) { vscode.window.showInformationMessage('No hay macro grabada.'); return; }
    replaying = true;
    execActive++;
    try {
      for (let n = 0; n < times; n++) {
        for (const st of macro) {
          if (st.t === 'cmd') {
            if (COLLAPSE_CMDS.has(st.c)) collapseIfBlock();
            await runCommand(st.c, st.a);
          } else if (st.t === 'type') {
            collapseIfBlock();
            await vscode.commands.executeCommand('default:type', { text: st.text });
          }
        }
      }
    } finally {
      execActive--;
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
      .filter((b) => b.command.startsWith('borlandKit.block') || b.command.startsWith('borlandKit.cursorView') || b.command === 'borlandKit.replaceNext' || b.command === 'borlandKit.deleteWhitespaceAhead')
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
  const opsMap = new Map(); // uri -> { undo: [], redo: [] }
  const deco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
    overviewRulerColor: new vscode.ThemeColor('editor.selectionBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  let lastDir = context.globalState.get('borlandKit.lastDir2', '');

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
  function refreshBlockStatus(ed) {
    if (!ed) {
      blockStatus.hide();
      return;
    }

    const doc = ed.document;
    const m = validBlock(doc);

    if (!m) {
      blockStatus.hide();
      return;
    }

    const start = doc.positionAt(m.b);
    const end = doc.positionAt(m.e);
    const text = doc.getText(rng(doc, m.b, m.e));

    // Si termina exactamente al comienzo de una línea,
    // esa línea no forma parte del bloque.
    const lines = end.character === 0
      ? end.line - start.line
      : end.line - start.line + 1;

    const chars = text.length;

    blockStatus.text = `$(selection) ${lines} líneas · ${chars} caracteres`;
    blockStatus.show();
  }
  function blockView(ed) {
    const m = needBlock(ed);
    if (!m) return;

    const doc = ed.document;
    const start = doc.positionAt(m.b);

    // m.e puede estar exactamente al comienzo de la línea siguiente.
    // Para determinar la visibilidad del final usamos el último carácter
    // que realmente pertenece al bloque.
    // const end = doc.positionAt(Math.max(m.b, m.e - 1));
    const endOffset = Math.max(m.b, m.e - 1);
    const end = doc.positionAt(endOffset);

    const isVisible = (line) =>
      ed.visibleRanges.some(
        (r) => line >= r.start.line && line <= r.end.line
      );

    const startVisible = isVisible(start.line);
    const endVisible = isVisible(end.line);

    if (!startVisible && !endVisible) {
      // No se ve ninguna parte del bloque:
      // llevar el principio a la parte superior.
      ed.revealRange(
        new vscode.Range(start, start),
        vscode.TextEditorRevealType.AtTop
      );
      return;
    }

    if (startVisible && !endVisible) {
      // Se ve el principio pero no el final:
      // llevar el final a la parte inferior.
      ed.revealRange(
        new vscode.Range(end, end),
        vscode.TextEditorRevealType.AtBottom
      );
      return;
    }

    if (!startVisible && endVisible) {
      // Se ve el final pero no el principio:
      // llevar el principio a la parte superior.
      ed.revealRange(
        new vscode.Range(start, start),
        vscode.TextEditorRevealType.AtTop
      );
      return;
    }

    // Se ven principio y final:
    // centrar el bloque completo.
    ed.revealRange(
      new vscode.Range(start, doc.positionAt(m.e)),
      vscode.TextEditorRevealType.InCenter
    );
  }
  const opsOf = (doc) => {
    const k = key(doc);
    if (!opsMap.has(k)) opsMap.set(k, { undo: [], redo: [] });
    return opsMap.get(k);
  };
  const snapMarks = (doc) => { const m = getMarks(doc); return { b: m.b, e: m.e }; };
  const hashDoc = (doc) => crypto.createHash('md5').update(doc.getText()).digest('hex');
  const off = (ed) => ed.document.offsetAt(ed.selection.active);
  const rng = (doc, b, e) => new vscode.Range(doc.positionAt(b), doc.positionAt(e));
  const lenInDoc = (doc, text) =>
    doc.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n').length : text.replace(/\r\n/g, '\n').length;

  function refresh(ed) {
    const m = validBlock(ed.document);
    ed.setDecorations(deco, m ? [rng(ed.document, m.b, m.e)] : []);
  }

  function refreshAll() {
    vscode.window.visibleTextEditors.forEach(refresh);
    const ed = vscode.window.activeTextEditor;
    vscode.commands.executeCommand('setContext', 'borlandKit.hasBlock', !!(ed && validBlock(ed.document)));
    refreshBlockStatus(ed);
  }

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

  // Undo/Redo de operaciones de bloque: se compara el texto resultante con el
  // que tenía el documento antes/después de la operación y se restauran las marcas.
  function onUndoRedo(e) {
    const R = vscode.TextDocumentChangeReason;
    if (!e.contentChanges.length) return;
    const doc = e.document;
    const o = opsOf(doc);
    if (R && e.reason === R.Undo) {
      const top = o.undo[o.undo.length - 1];
      if (top && hashDoc(doc) === top.hBefore) {
        o.undo.pop(); o.redo.push(top);
        const m = getMarks(doc); m.b = top.before.b; m.e = top.before.e; refreshAll();
      }
    } else if (R && e.reason === R.Redo) {
      const top = o.redo[o.redo.length - 1];
      if (top && hashDoc(doc) === top.hAfter) {
        o.redo.pop(); o.undo.push(top);
        const m = getMarks(doc); m.b = top.after.b; m.e = top.after.e; refreshAll();
      }
    } else {
      o.redo.length = 0;
    }
  }

  async function blockOp(ed, editFn, afterFn) {
    const doc = ed.document;
    const o = opsOf(doc);
    const before = snapMarks(doc);
    const hBefore = hashDoc(doc);
    const ok = await ed.edit(editFn);
    if (!ok) return;
    const after = afterFn();
    setBlock(ed, after.b, after.e);
    o.undo.push({ before, after, hBefore, hAfter: hashDoc(doc) });
    if (o.undo.length > 100) o.undo.shift();
    o.redo.length = 0;
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => { adjustBlocks(e); onUndoRedo(e); }),
    vscode.window.onDidChangeActiveTextEditor(refreshAll),
    vscode.workspace.onDidCloseTextDocument((d) => { blocks.delete(key(d)); opsMap.delete(key(d)); }),
    // Selecciones hechas con mouse o teclado pasan a ser el bloque persistente.
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!persistentSel() || blockSelSuppressed) return;
      const ed = e.textEditor;
      if (ed !== vscode.window.activeTextEditor) return;
      if (e.selections.length !== 1 || e.selections[0].isEmpty) return;
      const K = vscode.TextEditorSelectionChangeKind;
      const ok = e.kind === K.Mouse || e.kind === K.Keyboard || execActive > 0;
      if (!ok) return;
      const doc = ed.document;
      const s = e.selections[0];
      const m = getMarks(doc);
      m.b = doc.offsetAt(s.start);
      m.e = doc.offsetAt(s.end);
      refreshAll();
    })
  );

  function needBlock(ed) {
    const m = validBlock(ed.document);
    if (!m) vscode.window.showWarningMessage('No hay bloque marcado (Ctrl+K B / Ctrl+K K, o seleccioná texto).');
    return m;
  }
  function setBlock(ed, b, e) {
    const m = getMarks(ed.document);
    m.b = b; m.e = e;
    refreshAll();
  }
  // Carpeta inicial de los diálogos de leer/escribir bloque.
  // Nunca se usa la carpeta de configuración del propio editor (ahí vive
  // keybindings.json) ni una carpeta que ya no existe.
  function dialogDir(doc) {
    const mode = vscode.workspace.getConfiguration('borlandKit').get('dialogDirectory', 'document');
    const userDir = path.resolve(context.globalStorageUri.fsPath, '..', '..');
    const inside = (d, root) => {
      const r = path.relative(root, d);
      return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
    };
    const docDir = doc.uri.scheme === 'file' && !doc.isUntitled ? path.dirname(doc.fileName) : null;
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri) || (vscode.workspace.workspaceFolders || [])[0];
    const wsDir = folder ? folder.uri.fsPath : null;
    const usable = (d) => d && fs.existsSync(d) && !inside(d, userDir);
    const order = mode === 'last' ? [lastDir, docDir, wsDir]
      : mode === 'workspace' ? [wsDir, docDir, lastDir]
      : [docDir, wsDir, lastDir];
    for (const d of order) if (usable(d)) return d;
    return os.homedir();
  }
  const rememberDir = (fsPath) => {
    lastDir = path.dirname(fsPath);
    context.globalState.update('borlandKit.lastDir2', lastDir);
  };

  // ========================================= ABRIR ARCHIVO BAJO EL CURSOR
  const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
  const EXCLUDE_GLOB = '**/{node_modules,.git,.hg,.svn,__pycache__,.venv,venv,.mypy_cache,.pytest_cache}/**';
  const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache']);

  // Aísla el nombre: si el cursor está entre comillas (' " `) el contenido es
  // el nombre; si no, es la palabra delimitada por espacios/paréntesis/etc.
  function extractTarget(ed) {
    const doc = ed.document;
    const line = doc.lineAt(ed.selection.active.line).text;
    if (!ed.selection.isEmpty && ed.selection.isSingleLine) {
      const raw = doc.getText(ed.selection).trim().replace(/^['"`]+|['"`]+$/g, '');
      return { name: raw, rest: line.slice(ed.selection.end.character), quoted: true };
    }
    let col = ed.selection.active.character;
    for (let i = 0; i < line.length; i++) {
      const q = line[i];
      if (q !== '"' && q !== "'" && q !== '`') continue;
      const j = line.indexOf(q, i + 1);
      if (j < 0) continue;
      if (col > i && col <= j) return { name: line.slice(i + 1, j).trim(), rest: line.slice(j + 1), quoted: true };
      i = j;
    }
    const DELIM = /[\s'"`()\[\]{}<>|]/;
    const isD = (c) => c === undefined || DELIM.test(c);
    if (isD(line[col]) && col > 0 && !isD(line[col - 1])) col--;
    if (isD(line[col])) return null;
    let s0 = col, e0 = col;
    while (s0 > 0 && !isD(line[s0 - 1])) s0--;
    while (e0 < line.length && !isD(line[e0])) e0++;
    return { name: line.slice(s0, e0), rest: line.slice(e0), quoted: false };
  }

  function parseTarget(raw) {
    let name = raw.name;
    let mode = 'editor';
    let line = null, col = null;
    const pm = /^(img|pdf):\s*/i.exec(name);
    if (pm) { mode = 'browser'; name = name.slice(pm[0].length); }
    if (!raw.quoted) name = name.replace(/[.,;!?:]+$/, '');
    let url = null;
    if (URL_RE.test(name)) url = name;
    else if (/^www\./i.test(name)) url = 'https://' + name;
    if (url) {
      if (/^file:\/\//i.test(url)) { name = vscode.Uri.parse(url).fsPath; url = null; }
      else return { url, mode: 'browser' };
    }
    if (!raw.quoted && name.includes('=')) name = name.slice(name.indexOf('=') + 1);
    const m = /:(\d+)(?::(\d+))?$/.exec(name);
    if (m) { line = parseInt(m[1], 10); col = m[2] ? parseInt(m[2], 10) : null; name = name.slice(0, m.index); }
    else {
      const lm = /^\s*,\s*line\s+(\d+)/i.exec(raw.rest || '');
      if (lm) line = parseInt(lm[1], 10);   // File "x.py", line 12
    }
    if (name.startsWith('~')) name = path.join(os.homedir(), name.slice(1));
    return { name, line, col, mode };
  }

  const escapeGlob = (t) => t.replace(/[*?\[\]{}]/g, (c) => `[${c}]`);
  const statOf = (p) => { try { const st = fs.statSync(p); return { p, dir: st.isDirectory() }; } catch (e) { return null; } };

  function walkFind(root, clean) {
    const out = [];
    let count = 0;
    const rec = (dir, depth) => {
      if (depth > 8 || count > 20000 || out.length >= 50) return;
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const en of ents) {
        count++;
        const full = path.join(dir, en.name);
        if (en.isDirectory()) { if (!SKIP_DIRS.has(en.name)) rec(full, depth + 1); }
        else if (full.split(path.sep).join('/').endsWith('/' + clean)) out.push(full);
      }
    };
    rec(root, 0);
    return out;
  }

  async function resolveFile(name, doc) {
    if (path.isAbsolute(name)) { const r = statOf(name); return r ? [r] : []; }
    const docDir = doc.uri.scheme === 'file' && !doc.isUntitled ? path.dirname(doc.fileName) : null;
    if (docDir) { const r = statOf(path.resolve(docDir, name)); if (r) return [r]; }
    const clean = name.replace(/\\/g, '/').replace(/^(\.\.?\/)+/, '').replace(/^\/+/, '');
    if (!clean) return [];
    let found = [];
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) {
      const uris = await vscode.workspace.findFiles('**/' + escapeGlob(clean), EXCLUDE_GLOB, 50);
      found = uris.map((u) => u.fsPath);
    } else if (docDir) {
      found = walkFind(docDir, clean);
    }
    if (docDir) {
      const common = (p) => { let n = 0; while (n < p.length && n < docDir.length && p[n] === docDir[n]) n++; return n; };
      found.sort((a, b) => common(b) - common(a) || a.length - b.length);
    }
    return found.map((p) => ({ p, dir: false }));
  }

  function openInBrowser(target) {
    const isUrl = URL_RE.test(target);
    const cmd = vscode.workspace.getConfiguration('borlandKit').get('browserCommand', '').trim();
    const arg = isUrl ? target : vscode.Uri.file(target).toString();
    if (cmd) {
      const [bin, ...pre] = cmd.split(/\s+/);
      try {
        const child = cp.spawn(bin, [...pre, arg], { detached: true, stdio: 'ignore' });
        child.on('error', (e) => vscode.window.showErrorMessage(`No se pudo ejecutar "${bin}": ${e.message}`));
        child.unref();
      } catch (e) {
        vscode.window.showErrorMessage(`No se pudo ejecutar "${bin}": ${e.message}`);
      }
    } else {
      vscode.env.openExternal(isUrl ? vscode.Uri.parse(target) : vscode.Uri.file(target));
    }
  }

  async function openFileUnderCursor(ed) {
    const raw = extractTarget(ed);
    if (!raw || !raw.name) { vscode.window.showInformationMessage('No hay nombre de archivo bajo el cursor.'); return; }
    const t = parseTarget(raw);
    if (t.url) { openInBrowser(t.url); return; }
    if (!t.name) { vscode.window.showInformationMessage('No hay nombre de archivo bajo el cursor.'); return; }
    const found = await resolveFile(t.name, ed.document);
    if (!found.length) { vscode.window.showWarningMessage(`No se encontró "${t.name}".`); return; }
    let pick = found[0];
    if (found.length > 1) {
      const chosen = await vscode.window.showQuickPick(
        found.map((f) => ({ label: vscode.workspace.asRelativePath(f.p), f })),
        { placeHolder: `Hay ${found.length} coincidencias para "${t.name}"` });
      if (!chosen) return;
      pick = chosen.f;
    }
    if (t.mode === 'browser') { openInBrowser(pick.p); return; }
    const uri = vscode.Uri.file(pick.p);
    if (pick.dir) { await vscode.commands.executeCommand('revealInExplorer', uri); return; }
    if (t.line != null) {
      const pos = new vscode.Position(Math.max(0, t.line - 1), Math.max(0, (t.col || 1) - 1));
      await vscode.commands.executeCommand('vscode.open', uri, { selection: new vscode.Range(pos, pos) });
    } else {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  function indentUnit(ed) {
    const tabSize = Number(ed.options.tabSize) || 4;
    return ed.options.insertSpaces === false ? '\t' : ' '.repeat(tabSize);
  }

  function outdentText(line, unit) {
    const leading = /^[ \t]*/.exec(line.text)[0];
    if (!leading.length) return '';
    if (unit === '\t') {
      return leading[0] === '\t' ? '\t' : leading.slice(0, 1);
    }
    if (leading[0] === '\t') return '\t';
    return leading.slice(0, Math.min(unit.length, leading.length));
  }

  async function shiftLines(ed, dir, byLevel = false) {
    const doc = ed.document;
    const m = validBlock(doc);
    let b, e;
    if (m) { b = m.b; e = m.e; }
    else if (!ed.selection.isEmpty) { b = doc.offsetAt(ed.selection.start); e = doc.offsetAt(ed.selection.end); }
    else { b = e = off(ed); }
    const sp = doc.positionAt(b), ep = doc.positionAt(e);
    const first = sp.line;
    let last = ep.line;
    if (e > b && ep.character === 0 && last > first) last--; // un bloque que termina en columna 0 no incluye esa línea
    const unit = byLevel ? indentUnit(ed) : ' ';
    const starts = [];
    for (let l = first; l <= last; l++) {
      const line = doc.lineAt(l);
      if (dir > 0) {
        if (line.text.length > 0) starts.push({ line, text: unit });
      } else {
        const text = byLevel ? outdentText(line, unit)
          : (line.text.startsWith(' ') ? ' ' : '');
        if (text.length > 0) starts.push({ line, text });
      }
    }
    if (!starts.length) return;
    const selEqual = !ed.selection.isEmpty
      && doc.offsetAt(ed.selection.start) === b && doc.offsetAt(ed.selection.end) === e;
    const fsOff = doc.offsetAt(doc.lineAt(first).range.start);
    const firstChanged = starts.some((x) => x.line.lineNumber === first);

    const totalDelta = starts.reduce(
      (n, x) => n + (dir > 0 ? x.text.length : -x.text.length), 0
    );

    let b2 = b;
    if (firstChanged && b > fsOff) {
      const firstItem = starts.find((x) => x.line.lineNumber === first);
      const delta = dir > 0 ? firstItem.text.length : -firstItem.text.length;
      b2 = Math.max(fsOff, b + delta);
    }

    const e2 = Math.max(b2, e + totalDelta);

    const editFn = (eb) => {
       for (const item of starts) {
        const pos = item.line.range.start;
        if (dir > 0) {
          eb.insert(pos, item.text);
        } else {
          eb.delete(new vscode.Range(pos, pos.translate(0, item.text.length)));
        }
       }
    };
    if (m) await blockOp(ed, editFn, () => ({ b: b2, e: e2 }));
    else await ed.edit(editFn);
    if (selEqual) ed.selection = new vscode.Selection(doc.positionAt(b2), doc.positionAt(e2));
  }

  // Anteponer un texto arbitrario al comienzo de cada línea del bloque
  // persistente. A diferencia de shiftLines(), este comando requiere
  // explícitamente un bloque persistente y no usa la selección actual
  // como fallback.
  async function prefixBlockLines(ed) {
    const doc = ed.document;
    const m = validBlock(doc);
    let b, e;
    if (m) { b = m.b; e = m.e; }
    else if (!ed.selection.isEmpty) { b = doc.offsetAt(ed.selection.start); e = doc.offsetAt(ed.selection.end); }
    else { b = e = off(ed); }

    const prefix = await vscode.window.showInputBox({
      prompt: 'Texto a anteponer al comienzo de cada línea del bloque',
      placeHolder: 'Por ejemplo: "    ", "> ", "// "'
    });

    // Escape cancela la operación.
    if (prefix === undefined) return;

    // No tiene sentido modificar el bloque si no se agregó nada.
    if (prefix.length === 0) return;

    const sp = doc.positionAt(b);
    const ep = doc.positionAt(e);
    const first = sp.line;
    let last = ep.line;

    // Un bloque que termina exactamente en columna 0 no incluye esa línea.
    if (e > b && ep.character === 0 && last > first) last--;

    const starts = [];
    for (let line = first; line <= last; line++) {
      starts.push(doc.lineAt(line));
    }
    if (!starts.length) return;

    const firstLineStart = doc.offsetAt(starts[0].range.start);

    // Si el comienzo del bloque está dentro de la primera línea,
    // el prefijo insertado delante de la línea también queda dentro
    // del bloque y por lo tanto desplaza m.b.
    const b2 = b + (b > firstLineStart ? prefix.length : 0);

    // Cada inserción está antes de m.e en el documento original.
    const e2 = e + prefix.length * starts.length;

    await blockOp(
      ed,
      (eb) => {
        for (const line of starts) {
          eb.insert(line.range.start, prefix);
        }
      },
      () => ({ b: b2, e: e2 })
    );
  }

  // Como blockOp, pero para operaciones que se ejecutan con un comando
  // (no con ed.edit): conserva deshacer/rehacer de las marcas del bloque.
  async function blockOpRun(ed, run, afterFn) {
    const doc = ed.document;
    const o = opsOf(doc);
    const before = snapMarks(doc);
    const hBefore = hashDoc(doc);
    await run();
    const hAfter = hashDoc(doc);
    if (hAfter === hBefore) return;
    const after = afterFn();
    setBlock(ed, after.b, after.e);
    o.undo.push({ before, after, hBefore, hAfter });
    if (o.undo.length > 100) o.undo.shift();
    o.redo.length = 0;
  }

  async function commentLines(ed, add) {
    const doc = ed.document;
    const m = validBlock(doc);
    let b, e;
    if (m) { b = m.b; e = m.e; }
    else if (!ed.selection.isEmpty) { b = doc.offsetAt(ed.selection.start); e = doc.offsetAt(ed.selection.end); }
    else { b = e = off(ed); }
    const sp = doc.positionAt(b), ep = doc.positionAt(e);
    const first = sp.line;
    let last = ep.line;
    if (e > b && ep.character === 0 && last > first) last--;
    const origSel = ed.selection;
    const selEqual = !origSel.isEmpty
      && doc.offsetAt(origSel.start) === b && doc.offsetAt(origSel.end) === e;
    const cur = origSel.active;
    const curInside = cur.line >= first && cur.line <= last;
    const oldLen = doc.lineAt(cur.line).text.length;
    const cmd = add ? 'editor.action.addCommentLine' : 'editor.action.removeCommentLine';
    const run = async () => {
      ed.selection = new vscode.Selection(new vscode.Position(first, 0), doc.lineAt(last).range.end);
      await vscode.commands.executeCommand(cmd);
    };
    // Tras la operación el bloque abarca las líneas completas afectadas.
    const finish = () => ({
      b: doc.offsetAt(new vscode.Position(first, 0)),
      e: doc.offsetAt(doc.lineAt(last).range.end),
    });
    if (m) await blockOpRun(ed, run, finish);
    else await run();
    if (selEqual || (!m && !origSel.isEmpty)) {
      const r = finish();
      ed.selection = new vscode.Selection(doc.positionAt(r.b), doc.positionAt(r.e));
    } else {
      const newLen = doc.lineAt(cur.line).text.length;
      const col = curInside ? Math.max(0, Math.min(cur.character + (newLen - oldLen), newLen)) : cur.character;
      const pos = new vscode.Position(cur.line, col);
      ed.selection = new vscode.Selection(pos, pos);
    }
  }

  // Ctrl+Home / Ctrl+End: primera  / última línea visible en pantalla
  // (se conserva la columna, ajustada al largo de la línea destino).
  // Con select=true (Ctrl+Shift+...) se extiende la selección desde el ancla.
  function moveToViewLine(ed, top, select = false) {
    const vr = ed.visibleRanges;
    if (!vr.length) return;
    const doc = ed.document;
    let line = top ? vr[0].start.line : vr[vr.length - 1].end.line;
    line = Math.max(0, Math.min(line, doc.lineCount - 1));
    const col = Math.min(ed.selection.active.character, doc.lineAt(line).text.length);
    const pos = new vscode.Position(line, col);
    const sel = new vscode.Selection(select ? ed.selection.anchor : pos, pos);
    ed.selection = sel;
    // El aviso de cambio de selección llega cuando ya terminó el comando, así
    // que el bloque persistente se actualiza directamente acá.
    if (select && !sel.isEmpty && persistentSel()) {
      const m = getMarks(doc);
      m.b = doc.offsetAt(sel.start);
      m.e = doc.offsetAt(sel.end);
      refreshAll();
    }
  }

  function wordAtCursor(ed) {
    const doc = ed.document;
    if (!ed.selection.isEmpty && ed.selection.isSingleLine) return doc.getText(ed.selection);
    const r = doc.getWordRangeAtPosition(ed.selection.active);
    return r ? doc.getText(r) : '';
  }
  const quickOpenWithWord = (ed, prefix) =>
    vscode.commands.executeCommand('workbench.action.quickOpen', prefix + wordAtCursor(ed));

  const edCmds = {
    // Ctrl+L: "reemplazar siguiente" usando el buscar/reemplazar nativo.
    // Solo reemplaza: el cursor queda justo después del texto reemplazado,
    // sin seleccionar ni mostrar la siguiente coincidencia. Si no hay nada
    // para reemplazar, la selección original se restaura.
    // (replaceOne nativo primero selecciona la coincidencia y recién en la
    // siguiente llamada reemplaza; por eso se repite si el texto no cambió.)
    replaceNext: async (ed) => {
      const doc = ed.document;
      const origSel = ed.selection;
      let endOff = null;
      blockSelSuppressed = true;
      const sub = vscode.workspace.onDidChangeTextDocument((ev) => {
        if (ev.document === doc && ev.contentChanges.length && endOff === null) {
          const c = ev.contentChanges[0];
          endOff = c.rangeOffset + c.text.length; // fin del reemplazo, ya en el documento modificado
        }
      });
      try {
        await vscode.commands.executeCommand('editor.action.startFindReplaceAction');
        await sleep(40);
        for (let i = 0; i < 2 && endOff === null; i++) {
          await vscode.commands.executeCommand('editor.action.replaceOne');
          await sleep(40);
        }
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        await sleep(40);
        if (endOff !== null) {
          const pos = doc.positionAt(endOff);
          ed.selection = new vscode.Selection(pos, pos);
          ed.revealRange(new vscode.Range(pos, pos));
        } else {
          ed.selection = origSel;
        }
      } finally {
        sub.dispose();
        blockSelSuppressed = false;
      }
    },
    // Alt+F2 / Alt+Shift+F2: lista de símbolos del archivo / del proyecto,
    // filtrada con la palabra bajo el cursor (o la selección).
    symbolsInFile: (ed) => quickOpenWithWord(ed, '@'),
    symbolsInWorkspace: (ed) => quickOpenWithWord(ed, '#'),
    openFileUnderCursor: (ed) => openFileUnderCursor(ed),
    cursorViewTop: (ed) => moveToViewLine(ed, true),
    cursorViewBottom: (ed) => moveToViewLine(ed, false),
    cursorViewTopSelect: (ed) => moveToViewLine(ed, true, true),
    cursorViewBottomSelect: (ed) => moveToViewLine(ed, false, true),
    // Ctrl+T:
    // - Si a continuación del cursor hay espacios/tabs (o fin de línea): los
    //   borra y, si llega al fin de línea, ese salto más la indentación de la
    //   línea siguiente, trayendo la próxima palabra al cursor. Cruza como
    //   máximo UN salto de línea; si la siguiente está vacía hay que repetir.
    // - Si no hay espacios (el cursor está ante una palabra o signos): borra
    //   la palabra a la derecha (o el grupo de signos) y los espacios que le
    //   siguen, sin cruzar de línea.
    deleteWhitespaceAhead: async (ed) => {
      collapseIfBlock();
      const doc = ed.document;
      const pos = ed.selection.active;
      const isWs = (c) => c === ' ' || c === '\t';
      const isWord = (c) => /[\p{L}\p{N}_]/u.test(c);
      const skipWs = (t, c) => { while (c < t.length && isWs(t[c])) c++; return c; };
      let ln = pos.line;
      let text = doc.lineAt(ln).text;
      let col;
      const ch = text[pos.character];
      if (ch !== undefined && !isWs(ch)) {
        const w = isWord(ch);
        col = pos.character;
        while (col < text.length && !isWs(text[col]) && isWord(text[col]) === w) col++;
        col = skipWs(text, col);
      } else {
        col = skipWs(text, pos.character);
        if (col >= text.length && ln < doc.lineCount - 1) {
          ln++;
          text = doc.lineAt(ln).text;
          col = skipWs(text, 0);
        }
      }
      const end = new vscode.Position(ln, col);
      if (end.isEqual(pos)) return;
      await ed.edit((eb) => eb.delete(new vscode.Range(pos, end)));
    },
    // Ctrl+K I / Ctrl+K U: indentar / desindentar un espacio las líneas del
    // bloque (o de la selección, o la línea actual si no hay ninguno).
    blockIndent: (ed) => shiftLines(ed, +1),
    blockOutdent: (ed) => shiftLines(ed, -1),
    // Indentar / desindentar un nivel según la configuración del editor.
    blockIndentLevel: (ed) => shiftLines(ed, +1, true),
    blockOutdentLevel: (ed) => shiftLines(ed, -1, true),
    // Anteponer texto arbitrario al comienzo de cada línea del bloque.
    blockPrefix: (ed) => prefixBlockLines(ed),
    // Comentar / descomentar las líneas del bloque (usa los comandos nativos
    // para respetar el estilo de comentario de cada lenguaje).
    blockComment: (ed) => commentLines(ed, true),
    blockUncomment: (ed) => commentLines(ed, false),
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
    blockView: (ed) => blockView(ed),
    // Ctrl+Q B / Ctrl+Q K: saltar al principio / al final del bloque.
    // El bloque sigue marcado; solo se mueve el cursor.
    blockGotoBegin: (ed) => {
      const m = needBlock(ed); if (!m) return;
      const pos = ed.document.positionAt(m.b);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    },
    blockGotoEnd: (ed) => {
      const m = needBlock(ed); if (!m) return;
      const pos = ed.document.positionAt(m.e);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    },
    // Ctrl+K L / Ctrl+K T: marcar la línea / la palabra del cursor como bloque.
    // Se marca el bloque persistente (como Ctrl+K B / K K) y el cursor no se
    // mueve. La línea incluye su salto de línea, como la selección de línea nativa.
    blockMarkLine: (ed) => {
      const doc = ed.document;
      const ln = ed.selection.active.line;
      const b = doc.offsetAt(new vscode.Position(ln, 0));
      const e = ln < doc.lineCount - 1
        ? doc.offsetAt(new vscode.Position(ln + 1, 0))
        : doc.offsetAt(doc.lineAt(ln).range.end);
      if (e <= b) { vscode.window.showInformationMessage('La línea está vacía.'); return; }
      const a = ed.selection.active;
      ed.selection = new vscode.Selection(a, a);
      setBlock(ed, b, e);
    },
    blockMarkWord: (ed) => {
      const doc = ed.document;
      const r = doc.getWordRangeAtPosition(ed.selection.active);
      if (!r) { vscode.window.showInformationMessage('No hay palabra bajo el cursor.'); return; }
      const a = ed.selection.active;
      ed.selection = new vscode.Selection(a, a);
      setBlock(ed, doc.offsetAt(r.start), doc.offsetAt(r.end));
    },
    blockClipCopy: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      await vscode.env.clipboard.writeText(ed.document.getText(rng(ed.document, m.b, m.e)));
    },
    blockClipCut: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const r = rng(doc, m.b, m.e);
      await vscode.env.clipboard.writeText(doc.getText(r));
      await blockOp(ed, (eb) => eb.delete(r), () => ({ b: null, e: null }));
    },
    // Shift+Insert: pega el portapapeles en el cursor y deja lo pegado marcado
    // como bloque. Si hay un bloque seleccionado NO lo reemplaza (para eso está
    // Ctrl+Shift+Insert); una selección que no es el bloque sí se reemplaza,
    // como en el pegado nativo.
    blockPaste: async (ed) => {
      if (ed.selections.length > 1) {
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        return;
      }
      const doc = ed.document;
      const text = await vscode.env.clipboard.readText();
      if (!text) return;
      const sel = ed.selection;
      const m = validBlock(doc);
      const selIsBlock = !!m && !sel.isEmpty
        && doc.offsetAt(sel.start) === m.b && doc.offsetAt(sel.end) === m.e;
      const replaceSel = !sel.isEmpty && !(persistentSel() && selIsBlock);
      const start = replaceSel ? doc.offsetAt(sel.start) : off(ed);
      const end = replaceSel ? doc.offsetAt(sel.end) : start;
      const len = lenInDoc(doc, text);
      await blockOp(ed,
        (eb) => (replaceSel
          ? eb.replace(rng(doc, start, end), text)
          : eb.insert(doc.positionAt(start), text)),
        () => ({ b: start, e: start + len }));
      const pos = doc.positionAt(start + len);
      ed.selection = new vscode.Selection(pos, pos);
    },
    // Ctrl+Shift+Insert: reemplaza el bloque por el contenido del portapapeles
    // (borrar bloque + pegar, en una sola operación deshacible).
    blockReplacePaste: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const text = await vscode.env.clipboard.readText();
      if (!text) { vscode.window.showWarningMessage('El portapapeles está vacío.'); return; }
      const b = m.b, e = m.e;
      const len = lenInDoc(doc, text);
      await blockOp(ed, (eb) => eb.replace(rng(doc, b, e), text), () => ({ b, e: b + len }));
      const pos = doc.positionAt(b + len);
      ed.selection = new vscode.Selection(pos, pos);
    },
    blockCopy: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const text = doc.getText(rng(doc, m.b, m.e));
      const p = off(ed);
      await blockOp(ed, (eb) => eb.insert(doc.positionAt(p), text), () => ({ b: p, e: p + text.length }));
    },
    // Convertir el contenido del bloque persistente a mayúsculas/minúsculas.
    blockUppercase: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const r = rng(doc, m.b, m.e);
      const text = doc.getText(r);
      const converted = text.toUpperCase();

      // Evitar generar una operación de undo si no cambia nada.
      if (converted === text) return;

      const len = converted.length;

      await blockOp(
        ed,
        (eb) => eb.replace(r, converted),
        () => ({ b: m.b, e: m.b + len })
      );
    },
    blockLowercase: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const r = rng(doc, m.b, m.e);
      const text = doc.getText(r);
      const converted = text.toLowerCase();

      // Evitar generar una operación de undo si no cambia nada.
      if (converted === text) return;

      const len = converted.length;

      await blockOp(
        ed,
        (eb) => eb.replace(r, converted),
        () => ({ b: m.b, e: m.b + len })
      );
    },
    blockMove: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const p = off(ed);
      if (p > m.b && p < m.e) { vscode.window.showWarningMessage('El cursor está dentro del bloque.'); return; }
      const b = m.b, e = m.e, len = e - b;
      const text = doc.getText(rng(doc, b, e));
      const ns = p >= e ? p - len : p;
      await blockOp(ed, (eb) => {
        eb.delete(rng(doc, b, e));
        eb.insert(doc.positionAt(p), text);
      }, () => ({ b: ns, e: ns + len }));
    },
    blockDelete: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const r = rng(ed.document, m.b, m.e);
      await blockOp(ed, (eb) => eb.delete(r), () => ({ b: null, e: null }));
    },
    blockWrite: async (ed) => {
      const doc = ed.document;
      const m = validBlock(doc);
      let text;
      if (m) text = doc.getText(rng(doc, m.b, m.e));
      else if (!ed.selection.isEmpty) text = ed.selections.map((s) => doc.getText(s)).join(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
      else { vscode.window.showWarningMessage('No hay bloque ni selección para escribir.'); return; }
      const uri = await vscode.window.showSaveDialog({
        title: 'Escribir bloque a archivo',
        saveLabel: 'Escribir bloque',
        defaultUri: vscode.Uri.file(path.join(dialogDir(doc), 'bloque.txt')),
      });
      if (!uri) return;
      try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
        rememberDir(uri.fsPath);
        vscode.window.setStatusBarMessage(`Bloque escrito en ${uri.fsPath}`, 3000);
      } catch (err) {
        vscode.window.showErrorMessage(`No se pudo escribir: ${err.message}`);
      }
    },
    blockRead: async (ed) => {
      const doc = ed.document;
      const uris = await vscode.window.showOpenDialog({
        title: 'Leer archivo en la posición del cursor',
        openLabel: 'Leer',
        canSelectMany: false,
        canSelectFolders: false,
        defaultUri: vscode.Uri.file(dialogDir(doc)),
      });
      if (!uris || !uris.length) return;
      let text;
      try {
        text = Buffer.from(await vscode.workspace.fs.readFile(uris[0])).toString('utf8');
      } catch (err) {
        vscode.window.showErrorMessage(`No se pudo leer: ${err.message}`);
        return;
      }
      rememberDir(uris[0].fsPath);
      const p = off(ed);
      const len = lenInDoc(doc, text);
      await blockOp(ed, (eb) => eb.insert(doc.positionAt(p), text), () => ({ b: p, e: p + len }));
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
  context.subscriptions.push(status, blockStatus, deco);
}

function deactivate() {}
module.exports = { activate, deactivate };
