package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"sync"
	"time"
)

// Embedded Steam CDN IP list (Fallback)
var defaultSteamCDNIPs = []string{
	"104.116.243.163",
	"104.116.243.72",
	"2.17.107.170",
	"2.17.107.243",
	"23.192.228.147",
	"23.192.228.139",
	"23.52.74.14",
	"23.212.62.72",
	"23.212.62.73",
}

func fetchRemoteIPs(domain string) ([]string, error) {
	apiURL := fmt.Sprintf("https://lytvpk-get-ips.laoyutang.cn/?domain=%s", domain)
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.DialContext(ctx, "tcp4", addr)
			},
		},
	}

	resp, err := client.Get(apiURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status: %d", resp.StatusCode)
	}

	var ips []string
	if err := json.NewDecoder(resp.Body).Decode(&ips); err != nil {
		return nil, err
	}
	return ips, nil
}

type IPSelector struct {
	cachedBestIP string
	lastCheck    time.Time
	isSelecting  bool
	mu           sync.RWMutex
}

var globalIPSelector = &IPSelector{}

func (s *IPSelector) IsSelecting() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isSelecting
}

func (s *IPSelector) GetBestIP(testUrl string) string {
	s.mu.RLock()
	// 如果有缓存，直接使用（生命周期为整个程序运行期间）
	if s.cachedBestIP != "" {
		defer s.mu.RUnlock()
		// fmt.Printf("[IPSelector] Using cached best IP: %s\n", s.cachedBestIP)
		return s.cachedBestIP
	}
	s.mu.RUnlock()

	return s.refreshBestIP(testUrl)
}

func (s *IPSelector) GetCachedBestIP() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cachedBestIP
}

func (s *IPSelector) refreshBestIP(testUrl string) string {
	s.mu.Lock()
	// 如果已经在优选，直接返回空字符串或者等待（这里简化为返回，前端会轮询状态）
	// 但是为了防止多个协程同时进入，我们需要检查 isSelecting
	if s.isSelecting {
		s.mu.Unlock()
		// 简单的自旋等待，或者直接返回空让调用者重试
		// 实际上 GetBestIP 的调用者通常会等待结果，所以这里我们应该等待
		// 但为了避免复杂性，我们只让第一个进入的协程执行，其他协程等待 cachedBestIP 被赋值

		// 轮询等待结果（最多等待30秒）
		for i := 0; i < 60; i++ {
			time.Sleep(500 * time.Millisecond)
			s.mu.RLock()
			if s.cachedBestIP != "" {
				res := s.cachedBestIP
				s.mu.RUnlock()
				return res
			}
			if !s.isSelecting {
				// 优选结束但没有结果？
				s.mu.RUnlock()
				return ""
			}
			s.mu.RUnlock()
		}
		return ""
	}

	// Double check cache
	if s.cachedBestIP != "" {
		s.mu.Unlock()
		return s.cachedBestIP
	}

	s.isSelecting = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.isSelecting = false
		s.mu.Unlock()
	}()

	// Fetch remote IPs
	var candidateIPs []string
	remoteIPs, err := fetchRemoteIPs("cdn.steamusercontent.com")
	if err == nil && len(remoteIPs) > 0 {
		fmt.Printf("[IPSelector] Fetched %d IPs from remote API\n", len(remoteIPs))
		candidateIPs = remoteIPs
	} else {
		fmt.Printf("[IPSelector] Failed to fetch remote IPs (using built-in): %v\n", err)
		candidateIPs = make([]string, len(defaultSteamCDNIPs))
		copy(candidateIPs, defaultSteamCDNIPs)
	}

	// Resolve via 8.8.8.8
	fmt.Println("[IPSelector] Resolving cdn.steamusercontent.com via 8.8.8.8...")
	dnsIPs, err := lookupIPWithDNS("8.8.8.8", "cdn.steamusercontent.com")
	if err == nil {
		v4 := 0
		v6 := 0
		for _, ip := range dnsIPs {
			if net.ParseIP(ip).To4() != nil {
				v4++
			} else {
				v6++
			}
		}
		fmt.Printf("[IPSelector] DNS returned %d IPs (IPv4: %d, IPv6: %d): %v\n", len(dnsIPs), v4, v6, dnsIPs)
		candidateIPs = append(candidateIPs, dnsIPs...)
	} else {
		fmt.Printf("[IPSelector] DNS lookup failed: %v\n", err)
	}

	bestIP := selectBestIP(candidateIPs, testUrl)

	s.mu.Lock()
	if bestIP != "" {
		s.cachedBestIP = bestIP
		s.lastCheck = time.Now()
	}
	result := s.cachedBestIP
	s.mu.Unlock()

	return result
}

func lookupIPWithDNS(dnsServer string, host string) ([]string, error) {
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			d := net.Dialer{
				Timeout: time.Second * 5,
			}
			return d.DialContext(ctx, "udp", dnsServer+":53")
		},
	}
	return r.LookupHost(context.Background(), host)
}

func selectBestIP(ips []string, testUrl string) string {
	type result struct {
		ip      string
		latency time.Duration
	}

	fmt.Printf("[IPSelector] Starting ping test for %d IPs...\n", len(ips))

	// 1. TCP Ping Test
	results := make(chan result, len(ips))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	for _, ip := range ips {
		go func(targetIP string) {
			start := time.Now()
			d := net.Dialer{Timeout: 1500 * time.Millisecond}
			conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(targetIP, "80"))
			if err == nil {
				conn.Close()
				latency := time.Since(start)
				fmt.Printf("[IPSelector] Ping success: %s - %v\n", targetIP, latency)
				select {
				case results <- result{ip: targetIP, latency: latency}:
				case <-ctx.Done():
				}
			}
		}(ip)
	}

	var pingResults []result
	for i := 0; i < len(ips); i++ {
		select {
		case res := <-results:
			pingResults = append(pingResults, res)
		case <-ctx.Done():
			goto PING_DONE
		}
	}
PING_DONE:

	if len(pingResults) == 0 {
		fmt.Println("[IPSelector] No reachable IP found via Ping")
		return ""
	}

	// Sort by latency
	sort.Slice(pingResults, func(i, j int) bool {
		return pingResults[i].latency < pingResults[j].latency
	})

	fmt.Println("[IPSelector] --- All Ping Results (Sorted) ---")
	for i, res := range pingResults {
		fmt.Printf("  %d. %s: %v\n", i+1, res.ip, res.latency)
	}
	fmt.Println("[IPSelector] --------------------------------")

	// Take top 3 for speed test
	topCount := 3
	if len(pingResults) < topCount {
		topCount = len(pingResults)
	}
	topCandidates := pingResults[:topCount]

	fmt.Printf("[IPSelector] Top %d IPs by latency: %v\n", topCount, topCandidates)

	// 2. Download Speed Test
	type speedResult struct {
		ip    string
		speed float64 // MB/s
		err   error
	}

	speedResults := make(chan speedResult, topCount)
	// Increase timeout to 30s for 5MB test
	speedCtx, speedCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer speedCancel()

	fmt.Println("[IPSelector] Starting download speed test...")

	// 使用用户指定的测试链接
	testUrl = "https://cdn.steamusercontent.com/ugc/1852675168601248369/F20C8BCDE3535FB6415810D1B0A3BD7B404E4346/"

	for _, candidate := range topCandidates {
		go func(ip string) {
			speed, err := testDownloadSpeed(speedCtx, ip, testUrl)
			select {
			case speedResults <- speedResult{ip: ip, speed: speed, err: err}:
			case <-speedCtx.Done():
			}
		}(candidate.ip)
	}

	var bestIP string
	var maxSpeed float64 = -1

	// 等待所有结果返回，而不是一旦找到一个就认为结束（虽然逻辑是选最快，但这里是等待所有协程完成）
	// 注意：之前的逻辑是遍历 topCount 次，每次接收一个结果。
	// 问题在于：如果超时了，goto SPEED_DONE，这时候可能已经打印了一些日志。
	// 但实际上，打印 Best IP selected 的逻辑是在循环结束后。
	// 日志重复的原因可能是：
	// 1. 多个协程并发调用了 GetBestIP -> 导致多个 refreshBestIP 同时运行 (已修复)
	// 2. 这里的循环逻辑有问题？
	// 从用户日志看：
	// [IPSelector] Best IP selected: 23.59.72.42 (Speed: 5.04 MB/s)  <-- 这里出现一次
	// [IPSelector] 203.69.138.225 - Speed: 1.11 MB/s                 <-- 之后又打印了一个测速结果
	// [IPSelector] Best IP selected: 23.59.72.59 (Speed: 6.05 MB/s)  <-- 又选出了一个更好的？

	// 仔细看代码：
	// 循环接收结果，每次接收到结果都会更新 maxSpeed 和 bestIP。
	// 但是！之前的代码没有提前退出循环，而是接收完所有结果后才打印 Best IP。
	// 等等，用户日志显示 Best IP 打印了两次，说明 refreshBestIP 被执行了两次！
	// 第一次 Best IP 打印后，居然还有测速日志，然后又一次 Best IP。
	// 这绝对是并发进入了 refreshBestIP。

	// 我们之前加的锁逻辑：
	// s.mu.Lock(); if s.isSelecting { ... }
	// 这段代码是我刚才加上去的。
	// 在用户遇到问题的时候，这段代码还不在。
	// 所以，刚才的修复（防止重入）应该已经解决了这个问题。

	for i := 0; i < topCount; i++ {
		select {
		case res := <-speedResults:
			if res.err != nil {
				fmt.Printf("[IPSelector] Speed test failed for %s: %v\n", res.ip, res.err)
				continue
			}
			fmt.Printf("[IPSelector] %s - Speed: %.2f MB/s\n", res.ip, res.speed)
			if res.speed > maxSpeed {
				maxSpeed = res.speed
				bestIP = res.ip
			}
		case <-speedCtx.Done():
			goto SPEED_DONE
		}
	}
SPEED_DONE:

	if bestIP != "" {
		fmt.Printf("[IPSelector] Best IP selected: %s (Speed: %.2f MB/s)\n", bestIP, maxSpeed)
		return bestIP
	}

	// Fallback to lowest latency if speed test failed for all
	fmt.Printf("[IPSelector] Speed test failed for all, falling back to lowest latency: %s\n", topCandidates[0].ip)
	return topCandidates[0].ip
}

func testDownloadSpeed(ctx context.Context, ip string, downloadUrl string) (float64, error) {
	u, err := url.Parse(downloadUrl)
	if err != nil {
		return 0, err
	}

	dialer := &net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			// Force connection to specific IP
			_, port, _ := net.SplitHostPort(addr)
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip, port))
		},
		TLSHandshakeTimeout: 5 * time.Second,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   20 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "GET", downloadUrl, nil)
	if err != nil {
		return 0, err
	}

	// Request first 5MB for better speed measurement
	req.Header.Set("Range", "bytes=0-5242880")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Host", u.Host)

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return 0, fmt.Errorf("bad status: %d", resp.StatusCode)
	}

	// Read body to measure throughput
	written, err := io.Copy(io.Discard, resp.Body)
	if err != nil {
		return 0, err
	}

	duration := time.Since(start)
	if duration == 0 {
		duration = 1 * time.Millisecond
	}

	speedMBps := float64(written) / 1024 / 1024 / duration.Seconds()
	return speedMBps, nil
}
