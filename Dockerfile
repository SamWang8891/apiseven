# apiseven: the web app and a small Go server that serves it and proxies the APISIX Admin API.
#   docker build -t apiseven:local .
# Base images are pinned (the distroless one by digest: its tag carries no version).

FROM node:22.23.5-alpine3.24 AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
# The build puts LICENSE.txt and NOTICE.txt (from these) and THIRD-PARTY-LICENSES.txt in dist/.
COPY LICENSE NOTICE /src/
COPY web/ ./
RUN npm run build

FROM golang:1.27.3-alpine3.24 AS server
WORKDIR /src/server
COPY server/ ./
COPY --from=web /src/web/dist ./dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/apiseven .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=server /out/apiseven /apiseven
# Also served by the app, at /LICENSE.txt, /NOTICE.txt and /THIRD-PARTY-LICENSES.txt (embedded in dist/).
COPY --from=web /src/web/dist/LICENSE.txt /src/web/dist/NOTICE.txt /src/web/dist/THIRD-PARTY-LICENSES.txt /licenses/
USER nonroot:nonroot
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/apiseven", "-healthcheck"]
ENTRYPOINT ["/apiseven"]
