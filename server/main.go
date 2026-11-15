// Command apiseven serves the apiseven web app and proxies the APISIX Admin API under
// /apisix/admin, so the browser needs no direct access to APISIX. Configuration is by
// environment variable; see the README.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// embedded holds dist/, a copy of web/dist made by `make build` or the Dockerfile.
//
//go:embed all:dist
var embedded embed.FS

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	dist, err := fs.Sub(embedded, "dist")
	if err != nil {
		fmt.Fprintln(stderr, "apiseven:", err)
		return 2
	}
	return runWith(args, getenv, stdout, stderr, dist)
}

// runWith is run with the web build passed in. Exit codes: 0 done, 1 failure, 2 bad configuration.
func runWith(args []string, getenv func(string) string, stdout, stderr io.Writer, dist fs.FS) int {
	flags := flag.NewFlagSet("apiseven", flag.ContinueOnError)
	flags.SetOutput(stderr)
	check := flags.Bool("healthcheck", false, "request /healthz from the server at LISTEN; exit 0 when healthy, 1 otherwise")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *check {
		listen, err := parseListen(getenv("LISTEN"))
		if err != nil {
			fmt.Fprintln(stderr, "apiseven:", err)
			return 1
		}
		return healthcheck(healthcheckAddr(listen), stderr)
	}

	cfg, err := loadConfig(getenv)
	if err != nil {
		fmt.Fprintln(stderr, "apiseven:", err)
		return 2
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		fmt.Fprintln(stderr, "apiseven: this binary was built without the web app (dist/index.html is missing); build it with `make build` or the Dockerfile")
		return 2
	}
	logger := slog.New(slog.NewTextHandler(stdout, nil))
	logStartup(logger, cfg)

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		logger.Error("cannot listen", "listen", cfg.Listen, "error", err.Error())
		return 1
	}
	srv := &http.Server{
		Handler:           newHandler(cfg, dist, logger),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	select {
	case err := <-served:
		logger.Error("server stopped", "error", err.Error())
		return 1
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		logger.Error("shutdown", "error", err.Error())
		return 1
	}
	return 0
}

// logStartup says how the server is set up, never with the key or the Basic auth credentials.
func logStartup(logger *slog.Logger, cfg Config) {
	key := "browser"
	if cfg.AdminKey != "" {
		key = "server"
	}
	auth := "off"
	if cfg.basicAuth() {
		auth = "on"
	}
	hosts := "IP addresses, localhost"
	switch {
	case cfg.basicAuth():
		hosts = "any (basic auth is on)"
	case cfg.AnyHost:
		hosts = "any (ALLOWED_HOSTS=*)"
	case len(cfg.AllowedHosts) > 0:
		hosts += ", " + strings.Join(cfg.AllowedHosts, ", ")
	}
	logger.Info("apiseven starting", "listen", cfg.Listen, "admin_url", cfg.AdminURL.String(),
		"admin_key", key, "basic_auth", auth, "allowed_hosts", hosts)
	if cfg.AdminKey != "" && !cfg.basicAuth() {
		logger.Warn("WARNING: the Admin API key is set on the server and basic auth is off: anyone who can reach " +
			"this port has full Admin API access. Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, or keep the port private.")
	}
}

// healthcheckAddr is where -healthcheck finds the server: LISTEN, with a wildcard host made loopback.
func healthcheckAddr(listen string) string {
	host, port, _ := net.SplitHostPort(listen)
	switch host {
	case "", "0.0.0.0":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	}
	return net.JoinHostPort(host, port)
}

// healthcheck is for the container's health check: distroless has no shell, curl or wget.
func healthcheck(addr string, stderr io.Writer) int {
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}}
	res, err := client.Get("http://" + addr + "/healthz")
	if err != nil {
		fmt.Fprintln(stderr, "apiseven: health check failed:", err)
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(stderr, "apiseven: health check failed:", res.Status)
		return 1
	}
	return 0
}
