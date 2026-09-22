package codingattachment

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// HEIC 是 iPhone 的默认照片格式，而模型服务端不收它 —— 读者拍的照片会直接被拒。
// 所以在**导入那一刻**（附件被复制进库的时候）就把它转成 PNG，之后尺寸预检、发送、历史
// 全都按 PNG 走。原来的文件不动：库里的只是一份副本。
//
// 红线（用户明确要求，OCR 需要原分辨率）：**不缩放、不降采样、不重编码有损**。
// macOS 自带的 `sips -s format png` 正好满足：只换容器，像素尺寸保持不变（实测 5712×4284 进出一致），
// 而且不引入新的依赖。

// heicBrands 是 ISO-BMFF 里 HEIC/HEIF 的 ftyp 品牌。avif 不在此列（服务端另说，本轮不动）。
var heicBrands = []string{"heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"}

// LooksLikeHEIC 按文件头判断（不信扩展名 —— 用户可能把 HEIC 改名成 .jpg）。
func LooksLikeHEIC(data []byte) bool {
	if len(data) < 12 {
		return false
	}
	if string(data[4:8]) != "ftyp" {
		return false
	}
	brand := string(data[8:12])
	for _, candidate := range heicBrands {
		if brand == candidate {
			return true
		}
	}
	return false
}

// IsHEIFMediaType 认声明类型（有些来源会带 image/heic 但头不完整）。
func IsHEIFMediaType(mediaType string) bool {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence":
		return true
	default:
		return false
	}
}

// PNGNameFor 把 HEIC/HEIF 的扩展名换成 .png：库里存的是 PNG，名字也该说实话。
func PNGNameFor(name string) string {
	extension := filepath.Ext(name)
	if extension == "" {
		return name + ".png"
	}
	return strings.TrimSuffix(name, extension) + ".png"
}

// PNGPixelSize 读 PNG 的 IHDR（只读文件头，不解码整图）。
func PNGPixelSize(data []byte) (int, int, bool) {
	if len(data) < 24 || !bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		return 0, 0, false
	}
	if string(data[12:16]) != "IHDR" {
		return 0, 0, false
	}
	width := int(binary.BigEndian.Uint32(data[16:20]))
	height := int(binary.BigEndian.Uint32(data[20:24]))
	if width <= 0 || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}

// ConvertHEICToPNG 用 sips 做无损容器转换。失败时返回错误，绝不返回半成品。
// run 可注入（测试里用它避免真跑子进程）；为 nil 时用本机 sips。
func ConvertHEICToPNG(data []byte, run func(sourcePath, targetPath string) error) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("empty image data")
	}
	directory, err := os.MkdirTemp("", "milksu-heic-")
	if err != nil {
		return nil, fmt.Errorf("create temporary directory: %w", err)
	}
	defer os.RemoveAll(directory)

	source := filepath.Join(directory, "source.heic")
	target := filepath.Join(directory, "converted.png")
	if err := os.WriteFile(source, data, 0o600); err != nil {
		return nil, fmt.Errorf("write temporary image: %w", err)
	}
	if run == nil {
		run = runSipsToPNG
	}
	if err := run(source, target); err != nil {
		return nil, err
	}
	converted, err := os.ReadFile(target)
	if err != nil {
		return nil, fmt.Errorf("read converted image: %w", err)
	}
	if _, _, ok := PNGPixelSize(converted); !ok {
		return nil, errors.New("sips did not produce a PNG")
	}
	return converted, nil
}

// runSipsToPNG 只换格式：不加任何 -Z/-s dpiHeight 之类的缩放参数。
func runSipsToPNG(sourcePath, targetPath string) error {
	command := exec.Command("sips", "-s", "format", "png", "--out", targetPath, sourcePath)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("sips failed: %s", message)
	}
	return nil
}
