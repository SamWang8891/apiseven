package main

import (
	"bytes"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func startupLines(t *testing.T, vars map[string]string) []string {
	t.Helper()
	var out bytes.Buffer
	logStartup(slog.New(slog.NewTextHandler(&out, nil)), testConfig(t, adminURL, vars))
	return strings.Split(strings.TrimSpace(out.String()), "\n")
}

func TestWarningExactlyWhenServerKeyWithoutBasicAuth(t *testing.T) {
	for _, tc := range []struct {
		vars map[string]string
		warn bool
	}{
		{map[string]string{}, false},
		{map[string]string{"APISIX_ADMIN_KEY": serverKey}, true},
		{map[string]string{"APISIX_ADMIN_KEY": serverKey, "ALLOWED_HOSTS": "*"}, true},
		{map[string]string{"APISIX_ADMIN_KEY": serverKey, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "pw"}, false},
		{map[string]string{"BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "pw"}, false},
	} {
		lines := startupLines(t, tc.vars)
		warnings := 0
		for _, line := range lines {
			if strings.Contains(line, "WARNING") {
				warnings++
				if !strings.Contains(line, "level=WARN") || !strings.Contains(line, "full Admin API access") {
					t.Errorf("%v: warning line %q", tc.vars, line)
				}
			}
			for _, secret := range []string{serverKey, "pw"} {
				if strings.Contains(line, "="+secret) || strings.Contains(line, secret+" ") {
					t.Errorf("%v: startup line %q holds a secret", tc.vars, line)
				}
			}
		}
		if want := map[bool]int{true: 1, false: 0}[tc.warn]; warnings != want {
			t.Errorf("%v: %d WARNING lines, want %d:\n%s", tc.vars, warnings, want, strings.Join(lines, "\n"))
		}
	}
}

func TestStartupLogDescribesTheSetupWithoutSecrets(t *testing.T) {
	lines := startupLines(t, map[string]string{"APISIX_ADMIN_KEY": serverKey, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "pw-secret"})
	all := strings.Join(lines, "\n")
	for _, want := range []string{"listen=:8080", "admin_url=http://apisix:9180", "admin_key=server", "basic_auth=on"} {
		if !strings.Contains(all, want) {
			t.Errorf("startup log lacks %q:\n%s", want, all)
		}
	}
	for _, secret := range []string{serverKey, "pw-secret", "ops"} {
		if strings.Contains(all, secret) {
			t.Errorf("startup log holds %q:\n%s", secret, all)
		}
	}
}

func TestRunFailsFastOnBadConfig(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run(nil, env(map[string]string{"APISIX_ADMIN_URL": "http://admin:" + serverKey + "@apisix:9180", "APISIX_ADMIN_KEY": serverKey}), &stdout, &stderr)
	if code != 2 {
		t.Errorf("exit code %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "APISIX_ADMIN_URL") {
		t.Errorf("stderr %q does not name the variable", stderr.String())
	}
	if strings.Contains(stderr.String()+stdout.String(), serverKey) {
		t.Error("the error output holds the key")
	}
}

func TestRunRefusesABinaryWithoutTheWebApp(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := runWith(nil, env(map[string]string{"APISIX_ADMIN_URL": adminURL, "LISTEN": "127.0.0.1:1"}), &stdout, &stderr, emptyDist{})
	if code != 2 || !strings.Contains(stderr.String(), "index.html") {
		t.Errorf("exit %d, stderr %q; want 2 and a message about index.html", code, stderr.String())
	}
}

func TestHealthcheckFlag(t *testing.T) {
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			_, _ = w.Write([]byte("ok"))
			return
		}
		http.NotFound(w, r)
	}))
	defer healthy.Close()
	sick := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusServiceUnavailable)
	}))
	defer sick.Close()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closed := l.Addr().String()
	_ = l.Close()

	for _, tc := range []struct {
		listen string
		want   int
	}{
		{mustParse(t, healthy.URL).Host, 0},
		{":" + mustParse(t, healthy.URL).Port(), 0},
		{"0.0.0.0:" + mustParse(t, healthy.URL).Port(), 0},
		{mustParse(t, sick.URL).Host, 1},
		{closed, 1},
	} {
		var stdout, stderr bytes.Buffer
		// No APISIX_ADMIN_URL: the health check needs only LISTEN.
		if got := run([]string{"-healthcheck"}, env(map[string]string{"LISTEN": tc.listen}), &stdout, &stderr); got != tc.want {
			t.Errorf("-healthcheck with LISTEN=%s: exit %d, want %d (stderr %q)", tc.listen, got, tc.want, stderr.String())
		}
	}
}

func TestHealthcheckAddress(t *testing.T) {
	for listen, want := range map[string]string{
		":8080":          "127.0.0.1:8080",
		"0.0.0.0:8080":   "127.0.0.1:8080",
		"[::]:8080":      "[::1]:8080",
		"127.0.0.1:9000": "127.0.0.1:9000",
		"[::1]:9000":     "[::1]:9000",
		"10.1.2.3:80":    "10.1.2.3:80",
	} {
		if got := healthcheckAddr(listen); got != want {
			t.Errorf("healthcheckAddr(%q) = %q, want %q", listen, got, want)
		}
	}
}

// emptyDist is a web build with no files at all.
type emptyDist struct{}

func (emptyDist) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}
