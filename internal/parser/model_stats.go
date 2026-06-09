package parser

import (
	"encoding/binary"
	"fmt"
	"io"
	"path"
	"strings"

	"l4d2-manager-next/pkg/valve/vpk"
)

const (
	vvdFileID      = 0x56534449
	vvdFileVersion = 4

	vtxFileVersion = 7

	vtxHeaderSize     = 36
	vtxBodyPartSize   = 8
	vtxModelSize      = 8
	vtxModelLODSize   = 12
	vtxMeshSize       = 9
	vtxStripGroupSize = 25
	vtxStripSize      = 27

	vtxStripIsTriList  = 0x01
	vtxStripIsTriStrip = 0x02
)

// ModelStat describes one Source model's render-time LOD0 geometry counts.
type ModelStat struct {
	Path                   string                `json:"path"`
	VVDPath                string                `json:"vvdPath,omitempty"`
	VTXPath                string                `json:"vtxPath,omitempty"`
	LOD                    int                   `json:"lod"`
	Vertices               int                   `json:"vertices"`
	Triangles              int                   `json:"triangles"`
	StripGroupVertices     int                   `json:"stripGroupVertices"`
	StripGroupIndices      int                   `json:"stripGroupIndices"`
	MaxStripGroupVertices  int                   `json:"maxStripGroupVertices"`
	MaxStripGroupIndices   int                   `json:"maxStripGroupIndices"`
	StripGroupCount        int                   `json:"stripGroupCount"`
	TriangleStripEstimated bool                  `json:"triangleStripEstimated"`
	StripGroups            []ModelStripGroupStat `json:"stripGroups"`
	Message                string                `json:"message,omitempty"`
}

// ModelStripGroupStat describes one LOD0 VTX strip group inside a model.
type ModelStripGroupStat struct {
	BodyPart               int  `json:"bodyPart"`
	Model                  int  `json:"model"`
	Mesh                   int  `json:"mesh"`
	StripGroup             int  `json:"stripGroup"`
	Vertices               int  `json:"vertices"`
	Indices                int  `json:"indices"`
	Strips                 int  `json:"strips"`
	Triangles              int  `json:"triangles"`
	TriangleStripEstimated bool `json:"triangleStripEstimated"`
}

// VPKModelStats is the per-VPK aggregate returned by the model statistics parser.
type VPKModelStats struct {
	ModelCount     int         `json:"modelCount"`
	TotalVertices  int         `json:"totalVertices"`
	TotalTriangles int         `json:"totalTriangles"`
	Models         []ModelStat `json:"models"`
	Message        string      `json:"message,omitempty"`
}

// AnalyzeVPKModelStats reads a VPK and returns LOD0 vertex/triangle counts for contained models.
func AnalyzeVPKModelStats(filePath string) (VPKModelStats, error) {
	opener := vpk.Single(filePath)
	defer opener.Close()

	archive, err := opener.ReadArchive()
	if err != nil {
		return VPKModelStats{}, err
	}

	files := make(map[string]*vpk.File, len(archive.Files))
	modelPaths := make([]string, 0)
	for i := range archive.Files {
		file := &archive.Files[i]
		name := normalizeModelStatPath(file.Name())
		files[name] = file
		if isModelMDLPath(name) {
			modelPaths = append(modelPaths, name)
		}
	}

	result := VPKModelStats{
		ModelCount: len(modelPaths),
		Models:     make([]ModelStat, 0, len(modelPaths)),
	}
	if len(modelPaths) == 0 {
		return result, nil
	}

	for _, mdlPath := range modelPaths {
		stat := ModelStat{
			Path: mdlPath,
			LOD:  0,
		}
		base := strings.TrimSuffix(mdlPath, ".mdl")
		vvdPath := base + ".vvd"
		vtxPath := base + ".dx90.vtx"

		vvdFile := files[vvdPath]
		if vvdFile == nil {
			stat.Message = appendModelStatMessage(stat.Message, "缺少 .vvd")
		} else {
			stat.VVDPath = vvdPath
			data, err := readVPKFileBytes(opener, vvdFile)
			if err != nil {
				stat.Message = appendModelStatMessage(stat.Message, "读取 .vvd 失败: "+err.Error())
			} else if vertices, err := parseVVDLOD0VertexCount(data); err != nil {
				stat.Message = appendModelStatMessage(stat.Message, "解析 .vvd 失败: "+err.Error())
			} else {
				stat.Vertices = vertices
			}
		}

		vtxFile := files[vtxPath]
		if vtxFile == nil {
			stat.Message = appendModelStatMessage(stat.Message, "缺少 .dx90.vtx")
		} else {
			stat.VTXPath = vtxPath
			data, err := readVPKFileBytes(opener, vtxFile)
			if err != nil {
				stat.Message = appendModelStatMessage(stat.Message, "读取 .dx90.vtx 失败: "+err.Error())
			} else if vtxStats, err := parseVTXLOD0Stats(data); err != nil {
				stat.Message = appendModelStatMessage(stat.Message, "解析 .dx90.vtx 失败: "+err.Error())
			} else {
				stat.Triangles = vtxStats.Triangles
				stat.StripGroupVertices = vtxStats.TotalStripGroupVertices
				stat.StripGroupIndices = vtxStats.TotalStripGroupIndices
				stat.MaxStripGroupVertices = vtxStats.MaxStripGroupVertices
				stat.MaxStripGroupIndices = vtxStats.MaxStripGroupIndices
				stat.StripGroupCount = len(vtxStats.StripGroups)
				stat.TriangleStripEstimated = vtxStats.TriangleStripEstimated
				stat.StripGroups = vtxStats.StripGroups
			}
		}

		result.TotalVertices += stat.Vertices
		result.TotalTriangles += stat.Triangles
		result.Models = append(result.Models, stat)
	}

	return result, nil
}

func parseVVDLOD0VertexCount(data []byte) (int, error) {
	if len(data) < 64 {
		return 0, fmt.Errorf("文件头过小")
	}
	if id := int32At(data, 0); id != vvdFileID {
		return 0, fmt.Errorf("VVD 标识无效")
	}
	if version := int32At(data, 4); version != vvdFileVersion {
		return 0, fmt.Errorf("VVD 版本不支持: %d", version)
	}
	numLODs := int32At(data, 12)
	if numLODs <= 0 || numLODs > 8 {
		return 0, fmt.Errorf("LOD 数量无效")
	}
	vertices := int32At(data, 16)
	if vertices < 0 {
		return 0, fmt.Errorf("LOD0 顶点数无效")
	}
	return int(vertices), nil
}

type vtxLOD0Stats struct {
	Triangles               int
	TotalStripGroupVertices int
	TotalStripGroupIndices  int
	MaxStripGroupVertices   int
	MaxStripGroupIndices    int
	TriangleStripEstimated  bool
	StripGroups             []ModelStripGroupStat
}

func parseVTXLOD0Stats(data []byte) (vtxLOD0Stats, error) {
	if len(data) < vtxHeaderSize {
		return vtxLOD0Stats{}, fmt.Errorf("文件头过小")
	}
	if version := int32At(data, 0); version != vtxFileVersion {
		return vtxLOD0Stats{}, fmt.Errorf("VTX 版本不支持: %d", version)
	}

	numBodyParts, err := parseVTXBodyPartCount(data, 28)
	if err != nil {
		return vtxLOD0Stats{}, err
	}
	bodyPartOffset, err := safeI32(data, 32)
	if err != nil {
		return vtxLOD0Stats{}, err
	}
	stats := vtxLOD0Stats{}
	for bp := 0; bp < numBodyParts; bp++ {
		bpOff := bodyPartOffset + bp*vtxBodyPartSize
		if err := requireRange(data, bpOff, vtxBodyPartSize); err != nil {
			return vtxLOD0Stats{}, fmt.Errorf("bodypart 偏移无效: %w", err)
		}
		numModels := int32At(data, bpOff)
		modelOffset := int32At(data, bpOff+4)
		if numModels < 0 || numModels > 4096 {
			return vtxLOD0Stats{}, fmt.Errorf("model 数量无效")
		}

		for model := 0; model < numModels; model++ {
			modelOff := bpOff + modelOffset + model*vtxModelSize
			if err := requireRange(data, modelOff, vtxModelSize); err != nil {
				return vtxLOD0Stats{}, fmt.Errorf("model 偏移无效: %w", err)
			}
			numLODs := int32At(data, modelOff)
			lodOffset := int32At(data, modelOff+4)
			if numLODs <= 0 {
				continue
			}

			lodOff := modelOff + lodOffset
			lodStats, err := parseVTXLOD0Model(data, lodOff, bp, model)
			if err != nil {
				return vtxLOD0Stats{}, err
			}
			stats.add(lodStats)
		}
	}

	return stats, nil
}

func parseVTXBodyPartCount(data []byte, offset int) (int, error) {
	count, err := safeI32(data, offset)
	if err != nil {
		return 0, err
	}
	if count >= 0 && count <= 4096 {
		return count, nil
	}

	// Some third-party compiled VTX files keep a valid low-byte count but leave
	// garbage in the high bytes. Range checks below still guard every bodypart.
	if err := requireRange(data, offset, 1); err != nil {
		return 0, err
	}
	fallback := int(data[offset])
	if fallback > 0 && fallback <= 4096 {
		return fallback, nil
	}
	return 0, fmt.Errorf("bodypart 数量无效")
}

func (stats *vtxLOD0Stats) add(next vtxLOD0Stats) {
	stats.Triangles += next.Triangles
	stats.TotalStripGroupVertices += next.TotalStripGroupVertices
	stats.TotalStripGroupIndices += next.TotalStripGroupIndices
	stats.MaxStripGroupVertices = max(stats.MaxStripGroupVertices, next.MaxStripGroupVertices)
	stats.MaxStripGroupIndices = max(stats.MaxStripGroupIndices, next.MaxStripGroupIndices)
	stats.TriangleStripEstimated = stats.TriangleStripEstimated || next.TriangleStripEstimated
	stats.StripGroups = append(stats.StripGroups, next.StripGroups...)
}

func parseVTXLOD0Model(data []byte, lodOff, bodyPartIndex, modelIndex int) (vtxLOD0Stats, error) {
	if err := requireRange(data, lodOff, vtxModelLODSize); err != nil {
		return vtxLOD0Stats{}, fmt.Errorf("lod 偏移无效: %w", err)
	}
	numMeshes := int32At(data, lodOff)
	meshOffset := int32At(data, lodOff+4)
	if numMeshes < 0 || numMeshes > 65536 {
		return vtxLOD0Stats{}, fmt.Errorf("mesh 数量无效")
	}

	stats := vtxLOD0Stats{}
	for mesh := 0; mesh < numMeshes; mesh++ {
		meshOff := lodOff + meshOffset + mesh*vtxMeshSize
		if err := requireRange(data, meshOff, vtxMeshSize); err != nil {
			return vtxLOD0Stats{}, fmt.Errorf("mesh 偏移无效: %w", err)
		}
		numStripGroups := int32At(data, meshOff)
		stripGroupOffset := int32At(data, meshOff+4)
		if numStripGroups < 0 || numStripGroups > 65536 {
			return vtxLOD0Stats{}, fmt.Errorf("stripgroup 数量无效")
		}

		for sg := 0; sg < numStripGroups; sg++ {
			sgOff := meshOff + stripGroupOffset + sg*vtxStripGroupSize
			group, err := parseVTXStripGroup(data, sgOff)
			if err != nil {
				return vtxLOD0Stats{}, err
			}
			group.BodyPart = bodyPartIndex
			group.Model = modelIndex
			group.Mesh = mesh
			group.StripGroup = sg
			stats.Triangles += group.Triangles
			stats.TotalStripGroupVertices += group.Vertices
			stats.TotalStripGroupIndices += group.Indices
			stats.MaxStripGroupVertices = max(stats.MaxStripGroupVertices, group.Vertices)
			stats.MaxStripGroupIndices = max(stats.MaxStripGroupIndices, group.Indices)
			stats.TriangleStripEstimated = stats.TriangleStripEstimated || group.TriangleStripEstimated
			stats.StripGroups = append(stats.StripGroups, group)
		}
	}

	return stats, nil
}

func parseVTXStripGroup(data []byte, sgOff int) (ModelStripGroupStat, error) {
	if err := requireRange(data, sgOff, vtxStripGroupSize); err != nil {
		return ModelStripGroupStat{}, fmt.Errorf("stripgroup 偏移无效: %w", err)
	}
	numVerts := int32At(data, sgOff)
	numIndices := int32At(data, sgOff+8)
	numStrips := int32At(data, sgOff+16)
	stripOffset := int32At(data, sgOff+20)
	if numVerts < 0 || numIndices < 0 || numStrips < 0 || numStrips > 65536 {
		return ModelStripGroupStat{}, fmt.Errorf("strip 数据无效")
	}
	group := ModelStripGroupStat{
		Vertices: int(numVerts),
		Indices:  int(numIndices),
		Strips:   int(numStrips),
	}
	if numStrips == 0 && numIndices > 0 {
		group.Triangles = numIndices / 3
		return group, nil
	}

	for strip := 0; strip < numStrips; strip++ {
		stripOff := sgOff + stripOffset + strip*vtxStripSize
		if err := requireRange(data, stripOff, vtxStripSize); err != nil {
			return ModelStripGroupStat{}, fmt.Errorf("strip 偏移无效: %w", err)
		}
		stripIndices := int32At(data, stripOff)
		if stripIndices < 0 {
			return ModelStripGroupStat{}, fmt.Errorf("strip index 数量无效")
		}
		flags := data[stripOff+18]
		if flags&vtxStripIsTriStrip != 0 {
			group.Triangles += max(0, stripIndices-2)
			group.TriangleStripEstimated = true
			continue
		}
		group.Triangles += stripIndices / 3
	}

	return group, nil
}

func readVPKFileBytes(opener *vpk.Opener, file *vpk.File) ([]byte, error) {
	reader, err := file.Open(opener)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func normalizeModelStatPath(value string) string {
	value = strings.ReplaceAll(value, "\\", "/")
	value = path.Clean(value)
	value = strings.TrimPrefix(value, "./")
	return strings.ToLower(value)
}

func isModelMDLPath(value string) bool {
	return strings.HasPrefix(value, "models/") && strings.HasSuffix(value, ".mdl")
}

func appendModelStatMessage(current, next string) string {
	if current == "" {
		return next
	}
	return current + "；" + next
}

func safeI32(data []byte, offset int) (int, error) {
	if err := requireRange(data, offset, 4); err != nil {
		return 0, err
	}
	return int(int32At(data, offset)), nil
}

func int32At(data []byte, offset int) int {
	return int(int32(binary.LittleEndian.Uint32(data[offset : offset+4])))
}

func requireRange(data []byte, offset, size int) error {
	if offset < 0 || size < 0 || offset > len(data)-size {
		return fmt.Errorf("offset=%d size=%d len=%d", offset, size, len(data))
	}
	return nil
}
