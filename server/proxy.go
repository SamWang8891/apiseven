package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"slices"
	"strings"
	"time"
)

var proxyMethods = []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}

// maxBodyBytes bounds a proxied request body: ample for protos and certificate chains.
const maxBodyBytes = 16 << 20

const tooLarge = "apiseven: the request body is larger than 16 MiB"

// serveAdmin guards the Admin API proxy against requests the app did not make. Another web page
// can make the operator's browser send a "simple" cross-origin request here (no preflight); it
// cannot add a custom header without a preflight, which this server never grants, and a browser
// marks such a request with Origin and Sec-Fetch-Site.
func (h *handler) serveAdmin(w http.ResponseWriter, r *http.Request) {
	if hasDotSegment(r.URL.Path) {
		// nginx would resolve them, and so reach paths outside /apisix/admin (such as /ui).
		notFound(w, true)
		return
	}
	if !slices.Contains(proxyMethods, r.Method) {
		w.Header().Set("Allow", strings.Join(proxyMethods, ", "))
		refuse(w, true, http.StatusMethodNotAllowed, "method", fmt.Sprintf("apiseven: method %s is not allowed", r.Method))
		return
	}
	if msg := crossOrigin(r); msg != "" {
		refuse(w, true, http.StatusForbidden, "origin", msg)
		return
	}
	if r.Header.Get("X-Apiseven-Request") != "1" {
		refuse(w, true, http.StatusForbidden, "header", "apiseven: missing X-Apiseven-Request header")
		return
	}
	if r.ContentLength > maxBodyBytes {
		refuse(w, true, http.StatusRequestEntityTooLarge, "size", tooLarge)
		return
	}
	// A body sent without a length is cut off at the limit; ErrorHandler answers 413 then.
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	h.proxy.ServeHTTP(w, r)
}

func hasDotSegment(p string) bool {
	return slices.ContainsFunc(strings.Split(p, "/"), func(s string) bool { return s == "." || s == ".." })
}

// crossOrigin explains why a request came from another site or origin, or returns "".
func crossOrigin(r *http.Request) string {
	if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" || site == "same-site" {
		return fmt.Sprintf("apiseven: refused a request from another site (Sec-Fetch-Site: %s)", site)
	}
	if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r.Host) {
		return fmt.Sprintf("apiseven: refused a request from another origin (Origin %s, Host %s). "+
			"A reverse proxy in front of apiseven must pass the Host header through unchanged.", origin, r.Host)
	}
	return ""
}

// sameOrigin reports whether an Origin header names the host and port of the request's Host. The
// scheme is not compared: behind a TLS-terminating proxy the page is https and this server is not.
// A Host without a port matches only an Origin on its scheme's default port.
func sameOrigin(origin, host string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" && u.Scheme != "https" || u.Hostname() == "" ||
		u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false // includes "null", the origin of file:// pages and sandboxed frames
	}
	defaultPort := map[string]string{"http": "80", "https": "443"}[u.Scheme]
	originPort := u.Port()
	if originPort == "" {
		originPort = defaultPort
	}
	name, port := splitHost(host)
	if name == "" || name != strings.ToLower(u.Hostname()) {
		return false
	}
	if port == "" {
		return originPort == defaultPort
	}
	return port == originPort
}

// newProxy forwards to the Admin API: same method, path, query and body. It never forwards the
// browser's Authorization (Basic auth) or cookies; with a server key, that key replaces any the
// browser sent. APISIX's CORS headers are dropped: the app and the proxy share an origin.
func newProxy(cfg Config, logger *slog.Logger) http.Handler {
	target := cfg.AdminURL
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Never through HTTP_PROXY / HTTPS_PROXY: Docker can put them in every container, and the server's
	// key would then go to a forward proxy nobody chose for it (in clear text to an http:// Admin API).
	transport.Proxy = nil
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.ResponseHeaderTimeout = 60 * time.Second
	return &httputil.ReverseProxy{
		Transport: transport,
		// Its own messages (such as a broken answer from APISIX) hold errors, never header values.
		ErrorLog: slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			out := pr.Out.Header
			out.Del("Authorization")
			out.Del("Cookie")
			out.Del("X-Apiseven-Request")
			if cfg.AdminKey != "" {
				out.Set("X-API-KEY", cfg.AdminKey)
				// APISIX reads ?api_key= before the header (apisix/admin/init.lua, check_token).
				pr.Out.URL.RawQuery = withoutAPIKey(pr.Out.URL.RawQuery)
			}
		},
		ModifyResponse: func(res *http.Response) error {
			for name := range res.Header {
				if strings.HasPrefix(name, "Access-Control-") {
					delete(res.Header, name)
				}
			}
			for name := range securityHeaders {
				res.Header.Del(name) // already set on the response, once
			}
			res.Header.Del(refusalHeader) // only the server's own answers carry it
			if res.Header.Get("Cache-Control") == "" {
				res.Header.Set("Cache-Control", "no-store")
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				refuse(w, true, http.StatusRequestEntityTooLarge, "size", tooLarge)
				return
			}
			// Transport errors name the address, never the request's URL; unwrap one that would.
			var urlErr *url.Error
			if errors.As(err, &urlErr) {
				err = urlErr.Err
			}
			if !errors.Is(err, context.Canceled) {
				logger.Warn("cannot reach the APISIX Admin API", "admin", target.Host, "error", err.Error())
			}
			refuse(w, true, http.StatusBadGateway, "upstream", fmt.Sprintf("apiseven: cannot reach the APISIX Admin API at %s: %v", target.Host, err))
		},
	}
}

// withoutAPIKey drops every api_key argument (any case, as nginx matches $arg_api_key) and keeps
// the rest of the query exactly as sent.
func withoutAPIKey(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	var kept []string
	for _, pair := range strings.Split(rawQuery, "&") {
		name, _, _ := strings.Cut(pair, "=")
		if decoded, err := url.QueryUnescape(name); err == nil {
			name = decoded
		}
		if !strings.EqualFold(name, "api_key") {
			kept = append(kept, pair)
		}
	}
	return strings.Join(kept, "&")
}
