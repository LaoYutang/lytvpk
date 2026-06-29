package parser

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"

	"l4d2-manager-next/pkg/valve/vpk"
)

const (
	vtfFormatRGBA8888 = 0
	vtfFormatRGB888   = 2
	vtfFormatRGB565   = 4
	vtfFormatDXT1     = 13
	vtfFormatDXT5     = 15
	vtfFormatBGRA4444 = 19
	vtfFormatBGRA5551 = 21
)

type vtfMipLevel struct {
	width  int
	height int
}

func readAndEncodeVTFPreview(opener *vpk.Opener, file *vpk.File) string {
	reader, err := file.Open(opener)
	if err != nil {
		return ""
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return ""
	}

	return decodeVTFPreviewToDataURL(data)
}

func decodeVTFPreviewToDataURL(data []byte) string {
	img, err := decodeVTFTopFrame(data)
	if err != nil {
		return ""
	}

	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		return ""
	}

	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(out.Bytes())
}

func decodeVTFTopFrame(data []byte) (*image.RGBA, error) {
	if len(data) < 64 || string(data[:4]) != "VTF\x00" {
		return nil, errors.New("invalid vtf header")
	}

	headerSize := int(binary.LittleEndian.Uint32(data[12:16]))
	if headerSize <= 0 || headerSize > len(data) {
		headerSize = 64
	}

	width := int(binary.LittleEndian.Uint16(data[16:18]))
	height := int(binary.LittleEndian.Uint16(data[18:20]))
	if width <= 0 || height <= 0 {
		return nil, errors.New("invalid vtf dimensions")
	}

	frameCount := int(binary.LittleEndian.Uint16(data[24:26]))
	if frameCount <= 0 {
		frameCount = 1
	}

	format := int(binary.LittleEndian.Uint32(data[52:56]))
	mipmapCount := int(data[56])
	if mipmapCount <= 0 {
		mipmapCount = 1
	}

	levels := vtfMipmapDimensions(width, height)
	if mipmapCount < len(levels) {
		levels = levels[:mipmapCount]
	}

	offset := headerSize
	for mip := len(levels) - 1; mip >= 1; mip-- {
		size, err := vtfFrameEncodedSize(levels[mip].width, levels[mip].height, format)
		if err != nil {
			return nil, err
		}
		offset += size * frameCount
		if offset > len(data) {
			return nil, errors.New("vtf data truncated")
		}
	}

	size, err := vtfFrameEncodedSize(width, height, format)
	if err != nil {
		return nil, err
	}
	if offset+size > len(data) {
		return nil, errors.New("vtf frame truncated")
	}

	return decodeVTFFrame(data[offset:offset+size], width, height, format)
}

func vtfMipmapDimensions(width, height int) []vtfMipLevel {
	levels := make([]vtfMipLevel, 0)
	w := max(1, width)
	h := max(1, height)
	for {
		levels = append(levels, vtfMipLevel{width: w, height: h})
		if w == 1 && h == 1 {
			break
		}
		w = max(1, w/2)
		h = max(1, h/2)
	}
	return levels
}

func vtfFrameEncodedSize(width, height, format int) (int, error) {
	switch format {
	case vtfFormatDXT1:
		return int(math.Ceil(float64(width)/4) * math.Ceil(float64(height)/4) * 8), nil
	case vtfFormatDXT5:
		return int(math.Ceil(float64(width)/4) * math.Ceil(float64(height)/4) * 16), nil
	case vtfFormatRGBA8888:
		return width * height * 4, nil
	case vtfFormatRGB888:
		return width * height * 3, nil
	case vtfFormatRGB565, vtfFormatBGRA4444, vtfFormatBGRA5551:
		return width * height * 2, nil
	default:
		return 0, errors.New("unsupported vtf format")
	}
}

func decodeVTFFrame(data []byte, width, height, format int) (*image.RGBA, error) {
	img := image.NewRGBA(image.Rect(0, 0, width, height))

	switch format {
	case vtfFormatRGBA8888:
		if len(data) < width*height*4 {
			return nil, errors.New("rgba8888 data truncated")
		}
		copy(img.Pix, data[:width*height*4])
	case vtfFormatRGB888:
		if len(data) < width*height*3 {
			return nil, errors.New("rgb888 data truncated")
		}
		for i, j := 0, 0; i < len(img.Pix); i, j = i+4, j+3 {
			img.Pix[i] = data[j]
			img.Pix[i+1] = data[j+1]
			img.Pix[i+2] = data[j+2]
			img.Pix[i+3] = 255
		}
	case vtfFormatRGB565:
		if len(data) < width*height*2 {
			return nil, errors.New("rgb565 data truncated")
		}
		for i, j := 0, 0; i < len(img.Pix); i, j = i+4, j+2 {
			c := expandRGB565(binary.LittleEndian.Uint16(data[j : j+2]))
			img.Pix[i] = c.R
			img.Pix[i+1] = c.G
			img.Pix[i+2] = c.B
			img.Pix[i+3] = 255
		}
	case vtfFormatBGRA5551:
		if len(data) < width*height*2 {
			return nil, errors.New("bgra5551 data truncated")
		}
		for i, j := 0, 0; i < len(img.Pix); i, j = i+4, j+2 {
			value := binary.LittleEndian.Uint16(data[j : j+2])
			img.Pix[i] = expand5(uint8((value >> 10) & 0x1f))
			img.Pix[i+1] = expand5(uint8((value >> 5) & 0x1f))
			img.Pix[i+2] = expand5(uint8(value & 0x1f))
			if value&0x8000 != 0 {
				img.Pix[i+3] = 255
			}
		}
	case vtfFormatBGRA4444:
		if len(data) < width*height*2 {
			return nil, errors.New("bgra4444 data truncated")
		}
		for i, j := 0, 0; i < len(img.Pix); i, j = i+4, j+2 {
			value := binary.LittleEndian.Uint16(data[j : j+2])
			img.Pix[i] = expand4(uint8((value >> 8) & 0x0f))
			img.Pix[i+1] = expand4(uint8((value >> 4) & 0x0f))
			img.Pix[i+2] = expand4(uint8(value & 0x0f))
			img.Pix[i+3] = expand4(uint8((value >> 12) & 0x0f))
		}
	case vtfFormatDXT1:
		if err := decodeDXT1(data, img, true); err != nil {
			return nil, err
		}
	case vtfFormatDXT5:
		if err := decodeDXT5(data, img); err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("unsupported vtf format")
	}

	return img, nil
}

func decodeDXT1(data []byte, img *image.RGBA, oneBitAlpha bool) error {
	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	blocksX := (width + 3) / 4
	blocksY := (height + 3) / 4
	if len(data) < blocksX*blocksY*8 {
		return errors.New("dxt1 data truncated")
	}

	offset := 0
	for by := 0; by < blocksY; by++ {
		for bx := 0; bx < blocksX; bx++ {
			block := data[offset : offset+8]
			offset += 8
			decodeDXTColorBlock(block, img, bx, by, oneBitAlpha, nil)
		}
	}

	return nil
}

func decodeDXT5(data []byte, img *image.RGBA) error {
	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	blocksX := (width + 3) / 4
	blocksY := (height + 3) / 4
	if len(data) < blocksX*blocksY*16 {
		return errors.New("dxt5 data truncated")
	}

	offset := 0
	for by := 0; by < blocksY; by++ {
		for bx := 0; bx < blocksX; bx++ {
			block := data[offset : offset+16]
			offset += 16
			alpha := decodeDXT5AlphaBlock(block[:8])
			decodeDXTColorBlock(block[8:], img, bx, by, false, alpha[:])
		}
	}

	return nil
}

func decodeDXTColorBlock(block []byte, img *image.RGBA, bx, by int, oneBitAlpha bool, alpha []uint8) {
	c0 := binary.LittleEndian.Uint16(block[0:2])
	c1 := binary.LittleEndian.Uint16(block[2:4])
	palette := [4]color.RGBA{
		expandRGB565(c0),
		expandRGB565(c1),
		{},
		{},
	}

	if c0 > c1 || !oneBitAlpha {
		palette[2] = mixColor(palette[0], palette[1], 2, 1, 3)
		palette[3] = mixColor(palette[0], palette[1], 1, 2, 3)
	} else {
		palette[2] = mixColor(palette[0], palette[1], 1, 1, 2)
		palette[3] = color.RGBA{}
	}

	indices := binary.LittleEndian.Uint32(block[4:8])
	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			dstX := bx*4 + x
			dstY := by*4 + y
			if dstX >= width || dstY >= height {
				continue
			}

			pixelIndex := y*4 + x
			colorIndex := (indices >> (2 * pixelIndex)) & 0x03
			c := palette[colorIndex]
			if alpha != nil {
				c.A = alpha[pixelIndex]
			}
			img.SetRGBA(dstX, dstY, c)
		}
	}
}

func decodeDXT5AlphaBlock(block []byte) [16]uint8 {
	var palette [8]uint8
	palette[0] = block[0]
	palette[1] = block[1]
	if palette[0] > palette[1] {
		for i := 1; i <= 6; i++ {
			palette[i+1] = uint8(((7-i)*int(palette[0]) + i*int(palette[1])) / 7)
		}
	} else {
		for i := 1; i <= 4; i++ {
			palette[i+1] = uint8(((5-i)*int(palette[0]) + i*int(palette[1])) / 5)
		}
		palette[6] = 0
		palette[7] = 255
	}

	var bits uint64
	for i := 0; i < 6; i++ {
		bits |= uint64(block[2+i]) << (8 * i)
	}

	var alpha [16]uint8
	for i := 0; i < 16; i++ {
		alpha[i] = palette[(bits>>(3*i))&0x07]
	}
	return alpha
}

func expandRGB565(value uint16) color.RGBA {
	return color.RGBA{
		R: expand5(uint8((value >> 11) & 0x1f)),
		G: expand6(uint8((value >> 5) & 0x3f)),
		B: expand5(uint8(value & 0x1f)),
		A: 255,
	}
}

func mixColor(a, b color.RGBA, aw, bw, div int) color.RGBA {
	return color.RGBA{
		R: uint8((int(a.R)*aw + int(b.R)*bw) / div),
		G: uint8((int(a.G)*aw + int(b.G)*bw) / div),
		B: uint8((int(a.B)*aw + int(b.B)*bw) / div),
		A: 255,
	}
}

func expand5(value uint8) uint8 {
	return (value << 3) | (value >> 2)
}

func expand6(value uint8) uint8 {
	return (value << 2) | (value >> 4)
}

func expand4(value uint8) uint8 {
	return (value << 4) | value
}
