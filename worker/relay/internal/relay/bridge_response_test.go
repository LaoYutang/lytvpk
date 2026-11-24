package relay

import "testing"

func TestValidBridgeResponse(t *testing.T) {
	tests := []struct {
		name, route, body string
		want              bool
	}{
		{"list without result code", "list", `{"response":{"total":1,"publishedfiledetails":[{"publishedfileid":"18446744073709551615","title":"地图","tags":[{"tag":"Campaign"}],"extra":{"metadata":true}}]}}`, true},
		{"empty page with matching items on other pages", "list", `{"response":{"publishedfiledetails":[],"total":20634}}`, true},
		{"omitted rows on empty page", "list", `{"response":{"total":0}}`, true},
		{"omitted rows beyond end", "list", `{"response":{"total":20634}}`, true},
		{"explicit list without total", "list", `{"response":{"publishedfiledetails":[]}}`, true},
		{"empty detail", "detail", `{"response":{"publishedfiledetails":[]}}`, true},
		{"omitted empty detail", "detail", `{"response":{"result":1,"resultcount":0}}`, true},
		{"detail with nested items", "detail", `{"response":{"publishedfiledetails":[{"publishedfileid":"7","file_size":"700","time_updated":8,"previews":[{"preview_url":"a","preview_type":0}],"child_items":[{"publishedfileid":"9"}]}]}}`, true},
		{"unavailable detail", "detail", `{"response":{"result":1,"resultcount":1,"publishedfiledetails":[{"publishedfileid":"7","result":9}]}}`, true},
		{"missing detail envelope with empty count", "detail", `{"response":{"result":9,"resultcount":0}}`, true},
		{"missing detail envelope with empty rows", "detail", `{"response":{"result":9,"publishedfiledetails":[]}}`, true},
		{"zero-padded detail count", "detail", `{"response":{"publishedfiledetails":[{"publishedfileid":"5","favorited":"0007"}]}}`, true},
		{"empty updates", "updates", `{"items":[]}`, true},
		{"updates with partial business results", "updates", `{"items":[{"publishedfileid":"1","result":1,"time_updated":"1800000000"},{"publishedfileid":"2","result":0},{"publishedfileid":"3","result":9},{"publishedfileid":"4","result":1}]}`, true},
		{"update timestamp padded with leading zeros", "updates", `{"items":[{"publishedfileid":"1","result":1,"time_updated":"001800000000"}]}`, true},
		{"empty conversion", "parse", `[]`, true},
		{"collection and unavailable parse", "parse", `[{"publishedfileid":"123","result":0,"file_type":2,"children":[{"publishedfileid":"7","sortorder":0,"file_type":0}]},{"publishedfileid":"7","result":9}]`, true},
		{"file conversion", "parse", `[{"publishedfileid":"123","result":1,"file_size":"10","file_url":"a","filename":"file.vpk"}]`, true},

		{"missing envelope", "list", `{}`, false},
		{"empty envelope", "list", `{"response":{}}`, false},
		{"list error envelope", "list", `{"error":"upstream","response":{"total":0}}`, false},
		{"list nested error", "list", `{"response":{"error":"upstream","total":0}}`, false},
		{"Steam failure", "detail", `{"response":{"result":2,"publishedfiledetails":[]}}`, false},
		{"wrong list type", "list", `{"response":{"publishedfiledetails":{},"total":0}}`, false},
		{"null rows", "list", `{"response":{"publishedfiledetails":null,"total":0}}`, false},
		{"list row missing id", "list", `{"response":{"publishedfiledetails":[{"title":"x"}]}}`, false},
		{"wrong id type", "detail", `{"response":{"publishedfiledetails":[{"publishedfileid":7}]}}`, false},
		{"wrong total type", "list", `{"response":{"total":"1","publishedfiledetails":[]}}`, false},
		{"overflow of desktop total", "list", `{"response":{"total":18446744073709551615}}`, false},
		{"invalid UTF-8", "parse", "[{\"publishedfileid\":\"5\",\"result\":1,\"title\":\"\xff\"}]", false},
		{"negative total", "list", `{"response":{"total":-1}}`, false},
		{"malformed list title", "list", `{"response":{"publishedfiledetails":[{"publishedfileid":"5","title":{"x":1}}]}}`, false},
		{"bad tag", "list", `{"response":{"publishedfiledetails":[{"publishedfileid":"5","tags":[3]}]}}`, false},
		{"bad detail dependency", "detail", `{"response":{"publishedfiledetails":[{"publishedfileid":"5","required_items":[{"publishedfileid":"4","views":[]}]}]}}`, false},
		{"bad detail preview", "detail", `{"response":{"publishedfiledetails":[{"publishedfileid":"5","previews":[{"preview_type":"unknown"}]}]}}`, false},
		{"bad detail scalar", "detail", `{"response":{"publishedfiledetails":[{"publishedfileid":"5","time_updated":true}]}}`, false},
		{"missing detail list", "detail", `{"response":{"resultcount":1}}`, false},
		{"wrong updates envelope", "updates", `{"response":{"publishedfiledetails":[]}}`, false},
		{"null updates", "updates", `{"items":null}`, false},
		{"wrong updates row", "updates", `{"items":[null]}`, false},
		{"missing update result", "updates", `{"items":[{"publishedfileid":"1"}]}`, false},
		{"wrong update result type", "updates", `{"items":[{"publishedfileid":"1","result":"9"}]}`, false},
		{"invalid timestamp string", "updates", `{"items":[{"publishedfileid":"1","result":1,"time_updated":"unknown"}]}`, false},
		{"wrong timestamp type", "updates", `{"items":[{"publishedfileid":"1","result":1,"time_updated":[]}]}`, false},
		{"wrong parse container", "parse", `{"items":[]}`, false},
		{"empty parse row", "parse", `[{}]`, false},
		{"wrong parse child type", "parse", `[{"publishedfileid":"1","result":0,"children":[{"publishedfileid":2}]}]`, false},
		{"wrong parse size type", "parse", `[{"publishedfileid":"1","result":1,"file_size":123}]`, false},
		{"trailing JSON", "parse", `[]{}`, false},
		{"truncated JSON", "parse", `[{"result":`, false},
		{"wrong route", "ips", `[]`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validBridgeResponse(tt.route, []byte(tt.body)); got != tt.want {
				t.Fatalf("validBridgeResponse(%q) = %v, want %v", tt.route, got, tt.want)
			}
		})
	}
}
