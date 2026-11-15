package main

import (
	"fmt"
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
		"http://apisix:9180":                    "http://apisix:9180",
		"http://apisix:9180/":                   "http://apisix:9180",
		"https://apisix:9180/apisix/admin/":     "https://apisix:9180",
		"http://gw.example/prefix/apisix/admin": "http://gw.example/prefix",
		"  http://apisix:9180  ":                "http://apisix:9180",
		"HTTP://APISIX:9180":                    "http://apisix:9180",
		"http://[fd00::5]:9180/":                "http://[fd00::5]:9180",
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

func TestConfigAdminURLPastTheAdminPathIsAnError(t *testing.T) {
	for _, bad := range []string{"http://apisix:9180/apisix/admin/routes", "http://gw/x/apisix/admin/routes/"} {
		msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": bad})
		if !strings.Contains(msg, "APISIX_ADMIN_URL") || !strings.Contains(msg, "/apisix/admin") {
			t.Errorf("%q: error %q does not say what to pass", bad, msg)
		}
	}
}

// Each rejected form of APISIX_ADMIN_URL that can carry a secret (credentials, an api_key argument,
// a fragment, or text that does not parse at all): the error names the variable and the reason, at
// most scheme://host[:port], and never the secret.
func TestConfigAdminURLErrorsNeverRepeatTheSecret(t *testing.T) {
	for _, bad := range []string{
		"http://admin:TOPSECRETPW@apisix:9180",
		"http://TOPSECRETPW@apisix:9180",
		"https://admin:TOPSECRETPW@apisix:9180/apisix/admin",
		"ftp://admin:TOPSECRETPW@apisix:9180",
		"http://apisix:9180/?api_key=TOPSECRETKEY",
		"http://apisix:9180/apisix/admin?api_key=TOPSECRETKEY#TOPSECRETFRAG",
		"http://apisix:9180/#TOPSECRETFRAG",
		"http://apisix:9180/TOPSECRETPATH/apisix/admin/routes",
		"apisix:TOPSECRETPW",
		"http://apisix:9180/ TOPSECRETPW",
		"http://[::1:TOPSECRETPW",
		"http://admin:TOPSECRETPW@",
		"//admin:TOPSECRETPW@apisix:9180",
	} {
		msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": bad})
		if strings.Contains(msg, "TOPSECRET") {
			t.Errorf("%q: the error repeats a secret: %q", bad, msg)
		}
		if !strings.Contains(msg, "APISIX_ADMIN_URL") {
			t.Errorf("%q: error %q does not name APISIX_ADMIN_URL", bad, msg)
		}
	}
	msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": "http://admin:TOPSECRETPW@apisix:9180?api_key=TOPSECRETKEY"})
	if !strings.Contains(msg, "http://apisix:9180") {
		t.Errorf("error %q does not name scheme://host:port, which is safe to show", msg)
	}
}

// The key, the Basic auth pair and their _FILE forms: an error names the variable (and the file),
// never what it holds.
func TestConfigSecretErrorsNeverRepeatTheValue(t *testing.T) {
	for _, vars := range []map[string]string{
		{"APISIX_ADMIN_KEY": "a\nTOPSECRET"},
		{"APISIX_ADMIN_KEY_FILE": writeFile(t, "a\x00TOPSECRET")},
		{"BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD": "x\x01TOPSECRET"},
		{"BASIC_AUTH_USER": "ops", "BASIC_AUTH_PASSWORD_FILE": writeFile(t, "x\x7fTOPSECRET")},
		{"BASIC_AUTH_USER": "ops:TOPSECRET", "BASIC_AUTH_PASSWORD": "pw"},
		{"BASIC_AUTH_PASSWORD": "TOPSECRET"},
		{"BASIC_AUTH_PASSWORD_FILE": writeFile(t, "TOPSECRET")},
		{"BASIC_AUTH_USER": "TOPSECRET"},
	} {
		vars["APISIX_ADMIN_URL"] = adminURL
		if msg := loadErr(t, vars); strings.Contains(msg, "TOPSECRET") {
			t.Errorf("%v: the error repeats a secret: %q", vars, msg)
		}
	}
}

func TestConfigUnreadableFileNamesTheUserTheServerRunsAs(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("root reads any file")
	}
	path := writeFile(t, "TOPSECRET")
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"APISIX_ADMIN_KEY_FILE", "BASIC_AUTH_PASSWORD_FILE"} {
		vars := map[string]string{"APISIX_ADMIN_URL": adminURL, name: path, "BASIC_AUTH_USER": "ops"}
		msg := loadErr(t, vars)
		want := fmt.Sprintf("cannot be read as UID %d", os.Getuid())
		if !strings.Contains(msg, name) || !strings.Contains(msg, want) || strings.Contains(msg, path) || strings.Contains(msg, "TOPSECRET") {
			t.Errorf("%s: error %q should name the variable and say %q, without the path or the content", name, msg, want)
		}
	}
}

// A _FILE variable's value is never repeated, not even when it is an absolute path: a secret pasted
// there can start with "/" (base64 can). Each error names the variable and the reason only.
func TestConfigFileVariableValueIsNeverRepeated(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "TOPSECRET")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	empty := filepath.Join(dir, "empty")
	if err := os.WriteFile(empty, []byte(" \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := []struct{ value, reason string }{
		{"/q7Z9eX+TOPSECRET/k2Lw==", "the file it names does not exist"},
		{filepath.Join(dir, "missing"), "the file it names does not exist"},
		{empty, "the file it names is empty"},
		{dir, fmt.Sprintf("the file it names cannot be read as UID %d", os.Getuid())},
	}
	if os.Getuid() != 0 {
		locked := filepath.Join(dir, "locked")
		if err := os.WriteFile(locked, []byte("pw"), 0); err != nil {
			t.Fatal(err)
		}
		cases = append(cases, struct{ value, reason string }{locked, fmt.Sprintf("the file it names cannot be read as UID %d", os.Getuid())})
	}
	for _, tc := range cases {
		for _, name := range []string{"APISIX_ADMIN_KEY_FILE", "BASIC_AUTH_PASSWORD_FILE"} {
			msg := loadErr(t, map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "ops", name: tc.value})
			if strings.Contains(msg, "TOPSECRET") || strings.Contains(msg, tc.value) {
				t.Errorf("%s=%q: the error repeats the value: %q", name, tc.value, msg)
			}
			if !strings.HasPrefix(msg, name+": ") || !strings.Contains(msg, tc.reason) {
				t.Errorf("%s=%q: error %q should name the variable and say %q", name, tc.value, msg, tc.reason)
			}
		}
	}
}

// The key itself pasted into a _FILE variable (hex, or base64 with slashes in it): anything but an
// absolute path is refused without repeating it, and the error says it takes an absolute path.
func TestConfigFileVariableHoldingAKeyIsNotRepeated(t *testing.T) {
	for _, value := range []string{"edd1c9f034335f136f87ad84b625c8f1TOPSECRET", "q7Z/9eX+TOPSECRET/k2Lw==", "./TOPSECRET/key"} {
		for _, name := range []string{"APISIX_ADMIN_KEY_FILE", "BASIC_AUTH_PASSWORD_FILE"} {
			vars := map[string]string{"APISIX_ADMIN_URL": adminURL, "BASIC_AUTH_USER": "ops", name: value}
			msg := loadErr(t, vars)
			if strings.Contains(msg, "TOPSECRET") {
				t.Errorf("%s=%q: the error repeats the value: %q", name, value, msg)
			}
			if !strings.Contains(msg, name) || !strings.Contains(msg, "absolute path to a file") {
				t.Errorf("%s=%q: error %q should name the variable and say it takes an absolute path to a file", name, value, msg)
			}
		}
	}
}
