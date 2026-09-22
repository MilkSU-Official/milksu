package codingattachment

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"
)

// 真机那张 iPhone 照片：5712×4284（`sips -g pixelWidth` 实测）。读者就是用这张被服务端拒过。
const realHeicPath = "/Users/xiaoxingjiang/Downloads/IMG_2646.HEIC"

func readRealHeic(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(realHeicPath)
	if err != nil {
		t.Skipf("真机 HEIC 不在本机（%s）：%v", realHeicPath, err)
	}
	return data
}

// HEIC 必须能被认出来 —— 不能只信扩展名（用户可能把 HEIC 改名成 .jpg）。
func TestLooksLikeHEIC(t *testing.T) {
	if !LooksLikeHEIC(readRealHeic(t)) {
		t.Fatal("the real iPhone photo must be recognised as HEIC")
	}
	if LooksLikeHEIC([]byte("just some text")) {
		t.Fatal("plain text must not look like HEIC")
	}
	if !IsHEIFMediaType("image/heic") || !IsHEIFMediaType("Image/HEIF") {
		t.Fatal("declared HEIC/HEIF media types must be recognised")
	}
	if IsHEIFMediaType("image/png") {
		t.Fatal("png is not HEIC")
	}
}

// 红线：只换容器 ⇒ 像素尺寸一模一样（OCR 要原分辨率）。
func TestConvertHEICToPNGKeepsTheRealDimensions(t *testing.T) {
	converted, err := ConvertHEICToPNG(readRealHeic(t), nil)
	if err != nil {
		t.Fatalf("converting the real photo failed: %v", err)
	}
	width, height, ok := PNGPixelSize(converted)
	if !ok {
		t.Fatal("the conversion did not produce a readable PNG")
	}
	if width != 5712 || height != 4284 {
		t.Fatalf("conversion rescaled the photo: got %dx%d, want 5712x4284", width, height)
	}
	if name := PNGNameFor("IMG_2646.HEIC"); name != "IMG_2646.png" {
		t.Fatalf("stored name = %q, want IMG_2646.png", name)
	}
}

// 读者的原图必须原封不动：我们只是复制进库并转换。
func TestConversionLeavesTheOriginalFileUntouched(t *testing.T) {
	before, err := os.Stat(realHeicPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ConvertHEICToPNG(readRealHeic(t), nil); err != nil {
		t.Fatalf("converting the real photo failed: %v", err)
	}
	after, err := os.Stat(realHeicPath)
	if err != nil {
		t.Fatalf("the reader's original file disappeared: %v", err)
	}
	if after.Size() != before.Size() {
		t.Fatalf("the reader's original file changed size: %d -> %d", before.Size(), after.Size())
	}
}

// 已知限制（**等决定，不是本件的目标**）：无损 PNG 比 HEIC 大得多 —— 真机这张 4.1 MiB 的 HEIC
// 转出 33,668,242 字节（32.1 MiB），刚好超过我们自己 32 MiB 的附件上限约 0.1 MiB。
// 这条把现状钉住，免得以后有人以为 HEIC 已经"端到端能发了"。
func TestTheByteCapStillRejectsTheLargestRealPhoto(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_, importErr := store.ImportPayloads([]ImportPayload{{
		Name:       "IMG_2646.HEIC",
		MediaType:  "image/heic",
		DataBase64: base64.StdEncoding.EncodeToString(readRealHeic(t)),
	}})
	if importErr == nil {
		t.Skip("the byte cap no longer rejects this photo: update the expectation and the report")
	}
	if !strings.Contains(importErr.Error(), "32 MiB") {
		t.Fatalf("expected the size cap to be the reason, got %q", importErr.Error())
	}
}

// 转不了要说清楚是哪张、为什么；且不许产生附件。
func TestUnconvertibleHEICFailsLoudlyWithoutProducingAnAttachment(t *testing.T) {
	broken := append([]byte("ftypheic"), make([]byte, 64)...)
	if _, err := ConvertHEICToPNG(broken, nil); err == nil {
		t.Fatal("a damaged HEIC must not convert silently")
	}
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_, importErr := store.ImportPayloads([]ImportPayload{{
		Name:       "broken.heic",
		MediaType:  "image/heic",
		DataBase64: base64.StdEncoding.EncodeToString(broken),
	}})
	if importErr == nil {
		t.Fatal("importing a damaged HEIC must fail")
	}
	// 报错必须点名是哪张附件（读者才知道该换哪张图）。
	if !strings.Contains(importErr.Error(), "broken.heic") {
		t.Fatalf("the error must name the attachment, got %q", importErr.Error())
	}
	// 库里不许留下半个附件。
	entries, _ := os.ReadDir(store.root)
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			t.Fatalf("a failed HEIC import left something behind: %s", entry.Name())
		}
	}
}
