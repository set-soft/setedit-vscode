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

## Dependency:

- `Numbered Bookmarks` by Alessandro Fragnani

## Wrapping:

- `borlandKit.excludeFromWrapping` commands excluded from wrapping
- Added with: `Ctrl+Shift+P` then `Borland Kit: Instalar atajos grabables`

## Persistent blocks

- `borlandKit.persistentSelection` to enable the persitent blocks, enabled by default

## Block Read/Write Dialog:

- `borlandKit.dialogDirectory`:
  - `document`: directory for the file under edition
  - `workspace`: project root
  - `last`: last one used in the dialog
