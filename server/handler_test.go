package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
)

// testDist stands in for the embedded web/dist.
var testDist = fstest.MapFS{
	"index.html":                 {Data: []byte("<!doctype html><title>apiseven</title>")},
	"assets/index-abc123.js":     {Data: []byte("console.log(1)")},
	"assets/index-abc123.css":    {Data: []byte("body{}")},
	"assets/logo-xyz.png":        {Data: []byte("\x89PNG")},
	"favicon.ico":                {Data: []byte("\x00\x00\x01\x00")},
	"favicon-32x32.png":          {Data: []byte("\x89PNG")},
	"android-chrome-192x192.png": {Data: []byte("\x89PNG")},
	"site.webmanifest":           {Data: []byte(`{"name":"apiseven"}`)},
	".keep":                      {Data: []byte("")},
}

const (
	pageHost  = "127.0.0.1:8080"
	pageOrig  = "http://127.0.0.1:8080"
	serverKey = "server-side-key-123"
)

func testConfig(t *testing.T, upstream string, vars map[string]string) Config {
	t.Helper()
	all := map[string]string{"APISIX_ADMIN_URL": upstream}
	for k, v := range vars {
		all[k] = v
	}
	return mustLoad(t, all)
}

// server builds the handler with logs captured in the returned buffer.
func server(t *testing.T, cfg Config) (http.Handler, *bytes.Buffer) {
	t.Helper()
	var logs bytes.Buffer
	return newHandler(cfg, testDist, slog.New(slog.NewTextHandler(&logs, nil))), &logs
}

// request builds a request as the app's page at http://127.0.0.1:8080 would send it.
func request(method, target string, body io.Reader) *http.Request {
	r := httptest.NewRequest(method, target, body)
	r.Host = pageHost
	return r
}

func serve(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func assertSecurityHeaders(t *testing.T, label string, h http.Header) {
	t.Helper()
	want := map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "no-referrer",
		"X-Frame-Options":         "DENY",
		"Content-Security-Policy": contentSecurityPolicy,
	}
	for name, value := range want {
		if got := h.Values(name); len(got) != 1 || got[0] != value {
			t.Errorf("%s: %s = %q, want exactly %q", label, name, got, value)
		}
	}
}

func TestContentSecurityPolicy(t *testing.T) {
	want := "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
		"font-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
	if contentSecurityPolicy != want {
		t.Errorf("CSP = %q\nwant  %q", contentSecurityPolicy, want)
	}
}

func TestConfigJSON(t *testing.T) {
	for _, tc := range []struct {
		vars        map[string]string
		keyRequired bool
	}{
		{map[string]string{}, true},
		{map[string]string{"APISIX_ADMIN_KEY": serverKey}, false},
	} {
		h, _ := server(t, testConfig(t, adminURL, tc.vars))
		w := serve(h, request("GET", "/config.json", nil))
		if w.Code != 200 {
			t.Fatalf("status %d", w.Code)
		}
		var got map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("body %q: %v", w.Body, err)
		}
		want := map[string]any{"adminBase": "apisix/admin", "keyRequired": tc.keyRequired}
		if len(got) != 2 || got["adminBase"] != want["adminBase"] || got["keyRequired"] != want["keyRequired"] {
			t.Errorf("config.json = %v, want %v", got, want)
		}
		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q", ct)
		}
		if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("Cache-Control = %q, want no-store", cc)
		}
		assertSecurityHeaders(t, "config.json", w.Header())
		if strings.Contains(w.Body.String(), serverKey) {
			t.Error("config.json leaks the server key")
		}
	}
}

func TestHealthz(t *testing.T) {
	h, logs := server(t, testConfig(t, adminURL, nil))
	w := serve(h, request("GET", "/healthz", nil))
	if w.Code != 200 || w.Body.String() != "ok" {
		t.Errorf("GET /healthz = %d %q, want 200 ok", w.Code, w.Body)
	}
	if logs.Len() != 0 {
		t.Errorf("/healthz was logged: %s", logs)
	}
}

func TestStaticIndex(t *testing.T) {
	h, _ := server(t, testConfig(t, adminURL, nil))
	for _, path := range []string{"/", "/index.html"} {
		w := serve(h, request("GET", path, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), "<title>apiseven</title>") {
			t.Errorf("GET %s = %d %q, want the index", path, w.Code, w.Body)
		}
		if ct := w.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
			t.Errorf("GET %s: Content-Type %q", path, ct)
		}
		if cc := w.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Errorf("GET %s: Cache-Control %q, want no-cache", path, cc)
		}
		assertSecurityHeaders(t, path, w.Header())
	}
	w := serve(h, request("HEAD", "/", nil))
	if w.Code != 200 || w.Body.Len() != 0 {
		t.Errorf("HEAD / = %d with %d body bytes", w.Code, w.Body.Len())
	}
}

func TestStaticFilesTypesAndCaching(t *testing.T) {
	h, _ := server(t, testConfig(t, adminURL, nil))
	for path, want := range map[string][2]string{
		"/assets/index-abc123.js":     {"text/javascript; charset=utf-8", "public, max-age=31536000, immutable"},
		"/assets/index-abc123.css":    {"text/css; charset=utf-8", "public, max-age=31536000, immutable"},
		"/assets/logo-xyz.png":        {"image/png", "public, max-age=31536000, immutable"},
		"/favicon.ico":                {"image/x-icon", "no-cache"},
		"/favicon-32x32.png":          {"image/png", "no-cache"},
		"/android-chrome-192x192.png": {"image/png", "no-cache"},
		"/site.webmanifest":           {"application/manifest+json", "no-cache"},
	} {
		w := serve(h, request("GET", path, nil))
		if w.Code != 200 {
			t.Errorf("GET %s = %d", path, w.Code)
			continue
		}
		if got := w.Header().Get("Content-Type"); got != want[0] {
			t.Errorf("GET %s: Content-Type %q, want %q", path, got, want[0])
		}
		if got := w.Header().Get("Cache-Control"); got != want[1] {
			t.Errorf("GET %s: Cache-Control %q, want %q", path, got, want[1])
		}
		assertSecurityHeaders(t, path, w.Header())
	}
}

func TestStaticNotFoundAndTraversal(t *testing.T) {
	h, _ := server(t, testConfig(t, adminURL, nil))
	for _, path := range []string{
		"/nope", "/assets/", "/assets", "/.keep", "/index.html/",
		"/../x", "/%2e%2e/x", "/assets/..%2f..%2fmain.go", "/assets/../index.html", "/./index.html", "//index.html",
		"/apisix/other", "/apisix/adminx", "/apisix",
	} {
		w := serve(h, request("GET", path, nil))
		if w.Code != 404 {
			t.Errorf("GET %s = %d, want 404", path, w.Code)
		}
		assertSecurityHeaders(t, path, w.Header())
	}
}

func TestStaticMethods(t *testing.T) {
	h, _ := server(t, testConfig(t, adminURL, nil))
	for _, path := range []string{"/", "/config.json", "/assets/index-abc123.js"} {
		w := serve(h, request("POST", path, strings.NewReader("x")))
		if w.Code != 405 || w.Header().Get("Allow") != "GET, HEAD" {
			t.Errorf("POST %s = %d (Allow %q), want 405 with Allow: GET, HEAD", path, w.Code, w.Header().Get("Allow"))
		}
	}
}

func basicAuthConfig(t *testing.T, upstream string) Config {
	return testConfig(t, upstream, map[string]string{"APISIX_ADMIN_KEY": serverKey, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "s3cret pw"})
}

func TestBasicAuthGuardsEverythingButHealthz(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, basicAuthConfig(t, up.URL))
	paths := []string{"/", "/config.json", "/favicon.ico", "/apisix/admin/routes", "/nope"}
	for _, creds := range [][]string{nil, {"ops", "wrong"}, {"OPS", "s3cret pw"}, {"ops", "s3cret pw "}, {"", ""}} {
		for _, path := range paths {
			r := appRequest("GET", path, nil)
			if creds != nil {
				r.SetBasicAuth(creds[0], creds[1])
			}
			w := serve(h, r)
			if w.Code != 401 {
				t.Errorf("GET %s with %v = %d, want 401", path, creds, w.Code)
			}
			if got := w.Header().Get("WWW-Authenticate"); got != `Basic realm="apiseven"` {
				t.Errorf("GET %s: WWW-Authenticate %q", path, got)
			}
			assertSecurityHeaders(t, path, w.Header())
		}
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d unauthenticated requests reached APISIX", n)
	}
	for path, want := range map[string]int{"/": 200, "/config.json": 200, "/favicon.ico": 200, "/apisix/admin/routes": 200, "/nope": 404} {
		r := appRequest("GET", path, nil)
		r.SetBasicAuth("ops", "s3cret pw")
		if w := serve(h, r); w.Code != want {
			t.Errorf("GET %s with the right credentials = %d, want %d", path, w.Code, want)
		}
	}
	if w := serve(h, request("GET", "/healthz", nil)); w.Code != 200 {
		t.Errorf("GET /healthz without credentials = %d, want 200", w.Code)
	}
}

func TestBasicAuthRefusalOnTheAdminPathIsJSON(t *testing.T) {
	h, _ := server(t, basicAuthConfig(t, adminURL))
	w := serve(h, appRequest("GET", "/apisix/admin/routes", nil))
	assertErrorMsg(t, w, 401, "apiseven: sign-in required")
}

func TestHostCheck(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	for _, host := range []string{"evil.example", "evil.example:8080", "127.0.0.1.nip.io:8080", "localhost.evil.example", ""} {
		for _, path := range []string{"/", "/config.json", "/favicon.ico", "/apisix/admin/routes"} {
			r := appRequest("GET", path, nil)
			r.Host = host
			w := serve(h, r)
			if w.Code != 403 {
				t.Errorf("Host %q, GET %s = %d, want 403", host, path, w.Code)
				continue
			}
			if !strings.Contains(w.Body.String(), "ALLOWED_HOSTS") {
				t.Errorf("Host %q, GET %s: body %q does not name ALLOWED_HOSTS", host, path, w.Body)
			}
			if name, _ := splitHost(host); name != "" && !strings.Contains(w.Body.String(), name) {
				t.Errorf("Host %q, GET %s: body %q does not name the host", host, path, w.Body)
			}
		}
		r := request("GET", "/healthz", nil)
		r.Host = host
		if w := serve(h, r); w.Code != 200 {
			t.Errorf("Host %q, GET /healthz = %d, want 200", host, w.Code)
		}
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d requests with a refused Host reached APISIX", n)
	}
	for _, host := range []string{"127.0.0.1:8080", "[::1]:8080", "localhost:8080", "LOCALHOST", "192.168.1.5:8080", "10.0.0.7", "[fd00::1]"} {
		for _, path := range []string{"/", "/apisix/admin/routes"} {
			r := appRequest("GET", path, nil)
			r.Host = host
			if w := serve(h, r); w.Code != 200 {
				t.Errorf("Host %q, GET %s = %d, want 200", host, path, w.Code)
			}
		}
	}
}

func TestHostCheckAllowedHostsAndBasicAuth(t *testing.T) {
	up := newUpstream(t)
	named := testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey, "ALLOWED_HOSTS": "apisix-admin.example.com"})
	h, _ := server(t, named)
	for _, host := range []string{"apisix-admin.example.com", "APISIX-Admin.example.com:443", "apisix-admin.example.com:8080"} {
		r := appRequest("GET", "/apisix/admin/routes", nil)
		r.Host = host
		if w := serve(h, r); w.Code != 200 {
			t.Errorf("ALLOWED_HOSTS name, Host %q = %d, want 200", host, w.Code)
		}
	}
	r := request("GET", "/", nil)
	r.Host = "other.example.com"
	if w := serve(h, r); w.Code != 403 {
		t.Errorf("a name not in ALLOWED_HOSTS = %d, want 403", w.Code)
	}

	any, _ := server(t, testConfig(t, up.URL, map[string]string{"ALLOWED_HOSTS": "*"}))
	r = request("GET", "/", nil)
	r.Host = "whatever.example"
	if w := serve(any, r); w.Code != 200 {
		t.Errorf("ALLOWED_HOSTS=*: %d, want 200", w.Code)
	}

	h, _ = server(t, basicAuthConfig(t, up.URL))
	for _, path := range []string{"/", "/apisix/admin/routes"} {
		r := appRequest("GET", path, nil)
		r.Host = "evil.example"
		r.SetBasicAuth("ops", "s3cret pw")
		if w := serve(h, r); w.Code != 200 {
			t.Errorf("basic auth, Host evil.example, GET %s = %d, want 200", path, w.Code)
		}
	}
}

func TestRequestLog(t *testing.T) {
	up := newUpstream(t)
	cfg := testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "s3cret-pw"})
	h, logs := server(t, cfg)
	r := appRequest("PUT", "/apisix/admin/routes/r1?api_key=query-key-456&ttl=5", strings.NewReader(`{"uri":"/body-secret"}`))
	r.SetBasicAuth("ops", "s3cret-pw")
	r.Header.Set("X-API-KEY", "client-key-789")
	r.Header.Set("Cookie", "session=cookie-secret")
	if w := serve(h, r); w.Code != 200 {
		t.Fatalf("PUT = %d", w.Code)
	}
	r = request("GET", "/assets/index-abc123.js?v=query-secret", nil)
	r.SetBasicAuth("ops", "s3cret-pw")
	serve(h, r)
	serve(h, request("GET", "/healthz", nil))

	out := logs.String()
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 log lines (none for /healthz), got %d:\n%s", len(lines), out)
	}
	for _, want := range []string{"method=PUT", "path=/apisix/admin/routes/r1", "status=200", "duration="} {
		if !strings.Contains(lines[0], want) {
			t.Errorf("log line %q lacks %q", lines[0], want)
		}
	}
	if !strings.Contains(lines[1], "path=/assets/index-abc123.js") {
		t.Errorf("log line %q lacks the static path", lines[1])
	}
	for _, secret := range []string{serverKey, "query-key-456", "ttl=5", "client-key-789", "s3cret-pw", "b3Bz", "cookie-secret", "body-secret", "query-secret", "Authorization"} {
		if strings.Contains(out, secret) {
			t.Errorf("the log holds %q:\n%s", secret, out)
		}
	}
}

func assertErrorMsg(t *testing.T, w *httptest.ResponseRecorder, status int, msg string) {
	t.Helper()
	if w.Code != status {
		t.Errorf("status %d, want %d (body %q)", w.Code, status, w.Body)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type %q, want application/json", ct)
	}
	var body struct {
		ErrorMsg string `json:"error_msg"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", w.Body, err)
	}
	if !strings.HasPrefix(body.ErrorMsg, msg) {
		t.Errorf("error_msg %q, want it to start with %q", body.ErrorMsg, msg)
	}
}

// mustParse parses a URL or fails the test.
func mustParse(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}
