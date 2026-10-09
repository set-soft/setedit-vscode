# setedit-vscode
Configuration for VSCode/VSCodium to behave similar to SETEdit

- Persistent blocks using Ctrl+K B/K/H/C/V/Y
- Block read/write using Ctrl+K R/W
- Commands to record macros
- Mechanism to simply wrap defined keys so they can be recorded
- Repeatable search and replace
- Look for symbol in file and workspace
- Jump to line
- Replace block
- Open file under cursor
- Block un/indent by a space and by a level
- Block un/comment
- Arbitrary indent
- Move to window top/bottom
- Move to selection start/end
- Select word/line
- Block to upper/lowercase
- Selection status (characters, lines and jump to)
- Delete right spaces/word
- Show tabs, force to purge extra spaces (`showTabs` option and `tabOutline` color)
- Exit session with save confirmation (Alt+X, if you use the menu or close button you get the native behavior)
- Fold buttons

## Dependency:

- `Numbered Bookmarks` by Alessandro Fragnani

## Wrapping:

- `SETEdit.excludeFromWrapping` commands excluded from wrapping
- Added with: `Ctrl+Shift+P` then `SETEdit: Instalar atajos grabables`

## Persistent blocks

- `SETEdit.persistentSelection` to enable the persitent blocks, enabled by default

## Fold buttons

- `SETEdit.foldButtons` to enable the buttons to fold/unfold, enabled by default

## Block Read/Write Dialog:

- `SETEdit.dialogDirectory`:
  - `document`: directory for the file under edition
  - `workspace`: project root
  - `last`: last one used in the dialog

## Example of more visible trailing spaces

Add to `settings.json`:

```
"workbench.colorCustomizations": {
        // Cambia el color de los puntos de espacio y flechas de tabulación
        "editorWhitespace.foreground": "#fa1313"
    }
```
## Font

A popular font is [JetBrains Mono](https://www.jetbrains.com/lp/mono/), which supports ligatures (joins characters to show something better)

In `settings.json`:

```
    "editor.fontFamily": "'JetBrains Mono', monospace",
    "editor.fontLigatures": true,
```
