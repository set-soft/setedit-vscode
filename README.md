# setedit-vscode
Configuration for VSCode/VSCodium to behave similar to SETEdit

- Persistent blocks using Ctrl+K B/K/H/C/V/Y
- Block read/write using Ctrl+K R/W
- Commands to record macros
- Mechanism to simply wrap defined keys so they can be recorded
- Repeatable search and replace
- Look for symbol in file and workspace
- Jump to line

Wrapping:

- `borlandKit.excludeFromWrapping` commands excluded from wrapping
- Added with: `Ctrl+Shift+P` then `Borland Kit: Instalar atajos grabables`

Block Read/Write Dialog:

- `borlandKit.dialogDirectory`:
  - `document`: directory for the file under edition
  - `workspace`: project root
  - `last`: last one used in the dialog
