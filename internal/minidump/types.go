package minidump

type Report struct {
	File              FileInfo          `json:"file"`
	Header            HeaderInfo        `json:"header"`
	Streams           []StreamInfo      `json:"streams"`
	System            *SystemInfo       `json:"system,omitempty"`
	Misc              *MiscInfo         `json:"misc,omitempty"`
	Exception         *ExceptionInfo    `json:"exception,omitempty"`
	ExceptionModule   *ModuleHit        `json:"exceptionModule,omitempty"`
	Threads           []ThreadInfo      `json:"threads"`
	ThreadNames       []ThreadName      `json:"threadNames"`
	Modules           []ModuleInfo      `json:"modules"`
	MemoryRanges      []MemoryRange     `json:"memoryRanges"`
	MemoryInfo        []MemoryInfoEntry `json:"memoryInfo"`
	SystemMemory      *RawFieldStream   `json:"systemMemory,omitempty"`
	ProcessVMCounters *RawFieldStream   `json:"processVmCounters,omitempty"`
	Comments          []CommentInfo     `json:"comments"`
	ParseWarnings     []string          `json:"parseWarnings"`
}

type FileInfo struct {
	Path         string `json:"path"`
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	LastModified string `json:"lastModified"`
}

type HeaderInfo struct {
	Signature             string   `json:"signature"`
	SignatureASCII        string   `json:"signatureAscii"`
	Version               string   `json:"version"`
	FormatVersion         int      `json:"formatVersion"`
	ImplementationVersion int      `json:"implementationVersion"`
	NumberOfStreams       uint32   `json:"numberOfStreams"`
	StreamDirectoryRVA    string   `json:"streamDirectoryRva"`
	Checksum              string   `json:"checksum"`
	TimeDateStampUnix     uint32   `json:"timeDateStampUnix"`
	TimeDateStampUTC      string   `json:"timeDateStampUtc"`
	Flags                 string   `json:"flags"`
	FlagNames             []string `json:"flagNames"`
}

type StreamInfo struct {
	Index int    `json:"index"`
	Type  uint32 `json:"type"`
	Name  string `json:"name"`
	Size  uint32 `json:"size"`
	RVA   string `json:"rva"`
	End   string `json:"end"`
}

type SystemInfo struct {
	ProcessorArchitecture string       `json:"processorArchitecture"`
	ArchitectureName      string       `json:"architectureName"`
	ProcessorLevel        uint16       `json:"processorLevel"`
	ProcessorRevision     string       `json:"processorRevision"`
	NumberOfProcessors    uint8        `json:"numberOfProcessors"`
	ProductType           uint8        `json:"productType"`
	ProductTypeName       string       `json:"productTypeName"`
	MajorVersion          uint32       `json:"majorVersion"`
	MinorVersion          uint32       `json:"minorVersion"`
	BuildNumber           uint32       `json:"buildNumber"`
	PlatformID            uint32       `json:"platformId"`
	PlatformName          string       `json:"platformName"`
	CSDVersion            string       `json:"csdVersion"`
	SuiteMask             string       `json:"suiteMask"`
	CPUVendor             string       `json:"cpuVendor"`
	CPUVersion            string       `json:"cpuVersion"`
	CPUFeatures           string       `json:"cpuFeatures"`
	AMDExtendedFeatures   string       `json:"amdExtendedFeatures"`
	ProcessorFeatures     []NamedValue `json:"processorFeatures"`
}

type MiscInfo struct {
	SizeOfInfo                uint32       `json:"sizeOfInfo"`
	Flags1                    string       `json:"flags1"`
	FlagNames                 []string     `json:"flagNames"`
	ProcessID                 uint32       `json:"processId"`
	ProcessCreateTimeUnix     uint32       `json:"processCreateTimeUnix"`
	ProcessCreateTimeUTC      string       `json:"processCreateTimeUtc"`
	ProcessUserTimeSeconds    uint32       `json:"processUserTimeSeconds"`
	ProcessKernelTimeSeconds  uint32       `json:"processKernelTimeSeconds"`
	ProcessorMaxMHz           uint32       `json:"processorMaxMhz"`
	ProcessorCurrentMHz       uint32       `json:"processorCurrentMhz"`
	ProcessorMhzLimit         uint32       `json:"processorMhzLimit"`
	ProcessorMaxIdleState     uint32       `json:"processorMaxIdleState"`
	ProcessorCurrentIdleState uint32       `json:"processorCurrentIdleState"`
	RawFields                 []NamedValue `json:"rawFields"`
}

type ExceptionInfo struct {
	ThreadID          uint32      `json:"threadId"`
	Code              string      `json:"code"`
	CodeName          string      `json:"codeName"`
	Flags             string      `json:"flags"`
	Record            string      `json:"record"`
	Address           string      `json:"address"`
	NumberParameters  uint32      `json:"numberParameters"`
	Parameters        []string    `json:"parameters"`
	ContextDescriptor Location    `json:"contextDescriptor"`
	Context           ContextInfo `json:"context"`
}

type ContextInfo struct {
	Architecture string            `json:"architecture"`
	Size         uint32            `json:"size"`
	RVA          string            `json:"rva"`
	ContextFlags string            `json:"contextFlags"`
	Registers    map[string]string `json:"registers"`
	Preview      HexPreview        `json:"preview"`
}

type ThreadInfo struct {
	ThreadID      uint32       `json:"threadId"`
	Name          string       `json:"name"`
	SuspendCount  uint32       `json:"suspendCount"`
	PriorityClass uint32       `json:"priorityClass"`
	Priority      uint32       `json:"priority"`
	TEB           string       `json:"teb"`
	Stack         MemoryBlock  `json:"stack"`
	Context       ContextInfo  `json:"context"`
	ThreadState   *ThreadState `json:"threadState,omitempty"`
}

type ThreadState struct {
	DumpFlags       string   `json:"dumpFlags"`
	DumpFlagNames   []string `json:"dumpFlagNames"`
	DumpError       string   `json:"dumpError"`
	ExitStatus      string   `json:"exitStatus"`
	CreateTimeUTC   string   `json:"createTimeUtc"`
	ExitTimeUTC     string   `json:"exitTimeUtc"`
	KernelTime100NS string   `json:"kernelTime100ns"`
	UserTime100NS   string   `json:"userTime100ns"`
	StartAddress    string   `json:"startAddress"`
	Affinity        string   `json:"affinity"`
}

type ThreadName struct {
	ThreadID uint32 `json:"threadId"`
	Name     string `json:"name"`
}

type ModuleInfo struct {
	Index             int           `json:"index"`
	BaseAddress       string        `json:"baseAddress"`
	EndAddress        string        `json:"endAddress"`
	SizeOfImage       uint32        `json:"sizeOfImage"`
	Checksum          string        `json:"checksum"`
	TimeDateStampUnix uint32        `json:"timeDateStampUnix"`
	TimeDateStampUTC  string        `json:"timeDateStampUtc"`
	Path              string        `json:"path"`
	FileName          string        `json:"fileName"`
	Version           VersionInfo   `json:"version"`
	CodeView          *CodeViewInfo `json:"codeView,omitempty"`
	CvRecord          Location      `json:"cvRecord"`
	MiscRecord        Location      `json:"miscRecord"`
}

type ModuleHit struct {
	Index       int    `json:"index"`
	Path        string `json:"path"`
	FileName    string `json:"fileName"`
	BaseAddress string `json:"baseAddress"`
	SizeOfImage uint32 `json:"sizeOfImage"`
	Offset      string `json:"offset"`
}

type VersionInfo struct {
	Signature      string `json:"signature"`
	StructVersion  string `json:"structVersion"`
	FileVersion    string `json:"fileVersion"`
	ProductVersion string `json:"productVersion"`
	FileFlagsMask  string `json:"fileFlagsMask"`
	FileFlags      string `json:"fileFlags"`
	FileOS         string `json:"fileOs"`
	FileType       string `json:"fileType"`
	FileTypeName   string `json:"fileTypeName"`
	FileSubtype    string `json:"fileSubtype"`
	FileDate       string `json:"fileDate"`
}

type CodeViewInfo struct {
	Signature string `json:"signature"`
	GUID      string `json:"guid,omitempty"`
	Age       uint32 `json:"age,omitempty"`
	PDBPath   string `json:"pdbPath,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
}

type MemoryRange struct {
	Index        int        `json:"index"`
	Source       string     `json:"source"`
	StartAddress string     `json:"startAddress"`
	EndAddress   string     `json:"endAddress"`
	Size         uint64     `json:"size"`
	RVA          string     `json:"rva"`
	Preview      HexPreview `json:"preview"`
}

type MemoryInfoEntry struct {
	Index                 int    `json:"index"`
	BaseAddress           string `json:"baseAddress"`
	AllocationBase        string `json:"allocationBase"`
	AllocationProtect     string `json:"allocationProtect"`
	AllocationProtectName string `json:"allocationProtectName"`
	RegionSize            uint64 `json:"regionSize"`
	State                 string `json:"state"`
	StateName             string `json:"stateName"`
	Protect               string `json:"protect"`
	ProtectName           string `json:"protectName"`
	Type                  string `json:"type"`
	TypeName              string `json:"typeName"`
}

type MemoryBlock struct {
	StartAddress string     `json:"startAddress"`
	EndAddress   string     `json:"endAddress"`
	Size         uint32     `json:"size"`
	RVA          string     `json:"rva"`
	Preview      HexPreview `json:"preview"`
}

type Location struct {
	Size uint32 `json:"size"`
	RVA  string `json:"rva"`
}

type RawFieldStream struct {
	Size    uint32       `json:"size"`
	Fields  []NamedValue `json:"fields"`
	Preview HexPreview   `json:"preview"`
}

type NamedValue struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Hex     string `json:"hex,omitempty"`
	Display string `json:"display,omitempty"`
}

type HexPreview struct {
	Bytes     uint32 `json:"bytes"`
	Truncated bool   `json:"truncated"`
	Text      string `json:"text"`
}

type CommentInfo struct {
	Stream string `json:"stream"`
	Text   string `json:"text"`
}
