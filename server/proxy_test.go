package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// seen is what the fake APISIX received.
type seen struct {
	Method   string
	URI      string
	Host     string
	Header   http.Header
	Body     string
	BodySize int
}

type upstream struct {
	*httptest.Server
	mu   sync.Mutex
	reqs []seen
}

func (u *upstream) count() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.reqs)
}

func (u *upstream) last(t *testing.T) seen {
	t.Helper()
	u.mu.Lock()
	defer u.mu.Unlock()
	if len(u.reqs) == 0 {
		t.Fatal("nothing reached APISIX")
	}
	return u.reqs[len(u.reqs)-1]
}

// newUpstream is a fake Admin API: it records each request and answers like APISIX with CORS on.
func newUpstream(t *testing.T) *upstream {
	t.Helper()
	u := &upstream{}
	u.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.reqs = append(u.reqs, seen{r.Method, r.RequestURI, r.Host, r.Header.Clone(), string(body), len(body)})
		u.mu.Unlock()
		w.Header().Set("Server", "APISIX/3.20.0")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Expose-Headers", "*")
		w.Header().Set("Access-Control-Max-Age", "3600")
		w.Header().Set("Content-Type", "application/json")
		// Something behind the proxy tries to pass for apiseven's own refusal, and sends its own
		// copies of two security headers.
		w.Header().Set("X-Apiseven-Refusal", "header")
		w.Header().Set("Content-Security-Policy", "default-src *")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		if r.URL.Path == "/apisix/admin/truncated" {
			conn, buf, _ := w.(http.Hijacker).Hijack()
			_, _ = buf.WriteString("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"total\"")
			_ = buf.Flush()
			_ = conn.Close()
			return
		}
		var code int
		if _, err := fmt.Sscanf(r.URL.Path, "/apisix/admin/status/%d", &code); err == nil {
			w.WriteHeader(code)
			_, _ = io.WriteString(w, `{"error_msg":"apiseven: the upstream says so"}`)
			return
		}
		if r.URL.Path == "/apisix/admin/routes/missing" {
			w.WriteHeader(404)
			_, _ = io.WriteString(w, `{"message":"Key not found"}`)
			return
		}
		_, _ = io.WriteString(w, `{"total":0,"list":[]}`)
	}))
	t.Cleanup(u.Close)
	return u
}

// appRequest is a request as the app at http://127.0.0.1:8080 sends it: the proxy header, the
// Sec-Fetch-Site a browser adds, and (for anything but GET and HEAD) the Origin a browser adds.
func appRequest(method, target string, body io.Reader) *http.Request {
	r := request(method, target, body)
	r.Header.Set("X-Apiseven-Request", "1")
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	if method != "GET" && method != "HEAD" {
		r.Header.Set("Origin", pageOrig)
	}
	return r
}

func TestProxyForwardsMethodPathQueryAndBody(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, nil))
	for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
		body := ""
		if method == "POST" || method == "PUT" || method == "PATCH" {
			body = `{"uri":"/a","plugins":{"x":{"k":"v"}}}`
		}
		r := appRequest(method, "/apisix/admin/routes/r%201?page=2&page_size=500&a=%2F", strings.NewReader(body))
		w := serve(h, r)
		if w.Code != 200 {
			t.Errorf("%s = %d (%s)", method, w.Code, w.Body)
			continue
		}
		got := up.last(t)
		if got.Method != method || got.URI != "/apisix/admin/routes/r%201?page=2&page_size=500&a=%2F" || got.Body != body {
			t.Errorf("%s: APISIX saw %s %s body %q", method, got.Method, got.URI, got.Body)
		}
		if host := mustParse(t, up.URL).Host; got.Host != host {
			t.Errorf("%s: APISIX saw Host %q, want %q", method, got.Host, host)
		}
		if got.Header.Get("X-Apiseven-Request") != "" {
			t.Errorf("%s: X-Apiseven-Request reached APISIX", method)
		}
	}
	serve(h, appRequest("GET", "/apisix/admin", nil))
	if got := up.last(t).URI; got != "/apisix/admin" {
		t.Errorf("bare /apisix/admin reached APISIX as %q", got)
	}
}

func TestProxyKeepsTheAdminURLPathPrefix(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL+"/gw/", nil))
	serve(h, appRequest("GET", "/apisix/admin/routes?x=1", nil))
	if got := up.last(t).URI; got != "/gw/apisix/admin/routes?x=1" {
		t.Errorf("APISIX saw %q", got)
	}
}

func TestProxyPassesStatusBodyAndHeadersButNotCORS(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, nil))
	w := serve(h, appRequest("GET", "/apisix/admin/routes/missing", nil))
	if w.Code != 404 || w.Body.String() != `{"message":"Key not found"}` {
		t.Errorf("got %d %q, want APISIX's 404 and body", w.Code, w.Body)
	}
	if w.Header().Get("Server") != "APISIX/3.20.0" || w.Header().Get("Content-Type") != "application/json" {
		t.Errorf("APISIX's headers did not pass: %v", w.Header())
	}
	for name := range w.Header() {
		if strings.HasPrefix(name, "Access-Control-") {
			t.Errorf("%s passed through", name)
		}
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control %q, want no-store", cc)
	}
	assertSecurityHeaders(t, "proxied", w.Header())
}

func TestProxyServerKeyReplacesTheClientKey(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	r := appRequest("GET", "/apisix/admin/routes?api_key=client-q&page=1&API_KEY=client-q2&api_keys=keep", nil)
	r.Header.Set("X-API-KEY", "client-key")
	r.Header.Add("x-api-key", "client-key-2")
	serve(h, r)
	got := up.last(t)
	if keys := got.Header.Values("X-Api-Key"); len(keys) != 1 || keys[0] != serverKey {
		t.Errorf("APISIX saw X-API-KEY %q, want only the server key", keys)
	}
	if got.URI != "/apisix/admin/routes?page=1&api_keys=keep" {
		t.Errorf("APISIX saw %q: the client's api_key query arguments must go, the rest stay", got.URI)
	}

	serve(h, appRequest("GET", "/apisix/admin/routes", nil))
	if keys := up.last(t).Header.Values("X-Api-Key"); len(keys) != 1 || keys[0] != serverKey {
		t.Errorf("no client key: APISIX saw X-API-KEY %q, want the server key", keys)
	}
}

func TestProxyWithoutServerKeyPassesTheClientKey(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, nil))
	r := appRequest("GET", "/apisix/admin/routes?api_key=client-q", nil)
	r.Header.Set("X-API-KEY", "client-key")
	serve(h, r)
	got := up.last(t)
	if keys := got.Header.Values("X-Api-Key"); len(keys) != 1 || keys[0] != "client-key" {
		t.Errorf("APISIX saw X-API-KEY %q, want the client's", keys)
	}
	if got.URI != "/apisix/admin/routes?api_key=client-q" {
		t.Errorf("APISIX saw %q", got.URI)
	}
}

func TestProxyNeverForwardsAuthorizationOrCookie(t *testing.T) {
	up := newUpstream(t)
	for _, cfg := range []Config{
		testConfig(t, up.URL, nil),
		testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}),
		basicAuthConfig(t, up.URL),
	} {
		h, _ := server(t, cfg)
		r := appRequest("POST", "/apisix/admin/routes", strings.NewReader("{}"))
		r.SetBasicAuth("ops", "s3cret pw")
		r.Header.Set("Cookie", "x_api_key=cookie-key; other=1")
		if w := serve(h, r); w.Code != 200 {
			t.Fatalf("POST = %d %s", w.Code, w.Body)
		}
		got := up.last(t)
		if got.Header.Get("Authorization") != "" || got.Header.Get("Cookie") != "" {
			t.Errorf("APISIX saw Authorization %q, Cookie %q", got.Header.Get("Authorization"), got.Header.Get("Cookie"))
		}
	}
}

func TestProxyOnlyAdminPathsAndCleanOnes(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, nil))
	for _, path := range []string{
		"/apisix/other", "/apisix/adminx", "/apisix/admin/../../ui/", "/apisix/admin/%2e%2e/%2e%2e/ui/",
		"/apisix/admin/routes/..%2F..%2F..%2Fui", "/apisix/admin/./routes", "/apisix/admin/routes/.",
	} {
		w := serve(h, appRequest("GET", path, nil))
		if w.Code != 404 {
			t.Errorf("GET %s = %d, want 404", path, w.Code)
		}
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d of those reached APISIX", n)
	}
}

func TestProxyRefusesOtherMethods(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, nil))
	for _, method := range []string{"TRACE", "PROPFIND", "CONNECT"} {
		w := serve(h, appRequest(method, "/apisix/admin/routes", nil))
		if w.Code != 405 {
			t.Errorf("%s = %d, want 405", method, w.Code)
		}
		if allow := w.Header().Get("Allow"); allow != "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" {
			t.Errorf("%s: Allow %q", method, allow)
		}
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d of those reached APISIX", n)
	}
}

func TestProxyUpstreamDown(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	h, logs := server(t, testConfig(t, "http://"+addr, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	w := serve(h, appRequest("GET", "/apisix/admin/routes?api_key=query-secret", nil))
	assertErrorMsg(t, w, 502, "apiseven: cannot reach the APISIX Admin API at "+addr+": ")
	assertSecurityHeaders(t, "502", w.Header())
	if strings.Contains(w.Body.String(), "query-secret") || strings.Contains(logs.String(), "query-secret") {
		t.Errorf("the query string leaked: body %s, logs %s", w.Body, logs)
	}
}

func TestProxyRequiresTheApisevenHeader(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	for _, value := range []string{"", "0", "true"} {
		for _, method := range []string{"GET", "POST", "DELETE", "OPTIONS"} {
			r := appRequest(method, "/apisix/admin/routes", strings.NewReader("{}"))
			r.Header.Del("X-Apiseven-Request")
			if value != "" {
				r.Header.Set("X-Apiseven-Request", value)
			}
			w := serve(h, r)
			assertErrorMsg(t, w, 403, "apiseven: missing X-Apiseven-Request header")
			assertNoCORS(t, w)
		}
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d requests without the header reached APISIX", n)
	}
	// Static files and config.json never need it.
	for _, path := range []string{"/", "/config.json", "/favicon.ico", "/site.webmanifest"} {
		if w := serve(h, request("GET", path, nil)); w.Code != 200 {
			t.Errorf("GET %s without the header = %d, want 200", path, w.Code)
		}
	}
}

func assertNoCORS(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	for name := range w.Header() {
		if strings.HasPrefix(name, "Access-Control-") {
			t.Errorf("response carries %s", name)
		}
	}
}

func TestProxyRefusesOtherOrigins(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	for _, origin := range []string{"http://evil.example", "http://127.0.0.1:9999", "http://localhost:8080", "null", "file://", "http://127.0.0.1:8080/x", "garbage"} {
		for _, method := range []string{"GET", "POST", "OPTIONS"} {
			r := appRequest(method, "/apisix/admin/routes", strings.NewReader("{}"))
			r.Header.Set("Origin", origin)
			if method == "OPTIONS" {
				// A CORS preflight: no custom header, only the request for it.
				r.Header.Del("X-Apiseven-Request")
				r.Header.Set("Access-Control-Request-Method", "POST")
				r.Header.Set("Access-Control-Request-Headers", "x-apiseven-request,content-type")
			}
			w := serve(h, r)
			if w.Code != 403 {
				t.Errorf("%s with Origin %q = %d, want 403", method, origin, w.Code)
			}
			assertNoCORS(t, w)
		}
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d cross-origin requests reached APISIX", n)
	}
}

func TestProxyRefusesCrossSiteFetches(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	for _, site := range []string{"cross-site", "same-site"} {
		r := appRequest("POST", "/apisix/admin/routes", strings.NewReader("{}"))
		r.Header.Set("Sec-Fetch-Site", site)
		w := serve(h, r)
		assertErrorMsg(t, w, 403, "apiseven: refused a request from another site")
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d cross-site requests reached APISIX", n)
	}
}

func TestProxyLetsTheAppsOwnRequestsThrough(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey, "ALLOWED_HOSTS": "admin.example.com"}))
	for _, tc := range []struct{ host, origin, site string }{
		{pageHost, "", "same-origin"},
		{pageHost, pageOrig, "same-origin"},
		{pageHost, pageOrig, ""},
		{pageHost, "", "none"},
		{"[::1]:8080", "http://[::1]:8080", "same-origin"},
		{"localhost:8080", "http://LOCALHOST:8080", "same-origin"},
		// Behind a TLS-terminating reverse proxy that passes the Host through.
		{"admin.example.com", "https://admin.example.com", "same-origin"},
		{"admin.example.com:443", "https://admin.example.com", "same-origin"},
		{"admin.example.com", "http://admin.example.com:80", ""},
	} {
		for _, method := range []string{"GET", "PUT", "DELETE"} {
			r := appRequest(method, "/apisix/admin/routes/r1", strings.NewReader("{}"))
			r.Host = tc.host
			r.Header.Del("Origin")
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			r.Header.Del("Sec-Fetch-Site")
			if tc.site != "" {
				r.Header.Set("Sec-Fetch-Site", tc.site)
			}
			if w := serve(h, r); w.Code != 200 {
				t.Errorf("%s Host %q Origin %q Sec-Fetch-Site %q = %d %s", method, tc.host, tc.origin, tc.site, w.Code, w.Body)
			}
		}
	}
	// The same names with a port the Origin does not have, or the other way round.
	for _, tc := range []struct{ host, origin string }{
		{"admin.example.com:8443", "https://admin.example.com"},
		{"admin.example.com", "https://admin.example.com:8443"},
		{"admin.example.com", "http://admin.example.com:8080"},
	} {
		r := appRequest("PUT", "/apisix/admin/routes/r1", strings.NewReader("{}"))
		r.Host = tc.host
		r.Header.Set("Origin", tc.origin)
		if w := serve(h, r); w.Code != 403 {
			t.Errorf("Host %q Origin %q = %d, want 403", tc.host, tc.origin, w.Code)
		}
	}
}

func TestOriginRefusalNamesBothSides(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, nil))
	r := appRequest("POST", "/apisix/admin/routes", strings.NewReader("{}"))
	r.Header.Set("Origin", "http://evil.example")
	w := serve(h, r)
	assertErrorMsg(t, w, 403, "apiseven: refused a request from another origin")
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if !strings.Contains(body["error_msg"], "http://evil.example") || !strings.Contains(body["error_msg"], pageHost) {
		t.Errorf("error_msg %q does not name the Origin and the Host", body["error_msg"])
	}
}

func TestProxyTransportHasNoEnvironmentProxy(t *testing.T) {
	rp, ok := newProxy(testConfig(t, adminURL, nil), slog.New(slog.DiscardHandler)).(*httputil.ReverseProxy)
	if !ok {
		t.Fatal("newProxy is not a *httputil.ReverseProxy")
	}
	if tr, ok := rp.Transport.(*http.Transport); !ok || tr.Proxy != nil {
		t.Errorf("the Admin API transport has a Proxy function: requests could go to HTTP_PROXY")
	}
}

// TestProxyIgnoresHTTPProxy sets HTTP_PROXY in a child process (Go reads it once per process) and
// sends a request for an Admin API on a name that does not resolve. Through the environment's proxy
// it would reach the fake forward proxy and succeed; straight, it fails to look the name up.
func TestProxyIgnoresHTTPProxy(t *testing.T) {
	if os.Getenv("APISEVEN_PROXY_ENV_CHILD") == "1" {
		proxyEnvChild(t)
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestProxyIgnoresHTTPProxy$", "-test.count=1", "-test.v")
	cmd.Env = append(os.Environ(), "APISEVEN_PROXY_ENV_CHILD=1")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("child process: %v\n%s", err, out)
	}
}

func proxyEnvChild(t *testing.T) {
	var reached atomic.Int32
	forward := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached.Add(1)
		_, _ = io.WriteString(w, `{"total":0,"list":[]}`)
	}))
	defer forward.Close()
	for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
		t.Setenv(name, forward.URL)
	}
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")
	h, _ := server(t, testConfig(t, "http://apisix.invalid:9180", map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	w := serve(h, appRequest("GET", "/apisix/admin/routes", nil))
	if n := reached.Load(); n != 0 {
		t.Fatalf("%d request(s) with the server key went to HTTP_PROXY", n)
	}
	assertErrorMsg(t, w, 502, "apiseven: cannot reach the APISIX Admin API at apisix.invalid:9180: ")
	if !strings.Contains(w.Body.String(), "apisix.invalid") {
		t.Errorf("502 body %s does not show the direct lookup of the Admin API's name", w.Body)
	}
}

func assertRefusal(t *testing.T, label string, w *httptest.ResponseRecorder, reason string) {
	t.Helper()
	if got := w.Header().Values("X-Apiseven-Refusal"); len(got) != 1 || got[0] != reason {
		t.Errorf("%s: X-Apiseven-Refusal %q, want exactly %q", label, got, reason)
	}
}

// Every answer the server makes itself on the Admin API path says so, with a reason word the app
// can rely on (an error_msg starting "apiseven: " could come from anywhere).
func TestServerRefusalsAreMarked(t *testing.T) {
	up := newUpstream(t)
	keyed, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	auth, _ := server(t, basicAuthConfig(t, up.URL))
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	down := "http://" + l.Addr().String()
	_ = l.Close()
	unreachable, _ := server(t, testConfig(t, down, nil))

	noHeader := appRequest("GET", "/apisix/admin/routes", nil)
	noHeader.Header.Del("X-Apiseven-Request")
	otherOrigin := appRequest("POST", "/apisix/admin/routes", strings.NewReader("{}"))
	otherOrigin.Header.Set("Origin", "http://evil.example")
	otherSite := appRequest("POST", "/apisix/admin/routes", strings.NewReader("{}"))
	otherSite.Header.Set("Sec-Fetch-Site", "cross-site")
	otherHost := appRequest("GET", "/apisix/admin/routes", nil)
	otherHost.Host = "evil.example"
	for _, tc := range []struct {
		label  string
		h      http.Handler
		r      *http.Request
		status int
		reason string
	}{
		{"no X-Apiseven-Request", keyed, noHeader, 403, "header"},
		{"another Origin", keyed, otherOrigin, 403, "origin"},
		{"Sec-Fetch-Site cross-site", keyed, otherSite, 403, "origin"},
		{"another Host", keyed, otherHost, 403, "host"},
		{"no Basic auth", auth, appRequest("GET", "/apisix/admin/routes", nil), 401, "auth"},
		{"a dot segment", keyed, appRequest("GET", "/apisix/admin/../ui/", nil), 404, "path"},
		{"another method", keyed, appRequest("TRACE", "/apisix/admin/routes", nil), 405, "method"},
		{"APISIX down", unreachable, appRequest("GET", "/apisix/admin/routes", nil), 502, "upstream"},
	} {
		w := serve(tc.h, tc.r)
		if w.Code != tc.status {
			t.Errorf("%s: status %d, want %d", tc.label, w.Code, tc.status)
		}
		assertRefusal(t, tc.label, w, tc.reason)
	}
	if n := up.count(); n != 0 {
		t.Errorf("%d refused requests reached APISIX", n)
	}
}

// What APISIX (or anything behind the proxy) answers is never marked, even when it sends the header.
func TestProxiedErrorsAreNeverMarked(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	for _, path := range []string{"/apisix/admin/status/401", "/apisix/admin/status/403", "/apisix/admin/status/502", "/apisix/admin/routes"} {
		w := serve(h, appRequest("GET", path, nil))
		if want := map[bool]int{true: 200}[path == "/apisix/admin/routes"]; want != 0 && w.Code != want {
			t.Errorf("GET %s = %d", path, w.Code)
		}
		if got := w.Header().Values("X-Apiseven-Refusal"); len(got) != 0 {
			t.Errorf("GET %s (proxied, status %d) carries X-Apiseven-Refusal %q", path, w.Code, got)
		}
	}
	if n := up.count(); n != 4 {
		t.Errorf("%d requests reached APISIX, want 4", n)
	}
}

func TestProxyRefusesBodiesOver16MiB(t *testing.T) {
	up := newUpstream(t)
	h, _ := server(t, testConfig(t, up.URL, nil))
	big := strings.Repeat("x", maxBodyBytes+1)

	// Announced by Content-Length (as browsers send it): refused before anything is forwarded.
	w := serve(h, appRequest("PUT", "/apisix/admin/protos/p1", strings.NewReader(big)))
	assertErrorMsg(t, w, 413, "apiseven: the request body is larger than 16 MiB")
	assertRefusal(t, "Content-Length", w, "size")
	if n := up.count(); n != 0 {
		t.Errorf("%d oversized requests reached APISIX", n)
	}

	// Streamed without a length: cut off at the limit, answered the same.
	r := appRequest("PUT", "/apisix/admin/protos/p1", io.MultiReader(strings.NewReader(big)))
	r.ContentLength = -1
	w = serve(h, r)
	assertErrorMsg(t, w, 413, "apiseven: the request body is larger than 16 MiB")
	assertRefusal(t, "streamed", w, "size")

	// Exactly the limit passes.
	w = serve(h, appRequest("PUT", "/apisix/admin/protos/p1", strings.NewReader(big[:maxBodyBytes])))
	if w.Code != 200 || up.last(t).BodySize != maxBodyBytes {
		t.Errorf("a 16 MiB body: %d, APISIX saw %d bytes", w.Code, up.last(t).BodySize)
	}
}

// The reverse proxy's own messages (a broken answer from APISIX) go through slog, at WARN.
func TestProxyLogsThroughSlog(t *testing.T) {
	up := newUpstream(t)
	h, logs := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	r := appRequest("GET", "/apisix/admin/truncated?api_key=query-secret", nil)
	r.Header.Set("Cookie", "cookie-secret")
	serve(h, r)
	out := logs.String()
	if !strings.Contains(out, "level=WARN") || !strings.Contains(out, "ReverseProxy read error during body copy") {
		t.Errorf("the proxy's own message is not in the slog output:\n%s", out)
	}
	for _, secret := range []string{serverKey, "query-secret", "cookie-secret"} {
		if strings.Contains(out, secret) {
			t.Errorf("the log holds %q:\n%s", secret, out)
		}
	}
}

// failingBody gives some bytes, then fails as a client's body does when it outlasts the read
// timeout or sends a malformed chunk.
type failingBody struct{ sent bool }

func (b *failingBody) Read(p []byte) (int, error) {
	if !b.sent {
		b.sent = true
		return copy(p, `{"uri":"/`), nil
	}
	return 0, errors.New("read tcp 127.0.0.1:8080->127.0.0.1:50000: i/o timeout")
}

// A failure to read the request from the client is not "cannot reach APISIX": 400, marked request.
func TestProxyRequestBodyThatCannotBeReadIsABadRequest(t *testing.T) {
	up := newUpstream(t)
	h, logs := server(t, testConfig(t, up.URL, map[string]string{"APISIX_ADMIN_KEY": serverKey}))
	for range 5 {
		r := appRequest("PUT", "/apisix/admin/routes/r1", &failingBody{})
		r.ContentLength = -1
		w := serve(h, r)
		assertErrorMsg(t, w, 400, "apiseven: could not read the request body: ")
		assertRefusal(t, "unreadable body", w, "request")
		if strings.Contains(w.Body.String(), "reach the APISIX Admin API") {
			t.Errorf("an unreadable request is reported as an unreachable APISIX: %s", w.Body)
		}
	}
	if strings.Contains(logs.String(), "cannot reach the APISIX Admin API") {
		t.Errorf("logged as an unreachable APISIX:\n%s", logs)
	}
}

// ErrorHandler reads the body's error while the transport may still be reading the body in another
// goroutine; `go test -race` reports an unguarded field.
func TestInboundBodyErrorIsSafeToReadWhileTheBodyIsRead(t *testing.T) {
	body := &inboundBody{ReadCloser: io.NopCloser(&failingBody{})}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = io.ReadAll(body)
	}()
	for range 1000 {
		_ = body.failure()
	}
	<-done
	if err := body.failure(); err == nil || !strings.Contains(err.Error(), "i/o timeout") {
		t.Errorf("failure() = %v, want the read error", err)
	}
}
