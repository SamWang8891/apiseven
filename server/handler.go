package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"path"
	"slices"
	"strings"
	"time"
)

// contentSecurityPolicy is sent with every response. Everything comes from apiseven's own origin:
// the app needs no inline script, and here it connects only to itself (config.json and the proxy).
// 'unsafe-eval' is there because the form validator (Ajv) compiles each JSON schema APISIX reports
// into a function with new Function, in the browser, at run time; it lets scripts already running in
// the page use eval, while inline and foreign scripts stay blocked. Without it the plugin forms lose
// their checks and their conditional fields. 'unsafe-inline' styles are for CodeMirror's style
// elements and the style attributes React sets. The static folder and the single file have no policy:
// no server sends them headers.
const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
	"font-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

var securityHeaders = map[string]string{
	"Content-Security-Policy": contentSecurityPolicy,
	"X-Content-Type-Options":  "nosniff",
	"Referrer-Policy":         "no-referrer",
	"X-Frame-Options":         "DENY",
}

// contentTypes is fixed rather than read from the system: the distroless image has no mime.types.
var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".map":         "application/json",
	".webmanifest": "application/manifest+json",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".svg":         "image/svg+xml",
	".woff2":       "font/woff2",
	".txt":         "text/plain; charset=utf-8",
}

const adminPath = "/apisix/admin"

type handler struct {
	cfg                Config
	static             fs.FS
	proxy              http.Handler
	log                *slog.Logger
	configJSON         []byte
	userHash, passHash [sha256.Size]byte
}

// newHandler serves the web app from static, ./config.json, /healthz, and the Admin API proxy.
func newHandler(cfg Config, static fs.FS, logger *slog.Logger) http.Handler {
	configJSON, _ := json.Marshal(struct {
		AdminBase   string `json:"adminBase"`
		KeyRequired bool   `json:"keyRequired"`
	}{"apisix/admin", cfg.AdminKey == ""})
	return &handler{
		cfg:        cfg,
		static:     static,
		proxy:      newProxy(cfg, logger),
		log:        logger,
		configJSON: configJSON,
		userHash:   sha256.Sum256([]byte(cfg.BasicUser)),
		passHash:   sha256.Sum256([]byte(cfg.BasicPassword)),
	}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	for name, value := range securityHeaders {
		w.Header().Set(name, value)
	}
	if r.URL.Path == "/healthz" {
		serveHealthz(w, r)
		return
	}
	start := time.Now()
	rec := &statusRecorder{ResponseWriter: w}
	h.route(rec, r)
	// The path only: query strings can hold api_key, and nothing else here is worth a log line.
	h.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.code(),
		"duration", time.Since(start).Round(time.Microsecond), "remote", r.RemoteAddr)
}

func (h *handler) route(w http.ResponseWriter, r *http.Request) {
	admin := isAdminPath(r.URL.Path)
	if !h.hostAllowed(r.Host) {
		refuse(w, admin, http.StatusForbidden, "host", hostRefusal(r.Host))
		return
	}
	if h.cfg.basicAuth() && !h.signedIn(r) {
		w.Header().Set("WWW-Authenticate", `Basic realm="apiseven"`)
		refuse(w, admin, http.StatusUnauthorized, "auth", "apiseven: sign-in required")
		return
	}
	switch {
	case admin:
		h.serveAdmin(w, r)
	case r.URL.Path == "/config.json":
		h.serveConfig(w, r)
	default:
		h.serveStatic(w, r)
	}
}

func isAdminPath(p string) bool { return p == adminPath || strings.HasPrefix(p, adminPath+"/") }

// hostAllowed is the DNS-rebinding check: a page on an attacker's name that resolves to this server
// sends that name as Host. IP literals and localhost cannot be rebound; other names must be listed.
// With Basic auth on, the browser's credentials are bound to the name, so any Host is accepted.
func (h *handler) hostAllowed(host string) bool {
	if h.cfg.AnyHost || h.cfg.basicAuth() {
		return true
	}
	name, _ := splitHost(host)
	if name == "" {
		return false
	}
	if _, err := netip.ParseAddr(name); err == nil || name == "localhost" {
		return true
	}
	return slices.Contains(h.cfg.AllowedHosts, name)
}

func hostRefusal(host string) string {
	name, _ := splitHost(host)
	if name == "" {
		return "apiseven: refused a request without a host name. apiseven answers requests for IP addresses, localhost and the names in ALLOWED_HOSTS."
	}
	return fmt.Sprintf("apiseven: refused a request for host %q. apiseven answers requests for IP addresses, localhost "+
		"and the names in ALLOWED_HOSTS (this stops DNS rebinding). If apiseven is served under this name, set ALLOWED_HOSTS=%s.", name, name)
}

// splitHost returns a Host header's name (lower case, IPv6 without brackets) and port, if any.
func splitHost(host string) (name, port string) {
	if h, p, err := net.SplitHostPort(host); err == nil {
		return strings.ToLower(h), p
	}
	return strings.ToLower(strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")), ""
}

// signedIn compares fixed-size hashes in constant time, user and password both, every time.
func (h *handler) signedIn(r *http.Request) bool {
	user, password, ok := r.BasicAuth()
	userHash, passHash := sha256.Sum256([]byte(user)), sha256.Sum256([]byte(password))
	match := subtle.ConstantTimeCompare(userHash[:], h.userHash[:]) & subtle.ConstantTimeCompare(passHash[:], h.passHash[:])
	return ok && match == 1
}

func serveHealthz(w http.ResponseWriter, r *http.Request) {
	if !getOrHead(w, r, false) {
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, "ok")
}

func (h *handler) serveConfig(w http.ResponseWriter, r *http.Request) {
	if !getOrHead(w, r, false) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(h.configJSON)
}

// serveStatic serves the embedded build: / is index.html; no directory listings, no dotfiles, and
// a path that is not already clean (., .., empty elements) is not found rather than cleaned.
func (h *handler) serveStatic(w http.ResponseWriter, r *http.Request) {
	if !getOrHead(w, r, false) {
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if !fs.ValidPath(name) || strings.HasPrefix(name, ".") || strings.Contains(name, "/.") {
		notFound(w, false)
		return
	}
	f, err := h.static.Open(name)
	if err != nil {
		notFound(w, false)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		notFound(w, false)
		return
	}
	content, ok := f.(io.ReadSeeker)
	if !ok {
		data, err := io.ReadAll(f)
		if err != nil {
			notFound(w, false)
			return
		}
		content = bytes.NewReader(data)
	}
	contentType, known := contentTypes[path.Ext(name)]
	if !known {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	if strings.HasPrefix(name, "assets/") {
		// Vite puts a content hash in every name under assets/.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, "", time.Time{}, content)
}

// getOrHead answers 405 for any other method and reports whether the request may go on.
func getOrHead(w http.ResponseWriter, r *http.Request, jsonBody bool) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	refuse(w, jsonBody, http.StatusMethodNotAllowed, "method", fmt.Sprintf("apiseven: method %s is not allowed here", r.Method))
	return false
}

func notFound(w http.ResponseWriter, jsonBody bool) {
	refuse(w, jsonBody, http.StatusNotFound, "path", "apiseven: not found")
}

// refusalHeader marks every answer the server makes itself (never a proxied one: the proxy drops
// it from APISIX's answers), with one word for why: host, auth, header, origin, path, method, size,
// request (the request body could not be read) or upstream. The app tells apiseven's refusals from
// APISIX's by it, not by the message text.
const refusalHeader = "X-Apiseven-Refusal"

// refuse writes an error the server itself decided: JSON {"error_msg": …} on the Admin API path,
// where the app shows error_msg verbatim, plain text elsewhere.
func refuse(w http.ResponseWriter, jsonBody bool, status int, reason, msg string) {
	w.Header().Set(refusalHeader, reason)
	w.Header().Set("Cache-Control", "no-store")
	if jsonBody {
		body, _ := json.Marshal(map[string]string{"error_msg": msg})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(body)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, msg+"\n")
}

// statusRecorder notes the status a handler wrote, for the request log.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 && code >= 200 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController (used by the reverse proxy to flush) reach the real writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *statusRecorder) code() int {
	if s.status == 0 {
		return http.StatusOK
	}
	return s.status
}
