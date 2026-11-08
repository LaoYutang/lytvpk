// lytvpk-relay exposes a bounded fallback for the project's fixed Worker APIs.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/panjf2000/ants/v2"

	"lytvpk-relay/internal/relay"
)

var version = "dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "lytvpk-relay:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	config := relay.DefaultConfig()
	flags := flag.NewFlagSet("lytvpk-relay", flag.ContinueOnError)
	listen := flags.String("listen", "127.0.0.1:18080", "API listen address (IP:port)")
	adminListen := flags.String("admin-listen", "127.0.0.1:18081", "loopback-only administration address (IP:port)")
	trustedProxies := flags.String("trusted-proxies", "", "comma-separated trusted proxy CIDRs; empty trusts no proxy")
	flags.StringVar(&config.RealIPHeader, "real-ip-header", config.RealIPHeader, "trusted single-address header: X-Real-IP or CF-Connecting-IP")
	flags.Float64Var(&config.PerClientRatePerMinute, "client-rate", config.PerClientRatePerMinute, "requests per client per minute")
	flags.IntVar(&config.PerClientBurst, "client-burst", config.PerClientBurst, "requests allowed in a client burst")
	flags.Float64Var(&config.GlobalRatePerMinute, "global-rate", config.GlobalRatePerMinute, "total requests per minute")
	flags.IntVar(&config.GlobalBurst, "global-burst", config.GlobalBurst, "requests allowed in a global burst")
	flags.IntVar(&config.MaxClients, "max-clients", config.MaxClients, "maximum tracked rate-limit identities")
	flags.DurationVar(&config.ClientIdleTTL, "client-idle-ttl", config.ClientIdleTTL, "idle period before client buckets can be reclaimed")
	flags.IntVar(&config.MaxConcurrent, "max-concurrent", config.MaxConcurrent, "maximum concurrent upstream requests")
	flags.IntVar(&config.MaxConcurrentPerClient, "max-concurrent-per-client", config.MaxConcurrentPerClient, "maximum concurrent upstream requests per client")
	flags.IntVar(&config.MaxQueued, "max-queued", config.MaxQueued, "maximum requests waiting for upstream capacity; zero with max-queued-per-client disables queuing")
	flags.IntVar(&config.MaxQueuedPerClient, "max-queued-per-client", config.MaxQueuedPerClient, "maximum queued requests per client; zero with max-queued disables queuing")
	flags.DurationVar(&config.QueueTimeout, "queue-timeout", config.QueueTimeout, "maximum wait for upstream capacity")
	flags.DurationVar(&config.RequestTimeout, "request-timeout", config.RequestTimeout, "total request budget including body, queue and upstream; at most 10s")
	flags.DurationVar(&config.UpstreamTimeout, "upstream-timeout", config.UpstreamTimeout, "upstream request timeout")
	flags.StringVar(&config.StatsFile, "stats-file", "/var/lib/lytvpk-relay/stats.sqlite3", "persistent SQLite statistics path; empty disables persistence")
	flags.DurationVar(&config.StatsFlushInterval, "stats-flush-interval", config.StatsFlushInterval, "interval between statistics checkpoints")
	flags.Int64Var(&config.MaxBodyBytes, "max-body-bytes", config.MaxBodyBytes, "maximum request body size in bytes")
	flags.Int64Var(&config.MaxResponseBytes, "max-response-bytes", config.MaxResponseBytes, "maximum upstream response size in bytes")
	flags.IntVar(&config.MaxParseIDs, "max-parse-ids", config.MaxParseIDs, "maximum IDs in one parse request")
	showVersion := flags.Bool("version", false, "print build version and exit")
	for _, name := range []string{
		"listen", "admin-listen", "trusted-proxies", "real-ip-header", "client-rate", "client-burst",
		"global-rate", "global-burst", "max-clients", "client-idle-ttl", "max-concurrent",
		"max-concurrent-per-client", "max-queued", "max-queued-per-client", "queue-timeout", "request-timeout",
		"upstream-timeout", "stats-file", "stats-flush-interval", "max-body-bytes", "max-response-bytes", "max-parse-ids",
	} {
		envName := "RELAY_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
		if value, present := os.LookupEnv(envName); present {
			if err := flags.Set(name, value); err != nil {
				return fmt.Errorf("invalid %s", envName)
			}
		}
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("positional arguments are not supported")
	}
	if *showVersion {
		fmt.Println("lytvpk-relay", version)
		return nil
	}
	apiAddress, err := parseListenAddress(*listen, false)
	if err != nil {
		return fmt.Errorf("API address: %w", err)
	}
	adminAddress, err := parseListenAddress(*adminListen, true)
	if err != nil {
		return fmt.Errorf("admin address: %w", err)
	}
	if apiAddress == adminAddress {
		return errors.New("API and admin addresses must differ")
	}
	if *trustedProxies != "" {
		for _, raw := range strings.Split(*trustedProxies, ",") {
			prefix, err := netip.ParsePrefix(strings.TrimSpace(raw))
			if err != nil || prefix.Addr().Zone() != "" {
				return errors.New("trusted-proxies must contain valid CIDRs")
			}
			config.TrustedProxies = append(config.TrustedProxies, prefix.Masked())
		}
	}
	handler, err := relay.New(config)
	if err != nil {
		return fmt.Errorf("configuration: %w", err)
	}
	apiListener, err := net.Listen("tcp", apiAddress.String())
	if err != nil {
		return fmt.Errorf("listen on API address: %w", err)
	}
	defer apiListener.Close()
	adminListener, err := net.Listen("tcp", adminAddress.String())
	if err != nil {
		return fmt.Errorf("listen on admin address: %w", err)
	}
	defer adminListener.Close()
	api := newHTTPServer(handler, config.RequestTimeout)
	admin := newHTTPServer(handler.AdminHandler(), config.RequestTimeout)
	pool, err := ants.NewPool(3, ants.WithNonblocking(true))
	if err != nil {
		return fmt.Errorf("create server pool: %w", err)
	}
	defer pool.Release()
	maintenanceCtx, cancelMaintenance := context.WithCancel(context.Background())
	defer cancelMaintenance()
	maintenanceDone := make(chan struct{})
	if err := pool.Submit(func() {
		defer close(maintenanceDone)
		handler.RunMaintenance(maintenanceCtx)
	}); err != nil {
		return fmt.Errorf("start statistics maintenance: %w", err)
	}
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveErrors := make(chan error, 2)
	for _, endpoint := range []struct {
		server   *http.Server
		listener net.Listener
	}{{api, apiListener}, {admin, adminListener}} {
		if err := pool.Submit(func() { serveErrors <- endpoint.server.Serve(endpoint.listener) }); err != nil {
			api.Close()
			admin.Close()
			return fmt.Errorf("start server: %w", err)
		}
	}
	fmt.Fprintf(os.Stderr, "lytvpk-relay %s listening on %s (admin %s)\n", version, apiAddress, adminAddress)
	var serveErr error
	select {
	case <-signalCtx.Done():
	case serveErr = <-serveErrors:
	}
	// Allow a second signal to terminate immediately while draining requests.
	stop()
	shutdownContext, cancel := context.WithTimeout(context.Background(), config.RequestTimeout+2*time.Second)
	defer cancel()
	var shutdownErr error
	for _, server := range []*http.Server{api, admin} {
		if err := server.Shutdown(shutdownContext); err != nil {
			server.Close()
			shutdownErr = errors.Join(shutdownErr, err)
		}
	}
	// Keep recording drained requests before the final checkpoint. A slow or
	// broken storage device must not hold the process open indefinitely.
	cancelMaintenance()
	maintenanceTimer := time.NewTimer(time.Second)
	defer maintenanceTimer.Stop()
	select {
	case <-maintenanceDone:
	case <-maintenanceTimer.C:
		fmt.Fprintln(os.Stderr, "lytvpk-relay: statistics maintenance exceeded the shutdown wait")
	}
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		return fmt.Errorf("HTTP server: %w", serveErr)
	}
	if shutdownErr != nil {
		return fmt.Errorf("graceful shutdown: %w", shutdownErr)
	}
	return nil
}

func parseListenAddress(raw string, loopbackOnly bool) (netip.AddrPort, error) {
	address, err := netip.ParseAddrPort(raw)
	if err != nil || address.Addr().Zone() != "" || address.Port() == 0 {
		return netip.AddrPort{}, errors.New("must be an IP literal and port between 1 and 65535")
	}
	address = netip.AddrPortFrom(address.Addr().Unmap(), address.Port())
	if loopbackOnly && !address.Addr().IsLoopback() {
		return netip.AddrPort{}, errors.New("must bind a loopback IP")
	}
	return address, nil
}

func newHTTPServer(handler http.Handler, requestTimeout time.Duration) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: min(5*time.Second, requestTimeout),
		ReadTimeout:       requestTimeout,
		WriteTimeout:      requestTimeout,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
}
