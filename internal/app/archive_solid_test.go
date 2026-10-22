package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"os"
	"path/filepath"
	"testing"

	"github.com/nwaples/rardecode/v2"
)

// The first two compressed streams from libarchive's generated RAR5 fixture:
// https://github.com/libarchive/libarchive/blob/master/libarchive/test/test_read_format_rar5_solid.rar.uu
// Only 671 bytes are retained; names and header checksums are rewritten below.
const rar5SolidFixture = "UmFyIRoHAQAJ78hvCwEFBwQGAQGAgIAA5TdjDCYCAwunAwSwCaSDAs1wynyAHQEIdGVzdC5iaW4KAxOLV6xb+BitHs01owEodlVWQfRgWNsMfHGMGDHxxiyyxjGWTGDBZZZZDHxsssmMYskJ8ZCSST4yEhJJJISfOSSSEISSQhCSSQkkhCEvfnvmvfNaSlc5nqnT7me2XOjL3N9v7m97810a5zfXrl+/zvlq1rVa6df3Oct+a8/ebrdvo3u5W9/4ZoAEABANSlwHzz9fn7/b6fP4/D3+72+z1en0efzeXyeLw9/vdzt9rs9jr9XqdLo8/nc3mcvlcnkcbicLg8Dfb3ebvdbncbfbbTZ7LYa/XazVanUafTaXSaLQ6DPZzN5nMV2Xy2VylVU1GTyOPx2MpqWko8XicRhsLhJ+enZybmpnAX+/Xy9Xm73a6XO5XG3222SCoUa+yogW3hbbde0swbc8IjZlzQJhCQzSUcGW0JJtLIxSrP0XCT1Vq/flrHkjIlJW4pW4FLyRYKTKilCp7qVbKlo7wWxli397LoX0vHLl9ZgpSZKgmiq5stXOFxZ0vBPE9nywNAVZQltcOXWoi/GKLB0ZZ2kLh0peumKYxpZqnLj5AvlkioagtbUl3aoparLP1hdOtKTriMzcbuknAgMLgQEEgCCkgwLGshN+wB0BCXRlc3QxLmJpbgoDE2dfrFsaWp4QRmJ+aABABADVGzBJC0+9ne/6RJBbxBbbr2oJg254RGzLmgTAEhmko4MtoSTaWRjG/BHxpLn6A2kojZlzQJfCQzSUcGW0JJtLIxjegj40lz1AbSURsy5oEvBIZpKODLaEk2lkYpTvhdljrlxu+Wuxb3V2EX64vXy4r3i4o3X/rjPwHXdWUQMFBAA="

func makeSolidRAR5Fixture(t *testing.T) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(rar5SolidFixture)
	if err != nil {
		t.Fatal(err)
	}
	for pos := 8; pos < len(b); {
		size, n := binary.Uvarint(b[pos+4:])
		if n <= 0 {
			t.Fatal("invalid fixture header")
		}
		end := pos + 4 + n + int(size)
		h := b[pos+4+n : end]
		take := func() uint64 {
			v, n := binary.Uvarint(h)
			if n <= 0 {
				t.Fatal("invalid fixture integer")
			}
			h = h[n:]
			return v
		}
		_ = take() // block type
		flags := take()
		if flags&1 != 0 {
			_ = take()
		}
		var dataSize uint64
		if flags&2 != 0 {
			dataSize = take()
		}
		copy(b[pos+4:end], bytes.ReplaceAll(b[pos+4:end], []byte(".bin"), []byte(".vpk")))
		binary.LittleEndian.PutUint32(b[pos:], crc32.ChecksumIEEE(b[pos+4:end]))
		pos = end + int(dataSize)
	}
	return b
}

func TestArchiveRAR5CompressedSolid(t *testing.T) {
	data := makeSolidRAR5Fixture(t)
	r, err := rardecode.NewReader(bytes.NewReader(data), rardecode.MaxDictionarySize(maxRARDictionarySize))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.Next(); err != nil {
		t.Fatal(err)
	}
	h, err := r.Next()
	if err != nil || !h.Solid {
		t.Fatalf("expected a solid stream, header=%+v error=%v", h, err)
	}
	path := filepath.Join(t.TempDir(), "solid.rar")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	if err := newArchiveTestApp(t).ExtractVPKFromRar(path, dest); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{
		"test.vpk":  "588870a2dade35c2650fbb7898c9a9c7f21fce7c281198604e8d0c9737f2c375",
		"test1.vpk": "7d89f86f9f69d744ffff3fc043e15bf89fc3ffc134ffcbb31d164a99bb8b67b0",
	} {
		got, err := os.ReadFile(filepath.Join(dest, name))
		if err != nil {
			t.Fatal(err)
		}
		if sum := fmt.Sprintf("%x", sha256.Sum256(got)); sum != want {
			t.Fatalf("%s checksum=%s", name, sum)
		}
	}
}
