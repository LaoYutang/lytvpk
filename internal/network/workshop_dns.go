package network

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"strings"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

const (
	workshopDNSTimeout     = 5 * time.Second
	workshopConnectTimeout = 30 * time.Second
	maxWorkshopCNAMEHops   = 8
)

// WorkshopDialer resolves directly through the selected DNS server. An empty
// server selects the system resolver; neither mode changes the system settings.
type WorkshopDialer struct {
	server  string
	dnsDial func(context.Context, string, string) (net.Conn, error)
	connect func(context.Context, string, string) (net.Conn, error)
}

func NewWorkshopDialer(server string) *WorkshopDialer {
	return &WorkshopDialer{
		server:  server,
		dnsDial: (&net.Dialer{Timeout: workshopDNSTimeout}).DialContext,
		connect: (&net.Dialer{Timeout: workshopConnectTimeout, KeepAlive: 30 * time.Second}).DialContext,
	}
}

func (d *WorkshopDialer) DialContext(ctx context.Context, _ string, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, workshopConnectTimeout)
	defer cancel()
	if _, err := netip.ParseAddr(host); err == nil || d.server == "" {
		return d.connect(ctx, "tcp4", address)
	}

	ips, err := d.lookupIPv4(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("工坊 DNS %s 解析 %s 失败: %w", d.server, host, err)
	}
	var failures []error
	for i, ip := range ips {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		deadline, _ := ctx.Deadline()
		attemptCtx, attemptCancel := context.WithTimeout(ctx, time.Until(deadline)/time.Duration(len(ips)-i))
		conn, err := d.connect(attemptCtx, "tcp4", net.JoinHostPort(ip.String(), port))
		attemptCancel()
		if err == nil {
			return conn, nil
		}
		failures = append(failures, err)
	}
	return nil, fmt.Errorf("连接工坊 %s 失败: %w", host, errors.Join(failures...))
}

type workshopDNSAnswer struct {
	addresses map[string][]netip.Addr
	aliases   map[string]string
}

func dnsHost(name string) string {
	return strings.ToLower(strings.TrimSuffix(name, ".")) + "."
}

func (d *WorkshopDialer) lookupIPv4(ctx context.Context, host string) ([]netip.Addr, error) {
	ctx, cancel := context.WithTimeout(ctx, workshopDNSTimeout)
	defer cancel()
	current := dnsHost(host)
	seen := map[string]bool{current: true}
	hops := 0
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		queried := current
		answer, err := d.query(ctx, current)
		if err != nil {
			return nil, err
		}
		for {
			if ips := answer.addresses[current]; len(ips) > 0 {
				return ips, nil
			}
			target, ok := answer.aliases[current]
			if !ok {
				if current != queried {
					break // The server returned only a CNAME; query its target.
				}
				return nil, fmt.Errorf("未返回有效的 IPv4 地址")
			}
			hops++
			if seen[target] || hops > maxWorkshopCNAMEHops {
				return nil, fmt.Errorf("CNAME 循环或跳转超过 %d 次", maxWorkshopCNAMEHops)
			}
			seen[target] = true
			current = target
		}
	}
}

func (d *WorkshopDialer) query(ctx context.Context, host string) (workshopDNSAnswer, error) {
	name, err := dnsmessage.NewName(host)
	if err != nil {
		return workshopDNSAnswer{}, err
	}
	var idBytes [2]byte
	if _, err := rand.Read(idBytes[:]); err != nil {
		return workshopDNSAnswer{}, err
	}
	id := binary.BigEndian.Uint16(idBytes[:])
	question := dnsmessage.Question{Name: name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET}
	request, err := (&dnsmessage.Message{
		Header:    dnsmessage.Header{ID: id, RecursionDesired: true},
		Questions: []dnsmessage.Question{question},
	}).Pack()
	if err != nil {
		return workshopDNSAnswer{}, err
	}
	for _, protocol := range []string{"udp", "tcp"} {
		response, err := d.exchange(ctx, protocol, request)
		if err != nil {
			return workshopDNSAnswer{}, err
		}
		answer, truncated, err := parseWorkshopDNSAnswer(response, id, question)
		if err != nil {
			return workshopDNSAnswer{}, err
		}
		if !truncated {
			return answer, nil
		}
		if protocol == "tcp" {
			return workshopDNSAnswer{}, fmt.Errorf("TCP DNS 响应被截断")
		}
	}
	return workshopDNSAnswer{}, fmt.Errorf("DNS 响应无效")
}

func (d *WorkshopDialer) exchange(ctx context.Context, protocol string, request []byte) ([]byte, error) {
	conn, err := d.dnsDial(ctx, protocol, net.JoinHostPort(d.server, "53"))
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			return nil, err
		}
	}
	packet := request
	if protocol == "tcp" {
		packet = make([]byte, len(request)+2)
		binary.BigEndian.PutUint16(packet, uint16(len(request)))
		copy(packet[2:], request)
	}
	if n, err := conn.Write(packet); err != nil || n != len(packet) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err == nil {
			err = io.ErrShortWrite
		}
		return nil, err
	}
	response := make([]byte, 65535)
	var n int
	if protocol == "tcp" {
		var size [2]byte
		_, err = io.ReadFull(conn, size[:])
		if err == nil {
			n = int(binary.BigEndian.Uint16(size[:]))
			_, err = io.ReadFull(conn, response[:n])
		}
	} else {
		n, err = conn.Read(response)
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return response[:n], err
}

func parseWorkshopDNSAnswer(packet []byte, id uint16, question dnsmessage.Question) (workshopDNSAnswer, bool, error) {
	var parser dnsmessage.Parser
	header, err := parser.Start(packet)
	if err != nil {
		return workshopDNSAnswer{}, false, err
	}
	if !header.Response || header.ID != id || header.OpCode != 0 {
		return workshopDNSAnswer{}, false, fmt.Errorf("DNS 响应标识无效")
	}
	questions, err := parser.AllQuestions()
	if err != nil {
		return workshopDNSAnswer{}, false, err
	}
	if len(questions) != 1 || !strings.EqualFold(questions[0].Name.String(), question.Name.String()) || questions[0].Type != question.Type || questions[0].Class != question.Class {
		return workshopDNSAnswer{}, false, fmt.Errorf("DNS 响应问题不匹配")
	}
	if header.Truncated {
		return workshopDNSAnswer{}, true, nil
	}
	if header.RCode != dnsmessage.RCodeSuccess {
		return workshopDNSAnswer{}, false, &net.DNSError{
			Err: header.RCode.String(), Name: question.Name.String(),
			IsNotFound:  header.RCode == dnsmessage.RCodeNameError,
			IsTemporary: header.RCode == dnsmessage.RCodeServerFailure,
		}
	}
	resources, err := parser.AllAnswers()
	if err != nil {
		return workshopDNSAnswer{}, false, err
	}
	answer := workshopDNSAnswer{addresses: make(map[string][]netip.Addr), aliases: make(map[string]string)}
	for _, resource := range resources {
		if resource.Header.Class != dnsmessage.ClassINET {
			continue
		}
		owner := dnsHost(resource.Header.Name.String())
		switch body := resource.Body.(type) {
		case *dnsmessage.AResource:
			answer.addresses[owner] = append(answer.addresses[owner], netip.AddrFrom4(body.A))
		case *dnsmessage.CNAMEResource:
			answer.aliases[owner] = dnsHost(body.CNAME.String())
		}
	}
	return answer, false, nil
}
