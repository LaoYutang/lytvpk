package serveraddress

import "testing"

func TestNormalize(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		expects string
	}{
		{name: "IPv4 default port", input: "127.0.0.1", expects: "127.0.0.1:27015"},
		{name: "domain default port", input: "example.com", expects: "example.com:27015"},
		{name: "empty port uses default", input: "example.com:", expects: "example.com:27015"},
		{name: "explicit port", input: "example.com:27016", expects: "example.com:27016"},
		{name: "raw IPv6 default port", input: "2001:db8::1", expects: "[2001:db8::1]:27015"},
		{name: "bracketed IPv6 default port", input: "[2001:db8::1]", expects: "[2001:db8::1]:27015"},
		{name: "bracketed IPv6 explicit port", input: "[2001:db8::1]:27016", expects: "[2001:db8::1]:27016"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Normalize(test.input)
			if err != nil {
				t.Fatalf("Normalize returned error: %v", err)
			}
			if got != test.expects {
				t.Fatalf("expected %q, got %q", test.expects, got)
			}
		})
	}
}

func TestNormalizeRejectsInvalidAddress(t *testing.T) {
	inputs := []string{
		"",
		":27015",
		"example.com:not-a-port",
		"example.com:0",
		"example.com:65536",
		"steam://connect/example.com",
		"[not-ipv6]",
		"2001:db8::invalid",
	}

	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			if _, err := Normalize(input); err == nil {
				t.Fatalf("expected %q to be rejected", input)
			}
		})
	}
}
