import assert from "node:assert/strict";
import test from "node:test";
import { createImageSizeCache, imageSizeFromHeader } from "./bridge-image-size.js";

// 真机那张：1179x17728。测试用的是**合成的最小文件头**，不需要真图。
const WIDTH = 1179;   // 0x049B
const HEIGHT = 17728; // 0x4540

function pngHeader(width = WIDTH, height = HEIGHT) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegSof(marker = 0xc0, { leading = true, width = WIDTH, height = HEIGHT } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (leading) {
    // 一个 APP0 段，用来证明"按长度跳过非 SOF 段"是对的
    const app0 = Buffer.alloc(18, 0);
    app0.writeUInt16BE(0xffe0, 0);
    app0.writeUInt16BE(16, 2);
    app0.write("JFIF", 4, "latin1");
    parts.push(app0);
  }
  const sof = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 3);
  sof.writeUInt16BE(0xff00 | marker, 0);
  sof.writeUInt16BE(sof.length - 2, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof);
  return Buffer.concat(parts);
}

function ispeBox(width, height) {
  // 真实 ISO-BMFF 的 ispe 盒：size(4) + 'ispe'(4) + version/flags(4) + width(4) + height(4)
  const box = Buffer.alloc(20, 0);
  box.writeUInt32BE(20, 0);
  box.write("ispe", 4, "latin1");
  box.writeUInt32BE(width, 12);
  box.writeUInt32BE(height, 16);
  return box;
}

function heicHeader(width = WIDTH, height = HEIGHT, extra = []) {
  const head = Buffer.alloc(24, 0);
  head.write("ftypheic", 4, "latin1");
  return Buffer.concat([head, ...extra, ispeBox(width, height)]);
}

test("reads the pixel size out of a PNG header", () => {
  assert.deepEqual(imageSizeFromHeader(pngHeader()), {
    width: 1179,
    height: 17728,
    mediaType: "image/png",
    format: "png",
  });
});

// JPEG 那条要走"逐段跳过、直到遇到 SOF"的逻辑，基线 JPEG 与渐进式 JPEG 都要能读。
test("reads the pixel size out of a baseline JPEG, skipping earlier segments", () => {
  assert.deepEqual(imageSizeFromHeader(jpegSof(0xc0)), {
    width: 1179,
    height: 17728,
    mediaType: "image/jpeg",
    format: "jpeg",
  });
});

test("reads a progressive JPEG too", () => {
  const size = imageSizeFromHeader(jpegSof(0xc2));
  assert.equal(size.width, 1179);
  assert.equal(size.height, 17728);
});

// HEIC 现在加不进来，但尺寸先要读得出来。
test("reads the pixel size out of a HEIC header", () => {
  assert.deepEqual(imageSizeFromHeader(heicHeader()), {
    width: 1179,
    height: 17728,
    mediaType: "image/heic",
    format: "heic",
  });
});

// 真机那张 5712x4284 的 HEIC 里，第一个 ispe 是 640x896 的缩略图 ⇒ 取第一个会报到错尺寸。
test("a HEIC with a thumbnail first reports the primary image, not the thumbnail", () => {
  const size = imageSizeFromHeader(heicHeader(5712, 4284, [ispeBox(640, 896), ispeBox(416, 312)]));
  assert.equal(size.width, 5712);
  assert.equal(size.height, 4284);
});

// 反过来的顺序也必须取主图（防"只取最后一个"）。
test("a HEIC whose largest ispe comes first still reports the primary image", () => {
  const size = imageSizeFromHeader(heicHeader(5712, 4284, [ispeBox(2856, 2142), ispeBox(640, 896)]));
  assert.equal(size.width, 5712);
  assert.equal(size.height, 4284);
});

// 面积并列时取更早的那个（真机里 5712x4284 与 4284x5712 面积相同，sips 报的是前者）。
test("an equal-area tie keeps the earlier box", () => {
  const size = imageSizeFromHeader(heicHeader(5712, 4284, [ispeBox(4284, 5712)]));
  assert.deepEqual([size.width, size.height], [4284, 5712]);
});

// 一个 ispe 都读不出来 ⇒ null（绝不退化成缩略图尺寸）。
test("a HEIC whose ispe boxes are unreadable yields null, never a thumbnail size", () => {
  const head = Buffer.alloc(24, 0);
  head.write("ftypheic", 4, "latin1");
  const broken = ispeBox(640, 896);
  broken.writeUInt32BE(0, 0); // 盒长度非法 ⇒ 视为图像数据里的巧合
  assert.equal(imageSizeFromHeader(Buffer.concat([head, broken])), null);
  // 只写了半截的 ispe
  assert.equal(imageSizeFromHeader(Buffer.concat([head, ispeBox(640, 896).subarray(0, 10)])), null);
});

// 读不出来就说 null（调用方不显示尺寸），绝不猜、绝不抛。
test("returns null instead of guessing at anything unreadable", () => {
  for (const bad of [
    Buffer.alloc(0),
    Buffer.alloc(64, 7),
    Buffer.from("not an image at all, just text padding here"),
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00]), // 截断的 JPEG
    pngHeader(0, 100),                            // 宽为 0
    heicHeader(1179, 0),                          // 高为 0
  ]) {
    assert.equal(imageSizeFromHeader(bad), null);
  }
  assert.equal(imageSizeFromHeader(undefined), null);
});

// 同一张图每轮都要描述一次 ⇒ 必须只量一次。缓存键是 sha256。
test("measures each content hash once", () => {
  let calls = 0;
  const cache = createImageSizeCache({
    measure: (bytes) => {
      calls += 1;
      return imageSizeFromHeader(bytes);
    },
  });
  const bytes = pngHeader();
  const first = cache.sizeFor("19a13f27", bytes);
  const second = cache.sizeFor("19a13f27", bytes);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(second.width, 1179);
  // 换一张图就要再量一次
  cache.sizeFor("other-hash", jpegSof(0xc0));
  assert.equal(calls, 2);
  // 量不出来的也记住，不要每轮重试
  cache.sizeFor("broken", Buffer.alloc(32, 3));
  cache.sizeFor("broken", Buffer.alloc(32, 3));
  assert.equal(calls, 3);
});
