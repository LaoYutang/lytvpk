package minidump

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

type directory struct {
	index int
	typ   uint32
	size  uint32
	rva   uint32
}

type parser struct {
	data        []byte
	report      Report
	directories []directory
	streams     map[uint32]directory
	systemArch  uint16
}

func ParseFile(path string) (Report, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return Report{}, fmt.Errorf("MDMP 文件路径不能为空")
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Report{}, fmt.Errorf("MDMP 文件不存在: %s", path)
		}
		return Report{}, fmt.Errorf("无法访问 MDMP 文件: %v", err)
	}
	if info.IsDir() {
		return Report{}, fmt.Errorf("请选择 MDMP 文件，而不是文件夹")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return Report{}, fmt.Errorf("读取 MDMP 文件失败: %v", err)
	}

	p := &parser{
		data:    data,
		streams: make(map[uint32]directory),
		report: Report{
			File: FileInfo{
				Path:         path,
				Name:         filepath.Base(path),
				Size:         info.Size(),
				LastModified: info.ModTime().Format(time.RFC3339),
			},
			Threads:      []ThreadInfo{},
			ThreadNames:  []ThreadName{},
			Modules:      []ModuleInfo{},
			MemoryRanges: []MemoryRange{},
			MemoryInfo:   []MemoryInfoEntry{},
			Comments:     []CommentInfo{},
		},
	}

	if err := p.parse(); err != nil {
		return Report{}, err
	}
	return p.report, nil
}

func (p *parser) parse() error {
	if len(p.data) < 32 {
		return fmt.Errorf("MDMP 文件过短，缺少 header")
	}

	signature := p.u32(0)
	if signature != minidumpSignature {
		return fmt.Errorf("不是有效的 MDMP 文件，签名为 %s", hex32(signature))
	}

	version := p.u32(4)
	streamCount := p.u32(8)
	dirRVA := p.u32(12)
	checksum := p.u32(16)
	timeDateStamp := p.u32(20)
	flags := p.u64(24)

	dirBytes := uint64(streamCount) * 12
	if err := p.checkRange(uint64(dirRVA), dirBytes); err != nil {
		return fmt.Errorf("stream directory 越界: %v", err)
	}

	p.report.Header = HeaderInfo{
		Signature:             hex32(signature),
		SignatureASCII:        "MDMP",
		Version:               hex32(version),
		FormatVersion:         int(version & 0xffff),
		ImplementationVersion: int(version >> 16),
		NumberOfStreams:       streamCount,
		StreamDirectoryRVA:    hex32(dirRVA),
		Checksum:              hex32(checksum),
		TimeDateStampUnix:     timeDateStamp,
		TimeDateStampUTC:      unix32UTC(timeDateStamp),
		Flags:                 hex64(flags),
		FlagNames:             namesForFlags(flags, minidumpFlagNames),
	}

	p.directories = make([]directory, 0, streamCount)
	for i := uint32(0); i < streamCount; i++ {
		off := uint64(dirRVA) + uint64(i)*12
		d := directory{
			index: int(i),
			typ:   p.u32(off),
			size:  p.u32(off + 4),
			rva:   p.u32(off + 8),
		}
		p.directories = append(p.directories, d)
		p.report.Streams = append(p.report.Streams, StreamInfo{
			Index: d.index,
			Type:  d.typ,
			Name:  streamName(d.typ),
			Size:  d.size,
			RVA:   hex32(d.rva),
			End:   hex32(d.rva + d.size),
		})
		if d.size > 0 {
			if _, exists := p.streams[d.typ]; !exists {
				p.streams[d.typ] = d
			}
		}
	}

	p.parseOptional(streamSystemInfo, "SystemInfoStream", p.parseSystemInfo)
	p.parseOptional(streamMiscInfo, "MiscInfoStream", p.parseMiscInfo)
	p.parseOptional(streamCommentA, "CommentStreamA", p.parseCommentA)
	p.parseOptional(streamCommentW, "CommentStreamW", p.parseCommentW)
	p.parseOptional(streamThreadNames, "ThreadNamesStream", p.parseThreadNames)
	p.parseOptional(streamModuleList, "ModuleListStream", p.parseModules)
	p.parseOptional(streamMemoryList, "MemoryListStream", p.parseMemoryList)
	p.parseOptional(streamMemory64List, "Memory64ListStream", p.parseMemory64List)
	p.parseOptional(streamMemoryInfoList, "MemoryInfoListStream", p.parseMemoryInfoList)
	p.parseOptional(streamSystemMemoryInfo, "SystemMemoryInfoStream", p.parseSystemMemoryInfo)
	p.parseOptional(streamProcessVMCounters, "ProcessVmCountersStream", p.parseProcessVMCounters)
	p.parseOptional(streamException, "ExceptionStream", p.parseException)

	threadStates := map[uint32]*ThreadState{}
	p.parseOptionalWithResult(streamThreadInfoList, "ThreadInfoListStream", func(d directory) error {
		states, err := p.parseThreadInfoList(d)
		if err == nil {
			threadStates = states
		}
		return err
	})
	p.parseOptionalWithResult(streamThreadList, "ThreadListStream", func(d directory) error {
		return p.parseThreads(d, threadStates)
	})

	p.attachExceptionModule()
	return nil
}

func (p *parser) parseOptional(streamType uint32, label string, fn func(directory) error) {
	p.parseOptionalWithResult(streamType, label, fn)
}

func (p *parser) parseOptionalWithResult(streamType uint32, label string, fn func(directory) error) {
	d, ok := p.streams[streamType]
	if !ok {
		return
	}
	if err := fn(d); err != nil {
		p.warn("%s 解析失败: %v", label, err)
	}
}

func (p *parser) parseSystemInfo(d directory) error {
	if err := p.checkStream(d, 56); err != nil {
		return err
	}
	off := uint64(d.rva)
	arch := p.u16(off)
	p.systemArch = arch
	csd, err := p.readMinidumpString(uint64(p.u32(off + 24)))
	if err != nil {
		p.warn("SystemInfoStream CSDVersion 读取失败: %v", err)
	}

	cpuVendor := ""
	cpuVersion := ""
	cpuFeatures := ""
	amdFeatures := ""
	processorFeatures := []NamedValue{}
	if arch == 0 || arch == 9 {
		vendorBytes := make([]byte, 0, 12)
		for i := uint64(0); i < 3; i++ {
			vendorBytes = append(vendorBytes, uint32Bytes(p.u32(off+32+i*4))...)
		}
		cpuVendor = strings.TrimRight(string(vendorBytes), "\x00")
		if d.size >= 52 {
			cpuVersion = hex32(p.u32(off + 48))
		}
		if d.size >= 56 {
			cpuFeatures = hex32(p.u32(off + 52))
		}
		if d.size >= 60 {
			amdFeatures = hex32(p.u32(off + 56))
		}
	} else {
		for i := uint64(0); i < 2 && 36+(i+1)*8 <= uint64(d.size); i++ {
			value := p.u64(off + 36 + i*8)
			processorFeatures = append(processorFeatures, NamedValue{
				Name:  fmt.Sprintf("ProcessorFeatures[%d]", i),
				Value: fmt.Sprintf("%d", value),
				Hex:   hex64(value),
			})
		}
	}

	p.report.System = &SystemInfo{
		ProcessorArchitecture: fmt.Sprintf("%d", arch),
		ArchitectureName:      lookupU16(architectureNames, arch),
		ProcessorLevel:        p.u16(off + 2),
		ProcessorRevision:     hex16(p.u16(off + 4)),
		NumberOfProcessors:    p.data[off+6],
		ProductType:           p.data[off+7],
		ProductTypeName:       lookupU8(productTypeNames, p.data[off+7]),
		MajorVersion:          p.u32(off + 8),
		MinorVersion:          p.u32(off + 12),
		BuildNumber:           p.u32(off + 16),
		PlatformID:            p.u32(off + 20),
		PlatformName:          lookupU32(platformNames, p.u32(off+20)),
		CSDVersion:            csd,
		SuiteMask:             hex16(p.u16(off + 28)),
		CPUVendor:             cpuVendor,
		CPUVersion:            cpuVersion,
		CPUFeatures:           cpuFeatures,
		AMDExtendedFeatures:   amdFeatures,
		ProcessorFeatures:     processorFeatures,
	}
	return nil
}

func (p *parser) parseMiscInfo(d directory) error {
	if err := p.checkStream(d, 24); err != nil {
		return err
	}
	off := uint64(d.rva)
	sizeOfInfo := p.u32(off)
	flags := p.u32(off + 4)
	misc := &MiscInfo{
		SizeOfInfo:               sizeOfInfo,
		Flags1:                   hex32(flags),
		FlagNames:                namesForFlags(uint64(flags), miscFlagNames),
		ProcessID:                p.u32(off + 8),
		ProcessCreateTimeUnix:    p.u32(off + 12),
		ProcessCreateTimeUTC:     unix32UTC(p.u32(off + 12)),
		ProcessUserTimeSeconds:   p.u32(off + 16),
		ProcessKernelTimeSeconds: p.u32(off + 20),
		RawFields:                []NamedValue{},
	}
	if d.size >= 44 {
		misc.ProcessorMaxMHz = p.u32(off + 24)
		misc.ProcessorCurrentMHz = p.u32(off + 28)
		misc.ProcessorMhzLimit = p.u32(off + 32)
		misc.ProcessorMaxIdleState = p.u32(off + 36)
		misc.ProcessorCurrentIdleState = p.u32(off + 40)
	}

	end := uint64(d.rva) + uint64(d.size)
	for pos := off; pos+4 <= end; pos += 4 {
		value := p.u32(pos)
		misc.RawFields = append(misc.RawFields, NamedValue{
			Name:  fmt.Sprintf("DWORD+0x%X", pos-off),
			Value: fmt.Sprintf("%d", value),
			Hex:   hex32(value),
		})
	}
	p.report.Misc = misc
	return nil
}

func (p *parser) parseException(d directory) error {
	if err := p.checkStream(d, 168); err != nil {
		return err
	}
	off := uint64(d.rva)
	threadID := p.u32(off)
	code := p.u32(off + 8)
	numberParameters := p.u32(off + 32)
	if numberParameters > 15 {
		p.warn("ExceptionStream NumberParameters=%d 超出 15，已截断展示", numberParameters)
		numberParameters = 15
	}
	parameters := make([]string, 0, numberParameters)
	for i := uint32(0); i < numberParameters; i++ {
		parameters = append(parameters, hex64(p.u64(off+40+uint64(i)*8)))
	}
	ctxSize := p.u32(off + 160)
	ctxRVA := p.u32(off + 164)
	context := p.parseContext(uint64(ctxRVA), ctxSize)
	p.report.Exception = &ExceptionInfo{
		ThreadID:          threadID,
		Code:              hex32(code),
		CodeName:          lookupU32(exceptionNames, code),
		Flags:             hex32(p.u32(off + 12)),
		Record:            hex64(p.u64(off + 16)),
		Address:           hex64(p.u64(off + 24)),
		NumberParameters:  numberParameters,
		Parameters:        parameters,
		ContextDescriptor: Location{Size: ctxSize, RVA: hex32(ctxRVA)},
		Context:           context,
	}
	return nil
}

func (p *parser) parseModules(d directory) error {
	if err := p.checkStream(d, 4); err != nil {
		return err
	}
	off := uint64(d.rva)
	count := p.u32(off)
	if err := p.checkStream(d, 4+uint64(count)*108); err != nil {
		return err
	}

	modules := make([]ModuleInfo, 0, count)
	pos := off + 4
	for i := uint32(0); i < count; i++ {
		base := p.u64(pos)
		size := p.u32(pos + 8)
		timestamp := p.u32(pos + 16)
		name, err := p.readMinidumpString(uint64(p.u32(pos + 20)))
		if err != nil {
			p.warn("ModuleListStream[%d] 模块名读取失败: %v", i, err)
		}
		cv := p.readLocation(pos + 76)
		misc := p.readLocation(pos + 84)
		mod := ModuleInfo{
			Index:             int(i),
			BaseAddress:       hex64(base),
			EndAddress:        hex64(base + uint64(size)),
			SizeOfImage:       size,
			Checksum:          hex32(p.u32(pos + 12)),
			TimeDateStampUnix: timestamp,
			TimeDateStampUTC:  unix32UTC(timestamp),
			Path:              name,
			FileName:          filepath.Base(name),
			Version:           p.parseVersionInfo(pos + 24),
			CvRecord:          cv,
			MiscRecord:        misc,
		}
		if codeView, err := p.parseCodeView(cv); err == nil {
			mod.CodeView = codeView
		} else if cv.Size > 0 {
			p.warn("ModuleListStream[%d] CodeView 读取失败: %v", i, err)
		}
		modules = append(modules, mod)
		pos += 108
	}
	p.report.Modules = modules
	return nil
}

func (p *parser) parseThreads(d directory, states map[uint32]*ThreadState) error {
	if err := p.checkStream(d, 4); err != nil {
		return err
	}
	off := uint64(d.rva)
	count := p.u32(off)
	if err := p.checkStream(d, 4+uint64(count)*48); err != nil {
		return err
	}
	nameByID := map[uint32]string{}
	for _, item := range p.report.ThreadNames {
		nameByID[item.ThreadID] = item.Name
	}

	threads := make([]ThreadInfo, 0, count)
	pos := off + 4
	for i := uint32(0); i < count; i++ {
		threadID := p.u32(pos)
		stack := p.readMemoryBlock(pos + 24)
		ctxLoc := p.readLocation(pos + 40)
		thread := ThreadInfo{
			ThreadID:      threadID,
			Name:          nameByID[threadID],
			SuspendCount:  p.u32(pos + 4),
			PriorityClass: p.u32(pos + 8),
			Priority:      p.u32(pos + 12),
			TEB:           hex64(p.u64(pos + 16)),
			Stack:         stack,
			Context:       p.parseContext(locationRVA(ctxLoc), ctxLoc.Size),
			ThreadState:   states[threadID],
		}
		threads = append(threads, thread)
		pos += 48
	}
	p.report.Threads = threads
	return nil
}

func (p *parser) parseThreadInfoList(d directory) (map[uint32]*ThreadState, error) {
	if err := p.checkStream(d, 16); err != nil {
		return nil, err
	}
	off := uint64(d.rva)
	headerSize := p.u32(off)
	entrySize := p.u32(off + 4)
	count := p.u64(off + 8)
	if entrySize < 64 {
		return nil, fmt.Errorf("ThreadInfoListStream entry size 过小: %d", entrySize)
	}
	if count > math.MaxInt32 {
		return nil, fmt.Errorf("ThreadInfoListStream entry 数量异常: %d", count)
	}
	if err := p.checkStream(d, uint64(headerSize)+count*uint64(entrySize)); err != nil {
		return nil, err
	}
	states := make(map[uint32]*ThreadState, int(count))
	pos := off + uint64(headerSize)
	for i := uint64(0); i < count; i++ {
		threadID := p.u32(pos)
		flags := p.u32(pos + 4)
		states[threadID] = &ThreadState{
			DumpFlags:       hex32(flags),
			DumpFlagNames:   namesForFlags(uint64(flags), threadInfoFlagNames),
			DumpError:       hex32(p.u32(pos + 8)),
			ExitStatus:      hex32(p.u32(pos + 12)),
			CreateTimeUTC:   filetimeUTC(p.u64(pos + 16)),
			ExitTimeUTC:     filetimeUTC(p.u64(pos + 24)),
			KernelTime100NS: fmt.Sprintf("%d", p.u64(pos+32)),
			UserTime100NS:   fmt.Sprintf("%d", p.u64(pos+40)),
			StartAddress:    hex64(p.u64(pos + 48)),
			Affinity:        hex64(p.u64(pos + 56)),
		}
		pos += uint64(entrySize)
	}
	return states, nil
}

func (p *parser) parseThreadNames(d directory) error {
	if err := p.checkStream(d, 4); err != nil {
		return err
	}
	off := uint64(d.rva)
	count := p.u32(off)
	if err := p.checkStream(d, 4+uint64(count)*12); err != nil {
		return err
	}
	names := make([]ThreadName, 0, count)
	pos := off + 4
	for i := uint32(0); i < count; i++ {
		threadID := p.u32(pos)
		name, err := p.readMinidumpString(p.u64(pos + 4))
		if err != nil {
			p.warn("ThreadNamesStream[%d] 名称读取失败: %v", i, err)
		}
		names = append(names, ThreadName{ThreadID: threadID, Name: name})
		pos += 12
	}
	p.report.ThreadNames = names
	return nil
}

func (p *parser) parseMemoryList(d directory) error {
	if err := p.checkStream(d, 4); err != nil {
		return err
	}
	off := uint64(d.rva)
	count := p.u32(off)
	if err := p.checkStream(d, 4+uint64(count)*16); err != nil {
		return err
	}
	pos := off + 4
	for i := uint32(0); i < count; i++ {
		start := p.u64(pos)
		size := p.u32(pos + 8)
		rva := p.u32(pos + 12)
		p.report.MemoryRanges = append(p.report.MemoryRanges, MemoryRange{
			Index:        len(p.report.MemoryRanges),
			Source:       "MemoryListStream",
			StartAddress: hex64(start),
			EndAddress:   hex64(start + uint64(size)),
			Size:         uint64(size),
			RVA:          hex32(rva),
			Preview:      p.preview(uint64(rva), uint64(size)),
		})
		pos += 16
	}
	return nil
}

func (p *parser) parseMemory64List(d directory) error {
	if err := p.checkStream(d, 16); err != nil {
		return err
	}
	off := uint64(d.rva)
	count := p.u64(off)
	baseRVA := p.u64(off + 8)
	if count > math.MaxInt32 {
		return fmt.Errorf("Memory64ListStream range 数量异常: %d", count)
	}
	if err := p.checkStream(d, 16+count*16); err != nil {
		return err
	}
	pos := off + 16
	currentRVA := baseRVA
	for i := uint64(0); i < count; i++ {
		start := p.u64(pos)
		size := p.u64(pos + 8)
		p.report.MemoryRanges = append(p.report.MemoryRanges, MemoryRange{
			Index:        len(p.report.MemoryRanges),
			Source:       "Memory64ListStream",
			StartAddress: hex64(start),
			EndAddress:   hex64(start + size),
			Size:         size,
			RVA:          hex64(currentRVA),
			Preview:      p.preview(currentRVA, size),
		})
		currentRVA += size
		pos += 16
	}
	return nil
}

func (p *parser) parseMemoryInfoList(d directory) error {
	if err := p.checkStream(d, 16); err != nil {
		return err
	}
	off := uint64(d.rva)
	headerSize := p.u32(off)
	entrySize := p.u32(off + 4)
	count := p.u64(off + 8)
	if entrySize < 48 {
		return fmt.Errorf("MemoryInfoListStream entry size 过小: %d", entrySize)
	}
	if count > math.MaxInt32 {
		return fmt.Errorf("MemoryInfoListStream entry 数量异常: %d", count)
	}
	if err := p.checkStream(d, uint64(headerSize)+count*uint64(entrySize)); err != nil {
		return err
	}
	pos := off + uint64(headerSize)
	entries := make([]MemoryInfoEntry, 0, count)
	for i := uint64(0); i < count; i++ {
		allocationProtect := p.u32(pos + 16)
		state := p.u32(pos + 32)
		protect := p.u32(pos + 36)
		typ := p.u32(pos + 40)
		entries = append(entries, MemoryInfoEntry{
			Index:                 int(i),
			BaseAddress:           hex64(p.u64(pos)),
			AllocationBase:        hex64(p.u64(pos + 8)),
			AllocationProtect:     hex32(allocationProtect),
			AllocationProtectName: protectName(allocationProtect),
			RegionSize:            p.u64(pos + 24),
			State:                 hex32(state),
			StateName:             lookupU32(memoryStateNames, state),
			Protect:               hex32(protect),
			ProtectName:           protectName(protect),
			Type:                  hex32(typ),
			TypeName:              lookupU32(memoryTypeNames, typ),
		})
		pos += uint64(entrySize)
	}
	p.report.MemoryInfo = entries
	return nil
}

func (p *parser) parseSystemMemoryInfo(d directory) error {
	if err := p.checkStream(d, 1); err != nil {
		return err
	}
	p.report.SystemMemory = &RawFieldStream{
		Size:    d.size,
		Fields:  p.rawFields(d, 8),
		Preview: p.preview(uint64(d.rva), uint64(d.size)),
	}
	return nil
}

func (p *parser) parseProcessVMCounters(d directory) error {
	if err := p.checkStream(d, 1); err != nil {
		return err
	}
	names := []string{
		"PeakVirtualSize",
		"VirtualSize",
		"PageFaultCount",
		"PeakWorkingSetSize",
		"WorkingSetSize",
		"QuotaPeakPagedPoolUsage",
		"QuotaPagedPoolUsage",
		"QuotaPeakNonPagedPoolUsage",
		"QuotaNonPagedPoolUsage",
		"PagefileUsage",
		"PeakPagefileUsage",
		"PrivateUsage",
		"PrivateWorkingSetSize",
		"SharedCommitUsage",
		"JobSharedCommitUsage",
		"JobPrivateCommitUsage",
		"JobPeakPrivateCommitUsage",
		"JobPrivateCommitLimit",
		"JobTotalCommitLimit",
	}
	fields := make([]NamedValue, 0, int(d.size)/8)
	off := uint64(d.rva)
	end := off + uint64(d.size)
	index := 0
	for pos := off; pos+8 <= end; pos += 8 {
		value := p.u64(pos)
		name := fmt.Sprintf("QWORD+0x%X", pos-off)
		if index < len(names) {
			name = names[index]
		}
		fields = append(fields, NamedValue{
			Name:    name,
			Value:   fmt.Sprintf("%d", value),
			Hex:     hex64(value),
			Display: formatBytes(value),
		})
		index++
	}
	p.report.ProcessVMCounters = &RawFieldStream{
		Size:    d.size,
		Fields:  fields,
		Preview: p.preview(uint64(d.rva), uint64(d.size)),
	}
	return nil
}

func (p *parser) parseCommentA(d directory) error {
	data, err := p.streamData(d)
	if err != nil {
		return err
	}
	p.report.Comments = append(p.report.Comments, CommentInfo{
		Stream: streamName(d.typ),
		Text:   strings.TrimRight(string(data), "\x00"),
	})
	return nil
}

func (p *parser) parseCommentW(d directory) error {
	data, err := p.streamData(d)
	if err != nil {
		return err
	}
	p.report.Comments = append(p.report.Comments, CommentInfo{
		Stream: streamName(d.typ),
		Text:   strings.TrimRight(decodeUTF16(data), "\x00"),
	})
	return nil
}

func (p *parser) parseContext(rva uint64, size uint32) ContextInfo {
	ctx := ContextInfo{
		Architecture: lookupU16(architectureNames, p.systemArch),
		Size:         size,
		RVA:          formatRVA(rva),
		Registers:    map[string]string{},
		Preview:      p.preview(rva, uint64(size)),
	}
	if size == 0 {
		return ctx
	}
	if err := p.checkRange(rva, uint64(size)); err != nil {
		p.warn("线程上下文越界: RVA=%s Size=%d: %v", formatRVA(rva), size, err)
		return ctx
	}
	if p.systemArch == 9 && size >= 256 {
		ctx.ContextFlags = hex32(p.u32(rva + 48))
		regs := map[string]uint64{
			"RAX": p.u64(rva + 120),
			"RCX": p.u64(rva + 128),
			"RDX": p.u64(rva + 136),
			"RBX": p.u64(rva + 144),
			"RSP": p.u64(rva + 152),
			"RBP": p.u64(rva + 160),
			"RSI": p.u64(rva + 168),
			"RDI": p.u64(rva + 176),
			"R8":  p.u64(rva + 184),
			"R9":  p.u64(rva + 192),
			"R10": p.u64(rva + 200),
			"R11": p.u64(rva + 208),
			"R12": p.u64(rva + 216),
			"R13": p.u64(rva + 224),
			"R14": p.u64(rva + 232),
			"R15": p.u64(rva + 240),
			"RIP": p.u64(rva + 248),
			"DR0": p.u64(rva + 72),
			"DR1": p.u64(rva + 80),
			"DR2": p.u64(rva + 88),
			"DR3": p.u64(rva + 96),
			"DR6": p.u64(rva + 104),
			"DR7": p.u64(rva + 112),
		}
		for name, value := range regs {
			ctx.Registers[name] = hex64(value)
		}
		ctx.Registers["EFlags"] = hex32(p.u32(rva + 68))
		ctx.Registers["SegCS"] = hex16(p.u16(rva + 56))
		ctx.Registers["SegSS"] = hex16(p.u16(rva + 66))
		return ctx
	}
	if size >= 204 {
		ctx.ContextFlags = hex32(p.u32(rva))
		regs := map[string]uint32{
			"EAX":    p.u32(rva + 176),
			"EBX":    p.u32(rva + 164),
			"ECX":    p.u32(rva + 172),
			"EDX":    p.u32(rva + 168),
			"ESI":    p.u32(rva + 160),
			"EDI":    p.u32(rva + 156),
			"EBP":    p.u32(rva + 180),
			"ESP":    p.u32(rva + 196),
			"EIP":    p.u32(rva + 184),
			"EFlags": p.u32(rva + 192),
			"DR0":    p.u32(rva + 4),
			"DR1":    p.u32(rva + 8),
			"DR2":    p.u32(rva + 12),
			"DR3":    p.u32(rva + 16),
			"DR6":    p.u32(rva + 20),
			"DR7":    p.u32(rva + 24),
		}
		for name, value := range regs {
			ctx.Registers[name] = hex32(value)
		}
		ctx.Registers["SegCS"] = hex32(p.u32(rva + 188))
		ctx.Registers["SegSS"] = hex32(p.u32(rva + 200))
		return ctx
	}
	p.warn("线程上下文大小 %d 暂不支持寄存器解码", size)
	return ctx
}

func (p *parser) attachExceptionModule() {
	if p.report.Exception == nil || len(p.report.Modules) == 0 {
		return
	}
	address, ok := parseHexUint64(p.report.Exception.Address)
	if !ok {
		return
	}
	for _, mod := range p.report.Modules {
		base, ok := parseHexUint64(mod.BaseAddress)
		if !ok {
			continue
		}
		end := base + uint64(mod.SizeOfImage)
		if address >= base && address < end {
			hit := &ModuleHit{
				Index:       mod.Index,
				Path:        mod.Path,
				FileName:    mod.FileName,
				BaseAddress: mod.BaseAddress,
				SizeOfImage: mod.SizeOfImage,
				Offset:      fmt.Sprintf("0x%X", address-base),
			}
			p.report.ExceptionModule = hit
			return
		}
	}
}

func (p *parser) parseVersionInfo(off uint64) VersionInfo {
	fileMS := p.u32(off + 8)
	fileLS := p.u32(off + 12)
	productMS := p.u32(off + 16)
	productLS := p.u32(off + 20)
	fileType := p.u32(off + 40)
	return VersionInfo{
		Signature:      hex32(p.u32(off)),
		StructVersion:  versionFromDWORD(p.u32(off + 4)),
		FileVersion:    versionFromTwoDWORD(fileMS, fileLS),
		ProductVersion: versionFromTwoDWORD(productMS, productLS),
		FileFlagsMask:  hex32(p.u32(off + 24)),
		FileFlags:      hex32(p.u32(off + 28)),
		FileOS:         hex32(p.u32(off + 36)),
		FileType:       hex32(fileType),
		FileTypeName:   lookupU32(fileTypeNames, fileType),
		FileSubtype:    hex32(p.u32(off + 44)),
		FileDate:       hex64(uint64(p.u32(off+48))<<32 | uint64(p.u32(off+52))),
	}
}

func (p *parser) parseCodeView(loc Location) (*CodeViewInfo, error) {
	if loc.Size == 0 {
		return nil, nil
	}
	rva := locationRVA(loc)
	if err := p.checkRange(rva, uint64(loc.Size)); err != nil {
		return nil, err
	}
	data := p.data[rva : rva+uint64(loc.Size)]
	if len(data) < 4 {
		return nil, fmt.Errorf("CodeView record 过短")
	}
	signature := string(data[:4])
	info := &CodeViewInfo{Signature: signature}
	switch signature {
	case "RSDS":
		if len(data) < 24 {
			return info, fmt.Errorf("RSDS record 过短")
		}
		info.GUID = formatGUID(data[4:20])
		info.Age = binary.LittleEndian.Uint32(data[20:24])
		info.PDBPath = cString(data[24:])
	case "NB10":
		if len(data) < 16 {
			return info, fmt.Errorf("NB10 record 过短")
		}
		info.Timestamp = hex32(binary.LittleEndian.Uint32(data[8:12]))
		info.Age = binary.LittleEndian.Uint32(data[12:16])
		info.PDBPath = cString(data[16:])
	}
	return info, nil
}

func (p *parser) readMemoryBlock(off uint64) MemoryBlock {
	start := p.u64(off)
	size := p.u32(off + 8)
	rva := p.u32(off + 12)
	return MemoryBlock{
		StartAddress: hex64(start),
		EndAddress:   hex64(start + uint64(size)),
		Size:         size,
		RVA:          hex32(rva),
		Preview:      p.preview(uint64(rva), uint64(size)),
	}
}

func (p *parser) readLocation(off uint64) Location {
	return Location{Size: p.u32(off), RVA: hex32(p.u32(off + 4))}
}

func (p *parser) rawFields(d directory, wordBytes uint64) []NamedValue {
	fields := []NamedValue{}
	if wordBytes != 4 && wordBytes != 8 {
		wordBytes = 8
	}
	off := uint64(d.rva)
	end := off + uint64(d.size)
	for pos := off; pos+wordBytes <= end; pos += wordBytes {
		var value uint64
		if wordBytes == 4 {
			value = uint64(p.u32(pos))
		} else {
			value = p.u64(pos)
		}
		fields = append(fields, NamedValue{
			Name:    fmt.Sprintf("%s+0x%X", map[uint64]string{4: "DWORD", 8: "QWORD"}[wordBytes], pos-off),
			Value:   fmt.Sprintf("%d", value),
			Hex:     formatWidthHex(value, int(wordBytes)*2),
			Display: formatBytes(value),
		})
	}
	return fields
}

func (p *parser) preview(rva uint64, size uint64) HexPreview {
	if size == 0 {
		return HexPreview{}
	}
	if err := p.checkRange(rva, minUint64(size, previewByteLimit)); err != nil {
		return HexPreview{Truncated: true, Text: fmt.Sprintf("预览读取失败: %v", err)}
	}
	n := minUint64(size, previewByteLimit)
	data := p.data[rva : rva+n]
	return HexPreview{
		Bytes:     uint32(n),
		Truncated: size > previewByteLimit,
		Text:      hexDump(data),
	}
}

func (p *parser) readMinidumpString(rva uint64) (string, error) {
	if rva == 0 {
		return "", nil
	}
	if err := p.checkRange(rva, 4); err != nil {
		return "", err
	}
	byteLen := uint64(p.u32(rva))
	if byteLen == 0 {
		return "", nil
	}
	if err := p.checkRange(rva+4, byteLen); err != nil {
		return "", err
	}
	return strings.TrimRight(decodeUTF16(p.data[rva+4:rva+4+byteLen]), "\x00"), nil
}

func (p *parser) streamData(d directory) ([]byte, error) {
	if err := p.checkStream(d, 0); err != nil {
		return nil, err
	}
	return p.data[uint64(d.rva) : uint64(d.rva)+uint64(d.size)], nil
}

func (p *parser) checkStream(d directory, minSize uint64) error {
	if uint64(d.size) < minSize {
		return fmt.Errorf("%s size=%d 小于需要的 %d", streamName(d.typ), d.size, minSize)
	}
	return p.checkRange(uint64(d.rva), uint64(d.size))
}

func (p *parser) checkRange(off uint64, size uint64) error {
	if off > uint64(len(p.data)) {
		return fmt.Errorf("RVA %s 超出文件大小 %d", formatRVA(off), len(p.data))
	}
	if size > uint64(len(p.data))-off {
		return fmt.Errorf("RVA %s size %d 超出文件大小 %d", formatRVA(off), size, len(p.data))
	}
	return nil
}

func (p *parser) u16(off uint64) uint16 {
	return binary.LittleEndian.Uint16(p.data[off : off+2])
}

func (p *parser) u32(off uint64) uint32 {
	return binary.LittleEndian.Uint32(p.data[off : off+4])
}

func (p *parser) u64(off uint64) uint64 {
	return binary.LittleEndian.Uint64(p.data[off : off+8])
}

func (p *parser) warn(format string, args ...any) {
	p.report.ParseWarnings = append(p.report.ParseWarnings, fmt.Sprintf(format, args...))
}

func streamName(typ uint32) string {
	if name, ok := streamNames[typ]; ok {
		return name
	}
	return fmt.Sprintf("UnknownStream(%d)", typ)
}

func locationRVA(loc Location) uint64 {
	value, ok := parseHexUint64(loc.RVA)
	if !ok {
		return 0
	}
	return value
}

func decodeUTF16(data []byte) string {
	if len(data)%2 == 1 {
		data = data[:len(data)-1]
	}
	words := make([]uint16, 0, len(data)/2)
	for i := 0; i+1 < len(data); i += 2 {
		words = append(words, binary.LittleEndian.Uint16(data[i:i+2]))
	}
	return string(utf16.Decode(words))
}

func cString(data []byte) string {
	if idx := strings.IndexByte(string(data), 0); idx >= 0 {
		data = data[:idx]
	}
	if utf8.Valid(data) {
		return string(data)
	}
	return strings.ToValidUTF8(string(data), "")
}

func uint32Bytes(value uint32) []byte {
	data := make([]byte, 4)
	binary.LittleEndian.PutUint32(data, value)
	return data
}

func namesForFlags(value uint64, names []flagName) []string {
	result := []string{}
	for _, item := range names {
		if value&item.value != 0 {
			result = append(result, item.name)
		}
	}
	if len(result) == 0 && value == 0 {
		result = append(result, "0")
	}
	return result
}

func protectName(value uint32) string {
	names := namesForFlags(uint64(value), memoryProtectNames)
	if len(names) == 1 && names[0] == "0" {
		return ""
	}
	return strings.Join(names, " | ")
}

func lookupU32(values map[uint32]string, key uint32) string {
	if value, ok := values[key]; ok {
		return value
	}
	return fmt.Sprintf("Unknown(%d)", key)
}

func lookupU16(values map[uint16]string, key uint16) string {
	if value, ok := values[key]; ok {
		return value
	}
	return fmt.Sprintf("Unknown(%d)", key)
}

func lookupU8(values map[uint8]string, key uint8) string {
	if value, ok := values[key]; ok {
		return value
	}
	return fmt.Sprintf("Unknown(%d)", key)
}

func versionFromDWORD(value uint32) string {
	return fmt.Sprintf("%d.%d", value>>16, value&0xffff)
}

func versionFromTwoDWORD(ms uint32, ls uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d", ms>>16, ms&0xffff, ls>>16, ls&0xffff)
}

func unix32UTC(value uint32) string {
	if value == 0 {
		return ""
	}
	return time.Unix(int64(value), 0).UTC().Format("2006-01-02 15:04:05")
}

func filetimeUTC(value uint64) string {
	if value == 0 {
		return ""
	}
	const ticksPerSecond = 10000000
	const unixEpochOffsetSeconds = 11644473600
	seconds := int64(value/ticksPerSecond) - unixEpochOffsetSeconds
	nanos := int64(value%ticksPerSecond) * 100
	return time.Unix(seconds, nanos).UTC().Format("2006-01-02 15:04:05.0000000")
}

func hex16(value uint16) string {
	return fmt.Sprintf("0x%04X", value)
}

func hex32(value uint32) string {
	return fmt.Sprintf("0x%08X", value)
}

func hex64(value uint64) string {
	return fmt.Sprintf("0x%016X", value)
}

func formatRVA(value uint64) string {
	if value <= math.MaxUint32 {
		return hex32(uint32(value))
	}
	return hex64(value)
}

func formatWidthHex(value uint64, width int) string {
	return fmt.Sprintf("0x%0*X", width, value)
}

func parseHexUint64(value string) (uint64, bool) {
	value = strings.TrimPrefix(strings.TrimSpace(value), "0x")
	value = strings.TrimPrefix(value, "0X")
	if value == "" {
		return 0, false
	}
	var result uint64
	if _, err := fmt.Sscanf(value, "%X", &result); err != nil {
		return 0, false
	}
	return result, true
}

func minUint64(left uint64, right uint64) uint64 {
	if left < right {
		return left
	}
	return right
}

func formatBytes(value uint64) string {
	const unit = 1024
	if value < unit {
		return fmt.Sprintf("%d B", value)
	}
	units := []string{"KB", "MB", "GB", "TB"}
	f := float64(value)
	for _, suffix := range units {
		f /= unit
		if f < unit {
			return fmt.Sprintf("%.2f %s", f, suffix)
		}
	}
	return fmt.Sprintf("%.2f PB", f/unit)
}

func formatGUID(data []byte) string {
	if len(data) < 16 {
		return ""
	}
	return fmt.Sprintf(
		"%08X-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X",
		binary.LittleEndian.Uint32(data[0:4]),
		binary.LittleEndian.Uint16(data[4:6]),
		binary.LittleEndian.Uint16(data[6:8]),
		data[8], data[9], data[10], data[11], data[12], data[13], data[14], data[15],
	)
}

func hexDump(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	var builder strings.Builder
	for offset := 0; offset < len(data); offset += 16 {
		end := offset + 16
		if end > len(data) {
			end = len(data)
		}
		row := data[offset:end]
		builder.WriteString(fmt.Sprintf("%08X  ", offset))
		for i := 0; i < 16; i++ {
			if i < len(row) {
				builder.WriteString(fmt.Sprintf("%02X ", row[i]))
			} else {
				builder.WriteString("   ")
			}
			if i == 7 {
				builder.WriteByte(' ')
			}
		}
		builder.WriteString(" |")
		for _, b := range row {
			if b >= 32 && b <= 126 {
				builder.WriteByte(b)
			} else {
				builder.WriteByte('.')
			}
		}
		builder.WriteString("|\n")
	}
	return strings.TrimRight(builder.String(), "\n")
}
