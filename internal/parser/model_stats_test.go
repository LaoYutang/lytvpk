package parser

import (
	"encoding/binary"
	"os"
	"testing"
)

func TestParseVVDLOD0VertexCount(t *testing.T) {
	data := make([]byte, 64)
	binary.LittleEndian.PutUint32(data[0:], uint32(vvdFileID))
	binary.LittleEndian.PutUint32(data[4:], 4)
	binary.LittleEndian.PutUint32(data[12:], 3)
	binary.LittleEndian.PutUint32(data[16:], 19838)

	count, err := parseVVDLOD0VertexCount(data)
	if err != nil {
		t.Fatalf("parse VVD vertices: %v", err)
	}
	if count != 19838 {
		t.Fatalf("expected 19838 vertices, got %d", count)
	}
}

func TestParseVVDRejectsInvalidHeader(t *testing.T) {
	data := make([]byte, 64)
	binary.LittleEndian.PutUint32(data[0:], uint32(0x12345678))
	binary.LittleEndian.PutUint32(data[4:], 4)
	binary.LittleEndian.PutUint32(data[12:], 1)
	binary.LittleEndian.PutUint32(data[16:], 19838)

	if _, err := parseVVDLOD0VertexCount(data); err == nil {
		t.Fatalf("expected invalid VVD header to fail")
	}
}

func TestParseVTXLOD0TriangleCountTriListPackOne(t *testing.T) {
	data := buildMinimalVTXFixture(t, 300, 0x01)

	stats, err := parseVTXLOD0Stats(data)
	if err != nil {
		t.Fatalf("parse VTX triangles: %v", err)
	}
	if stats.TriangleStripEstimated {
		t.Fatalf("tri-list should not be marked estimated")
	}
	if stats.Triangles != 100 {
		t.Fatalf("expected 100 triangles, got %d", stats.Triangles)
	}
}

func TestParseVTXLOD0StatsReadsStripGroupVerticesAndIndices(t *testing.T) {
	data := buildMinimalVTXFixture(t, 300, 0x01)
	binary.LittleEndian.PutUint32(data[stripGroupFixtureOffset:], 1234)

	stats, err := parseVTXLOD0Stats(data)
	if err != nil {
		t.Fatalf("parse VTX strip groups: %v", err)
	}
	if stats.TotalStripGroupVertices != 1234 {
		t.Fatalf("expected total strip group vertices 1234, got %d", stats.TotalStripGroupVertices)
	}
	if stats.MaxStripGroupVertices != 1234 {
		t.Fatalf("expected max strip group vertices 1234, got %d", stats.MaxStripGroupVertices)
	}
	if stats.TotalStripGroupIndices != 300 {
		t.Fatalf("expected total strip group indices 300, got %d", stats.TotalStripGroupIndices)
	}
	if stats.MaxStripGroupIndices != 300 {
		t.Fatalf("expected max strip group indices 300, got %d", stats.MaxStripGroupIndices)
	}
	if len(stats.StripGroups) != 1 {
		t.Fatalf("expected one strip group, got %d", len(stats.StripGroups))
	}
	group := stats.StripGroups[0]
	if group.BodyPart != 0 || group.Model != 0 || group.Mesh != 0 || group.StripGroup != 0 {
		t.Fatalf("unexpected strip group location: %+v", group)
	}
	if group.Vertices != 1234 || group.Indices != 300 || group.Triangles != 100 {
		t.Fatalf("unexpected strip group stats: %+v", group)
	}
}

func TestParseVTXLOD0TriangleCountTriStripMarksEstimated(t *testing.T) {
	data := buildMinimalVTXFixture(t, 102, 0x02)

	stats, err := parseVTXLOD0Stats(data)
	if err != nil {
		t.Fatalf("parse VTX triangles: %v", err)
	}
	if !stats.TriangleStripEstimated {
		t.Fatalf("tri-strip should be marked estimated")
	}
	if stats.Triangles != 100 {
		t.Fatalf("expected 100 triangles, got %d", stats.Triangles)
	}
}

func TestParseVTXRejectsOutOfRangePackedOffsets(t *testing.T) {
	data := buildMinimalVTXFixture(t, 300, 0x01)
	binary.LittleEndian.PutUint32(data[32:], 999999)

	if _, err := parseVTXLOD0Stats(data); err == nil {
		t.Fatalf("expected bad bodypart offset to fail")
	}
}

func TestParseVTXLOD0StatsAcceptsDirtyHighBytesInBodyPartCount(t *testing.T) {
	data := buildMinimalVTXFixture(t, 300, 0x01)
	binary.LittleEndian.PutUint32(data[28:], 0x00238401)

	stats, err := parseVTXLOD0Stats(data)
	if err != nil {
		t.Fatalf("parse VTX with dirty bodypart count high bytes: %v", err)
	}
	if stats.Triangles != 100 {
		t.Fatalf("expected 100 triangles, got %d", stats.Triangles)
	}
}

func TestParseVTXRejectsUnsupportedVersion(t *testing.T) {
	data := buildMinimalVTXFixture(t, 300, 0x01)
	binary.LittleEndian.PutUint32(data[0:], 6)

	if _, err := parseVTXLOD0Stats(data); err == nil {
		t.Fatalf("expected unsupported VTX version to fail")
	}
}

func TestAnalyzeVPKModelStatsExternalFixture(t *testing.T) {
	fixture := os.Getenv("LYTVPK_MODEL_STATS_FIXTURE")
	if fixture == "" {
		t.Skip("set LYTVPK_MODEL_STATS_FIXTURE to run external VPK model stats verification")
	}

	stats, err := AnalyzeVPKModelStats(fixture)
	if err != nil {
		t.Fatalf("analyze external VPK: %v", err)
	}
	if stats.ModelCount == 0 {
		t.Fatalf("expected at least one model in external VPK")
	}
	if stats.TotalVertices == 0 || stats.TotalTriangles == 0 {
		t.Fatalf("expected non-zero geometry counts, got vertices=%d triangles=%d stats=%+v", stats.TotalVertices, stats.TotalTriangles, stats)
	}
	t.Logf("external VPK model stats: models=%d vertices=%d triangles=%d", stats.ModelCount, stats.TotalVertices, stats.TotalTriangles)
}

func buildMinimalVTXFixture(t *testing.T, stripIndices int, flags byte) []byte {
	t.Helper()

	const (
		headerOffset     = 36
		bodyPartOffset   = headerOffset
		modelOffset      = bodyPartOffset + 8
		lodOffset        = modelOffset + 8
		meshOffset       = lodOffset + 12
		stripGroupOffset = meshOffset + 9
		stripOffset      = stripGroupOffset + 25
	)

	data := make([]byte, stripOffset+27)
	binary.LittleEndian.PutUint32(data[0:], 7)
	binary.LittleEndian.PutUint32(data[20:], 1)
	binary.LittleEndian.PutUint32(data[28:], 1)
	binary.LittleEndian.PutUint32(data[32:], bodyPartOffset)

	binary.LittleEndian.PutUint32(data[bodyPartOffset:], 1)
	binary.LittleEndian.PutUint32(data[bodyPartOffset+4:], uint32(modelOffset-bodyPartOffset))

	binary.LittleEndian.PutUint32(data[modelOffset:], 1)
	binary.LittleEndian.PutUint32(data[modelOffset+4:], uint32(lodOffset-modelOffset))

	binary.LittleEndian.PutUint32(data[lodOffset:], 1)
	binary.LittleEndian.PutUint32(data[lodOffset+4:], uint32(meshOffset-lodOffset))

	binary.LittleEndian.PutUint32(data[meshOffset:], 1)
	binary.LittleEndian.PutUint32(data[meshOffset+4:], uint32(stripGroupOffset-meshOffset))

	binary.LittleEndian.PutUint32(data[stripGroupOffset+8:], uint32(stripIndices))
	binary.LittleEndian.PutUint32(data[stripGroupOffset+16:], 1)
	binary.LittleEndian.PutUint32(data[stripGroupOffset+20:], uint32(stripOffset-stripGroupOffset))

	binary.LittleEndian.PutUint32(data[stripOffset:], uint32(stripIndices))
	data[stripOffset+18] = flags

	return data
}

const stripGroupFixtureOffset = 36 + 8 + 8 + 12 + 9
