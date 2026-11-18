# Notr build. Run `make help` for the targets.
#
#   make dev     Run the editor in a browser at http://localhost:3000
#   make app     Build Notr.app (needs macOS, Xcode 16+, XcodeGen)
#   make dmg     Build Notr.app and package it as build/Notr-<version>.dmg

VERSION ?= $(shell node -p "require('./package.json').version")
BUILD   ?= 1
APP      = build/Release/Notr.app
DMG      = build/Notr-$(VERSION).dmg

.PHONY: help dev web project app dmg open clean

help:
	@grep -E '^#   make' Makefile | sed 's/^#   //'

node_modules: package-lock.json
	npm ci
	@touch node_modules

dev: node_modules
	npm run dev

# Static export of the editor, copied to where the Xcode project bundles it.
web: node_modules
	npm run build
	rm -rf mac/web
	cp -R out mac/web

project:
	@command -v xcodegen >/dev/null || { echo "XcodeGen is missing: brew install xcodegen"; exit 1; }
	cd mac && xcodegen generate

app: web project
	xcodebuild \
	  -project mac/Notr.xcodeproj \
	  -scheme Notr \
	  -configuration Release \
	  -destination 'generic/platform=macOS' \
	  -derivedDataPath build/DerivedData \
	  MARKETING_VERSION=$(VERSION) \
	  CURRENT_PROJECT_VERSION=$(BUILD) \
	  build
	rm -rf build/Release && mkdir -p build/Release
	cp -R build/DerivedData/Build/Products/Release/Notr.app build/Release/
	@echo "Built $(APP)"

dmg: app
	scripts/make-dmg.sh "$(APP)" "$(DMG)"

open: app
	open "$(APP)"

clean:
	rm -rf build out .next mac/web mac/Notr.xcodeproj
