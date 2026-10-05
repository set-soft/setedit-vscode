// Borland Kit 0.2: macros por COMANDOS (no por efectos), bloques persistentes, bloque <-> disco.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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

  const persistentSel = () => vscode.workspace.getConfiguration('borlandKit').get('persistentSelection', true);
  const COLLAPSE_CMDS = new Set(['deleteLeft', 'deleteRight', 'deleteWordLeft', 'deleteWordRight']);

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
      .filter((b) => b.command.startsWith('borlandKit.block') || b.command === 'borlandKit.replaceNext')
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
    blockCopy: async (ed) => {
      const m = needBlock(ed); if (!m) return;
      const doc = ed.document;
      const text = doc.getText(rng(doc, m.b, m.e));
      const p = off(ed);
      await blockOp(ed, (eb) => eb.insert(doc.positionAt(p), text), () => ({ b: p, e: p + text.length }));
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
  context.subscriptions.push(status, deco);
}

function deactivate() {}
module.exports = { activate, deactivate };
