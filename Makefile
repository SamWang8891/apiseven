# Thin wrappers; each target says what it runs.
.PHONY: dev-up dev-down seed web check test build docker single static e2e

# The local APISIX + etcd for development (dev/compose.yaml), and its sample data.
dev-up:
	docker compose -f dev/compose.yaml up -d
dev-down:
	docker compose -f dev/compose.yaml down -v
seed:
	node dev/seed.mjs

# The web app's dependencies. Every target that runs npm in web/ installs them first (`npm ci`) when the
# stamp of the last install make finished, web/.npm-installed (git-ignored), is missing or older than
# web/package-lock.json. The stamp sits outside node_modules, so an `npm ci` run by hand removes nothing.
# It is removed before an install and written only after `npm ci` succeeds, so an install that failed or
# was interrupted (Ctrl-C) is redone by the next target.
WEB_DEPS := web/.npm-installed
$(WEB_DEPS): web/package-lock.json
	cd web && rm -f .npm-installed && npm ci && touch .npm-installed

# The web app's dev server (needs a running APISIX; see dev-up).
web: | $(WEB_DEPS)
	cd web && npm run dev

# Type check, lint and tests for the web app; gofmt, vet and tests for the server.
check: | $(WEB_DEPS)
	cd web && npm run check
	node --test 'dev/*.test.mjs'
	@cd server && out="$$(gofmt -l .)" && if [ -n "$$out" ]; then echo "gofmt needed: $$out"; exit 1; fi
	cd server && go vet ./... && go test ./...

test: | $(WEB_DEPS)
	cd web && npm test
	node --test 'dev/*.test.mjs'
	cd server && go test ./...

# The Playwright suite against the dev stack (make dev-up first; Chromium: cd web && npx playwright
# install chromium). It resets the dev APISIX to the seed. It builds what it tests: the single file and
# the image $(IMAGE), which proxy mode then requires. web/playwright.config.ts lists the E2E_* variables
# that point it at another APISIX.
e2e: single docker | $(WEB_DEPS)
	cd web && E2E_IMAGE=$(IMAGE) E2E_REQUIRE_PROXY=1 E2E_REQUIRE_SINGLE=1 npm run e2e

# bin/apiseven: the server with the web build embedded (server/dist is a copy of web/dist).
build: | $(WEB_DEPS)
	cd web && npm run build
	find server/dist -mindepth 1 ! -name .keep -delete
	cp -R web/dist/. server/dist/
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../bin/apiseven .

# IMAGE=<tag> builds under another tag (the end-to-end suite reads E2E_IMAGE).
IMAGE ?= apiseven:local
docker:
	docker build -t $(IMAGE) .

# The single-file export: dist/apiseven.html, which runs opened straight from disk.
single: | $(WEB_DEPS)
	cd web && npm run build:single
	mkdir -p dist
	cp web/dist-single/apiseven.html web/dist-single/LICENSE.txt web/dist-single/NOTICE.txt web/dist-single/THIRD-PARTY-LICENSES.txt dist/

# Both static exports: dist/apiseven.html and dist/apiseven-static.zip (web/dist, for any file server).
static: single
	cd web && npm run build
	rm -f dist/apiseven-static.zip
	cd web/dist && zip -qrX ../../dist/apiseven-static.zip .
