# Makefile
.PHONY: build clean

build:
	# 1. Instalar dependencias si las hubiera
	npm install
	# 2. Usar vsce para empaquetar la extensión.
	# 'vsce' lee el package.json y genera internamente el ZIP correcto con la extensión .vsix
	npx @vscode/vsce package

clean:
	rm -f *.vsix
