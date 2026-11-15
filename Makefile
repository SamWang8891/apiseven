# Thin wrappers; each target says what it runs.
.PHONY: dev-up dev-down seed web check test build docker

# The local APISIX + etcd for development (dev/compose.yaml), and its sample data.
dev-up:
	docker compose -f dev/compose.yaml up -d
dev-down:
	docker compose -f dev/compose.yaml down -v
seed:
	node dev/seed.mjs

# The web app's dev server (needs a running APISIX; see dev-up).
web:
	cd web && npm run dev

# Type check, lint and tests for the web app; gofmt, vet and tests for the server.
check:
	cd web && npm run check
	@cd server && out="$$(gofmt -l .)" && if [ -n "$$out" ]; then echo "gofmt needed: $$out"; exit 1; fi
	cd server && go vet ./... && go test ./...

test:
	cd web && npm test
	cd server && go test ./...

# bin/apiseven: the server with the web build embedded (server/dist is a copy of web/dist).
build:
	cd web && npm run build
	find server/dist -mindepth 1 ! -name .keep -delete
	cp -R web/dist/. server/dist/
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../bin/apiseven .

docker:
	docker build -t apiseven:local .
