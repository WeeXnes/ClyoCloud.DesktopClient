.PHONY: all build run install uninstall pack-linux pack-win package-linux package-win installer-setup installer-linux installer-win installer-all clean

all: build

build:
	npm run build

run: build
	npm start

install:
	npm run install

uninstall:
	npm run uninstall

pack-linux: build
	npm run pack:linux

pack-win: build
	npm run pack:win

package-linux: build
	npm run package:linux

package-win: build
	npm run package:win

installer-setup:
	npm run installer:setup

installer-linux:
	npm run installer:linux

installer-win:
	npm run installer:win

installer-all:
	npm run installer:all

clean:
	rm -rf dist release installer/publish installer/payload.zip
