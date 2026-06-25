package minidump

import "encoding/binary"

func testSystemInfo(csdRVA uint32) []byte {
	data := make([]byte, 56)
	binary.LittleEndian.PutUint16(data[0:], 0)
	binary.LittleEndian.PutUint16(data[2:], 6)
	binary.LittleEndian.PutUint16(data[4:], 0xb701)
	data[6] = 4
	data[7] = 1
	binary.LittleEndian.PutUint32(data[8:], 10)
	binary.LittleEndian.PutUint32(data[12:], 0)
	binary.LittleEndian.PutUint32(data[16:], 26100)
	binary.LittleEndian.PutUint32(data[20:], 2)
	binary.LittleEndian.PutUint32(data[24:], csdRVA)
	binary.LittleEndian.PutUint16(data[32:], 0x100)
	copy(data[36:], []byte("GenuineIntel"))
	binary.LittleEndian.PutUint32(data[48:], 0x000b0701)
	binary.LittleEndian.PutUint32(data[52:], 0x7ffafbff)
	return data
}

func testExceptionStream(contextRVA uint32, contextSize uint32) []byte {
	data := make([]byte, 168)
	binary.LittleEndian.PutUint32(data[0:], 1234)
	binary.LittleEndian.PutUint32(data[8:], 0xc0000005)
	binary.LittleEndian.PutUint64(data[24:], 0x10000123)
	binary.LittleEndian.PutUint32(data[32:], 2)
	binary.LittleEndian.PutUint64(data[40:], 1)
	binary.LittleEndian.PutUint64(data[48:], 0)
	binary.LittleEndian.PutUint32(data[160:], contextSize)
	binary.LittleEndian.PutUint32(data[164:], contextRVA)
	return data
}

func testThreadList(stackRVA uint32, contextRVA uint32, contextSize uint32) []byte {
	data := make([]byte, 4+48)
	binary.LittleEndian.PutUint32(data[0:], 1)
	off := 4
	binary.LittleEndian.PutUint32(data[off:], 1234)
	binary.LittleEndian.PutUint64(data[off+16:], 0x7ffdf000)
	binary.LittleEndian.PutUint64(data[off+24:], 0x0012f000)
	binary.LittleEndian.PutUint32(data[off+32:], 6)
	binary.LittleEndian.PutUint32(data[off+36:], stackRVA)
	binary.LittleEndian.PutUint32(data[off+40:], contextSize)
	binary.LittleEndian.PutUint32(data[off+44:], contextRVA)
	return data
}

func testX86Context(eip uint32) []byte {
	data := make([]byte, 204)
	binary.LittleEndian.PutUint32(data[0:], 0x0001007f)
	binary.LittleEndian.PutUint32(data[156:], 0x11111111)
	binary.LittleEndian.PutUint32(data[160:], 0x22222222)
	binary.LittleEndian.PutUint32(data[164:], 0x33333333)
	binary.LittleEndian.PutUint32(data[168:], 0x44444444)
	binary.LittleEndian.PutUint32(data[172:], 0x55555555)
	binary.LittleEndian.PutUint32(data[176:], 0x66666666)
	binary.LittleEndian.PutUint32(data[180:], 0x0012fee8)
	binary.LittleEndian.PutUint32(data[184:], eip)
	binary.LittleEndian.PutUint32(data[188:], 0x23)
	binary.LittleEndian.PutUint32(data[192:], 0x10202)
	binary.LittleEndian.PutUint32(data[196:], 0x0012fe90)
	binary.LittleEndian.PutUint32(data[200:], 0x2b)
	return data
}
