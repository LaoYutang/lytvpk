package relay

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"
	"unicode/utf8"
)

var errBridgeRows = errors.New("invalid workshop rows")

// Validate the representation the client will receive. Empty pages, missing
// items and collections without download URLs are ordinary upstream results.
func validBridgeResponse(routeName string, body []byte) bool {
	if !utf8.Valid(body) {
		return false
	}
	switch routeName {
	case "list":
		return validSteamEnvelope[bridgeListRow](body, true)
	case "detail":
		return validSteamEnvelope[bridgeDetailRow](body, false)
	case "updates":
		var response struct {
			Items bridgeRows[bridgeUpdateRow] `json:"items"`
			Error *json.RawMessage            `json:"error"`
		}
		return json.Unmarshal(body, &response) == nil && response.Error == nil && response.Items.present
	case "parse":
		var rows bridgeRows[bridgeParseRow]
		return json.Unmarshal(body, &rows) == nil && rows.present
	default:
		return false
	}
}

func validSteamEnvelope[T interface{ validRow() bool }](body []byte, list bool) bool {
	var envelope struct {
		Error    *json.RawMessage `json:"error"`
		Response *struct {
			Error       *json.RawMessage `json:"error"`
			Result      *int             `json:"result"`
			Total       *int             `json:"total"`
			ResultCount *int             `json:"resultcount"`
			Rows        bridgeRows[T]    `json:"publishedfiledetails"`
		} `json:"response"`
	}
	if json.Unmarshal(body, &envelope) != nil || envelope.Error != nil || envelope.Response == nil {
		return false
	}
	r := envelope.Response
	if r.Error != nil || (r.Total != nil && *r.Total < 0) || (r.ResultCount != nil && *r.ResultCount < 0) {
		return false
	}
	emptyCount := r.ResultCount != nil && *r.ResultCount == 0
	if r.Result != nil && *r.Result != 1 {
		// Steam EResult 9 means FileNotFound and is also meaningful at the
		// envelope level when no metadata rows were returned.
		return *r.Result == 9 && !r.Rows.hasItems && (r.Rows.present || emptyCount)
	}
	// Steam can omit an empty repeated field. Even past the last page,
	// total is the size of the entire query, not the number of rows here.
	if list {
		return r.Rows.present || r.Total != nil
	}
	return r.Rows.present || emptyCount
}

// Stream each array instead of retaining the decoded metadata for every row.
// The enclosing json.Unmarshal has already checked the complete JSON syntax.
type bridgeRows[T any] struct {
	present, hasItems bool
}

func (r *bridgeRows[T]) UnmarshalJSON(data []byte) error {
	d := json.NewDecoder(bytes.NewReader(data))
	if token, err := d.Token(); err != nil || token != json.Delim('[') {
		return errBridgeRows
	}
	r.present = true
	r.hasItems = d.More()
	for d.More() {
		var row *T
		if err := d.Decode(&row); err != nil || row == nil {
			return errBridgeRows
		}
		if item, ok := any(row).(interface{ validRow() bool }); ok && !item.validRow() {
			return errBridgeRows
		}
	}
	return nil
}

// Fields mirror the types read by the desktop client. Steam is free to omit
// optional fields and to introduce extra ones, which encoding/json skips.
type bridgeFile struct {
	ID         string  `json:"publishedfileid"`
	Result     *uint32 `json:"result"`
	Title      string  `json:"title"`
	Creator    string  `json:"creator"`
	PreviewURL string  `json:"preview_url"`
	FileType   int     `json:"file_type"`
}

type bridgeTag struct {
	Tag string `json:"tag"`
}

type bridgePreview struct {
	URL  string `json:"preview_url"`
	Type int    `json:"preview_type"`
}

type bridgeListRow struct {
	bridgeFile
	Tags          *bridgeRows[bridgeTag] `json:"tags"`
	Views         int                    `json:"views"`
	Subscriptions int                    `json:"subscriptions"`
	Favorited     int                    `json:"favorited"`
}

func (r bridgeListRow) validRow() bool { return validID(r.ID) }

// Detail statistics are decoded into interface{} by the client. Steam may
// supply numbers or strings (including zero-padded strings), or omit them.
type bridgeStat struct{}

func (*bridgeStat) UnmarshalJSON(data []byte) error {
	if data[0] == '"' || data[0] == 'n' {
		return nil
	}
	var value float64
	return json.Unmarshal(data, &value)
}

type bridgeDetailRow struct {
	bridgeFile
	Tags          *bridgeRows[bridgeTag]     `json:"tags"`
	Description   string                     `json:"description"`
	FileURL       string                     `json:"file_url"`
	Previews      *bridgeRows[bridgePreview] `json:"previews"`
	FileSize      bridgeStat                 `json:"file_size"`
	TimeCreated   bridgeStat                 `json:"time_created"`
	TimeUpdated   bridgeStat                 `json:"time_updated"`
	Views         bridgeStat                 `json:"views"`
	Subscriptions bridgeStat                 `json:"subscriptions"`
	Favorited     bridgeStat                 `json:"favorited"`
	ChildItems    *bridgeRows[bridgeListRow] `json:"child_items"`
	RequiredItems *bridgeRows[bridgeListRow] `json:"required_items"`
}

func (r bridgeDetailRow) validRow() bool {
	return validID(r.ID) || (r.ID == "" && r.Result != nil && *r.Result == 9)
}

// The update client also accepts decimal strings, including leading zeros.
type bridgeUpdateTime struct{}

func (*bridgeUpdateTime) UnmarshalJSON(data []byte) error {
	if data[0] == '"' {
		var stamp string
		if err := json.Unmarshal(data, &stamp); err != nil {
			return err
		}
		_, err := strconv.ParseInt(stamp, 10, 64)
		return err
	}
	var stamp float64
	return json.Unmarshal(data, &stamp)
}

type bridgeUpdateRow struct {
	ID          string           `json:"publishedfileid"`
	Result      *uint32          `json:"result"`
	TimeUpdated bridgeUpdateTime `json:"time_updated"`
}

func (r bridgeUpdateRow) validRow() bool { return validID(r.ID) && r.Result != nil }

type bridgeChild struct {
	ID        string `json:"publishedfileid"`
	SortOrder int    `json:"sortorder"`
	FileType  int    `json:"file_type"`
}

func (r bridgeChild) validRow() bool { return validID(r.ID) }

type bridgeParseRow struct {
	bridgeFile
	Filename    string                     `json:"filename"`
	FileSize    string                     `json:"file_size"`
	FileURL     string                     `json:"file_url"`
	Description string                     `json:"file_description"`
	Previews    *bridgeRows[bridgePreview] `json:"previews"`
	Children    *bridgeRows[bridgeChild]   `json:"children"`
}

func (r bridgeParseRow) validRow() bool {
	return r.Result != nil && (validID(r.ID) || (r.ID == "" && *r.Result == 9))
}
