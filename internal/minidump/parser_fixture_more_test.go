package minidump

import "encoding/binary"

func testModuleList(nameRVA uint32, cvRVA uint32, cvSize uint32) []byte {
	data := make([]byte, 4+108)
	binary.LittleEndian.PutUint32(data[0:], 1)
	off := 4
	binary.LittleEndian.PutUint64(data[off:], 0x10000000)
	binary.LittleEndian.PutUint32(data[off+8:], 0x2000)
	binary.LittleEndian.PutUint32(data[off+12:], 0x12345678)
	binary.LittleEndian.PutUint32(data[off+16:], 1716278400)
	binary.LittleEndian.PutUint32(data[off+20:], nameRVA)
	writeFixedFileInfo(data[off+24:])
	binary.LittleEndian.PutUint32(data[off+76:], cvSize)
	binary.LittleEndian.PutUint32(data[off+80:], cvRVA)
	return data
}

func writeFixedFileInfo(data []byte) {
	binary.LittleEndian.PutUint32(data[0:], 0xfeef04bd)
	binary.LittleEndian.PutUint32(data[4:], 0x00010000)
	binary.LittleEndian.PutUint32(data[8:], 0x00010002)
	binary.LittleEndian.PutUint32(data[12:], 0x00030004)
	binary.LittleEndian.PutUint32(data[16:], 0x00050006)
	binary.LittleEndian.PutUint32(data[20:], 0x00070008)
	binary.LittleEndian.PutUint32(data[24:], 0x3f)
	binary.LittleEndian.PutUint32(data[36:], 0x00040004)
	binary.LittleEndian.PutUint32(data[40:], 0x2)
}

func testRSDSRecord(path string) []byte {
	data := []byte("RSDS")
	data = append(data, []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}...)
	age := make([]byte, 4)
	binary.LittleEndian.PutUint32(age, 2)
	data = append(data, age...)
	data = append(data, []byte(path)...)
	data = append(data, 0)
	return data
}

func testMemoryList(stackRVA uint32) []byte {
	data := make([]byte, 4+16)
	binary.LittleEndian.PutUint32(data[0:], 1)
	binary.LittleEndian.PutUint64(data[4:], 0x0012f000)
	binary.LittleEndian.PutUint32(data[12:], 6)
	binary.LittleEndian.PutUint32(data[16:], stackRVA)
	return data
}

func testMiscInfo() []byte {
	data := make([]byte, 44)
	binary.LittleEndian.PutUint32(data[0:], 44)
	binary.LittleEndian.PutUint32(data[4:], 0x7)
	binary.LittleEndian.PutUint32(data[8:], 550)
	binary.LittleEndian.PutUint32(data[12:], 1775310644)
	binary.LittleEndian.PutUint32(data[16:], 12)
	binary.LittleEndian.PutUint32(data[20:], 3)
	binary.LittleEndian.PutUint32(data[24:], 5200)
	binary.LittleEndian.PutUint32(data[28:], 4800)
	return data
}

func testThreadNames(nameRVA uint32) []byte {
	data := make([]byte, 4+12)
	binary.LittleEndian.PutUint32(data[0:], 1)
	binary.LittleEndian.PutUint32(data[4:], 1234)
	binary.LittleEndian.PutUint64(data[8:], uint64(nameRVA))
	return data
}
