# setedit-vscode

Extension and configuration for VSCode/VSCodium that makes the editor behave
similarly to [SETEdit](https://setedit.sourceforge.net/) / RHIDE
(Borland C / Turbo C style editing: WordStar-like `Ctrl+K` / `Ctrl+Q` chords,
persistent blocks, command-based macros).

The repository has two parts:

| Part                    | What it is |
|-------------------------|------------|
| `extension/`            | The **SETEdit extension**: commands, settings, colors, keybindings and menus described in this document. |
| `keys/keybindings.json` | A **sample user keybindings file**. It is **not part of the extension**: you must merge it manually into your own `keybindings.json`. See [Additional keybindings](#additional-keybindings-keyskeybindingsjson-not-part-of-the-extension). |

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Persistent blocks](#persistent-blocks)
- [Macros and recordable keys (wrapping)](#macros-and-recordable-keys-wrapping)
- [Commands](#commands)
- [Keybindings defined by the extension](#keybindings-defined-by-the-extension)
- [Settings](#settings)
- [Settings overridden by default](#settings-overridden-by-default)
- [Colors](#colors)
- [Menus and UI](#menus-and-ui)
- [Open file / URL under cursor](#open-file--url-under-cursor)
- [Additional keybindings (keys/keybindings.json, NOT part of the extension)](#additional-keybindings-keyskeybindingsjson-not-part-of-the-extension)
- [Tips](#tips)
- [License](#license)
- [Authors](#authors)

## Features

**Blocks**
- Persistent blocks using `Ctrl+K B/K/H/C/V/Y`
- Block read/write from/to disk using `Ctrl+K R/W`
- Replace block from the clipboard, paste and mark as block
- Select word/line as block
- Jump to block start/end
- Block un/indent by a space and by a level
- Block un/comment
- Arbitrary indent (prefix each line with any text)
- Block to upper/lowercase
- Selection status in the status bar (lines and characters, click to show the block)

**Macros**
- Commands to record, stop and replay macros (also N times)
- Mechanism to simply wrap defined keys so they can be recorded

**Search and navigation**
- Repeatable search and replace (`Ctrl+L`)
- Look for symbol in file and workspace (using the word under the cursor)
- Jump to line
- Open file/URL under cursor
- Move to window top/bottom

**Editing and display**
- Delete right spaces/word
- Show tabs (`SETEdit.showTabs` option, `SETEdit.tabOutline1/2` colors) and
  trailing spaces
- Exit session with save confirmation (`Alt+X`; if you use the menu or the
  close button you get the native behavior)
- Fold buttons in the editor title bar

## Requirements

- VSCode / VSCodium `^1.80.0`
- [Numbered Bookmarks](https://marketplace.visualstudio.com/items?itemName=alefragnani.numbered-bookmarks)
  by Alessandro Fragnani. Only needed for the bookmark keys of the
  [additional keybindings file](#additional-keybindings-keyskeybindingsjson-not-part-of-the-extension);
  the extension itself doesn't use it.

## Installation

1. Install the extension from the `.vsix` package
   (*Extensions: Install from VSIX...* in the Command Palette).
2. Run `Ctrl+Shift+P` → **SETEdit: Install recordable keybindings**
   (see [Macros and recordable keys](#macros-and-recordable-keys-wrapping)).
   Repeat it every time you change your `keybindings.json`.
3. Optional: merge the contents of `keys/keybindings.json` into your own
   keybindings file (`Ctrl+Shift+P` → *Preferences: Open Keyboard Shortcuts (JSON)*).

The extension activates on startup (`onStartupFinished`).

## Persistent blocks

A *block* is a range of text that stays marked while you move around and type,
like in SETEdit. Only one block per document is kept.

- Mark it with `Ctrl+K B` (start) and `Ctrl+K K` (end), or just select text
  with the mouse or keyboard: with `SETEdit.persistentSelection` enabled
  (default) any single non-empty selection becomes the block.
- The block is highlighted with the editor selection color and shown in the
  status bar (`N lines · M chars`). Click it to scroll the block into view.
- Typing, deleting and moving the cursor **don't replace or delete the block**:
  if the current selection is the block it is collapsed first.
- `Ctrl+C`/`Ctrl+X` copy/cut the block when there is a block but no editor
  selection.
- Block operations (copy, move, delete, paste, case change, indent...) are
  undoable and redoable; the block marks are restored together with the text.
- The context key `SETEdit.hasBlock` is set while the active document has a
  block. It's used in the `when` clauses of some keybindings, and you can use
  it in yours.

## Macros and recordable keys (wrapping)

Macros record **commands**, not effects: the list of commands executed through
`SETEdit.exec` plus the typed text. The typed text is captured by overriding
the internal `type` command while recording (if another extension already
controls `type`, a warning is shown and typed text won't be recorded).

Native keys like the arrows or `Backspace` don't go through `SETEdit.exec`, so
they can't be recorded. To solve this, **SETEdit: Install recordable
keybindings** writes a generated block at the end of your user
`keybindings.json`:

```jsonc
// >>> SETEdit (generated, do not edit) >>>
{"key":"left","command":"SETEdit.exec","args":{"command":"cursorLeft"},"when":"editorTextFocus"},
...
// <<< SETEdit <<<
```

The block contains, in this order (the last one wins):

1. Wrapped versions of the basic cursor movement/selection/deletion keys.
2. Wrapped versions of the extension's block, view-line, replace and
   delete-whitespace keys.
3. Wrapped versions of **all your own keybindings** (except removals starting
   with `-`, other `SETEdit.*` commands, and anything in
   `SETEdit.excludeFromWrapping`).

Details:
- A confirmation dialog is shown first. A backup is saved as
  `keybindings.json.setedit.bak`.
- A previous generated block is replaced, so the command is safe to repeat.
- The file is read as JSONC (comments and trailing commas are accepted).
- Run it again after any change to your `keybindings.json`.
- Don't edit the generated region by hand.

Recorded macros are stored in the editor's global state, so they survive
restarts. Only one macro is kept.

## Commands

All commands are available from the Command Palette under the **SETEdit**.

### Macros and setup

| Command ID | Title | Description |
|------------|-------|-------------|
| `SETEdit.installKeybindings` | Install recordable keybindings | Adds/updates the generated block of wrapped keys in your `keybindings.json`. |
| `SETEdit.macroStart` | Record macro | Starts recording (a `REC` item appears in the status bar). |
| `SETEdit.macroStop` | Stop macro recording | Stops recording and saves the macro. |
| `SETEdit.macroPlay` | Replay recorded macro | Replays the last recorded macro. |
| `SETEdit.macroPlayN` | Replay recorded macro N times | Asks for a number of repetitions (default 2) and replays the macro. |
| `SETEdit.exec` | Execute a recordable command (wrapper) | Runs another command and records it if a macro is being recorded. Argument: a command id string, or `{ "command": "<id>", "args": <args> }`. Used by the generated keybindings; you normally won't call it directly. |

### Blocks

| Command ID | Title | Description |
|------------|-------|-------------|
| `SETEdit.blockBegin` | Block start (selection) | Marks the block start at the cursor. |
| `SETEdit.blockEnd` | Block end (selection) | Marks the block end at the cursor. |
| `SETEdit.blockHide` | Hide block (selection) | Unmarks the block (the text isn't touched). |
| `SETEdit.blockSelect` | Convert block into selection | Turns the block into the editor selection. |
| `SETEdit.blockView` | Show block | Scrolls to make the block visible (start, end or centered, depending on what is already visible). Also bound to a click on the status bar item. |
| `SETEdit.blockGotoBegin` | Jump to block start | Moves the cursor to the block start (the block stays marked). |
| `SETEdit.blockGotoEnd` | Jump to block end | Moves the cursor to the block end. |
| `SETEdit.blockMarkLine` | Select line as block | Marks the current line (with its line break) as block, without moving the cursor. |
| `SETEdit.blockMarkWord` | Select word as block | Marks the word under the cursor as block, without moving the cursor. |
| `SETEdit.blockCopy` | Copy block and paste it | Inserts a copy of the block at the cursor; the copy becomes the block. |
| `SETEdit.blockMove` | Move block | Moves the block to the cursor (refuses if the cursor is inside the block). |
| `SETEdit.blockDelete` | Hide block | Deletes the block text. |
| `SETEdit.blockClipCopy` | Copy block to clipboard | Copies the block text to the clipboard. |
| `SETEdit.blockClipCut` | Cut block to clipboard | Cuts the block text to the clipboard. |
| `SETEdit.blockPaste` | Paste and mark as block | Pastes the clipboard at the cursor and marks the pasted text as block. It doesn't replace the current block (a selection that isn't the block is replaced, as in a native paste). |
| `SETEdit.blockReplacePaste` | Replace from clipboard | Replaces the block with the clipboard contents, in one undoable step. |
| `SETEdit.blockWrite` | Write block to disk | Saves the block (or the current selection if there is no block) to a file, using a save dialog. |
| `SETEdit.blockRead` | Read block from disk | Inserts the contents of a file at the cursor and marks it as block. |
| `SETEdit.blockIndent` | Indent block one space | Adds one space at the start of each non-empty line of the block (or selection, or current line). |
| `SETEdit.blockOutdent` | Outdent block one space | Removes one leading space from each line. |
| `SETEdit.blockIndentLevel` | Indent block one level | Indents using the native `editor.action.indentLines`, respecting tab size and language rules. |
| `SETEdit.blockOutdentLevel` | Outdent block one space | Outdents one level using the native `editor.action.outdentLines`. |
| `SETEdit.blockPrefix` | Arbitrary indent | Asks for a text and inserts it at the start of every line of the block. Needs a block. |
| `SETEdit.blockComment` | Comment block | Comments the lines of the block using the language's line comment. |
| `SETEdit.blockUncomment` | Uncomment block | Removes the line comments. |
| `SETEdit.blockUppercase` | UPPERCASE block | Converts the block to upper case. |
| `SETEdit.blockLowercase` | lowercase block | Converts the block to lower case. |

When there is no block, the indent/outdent/comment commands work on the current
selection, or on the current line if nothing is selected. A block that ends at
column 0 doesn't include that last line.

### Search, navigation and editing

| Command ID | Title | Description |
|------------|-------|-------------|
| `SETEdit.replaceNext` | Replace next | Replaces the next match using the native find/replace widget. The cursor is left right after the replaced text, without selecting the next match. |
| `SETEdit.symbolsInFile` | Look for symbol in file (word under cursor) | Opens the symbol quick pick (`@`) filtered with the word under the cursor or selection. |
| `SETEdit.symbolsInWorkspace` | Look for symbol in project (word under cursor) | Same, for the whole workspace (`#`). |
| `SETEdit.cursorViewTop` | Jump to first visible line | Moves the cursor to the first line shown in the window, keeping the column. |
| `SETEdit.cursorViewBottom` | Jump to last visible line | Moves the cursor to the last line shown in the window. |
| `SETEdit.cursorViewTopSelect` | Select to first visible line | Same as above, extending the selection. |
| `SETEdit.cursorViewBottomSelect` | Select to last visible line | Same as above, extending the selection. |
| `SETEdit.deleteWhitespaceAhead` | Erase spaces and/or words at the right | If the cursor is before spaces/tabs (or at end of line) it deletes them, and at the end of a line it joins the next line, removing its indentation (crossing at most one line break). If the cursor is on a word (or a group of symbols) it deletes it plus the spaces that follow. |
| `SETEdit.openFileUnderCursor` | Open URL or file under cursor | See [Open file / URL under cursor](#open-file--url-under-cursor). |
| `SETEdit.quitWithConfirmation` | Exit with save and confirmation | Asks *Save* / *Discard* for every modified document and then quits. Cancelling any dialog aborts the exit. |

### Fold buttons

| Command ID | Title | Description |
|------------|-------|-------------|
| `SETEdit.foldAll` | Fold all | Runs `editor.foldAll`. Button in the editor title bar. |
| `SETEdit.unfoldAll` | Unfold all | Runs `editor.unfoldAll`. Button in the editor title bar. |
| `SETEdit.foldLevel` | Fold N levels... | Asks for a level (1 to 7), unfolds everything and folds that level. Button in the editor title bar. |

## Keybindings defined by the extension

These are contributed by the extension itself (`contributes.keybindings`).
After running [*Install recordable keybindings*](#macros-and-recordable-keys-wrapping)
the block, view-line and replace ones are also duplicated as wrapped (recordable)
versions in your `keybindings.json`.

| Key | Command | When |
|-----|---------|------|
| `Shift+F10` | `SETEdit.macroStart` | |
| `Alt+F10` | `SETEdit.macroStop` | |
| `Ctrl+F10` | `SETEdit.macroPlay` | |
| `Ctrl+L` | `SETEdit.replaceNext` | `editorTextFocus` |
| `Ctrl+K B` | `SETEdit.blockBegin` | `editorTextFocus` |
| `Ctrl+K K` | `SETEdit.blockEnd` | `editorTextFocus` |
| `Ctrl+K H` | `SETEdit.blockHide` | `editorTextFocus` |
| `Ctrl+K C` | `SETEdit.blockCopy` | `editorTextFocus` |
| `Ctrl+K V` | `SETEdit.blockMove` | `editorTextFocus && SETEdit.hasBlock` |
| `Ctrl+K Y` | `SETEdit.blockDelete` | `editorTextFocus` |
| `Ctrl+K W` | `SETEdit.blockWrite` | `editorTextFocus` |
| `Ctrl+K R` | `SETEdit.blockRead` | `editorTextFocus` |
| `Ctrl+W` | `SETEdit.blockWrite` | `editorTextFocus` |
| `Ctrl+R` | `SETEdit.blockRead` | `editorTextFocus` |
| `Ctrl+Delete` | `SETEdit.blockDelete` | `editorTextFocus && SETEdit.hasBlock` |
| `Ctrl+Insert` | `SETEdit.blockClipCopy` | `editorTextFocus && SETEdit.hasBlock` |
| `Shift+Delete` | `SETEdit.blockClipCut` | `editorTextFocus && SETEdit.hasBlock` |
| `Ctrl+C` | `SETEdit.blockClipCopy` | `editorTextFocus && !editorHasSelection && SETEdit.hasBlock` |
| `Ctrl+X` | `SETEdit.blockClipCut` | `editorTextFocus && !editorHasSelection && SETEdit.hasBlock` |
| `Ctrl+Shift+Insert` | `SETEdit.blockReplacePaste` | `editorTextFocus && SETEdit.hasBlock` |
| `Shift+Insert` | `SETEdit.blockPaste` | `editorTextFocus && !editorReadonly` |
| `Ctrl+Q B` | `SETEdit.blockGotoBegin` | `editorTextFocus` |
| `Ctrl+Q K` | `SETEdit.blockGotoEnd` | `editorTextFocus` |
| `Ctrl+K L` | `SETEdit.blockMarkLine` | `editorTextFocus` |
| `Ctrl+K T` | `SETEdit.blockMarkWord` | `editorTextFocus` |
| `Ctrl+K I` | `SETEdit.blockIndent` | `editorTextFocus` |
| `Ctrl+K U` | `SETEdit.blockOutdent` | `editorTextFocus` |
| `Ctrl+K Tab` | `SETEdit.blockIndentLevel` | `editorTextFocus` |
| `Ctrl+K Shift+Tab` | `SETEdit.blockOutdentLevel` | `editorTextFocus` |
| `Ctrl+K P` | `SETEdit.blockPrefix` | `editorTextFocus && SETEdit.hasBlock` |
| `Ctrl+K M` | `SETEdit.blockUppercase` | `editorTextFocus && SETEdit.hasBlock` |
| `Ctrl+K O` | `SETEdit.blockLowercase` | `editorTextFocus && SETEdit.hasBlock` |
| `Alt+F2` | `SETEdit.symbolsInFile` | `editorTextFocus` |
| `Ctrl+F2` | `SETEdit.symbolsInWorkspace` | `editorTextFocus` |
| `Ctrl+J` | `workbench.action.gotoLine` | |
| `Ctrl+Enter` | `SETEdit.openFileUnderCursor` | `editorTextFocus && !suggestWidgetVisible` |
| `Ctrl+Home` / `Ctrl+Q E` | `SETEdit.cursorViewTop` | `editorTextFocus` |
| `Ctrl+End` / `Ctrl+Q X` | `SETEdit.cursorViewBottom` | `editorTextFocus` |
| `Ctrl+Shift+Home` | `SETEdit.cursorViewTopSelect` | `editorTextFocus` |
| `Ctrl+Shift+End` | `SETEdit.cursorViewBottomSelect` | `editorTextFocus` |
| `Ctrl+T` | `SETEdit.deleteWhitespaceAhead` | `editorTextFocus && !editorReadonly` |
| `Alt+X` | `SETEdit.quitWithConfirmation` | |

Not bound by default: `SETEdit.macroPlayN`, `SETEdit.blockSelect`,
`SETEdit.blockView` (status bar click), `SETEdit.blockComment`,
`SETEdit.blockUncomment` (context menu), the fold commands (editor title
buttons) and `SETEdit.installKeybindings`.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `SETEdit.persistentSelection` | boolean | `true` | Mouse and keyboard selections remain as the block while typing. See [Persistent blocks](#persistent-blocks). |
| `SETEdit.dialogDirectory` | `document` \| `workspace` \| `last` | `document` | Starting directory of the block read/write dialogs (`Ctrl+K R` / `Ctrl+K W`, `Ctrl+R` / `Ctrl+W`). `document`: directory of the file being edited; `workspace`: project root; `last`: last directory used in the dialog. If the chosen directory doesn't exist, the other two are tried, then the home directory. The editor's own user settings directory (where `keybindings.json` lives) is never used. |
| `SETEdit.excludeFromWrapping` | string[] | `["workbench.action.debug.", "editor.debug.action."]` | Command **prefixes** that [*Install recordable keybindings*](#macros-and-recordable-keys-wrapping) won't wrap, so they are excluded from macro recording. |
| `SETEdit.browserCommand` | string | `""` | Command used to open URLs and `img:`/`pdf:` targets, e.g. `firefox` or `firefox --new-tab`. The system default is used when empty. |
| `SETEdit.showTabs` | boolean | `true` | Makes tab characters visible by drawing a border around each one (alternating between two colors). |
| `SETEdit.foldButtons` | boolean | `true` | Shows the un/fold buttons in the editor title section (along with the editor tabs). |

## Settings overridden by default

The extension changes these defaults through `configurationDefaults`. You can
still override them in your own `settings.json`.

| Setting | Value | Why |
|---------|-------|-----|
| `editor.find.seedSearchStringFromSelection` | `"never"` | The search doesn't take its text from the selection/word under the cursor. |
| `editor.renderWhitespace` | `"trailing"` | Shows trailing spaces. |
| `files.trimTrailingWhitespace` | `true` | Removes trailing spaces on save. |
| `files.insertFinalNewline` | `true` | Ensures a final newline on save. |
| `files.trimFinalNewlines` | `true` | Removes extra newlines at the end of the file on save. |

## Colors

Can be customized in `workbench.colorCustomizations`.

| Color id | Description | Dark | Light | High contrast | High contrast light |
|----------|-------------|------|-------|---------------|---------------------|
| `SETEdit.tabOutline1` | First color for the tabs border | `#34b934aa` | `#2aa72aaa` | `#00ff00` | `#000000` |
| `SETEdit.tabOutline2` | Second color for the tabs border | `#b93434aa` | `#a72a2aaa` | `#ff0000` | `#000000` |

Tabs alternate between both colors, so consecutive tabs can be told apart.

## Menus and UI

- **Editor title bar**: *Fold all*, *Unfold all* and *Fold N levels...* buttons.
- **Editor context menu**: *SETEdit tools* submenu, containing:
  - *Indent block*: indent/outdent one space, indent/outdent one level, arbitrary indent.
  - *Un/comment block*: comment block, uncomment block.
- **Status bar**:
  - `REC` while a macro is being recorded.
  - `N lines · M chars` for the current block; click to show the block.

## Open file / URL under cursor

`Ctrl+Enter` (`SETEdit.openFileUnderCursor`) opens the name found under the
cursor, or the current single-line selection.

- If the cursor is inside quotes (`'`, `"` or `` ` ``) the quoted text is the
  name; otherwise it's the word delimited by spaces, parentheses, brackets,
  braces, `<`, `>`, `|` and quotes.
- URLs (`http://...`, any `scheme://`, or `www....`) are opened in the browser
  (see `SETEdit.browserCommand`). `file://` URLs are opened as files.
- A prefix `img:` or `pdf:` opens the file in the browser instead of the editor.
- Supported suffixes: `name:LINE`, `name:LINE:COLUMN`, and the Python traceback
  style `File "name", line N`.
- `~` is expanded to the home directory. For `key=value` words only the value is used.
- Relative names are searched first relative to the current file, then in the
  workspace (excluding `node_modules`, `.git`, `.hg`, `.svn`, `__pycache__`,
  `.venv`, `venv`, `.mypy_cache`, `.pytest_cache`). If several files match, a
  quick pick is shown. Without a workspace, the search is done below the
  file's directory (limited depth).
- Directories are revealed in the Explorer.

## Additional keybindings (keys/keybindings.json, NOT part of the extension)

> **These keys are not defined by the extension.** The file `keys/keybindings.json`
> is a *user keybindings* sample that complements it with more Borland/WordStar-like
> keys that only use native VSCode/VSCodium commands (plus a few references to
> the extension). Nothing is installed automatically: copy the entries you want
> to your own `keybindings.json`
> (`Ctrl+Shift+P` → *Preferences: Open Keyboard Shortcuts (JSON)*).
>
> - The bookmark keys need the
>   [Numbered Bookmarks](https://marketplace.visualstudio.com/items?itemName=alefragnani.numbered-bookmarks) extension.
> - The `Escape` entry that hides the block needs this extension (it calls `SETEdit.blockHide`).
> - The end of the file contains a region marked
>   `>>> SETEdit (generated, do not edit) >>>` ... `<<< SETEdit <<<`. It is
>   produced by *SETEdit: Install recordable keybindings* (wrapped copies of the
>   keys of this file and of the extension) and is **not** meant to be copied
>   by hand. It isn't described here.

### Files and windows

| Key | Command | Description |
|-----|---------|-------------|
| `F2` | `workbench.action.files.save` | Save |
| `F3` | `workbench.action.files.openFile` | Open file |
| `Alt+0` | `workbench.action.quickOpen` | Quick open (file list) |
| `Alt+F3` | `workbench.action.closeActiveEditor` | Close the active editor |
| `F6` | `workbench.action.nextEditor` | Next open file |
| `Shift+F6` | `workbench.action.previousEditor` | Previous open file |
| `Ctrl+F12` | `workbench.action.reloadWindow` | Reload the window (reloads extensions) |

### Editing

| Key | Command | When | Description |
|-----|---------|------|-------------|
| `Ctrl+Y` | `editor.action.deleteLines` | `textInputFocus && !editorReadonly` | Delete line |
| `Alt+Backspace` | `undo` | `textInputFocus && !editorReadonly` | Undo |
| `Shift+Alt+Backspace` | `redo` | `textInputFocus && !editorReadonly` | Redo |
| `Ctrl+Q Y` | `deleteAllRight` | `textInputFocus && !editorReadonly` | Delete to end of line |
| `Ctrl+Q H` | `deleteAllLeft` | `textInputFocus && !editorReadonly` | Delete to start of line |
| `Ctrl+Tab` | `editor.action.triggerSuggest` | `editorHasCompletionItemProvider && textInputFocus && !editorReadonly` | Force autocompletion |
| `Escape` | `SETEdit.blockHide` | `editorTextFocus && !suggestWidgetVisible` | Hide the persistent block (**uses this extension**) |
| `Escape` | `hideSuggestWidget` | `suggestWidgetVisible && textInputFocus` | Close the autocompletion list |

### Cursor movement

| Key | Command | When | Description |
|-----|---------|------|-------------|
| `Ctrl+PageUp` | `cursorTop` | `textInputFocus` | Start of document |
| `Ctrl+PageDown` | `cursorBottom` | `textInputFocus` | End of document |
| `Ctrl+Shift+PageUp` | `cursorTopSelect` | `textInputFocus` | Select to start of document |
| `Ctrl+Shift+PageDown` | `cursorBottomSelect` | `textInputFocus` | Select to end of document |
| `Ctrl+Q R` | `cursorTop` | `textInputFocus` | Start of document (WordStar) |
| `Ctrl+Q C` | `cursorBottom` | `textInputFocus` | End of document (WordStar) |
| `Ctrl+Q S` | `cursorHome` | `textInputFocus` | Start of line (WordStar) |
| `Ctrl+Q D` | `cursorEnd` | `textInputFocus` | End of line (WordStar) |
| `Ctrl+Q Escape` | `editor.action.jumpToBracket` | `editorTextFocus` | Jump to the matching `()` `{}` `[]` |

### Search

| Key | Command | Description |
|-----|---------|-------------|
| `Ctrl+Q F` | `actions.find` | Find |
| `Ctrl+Q A` | `editor.action.startFindReplaceAction` | Find and replace |

### Numbered bookmarks (needs *Numbered Bookmarks*)

| Key | Command | Description |
|-----|---------|-------------|
| `Ctrl+K 1` … `Ctrl+K 9` | `numberedBookmarks.toggleBookmark1` … `9` | Set/clear bookmark N |
| `Ctrl+Q 1` … `Ctrl+Q 9` | `numberedBookmarks.jumpToBookmark1` … `9` | Jump to bookmark N |

All with `when: editorTextFocus`.

### Rectangular (column) blocks

| Key | Command | When | Description |
|-----|---------|------|-------------|
| `Ctrl+K Shift+B` | `editor.action.toggleColumnSelection` | `editorTextFocus` | Toggle rectangular selection mode |
| `Shift+Alt+Up` | `cursorColumnSelectUp` | `textInputFocus` | Extend the rectangle up |
| `Shift+Alt+Down` | `cursorColumnSelectDown` | `textInputFocus` | Extend the rectangle down |
| `Shift+Alt+Left` | `cursorColumnSelectLeft` | `textInputFocus` | Extend the rectangle left |
| `Shift+Alt+Right` | `cursorColumnSelectRight` | `textInputFocus` | Extend the rectangle right |

### Debugging (Turbo Pascal / Borland style)

| Key | Command | When | Description |
|-----|---------|------|-------------|
| `F9` | `editor.debug.action.toggleBreakpoint` | `editorTextFocus` | Toggle breakpoint |
| `Ctrl+F9` | `workbench.action.debug.start` | | Start debugging |
| `F7` | `workbench.action.debug.stepInto` | `inDebugMode` | Trace into |
| `F8` | `workbench.action.debug.stepOver` | `inDebugMode` | Step over |

A binding of `Ctrl+F2` to `workbench.action.debug.stop` is included but
commented out, because `Ctrl+F2` is used by the extension for
`SETEdit.symbolsInWorkspace`.

### Others

| Key | Command | When | Description |
|-----|---------|------|-------------|
| `Ctrl+K Shif+V` | `markdown.showPreviewToSide` | `editorFocus && !notebookEditorFocused && editorLangId =~ /^(markdown\|prompt\| instructions\|chatagent\| skill)$/` | Redirects the markdown preview, note that `Ctrl+K V` can be used when no block is selected |


## Tips

### More visible trailing spaces

Add to `settings.json`:

```jsonc
"workbench.colorCustomizations": {
    // Color of the space dots and tab arrows
    "editorWhitespace.foreground": "#fa1313"
}
```

### Font

A popular font is [JetBrains Mono](https://www.jetbrains.com/lp/mono/), which
supports ligatures (joins characters to show something better).

In `settings.json`:

```jsonc
"editor.fontFamily": "'JetBrains Mono', monospace",
"editor.fontLigatures": true,
"editor.fontWeight": "600",
"editor.letterSpacing": 0,
"editor.lineHeight": 1.2,
"editor.fontSize": 15,
```

## License

[MIT](LICENSE)


## Authors

- Claude Sonnet 5.5
- ChatGPT 5.6 Luna
- Salvador E. Tropea
