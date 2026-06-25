package minidump

const (
	minidumpSignature = 0x504d444d
	previewByteLimit  = 256
)

const (
	streamUnused              = 0
	streamThreadList          = 3
	streamModuleList          = 4
	streamMemoryList          = 5
	streamException           = 6
	streamSystemInfo          = 7
	streamThreadExList        = 8
	streamMemory64List        = 9
	streamCommentA            = 10
	streamCommentW            = 11
	streamHandleData          = 12
	streamFunctionTable       = 13
	streamUnloadedModuleList  = 14
	streamMiscInfo            = 15
	streamMemoryInfoList      = 16
	streamThreadInfoList      = 17
	streamHandleOperationList = 18
	streamToken               = 19
	streamJavaScriptData      = 20
	streamSystemMemoryInfo    = 21
	streamProcessVMCounters   = 22
	streamIptTrace            = 23
	streamThreadNames         = 24
)

var streamNames = map[uint32]string{
	streamUnused:              "UnusedStream",
	1:                         "ReservedStream0",
	2:                         "ReservedStream1",
	streamThreadList:          "ThreadListStream",
	streamModuleList:          "ModuleListStream",
	streamMemoryList:          "MemoryListStream",
	streamException:           "ExceptionStream",
	streamSystemInfo:          "SystemInfoStream",
	streamThreadExList:        "ThreadExListStream",
	streamMemory64List:        "Memory64ListStream",
	streamCommentA:            "CommentStreamA",
	streamCommentW:            "CommentStreamW",
	streamHandleData:          "HandleDataStream",
	streamFunctionTable:       "FunctionTableStream",
	streamUnloadedModuleList:  "UnloadedModuleListStream",
	streamMiscInfo:            "MiscInfoStream",
	streamMemoryInfoList:      "MemoryInfoListStream",
	streamThreadInfoList:      "ThreadInfoListStream",
	streamHandleOperationList: "HandleOperationListStream",
	streamToken:               "TokenStream",
	streamJavaScriptData:      "JavaScriptDataStream",
	streamSystemMemoryInfo:    "SystemMemoryInfoStream",
	streamProcessVMCounters:   "ProcessVmCountersStream",
	streamIptTrace:            "IptTraceStream",
	streamThreadNames:         "ThreadNamesStream",
}

var minidumpFlagNames = []flagName{
	{0x00000001, "MiniDumpWithDataSegs"},
	{0x00000002, "MiniDumpWithFullMemory"},
	{0x00000004, "MiniDumpWithHandleData"},
	{0x00000008, "MiniDumpFilterMemory"},
	{0x00000010, "MiniDumpScanMemory"},
	{0x00000020, "MiniDumpWithUnloadedModules"},
	{0x00000040, "MiniDumpWithIndirectlyReferencedMemory"},
	{0x00000080, "MiniDumpFilterModulePaths"},
	{0x00000100, "MiniDumpWithProcessThreadData"},
	{0x00000200, "MiniDumpWithPrivateReadWriteMemory"},
	{0x00000400, "MiniDumpWithoutOptionalData"},
	{0x00000800, "MiniDumpWithFullMemoryInfo"},
	{0x00001000, "MiniDumpWithThreadInfo"},
	{0x00002000, "MiniDumpWithCodeSegs"},
	{0x00004000, "MiniDumpWithoutAuxiliaryState"},
	{0x00008000, "MiniDumpWithFullAuxiliaryState"},
	{0x00010000, "MiniDumpWithPrivateWriteCopyMemory"},
	{0x00020000, "MiniDumpIgnoreInaccessibleMemory"},
	{0x00040000, "MiniDumpWithTokenInformation"},
	{0x00080000, "MiniDumpWithModuleHeaders"},
	{0x00100000, "MiniDumpFilterTriage"},
	{0x00200000, "MiniDumpWithAvxXStateContext"},
	{0x00400000, "MiniDumpWithIptTrace"},
	{0x00800000, "MiniDumpScanInaccessiblePartialPages"},
	{0x01000000, "MiniDumpFilterWriteCombinedMemory"},
	{0x02000000, "MiniDumpValidTypeFlags"},
}

var exceptionNames = map[uint32]string{
	0x40010005: "DBG_CONTROL_C",
	0x40010006: "DBG_PRINTEXCEPTION_C",
	0x40010008: "DBG_CONTROL_BREAK",
	0x80000001: "EXCEPTION_GUARD_PAGE",
	0x80000002: "EXCEPTION_DATATYPE_MISALIGNMENT",
	0x80000003: "EXCEPTION_BREAKPOINT",
	0x80000004: "EXCEPTION_SINGLE_STEP",
	0xc0000005: "EXCEPTION_ACCESS_VIOLATION",
	0xc0000006: "EXCEPTION_IN_PAGE_ERROR",
	0xc0000008: "EXCEPTION_INVALID_HANDLE",
	0xc0000017: "STATUS_NO_MEMORY",
	0xc000001d: "EXCEPTION_ILLEGAL_INSTRUCTION",
	0xc0000025: "EXCEPTION_NONCONTINUABLE_EXCEPTION",
	0xc0000026: "EXCEPTION_INVALID_DISPOSITION",
	0xc000008c: "EXCEPTION_ARRAY_BOUNDS_EXCEEDED",
	0xc000008d: "EXCEPTION_FLT_DENORMAL_OPERAND",
	0xc000008e: "EXCEPTION_FLT_DIVIDE_BY_ZERO",
	0xc000008f: "EXCEPTION_FLT_INEXACT_RESULT",
	0xc0000090: "EXCEPTION_FLT_INVALID_OPERATION",
	0xc0000091: "EXCEPTION_FLT_OVERFLOW",
	0xc0000092: "EXCEPTION_FLT_STACK_CHECK",
	0xc0000093: "EXCEPTION_FLT_UNDERFLOW",
	0xc0000094: "EXCEPTION_INT_DIVIDE_BY_ZERO",
	0xc0000095: "EXCEPTION_INT_OVERFLOW",
	0xc0000096: "EXCEPTION_PRIV_INSTRUCTION",
	0xc00000fd: "EXCEPTION_STACK_OVERFLOW",
	0xc0000135: "STATUS_DLL_NOT_FOUND",
	0xc0000139: "STATUS_ENTRYPOINT_NOT_FOUND",
	0xc0000142: "STATUS_DLL_INIT_FAILED",
	0xc0000409: "STATUS_STACK_BUFFER_OVERRUN",
	0xe06d7363: "MSVC_CPP_EXCEPTION",
}

var architectureNames = map[uint16]string{
	0:      "x86",
	5:      "ARM",
	6:      "Intel Itanium",
	9:      "x64",
	12:     "ARM64",
	0xffff: "Unknown",
}

var productTypeNames = map[uint8]string{
	1: "VER_NT_WORKSTATION",
	2: "VER_NT_DOMAIN_CONTROLLER",
	3: "VER_NT_SERVER",
}

var platformNames = map[uint32]string{
	0: "VER_PLATFORM_WIN32s",
	1: "VER_PLATFORM_WIN32_WINDOWS",
	2: "VER_PLATFORM_WIN32_NT",
}

var fileTypeNames = map[uint32]string{
	0x00000000: "VFT_UNKNOWN",
	0x00000001: "VFT_APP",
	0x00000002: "VFT_DLL",
	0x00000003: "VFT_DRV",
	0x00000004: "VFT_FONT",
	0x00000005: "VFT_VXD",
	0x00000007: "VFT_STATIC_LIB",
}

var miscFlagNames = []flagName{
	{0x00000001, "MINIDUMP_MISC1_PROCESS_ID"},
	{0x00000002, "MINIDUMP_MISC1_PROCESS_TIMES"},
	{0x00000004, "MINIDUMP_MISC1_PROCESSOR_POWER_INFO"},
	{0x00000010, "MINIDUMP_MISC3_PROCESS_INTEGRITY"},
	{0x00000020, "MINIDUMP_MISC3_PROCESS_EXECUTE_FLAGS"},
	{0x00000040, "MINIDUMP_MISC3_PROTECTED_PROCESS"},
	{0x00000080, "MINIDUMP_MISC3_TIMEZONE"},
	{0x00000100, "MINIDUMP_MISC4_BUILDSTRING"},
	{0x00000200, "MINIDUMP_MISC5_PROCESS_COOKIE"},
}

var threadInfoFlagNames = []flagName{
	{0x00000001, "MINIDUMP_THREAD_INFO_ERROR_THREAD"},
	{0x00000002, "MINIDUMP_THREAD_INFO_WRITING_THREAD"},
	{0x00000004, "MINIDUMP_THREAD_INFO_EXITED_THREAD"},
	{0x00000008, "MINIDUMP_THREAD_INFO_INVALID_INFO"},
	{0x00000010, "MINIDUMP_THREAD_INFO_INVALID_CONTEXT"},
	{0x00000020, "MINIDUMP_THREAD_INFO_INVALID_TEB"},
}

var memoryStateNames = map[uint32]string{
	0x00001000: "MEM_COMMIT",
	0x00002000: "MEM_RESERVE",
	0x00010000: "MEM_FREE",
}

var memoryTypeNames = map[uint32]string{
	0x01000000: "MEM_IMAGE",
	0x00040000: "MEM_MAPPED",
	0x00020000: "MEM_PRIVATE",
}

var memoryProtectNames = []flagName{
	{0x00000001, "PAGE_NOACCESS"},
	{0x00000002, "PAGE_READONLY"},
	{0x00000004, "PAGE_READWRITE"},
	{0x00000008, "PAGE_WRITECOPY"},
	{0x00000010, "PAGE_EXECUTE"},
	{0x00000020, "PAGE_EXECUTE_READ"},
	{0x00000040, "PAGE_EXECUTE_READWRITE"},
	{0x00000080, "PAGE_EXECUTE_WRITECOPY"},
	{0x00000100, "PAGE_GUARD"},
	{0x00000200, "PAGE_NOCACHE"},
	{0x00000400, "PAGE_WRITECOMBINE"},
}

type flagName struct {
	value uint64
	name  string
}
