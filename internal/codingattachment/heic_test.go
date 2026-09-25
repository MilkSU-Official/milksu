package codingattachment

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// 真机素材由环境变量提供（MILKSU_REAL_HEIC），**不在仓库里硬编码任何人的路径**：
// 那张 iPhone 照片是 5712×4284，读者正是用它被服务端拒过。没有素材就跳过，而不是失败。
func realHeicPath() string { return os.Getenv("MILKSU_REAL_HEIC") }

func readRealHeic(t *testing.T) []byte {
	t.Helper()
	path := realHeicPath()
	if path == "" {
		t.Skip("未提供 MILKSU_REAL_HEIC（真机素材）——跳过需要真实照片的用例")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("读不到 MILKSU_REAL_HEIC 指向的文件（%s）：%v", path, err)
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
	if realHeicPath() == "" {
		t.Skip("未提供 MILKSU_REAL_HEIC（真机素材）——跳过这条")
	}
	before, err := os.Stat(realHeicPath())
	if err != nil {
		t.Skipf("读不到 MILKSU_REAL_HEIC 指向的文件：%v", err)
	}
	if _, err := ConvertHEICToPNG(readRealHeic(t), nil); err != nil {
		t.Fatalf("converting the real photo failed: %v", err)
	}
	after, err := os.Stat(realHeicPath())
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

// 从**文件选择器**那条路（Import）导入 HEIC 时也必须被看见：以前只有 ImportPayloads 会转，
// 选择器进来的 HEIC 会原样落库、发不出去。这条钉住"要么转成功、要么明确报错"。
func TestImportingAHeicThroughTheFilePickerFailsLoudly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "IMG_from_picker.heic")
	// 只造一个 HEIC 的文件头：能被 LooksLikeHEIC 认出来，但 sips 必然转不了 ⇒ 必须报错。
	payload := append([]byte{0, 0, 0, 0x18}, []byte("ftypheic")...)
	payload = append(payload, []byte("milksu-test-not-a-real-heic")...)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(filepath.Join(dir, "library"))
	if err != nil {
		t.Fatal(err)
	}
	_, importErr := store.Import([]string{path})
	if importErr == nil {
		t.Fatal("a HEIC that cannot be converted must fail loudly, not land in the library untouched")
	}
	if !strings.Contains(importErr.Error(), "HEIC") {
		t.Fatalf("the error must name the format so the reader knows which file: %v", importErr)
	}
}

// 非 macOS 上没有 sips：必须明确报错（说明是哪张、为什么），而不是去试跑一个注定失败的子进程。
func TestConvertHEICToPNGWithoutSipsExplainsThePlatform(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("macOS 自带 sips，这条只钉别的平台的行为")
	}
	_, err := ConvertHEICToPNG([]byte("ftypheic-padding-padding"), nil)
	if err == nil {
		t.Fatal("without sips the conversion must fail, not silently succeed")
	}
	if !strings.Contains(err.Error(), "sips") {
		t.Fatalf("the error must name the missing tool, got %q", err.Error())
	}
}
