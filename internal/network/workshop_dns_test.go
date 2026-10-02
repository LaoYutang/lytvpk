package network

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

type fixtureDNSConn struct {
	protocol string
	respond  func(dnsmessage.Message) dnsmessage.Message
	reader   *bytes.Reader
}

func (c *fixtureDNSConn) Write(packet []byte) (int, error) {
	queryPacket := packet
	if c.protocol == "tcp" {
		queryPacket = packet[2:]
	}
	var query dnsmessage.Message
	if err := query.Unpack(queryPacket); err != nil {
		return 0, err
	}
	answer := c.respond(query)
	response, err := answer.Pack()
	if err != nil {
		return 0, err
	}
	if c.protocol == "tcp" {
		framed := make([]byte, len(response)+2)
		binary.BigEndian.PutUint16(framed, uint16(len(response)))
		copy(framed[2:], response)
		response = framed
	}
	c.reader = bytes.NewReader(response)
	return len(packet), nil
}

func (c *fixtureDNSConn) Read(packet []byte) (int, error)  { return c.reader.Read(packet) }
func (c *fixtureDNSConn) Close() error                     { return nil }
func (c *fixtureDNSConn) LocalAddr() net.Addr              { return &net.UDPAddr{} }
func (c *fixtureDNSConn) RemoteAddr() net.Addr             { return &net.UDPAddr{} }
func (c *fixtureDNSConn) SetDeadline(time.Time) error      { return nil }
func (c *fixtureDNSConn) SetReadDeadline(time.Time) error  { return nil }
func (c *fixtureDNSConn) SetWriteDeadline(time.Time) error { return nil }

func fixtureAnswer(query dnsmessage.Message, resources ...dnsmessage.Resource) dnsmessage.Message {
	return dnsmessage.Message{
		Header:    dnsmessage.Header{ID: query.ID, Response: true, RecursionAvailable: true},
		Questions: query.Questions,
		Answers:   resources,
	}
}

func fixtureA(name string, address [4]byte) dnsmessage.Resource {
	return dnsmessage.Resource{
		Header: dnsmessage.ResourceHeader{Name: dnsmessage.MustNewName(name), Class: dnsmessage.ClassINET, TTL: 60},
		Body:   &dnsmessage.AResource{A: address},
	}
}

func fixtureCNAME(name, target string) dnsmessage.Resource {
	return dnsmessage.Resource{
		Header: dnsmessage.ResourceHeader{Name: dnsmessage.MustNewName(name), Class: dnsmessage.ClassINET, TTL: 60},
		Body:   &dnsmessage.CNAMEResource{CNAME: dnsmessage.MustNewName(target)},
	}
}

func TestWorkshopDNSDirectQueryAndMultipleAddresses(t *testing.T) {
	dialer := NewWorkshopDialer("119.29.29.29")
	var queried, connected []string
	dialer.dnsDial = func(ctx context.Context, protocol, address string) (net.Conn, error) {
		queried = append(queried, protocol+" "+address)
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > workshopDNSTimeout {
			t.Fatal("DNS query is missing its five-second deadline")
		}
		return &fixtureDNSConn{protocol: protocol, respond: func(query dnsmessage.Message) dnsmessage.Message {
			if query.Questions[0].Name.String() != "workshop.example." || query.Questions[0].Type != dnsmessage.TypeA {
				t.Fatalf("unexpected question: %+v", query.Questions)
			}
			return fixtureAnswer(query,
				fixtureA("unrelated.example.", [4]byte{9, 9, 9, 9}),
				fixtureA("workshop.example.", [4]byte{192, 0, 2, 1}),
				fixtureA("workshop.example.", [4]byte{192, 0, 2, 2}),
			)
		}}, nil
	}
	left, right := net.Pipe()
	defer right.Close()
	dialer.connect = func(_ context.Context, protocol, address string) (net.Conn, error) {
		connected = append(connected, protocol+" "+address)
		if strings.Contains(address, "192.0.2.1") {
			return nil, errors.New("first address unavailable")
		}
		return left, nil
	}
	conn, err := dialer.DialContext(context.Background(), "tcp", "workshop.example:443")
	if err != nil {
		t.Fatal(err)
	}
	conn.Close()
	if fmt.Sprint(queried) != "[udp 119.29.29.29:53]" || fmt.Sprint(connected) != "[tcp4 192.0.2.1:443 tcp4 192.0.2.2:443]" {
		t.Fatalf("queries=%v connections=%v", queried, connected)
	}
}

func TestWorkshopDNSTruncatedUDPUsesSameServerOverTCP(t *testing.T) {
	dialer := NewWorkshopDialer("2001:db8::53")
	var calls []string
	dialer.dnsDial = func(_ context.Context, protocol, address string) (net.Conn, error) {
		calls = append(calls, protocol+" "+address)
		return &fixtureDNSConn{protocol: protocol, respond: func(query dnsmessage.Message) dnsmessage.Message {
			answer := fixtureAnswer(query, fixtureA("workshop.example.", [4]byte{127, 0, 0, 1}))
			if protocol == "udp" {
				answer.Truncated = true
				answer.Answers = nil
			}
			return answer
		}}, nil
	}
	ips, err := dialer.lookupIPv4(context.Background(), "workshop.example")
	if err != nil {
		t.Fatal(err)
	}
	if len(ips) != 1 || ips[0].String() != "127.0.0.1" || fmt.Sprint(calls) != "[udp [2001:db8::53]:53 tcp [2001:db8::53]:53]" {
		t.Fatalf("addresses=%v calls=%v", ips, calls)
	}
}

func TestWorkshopDNSCNAME(t *testing.T) {
	for _, mode := range []string{"inline", "separate", "loop", "too-many"} {
		t.Run(mode, func(t *testing.T) {
			dialer := NewWorkshopDialer("223.5.5.5")
			calls := 0
			dialer.dnsDial = func(_ context.Context, protocol, _ string) (net.Conn, error) {
				return &fixtureDNSConn{protocol: protocol, respond: func(query dnsmessage.Message) dnsmessage.Message {
					calls++
					name := query.Questions[0].Name.String()
					switch mode {
					case "loop":
						return fixtureAnswer(query, fixtureCNAME(name, name))
					case "too-many":
						return fixtureAnswer(query, fixtureCNAME(name, fmt.Sprintf("hop%d.example.", calls)))
					case "inline":
						return fixtureAnswer(query, fixtureCNAME(name, "cdn.example."), fixtureA("cdn.example.", [4]byte{192, 0, 2, 3}))
					default:
						if name == "workshop.example." {
							return fixtureAnswer(query, fixtureCNAME(name, "cdn.example."))
						}
						return fixtureAnswer(query, fixtureA(name, [4]byte{192, 0, 2, 3}))
					}
				}}, nil
			}
			ips, err := dialer.lookupIPv4(context.Background(), "workshop.example")
			if mode == "loop" || mode == "too-many" {
				if err == nil || calls > 9 {
					t.Fatalf("addresses=%v error=%v calls=%d", ips, err, calls)
				}
			} else if err != nil || len(ips) != 1 || ips[0] != netip.MustParseAddr("192.0.2.3") {
				t.Fatalf("addresses=%v error=%v", ips, err)
			}
			if mode == "separate" && calls != 2 {
				t.Fatalf("expected a query for the CNAME target, calls=%d", calls)
			}
		})
	}
}

func TestWorkshopDNSRejectsInvalidReplies(t *testing.T) {
	for _, mode := range []string{"wrong-id", "wrong-question", "not-response", "nxdomain", "servfail", "empty"} {
		t.Run(mode, func(t *testing.T) {
			dialer := NewWorkshopDialer("119.29.29.29")
			calls := 0
			dialer.dnsDial = func(_ context.Context, protocol, _ string) (net.Conn, error) {
				calls++
				return &fixtureDNSConn{protocol: protocol, respond: func(query dnsmessage.Message) dnsmessage.Message {
					answer := fixtureAnswer(query, fixtureA("workshop.example.", [4]byte{127, 0, 0, 1}))
					switch mode {
					case "wrong-id":
						answer.ID++
					case "wrong-question":
						answer.Questions = nil
					case "not-response":
						answer.Response = false
					case "nxdomain":
						answer.RCode = dnsmessage.RCodeNameError
					case "servfail":
						answer.RCode = dnsmessage.RCodeServerFailure
					case "empty":
						answer.Answers = nil
					}
					return answer
				}}, nil
			}
			if _, err := dialer.lookupIPv4(context.Background(), "workshop.example"); err == nil || calls != 1 {
				t.Fatalf("error=%v queries=%d", err, calls)
			}
		})
	}
}

func TestWorkshopDNSFailureDoesNotFallBack(t *testing.T) {
	dialer := NewWorkshopDialer("119.29.29.29")
	calls := 0
	dialer.dnsDial = func(_ context.Context, protocol, address string) (net.Conn, error) {
		calls++
		if protocol != "udp" || address != "119.29.29.29:53" {
			t.Fatalf("unexpected fallback: %s %s", protocol, address)
		}
		return nil, errors.New("DNS unavailable")
	}
	dialer.connect = func(context.Context, string, string) (net.Conn, error) {
		t.Fatal("must not connect through the system resolver after a DNS failure")
		return nil, nil
	}
	_, err := dialer.DialContext(context.Background(), "tcp", "workshop.example:443")
	if err == nil || calls != 1 || !strings.Contains(err.Error(), "工坊 DNS 119.29.29.29 解析 workshop.example 失败") {
		t.Fatalf("error=%v queries=%d", err, calls)
	}
}

func TestWorkshopDNSCallerTimeoutAndCancellation(t *testing.T) {
	dialer := NewWorkshopDialer("119.29.29.29")
	left, right := net.Pipe()
	defer right.Close()
	calls := 0
	dialer.dnsDial = func(context.Context, string, string) (net.Conn, error) { calls++; return left, nil }
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := dialer.lookupIPv4(ctx, "workshop.example"); !errors.Is(err, context.DeadlineExceeded) || calls != 1 {
		t.Fatalf("error=%v calls=%d", err, calls)
	}
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if _, err := dialer.lookupIPv4(ctx, "workshop.example"); !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("error=%v calls=%d", err, calls)
	}
}

func TestWorkshopDNSSystemAndLiteralAddress(t *testing.T) {
	for _, server := range []string{"", "119.29.29.29"} {
		dialer := NewWorkshopDialer(server)
		dialer.dnsDial = func(context.Context, string, string) (net.Conn, error) {
			t.Fatal("unexpected explicit DNS query")
			return nil, nil
		}
		address := "workshop.example:443"
		if server != "" {
			address = "127.0.0.1:443"
		}
		left, right := net.Pipe()
		dialer.connect = func(_ context.Context, protocol, target string) (net.Conn, error) {
			if protocol != "tcp4" || target != address {
				t.Fatalf("unexpected dial %s %s", protocol, target)
			}
			return left, nil
		}
		conn, err := dialer.DialContext(context.Background(), "tcp", address)
		if err != nil {
			t.Fatal(err)
		}
		conn.Close()
		right.Close()
	}
}

func TestWorkshopDNSPreservesHTTPSHostAndCertificateValidation(t *testing.T) {
	observations := make(chan [2]string, 1)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observations <- [2]string{r.Host, r.TLS.ServerName}
		fmt.Fprint(w, "ok")
	}))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	defer server.Close()
	host := server.Certificate().DNSNames[0]
	_, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	dialer := NewWorkshopDialer("119.29.29.29")
	dialer.dnsDial = func(_ context.Context, protocol, _ string) (net.Conn, error) {
		return &fixtureDNSConn{protocol: protocol, respond: func(query dnsmessage.Message) dnsmessage.Message {
			return fixtureAnswer(query, fixtureA(query.Questions[0].Name.String(), [4]byte{127, 0, 0, 1}))
		}}, nil
	}
	client := server.Client()
	transport := client.Transport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = dialer.DialContext
	if transport.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("TLS verification must remain enabled")
	}
	defer transport.CloseIdleConnections()
	client.Transport = transport
	response, err := client.Get("https://" + net.JoinHostPort(host, port))
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	observed := <-observations
	if observed[0] != net.JoinHostPort(host, port) || observed[1] != host {
		t.Fatalf("Host=%q SNI=%q", observed[0], observed[1])
	}
	_, err = client.Get("https://" + net.JoinHostPort("invalid.example", port))
	var hostnameError x509.HostnameError
	if !errors.As(err, &hostnameError) {
		t.Fatalf("expected certificate hostname error, got %v", err)
	}
}
