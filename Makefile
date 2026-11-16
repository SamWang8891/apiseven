# Thin wrappers; each target says what it runs.
.PHONY: dev-up dev-down seed web check test build docker single static

# The local APISIX + etcd for development (dev/compose.yaml), and its sample data.
dev-up:
	docker compose -f dev/compose.yaml up -d
dev-down:
	docker compose -f dev/compose.yaml down -v
seed:
	node dev/seed.mjs

# The web app's dependencies. Every target that runs npm in web/ installs them first when
# web/node_modules is missing (order-only: an existing install is left as it is). A failed install
# leaves no web/node_modules behind, so the next run installs again.
web/node_modules:
	cd web && { npm ci || { rm -rf node_modules; exit 1; }; }

# The web app's dev server (needs a running APISIX; see dev-up).
web: | web/node_modules
	cd web && npm run dev

# Type check, lint and tests for the web app; gofmt, vet and tests for the server.
check: | web/node_modules
	cd web && npm run check
	@cd server && out="$$(gofmt -l .)" && if [ -n "$$out" ]; then echo "gofmt needed: $$out"; exit 1; fi
	cd server && go vet ./... && go test ./...

test: | web/node_modules
	cd web && npm test
	cd server && go test ./...

# bin/apiseven: the server with the web build embedded (server/dist is a copy of web/dist).
build: | web/node_modules
	cd web && npm run build
	find server/dist -mindepth 1 ! -name .keep -delete
	cp -R web/dist/. server/dist/
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../bin/apiseven .

docker:
	docker build -t apiseven:local .

# The single-file export: dist/apiseven.html, which runs opened straight from disk.
single: | web/node_modules
	cd web && npm run build:single
	mkdir -p dist
	cp web/dist-single/apiseven.html dist/apiseven.html

# Both static exports: dist/apiseven.html and dist/apiseven-static.zip (web/dist, for any file server).
static: single
	cd web && npm run build
	rm -f dist/apiseven-static.zip
	cd web/dist && zip -qrX ../../dist/apiseven-static.zip .
