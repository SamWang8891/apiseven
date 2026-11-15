package main

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config is the server's settings, read once from the environment at start. Every variable is
// checked there: a value that is missing or malformed stops the server with a message naming it.
type Config struct {
	// AdminURL is the APISIX Admin API (APISIX_ADMIN_URL) without a trailing /apisix/admin.
	AdminURL *url.URL
	// AdminKey is injected as X-API-KEY on every proxied request; empty means the browser sends its own.
	AdminKey string
	// Listen is the address to listen on (LISTEN, default :8080).
	Listen string
	// BasicUser and BasicPassword turn on HTTP Basic auth in front of everything but /healthz.
	BasicUser, BasicPassword string
	// AllowedHosts are the host names (lower case, no port) accepted besides IP literals and localhost.
	AllowedHosts []string
	// AnyHost turns the Host check off (ALLOWED_HOSTS=*).
	AnyHost bool
}

func (c Config) basicAuth() bool { return c.BasicUser != "" }

// loadConfig reads the configuration through getenv (os.Getenv in production).
func loadConfig(getenv func(string) string) (Config, error) {
	var cfg Config
	var err error
	if cfg.AdminURL, err = parseAdminURL(getenv("APISIX_ADMIN_URL")); err != nil {
		return Config{}, err
	}
	if cfg.Listen, err = parseListen(getenv("LISTEN")); err != nil {
		return Config{}, err
	}
	if cfg.AdminKey, err = secret(getenv, "APISIX_ADMIN_KEY"); err != nil {
		return Config{}, err
	}
	if err = loadBasicAuth(getenv, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.AllowedHosts, cfg.AnyHost, err = parseAllowedHosts(getenv("ALLOWED_HOSTS")); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func parseAdminURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("APISIX_ADMIN_URL is required: the APISIX Admin API address, such as http://apisix:9180")
	}
	bad := func(why string) error {
		return fmt.Errorf("APISIX_ADMIN_URL %q: %s; use an address such as http://apisix:9180", raw, why)
	}
	if strings.ContainsFunc(raw, func(r rune) bool { return r <= ' ' || r == 0x7f }) {
		return nil, bad("it contains spaces or control characters")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, bad("not a URL")
	}
	switch {
	case u.Scheme != "http" && u.Scheme != "https":
		return nil, bad("the scheme must be http or https")
	case u.Host == "" || u.Hostname() == "":
		return nil, bad("no host")
	case u.User != nil:
		return nil, bad("credentials in the URL are not supported (the key goes in APISIX_ADMIN_KEY)")
	case u.RawQuery != "" || u.ForceQuery || u.Fragment != "":
		return nil, bad("a query or fragment is not allowed")
	}
	u.Host = strings.ToLower(u.Host)
	// The Admin API lives under /apisix/admin; the proxy adds that itself, as the Connect page does.
	u.Path = strings.TrimRight(strings.TrimSuffix(strings.TrimRight(u.Path, "/"), "/apisix/admin"), "/")
	u.RawPath = ""
	return u, nil
}

func parseListen(raw string) (string, error) {
	if raw == "" {
		return ":8080", nil
	}
	_, port, err := net.SplitHostPort(raw)
	if n, perr := strconv.Atoi(port); err != nil || perr != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("LISTEN %q: want host:port or :port with a port from 1 to 65535, such as :8080", raw)
	}
	return raw, nil
}

// secret reads NAME_FILE (which wins; its contents trimmed) or NAME (trimmed). Empty means unset,
// except for a file: a file that is named but empty or unreadable is an error. A value that cannot
// travel in an HTTP header is an error too; no error message repeats the value.
func secret(getenv func(string) string, name string) (string, error) {
	value := strings.TrimSpace(getenv(name))
	source := name
	if file := getenv(name + "_FILE"); file != "" {
		source = name + "_FILE"
		data, err := os.ReadFile(file)
		if err != nil {
			return "", fmt.Errorf("%s: cannot read %s: %v", source, file, errors.Unwrap(err))
		}
		if value = strings.TrimSpace(string(data)); value == "" {
			return "", fmt.Errorf("%s: %s is empty", source, file)
		}
	}
	if strings.ContainsFunc(value, func(r rune) bool { return r < ' ' && r != '\t' || r == 0x7f }) {
		return "", fmt.Errorf("%s: the value contains control characters (such as a line break inside it)", source)
	}
	return value, nil
}

func loadBasicAuth(getenv func(string) string, cfg *Config) error {
	user := getenv("BASIC_AUTH_USER")
	password, err := secret(getenv, "BASIC_AUTH_PASSWORD")
	if err != nil {
		return err
	}
	if (user == "") != (password == "") {
		return errors.New("BASIC_AUTH_USER and BASIC_AUTH_PASSWORD (or BASIC_AUTH_PASSWORD_FILE) must be set together, or neither")
	}
	if strings.ContainsFunc(user, func(r rune) bool { return r == ':' || r < ' ' || r == 0x7f }) {
		return errors.New("BASIC_AUTH_USER: a user name cannot contain a colon or control characters")
	}
	cfg.BasicUser, cfg.BasicPassword = user, password
	return nil
}

// parseAllowedHosts reads a comma-separated list of host names; `*` alone turns the check off.
func parseAllowedHosts(raw string) (hosts []string, anyHost bool, err error) {
	for _, entry := range strings.Split(raw, ",") {
		name := strings.ToLower(strings.TrimSpace(entry))
		switch {
		case name == "":
			continue
		case name == "*":
			anyHost = true
		case !isHostName(name):
			return nil, false, fmt.Errorf("ALLOWED_HOSTS: %q is not a host name; list names without scheme or port, such as apisix-admin.example.com", entry)
		default:
			hosts = append(hosts, name)
		}
	}
	if anyHost && len(hosts) > 0 {
		return nil, false, errors.New("ALLOWED_HOSTS: * allows every host, so it cannot be combined with names")
	}
	return hosts, anyHost, nil
}

func isHostName(name string) bool {
	return !strings.ContainsFunc(name, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '.' || r == '_')
	})
}
