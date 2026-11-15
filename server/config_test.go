package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// env returns a getenv over a fixed map: unset names read as "".
func env(vars map[string]string) func(string) string {
	return func(name string) string { return vars[name] }
}

// writeFile writes content to a new file in a temp dir and returns its path.
func writeFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func mustLoad(t *testing.T, vars map[string]string) Config {
	t.Helper()
	cfg, err := loadConfig(env(vars))
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	return cfg
}

func loadErr(t *testing.T, vars map[string]string) string {
	t.Helper()
	_, err := loadConfig(env(vars))
	if err == nil {
		t.Fatalf("loadConfig(%v): want an error, got none", vars)
	}
	return err.Error()
}

const adminURL = "http://apisix:9180"

func TestConfigNeedsAdminURL(t *testing.T) {
	msg := loadErr(t, map[string]string{})
	if !strings.Contains(msg, "APISIX_ADMIN_URL") {
		t.Errorf("error %q does not name APISIX_ADMIN_URL", msg)
	}
}

func TestConfigRejectsAdminURLsThatAreNotPlainHTTP(t *testing.T) {
	for _, bad := range []string{
		"ftp://apisix:9180",
		"apisix:9180",
		"//apisix:9180",
		"http://",
		"http://apisix:9180?x=1",
		"http://apisix:9180#frag",
		"http://user:pass@apisix:9180",
		"http://apisix:9180/a b",
	} {
		msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": bad})
		if !strings.Contains(msg, "APISIX_ADMIN_URL") {
			t.Errorf("%q: error %q does not name APISIX_ADMIN_URL", bad, msg)
		}
	}
}

func TestConfigAdminURLDropsTrailingSlashAndAdminPath(t *testing.T) {
	cases := map[string]string{
		"http://apisix:9180":                     "http://apisix:9180",
		"http://apisix:9180/":                    "http://apisix:9180",
		"https://apisix:9180/apisix/admin/":      "https://apisix:9180",
		"http://gw.example/prefix/apisix/admin":  "http://gw.example/prefix",
		"  http://apisix:9180  ":                 "http://apisix:9180",
		"HTTP://APISIX:9180":                     "http://apisix:9180",
		"http://[fd00::5]:9180/":                 "http://[fd00::5]:9180",
		"http://apisix:9180/apisix/admin/routes": "http://apisix:9180/apisix/admin/routes",
	}
	for in, want := range cases {
		cfg := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": in})
		if got := cfg.AdminURL.String(); got != want {
			t.Errorf("%q: AdminURL = %q, want %q", in, got, want)
		}
	}
}

func TestConfigListenDefaultsAndValidates(t *testing.T) {
	if got := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL}).Listen; got != ":8080" {
		t.Errorf("default Listen = %q, want :8080", got)
	}
	for _, ok := range []string{":9000", "127.0.0.1:8080", "[::]:8080", "0.0.0.0:1"} {
		if got := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "LISTEN": ok}).Listen; got != ok {
			t.Errorf("Listen = %q, want %q", got, ok)
		}
	}
	for _, bad := range []string{"8080", ":http", ":0", ":65536", "localhost", "1.2.3.4:"} {
		msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "LISTEN": bad})
		if !strings.Contains(msg, "LISTEN") {
			t.Errorf("%q: error %q does not name LISTEN", bad, msg)
		}
	}
}

func TestConfigKeyFromEnvOrFile(t *testing.T) {
	if got := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL}).AdminKey; got != "" {
		t.Errorf("no key set: AdminKey = %q, want empty", got)
	}
	if got := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "APISIX_ADMIN_KEY": " env-key\n"}).AdminKey; got != "env-key" {
		t.Errorf("AdminKey = %q, want env-key (trimmed)", got)
	}
	file := writeFile(t, "\n  file-key \n\n")
	cfg := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "APISIX_ADMIN_KEY": "env-key", "APISIX_ADMIN_KEY_FILE": file})
	if cfg.AdminKey != "file-key" {
		t.Errorf("file and env set: AdminKey = %q, want file-key (the file wins, trimmed)", cfg.AdminKey)
	}
}

func TestConfigKeyFileProblemsAreErrors(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "APISIX_ADMIN_KEY_FILE": missing})
	if !strings.Contains(msg, "APISIX_ADMIN_KEY_FILE") {
		t.Errorf("unreadable file: error %q does not name APISIX_ADMIN_KEY_FILE", msg)
	}
	msg = loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "APISIX_ADMIN_KEY_FILE": writeFile(t, " \n")})
	if !strings.Contains(msg, "empty") {
		t.Errorf("empty file: error %q does not say it is empty", msg)
	}
}

func TestConfigKeyThatCannotBeAHeaderIsAnErrorThatDoesNotRepeatIt(t *testing.T) {
	msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "APISIX_ADMIN_KEY": "top\nsecret"})
	if strings.Contains(msg, "secret") {
		t.Errorf("error %q repeats the key", msg)
	}
	loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "APISIX_ADMIN_KEY_FILE": writeFile(t, "a\x00b")})
}

func TestConfigBasicAuth(t *testing.T) {
	cfg := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL})
	if cfg.basicAuth() {
		t.Error("basic auth on without BASIC_AUTH_*")
	}
	cfg = mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "pw"})
	if !cfg.basicAuth() || cfg.BasicUser != "ops" || cfg.BasicPassword != "pw" {
		t.Errorf("basic auth = %v %q %q, want on ops pw", cfg.basicAuth(), cfg.BasicUser, cfg.BasicPassword)
	}
	file := writeFile(t, "from-file\n")
	cfg = mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "pw", "BASIC_AUTH_PASSWORD_FILE": file})
	if cfg.BasicPassword != "from-file" {
		t.Errorf("password = %q, want from-file (the file wins, trimmed)", cfg.BasicPassword)
	}
	cfg = mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD_FILE": file})
	if cfg.BasicPassword != "from-file" {
		t.Errorf("password = %q, want from-file", cfg.BasicPassword)
	}
}

func TestConfigBasicAuthHalfConfiguredIsAnError(t *testing.T) {
	for _, vars := range []map[string]string{
		{"BASIC_AUTH_USER": "ops"},
		{"BASIC_AUTH_PASSWORD": "pw"},
		{"BASIC_AUTH_PASSWORD_FILE": writeFile(t, "pw")},
	} {
		vars["APISIX_ADMIN_URL"] = adminURL
		msg := loadErr(t, vars)
		if !strings.Contains(msg, "BASIC_AUTH_USER") || !strings.Contains(msg, "BASIC_AUTH_PASSWORD") {
			t.Errorf("%v: error %q does not name both variables", vars, msg)
		}
	}
	loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "o:ps", "BASIC_AUTH_PASSWORD": "pw"})
	loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD_FILE": writeFile(t, "\n")})
	loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD_FILE": filepath.Join(t.TempDir(), "nope")})
}

func TestConfigAllowedHosts(t *testing.T) {
	cfg := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL})
	if cfg.AnyHost || len(cfg.AllowedHosts) != 0 {
		t.Errorf("default: AnyHost %v, AllowedHosts %v; want false, none", cfg.AnyHost, cfg.AllowedHosts)
	}
	cfg = mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "ALLOWED_HOSTS": " Apisix-Admin.example.com, , gw.internal "})
	if want := []string{"apisix-admin.example.com", "gw.internal"}; !slices.Equal(cfg.AllowedHosts, want) || cfg.AnyHost {
		t.Errorf("AllowedHosts = %v (AnyHost %v), want %v", cfg.AllowedHosts, cfg.AnyHost, want)
	}
	if cfg := mustLoad(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "ALLOWED_HOSTS": "*"}); !cfg.AnyHost {
		t.Error("ALLOWED_HOSTS=* does not turn the check off")
	}
	for _, bad := range []string{"admin.example.com:8080", "https://admin.example.com", "admin example", "a/b", "*, admin.example.com"} {
		msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "ALLOWED_HOSTS": bad})
		if !strings.Contains(msg, "ALLOWED_HOSTS") {
			t.Errorf("%q: error %q does not name ALLOWED_HOSTS", bad, msg)
		}
	}
}
