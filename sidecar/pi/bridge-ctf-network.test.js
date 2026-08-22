import assert from "node:assert/strict";
import test from "node:test";
import {
  ctfHTTPAssetPreviewBytes,
  ctfHTTPModelMaxBytes,
  isCTFHTTPStaticAsset,
  projectCTFHTTPBody,
} from "./bridge-ctf-network.js";

test("static JS/CSS URLs are treated as assets even without a content type", () => {
  assert.equal(isCTFHTTPStaticAsset("application/javascript", "https://www.nssctf.cn/js/index.js"), true);
  assert.equal(isCTFHTTPStaticAsset("text/html", "https://www.nssctf.cn/problem/7585"), false);
  assert.equal(isCTFHTTPStaticAsset("application/json", "https://www.nssctf.cn/api/problem/7585"), false);
});

test("HTML and JSON stay in the model-visible body up to Pi's 50KB tool limit", () => {
  const html = "<!doctype html><title>challenge</title>";
  const projected = projectCTFHTTPBody(Buffer.from(html), "text/html", "https://www.nssctf.cn/problem/7585");
  assert.equal(projected.bodyEncoding, "utf8");
  assert.equal(projected.body, html);
  assert.equal(projected.truncatedForModel, false);
  assert.ok(ctfHTTPModelMaxBytes <= 50 * 1024);
});

test("JavaScript bundles are clipped to a 4KB excerpt for the model", () => {
  const bundle = `var api="${"x".repeat(20_000)}";`;
  const projected = projectCTFHTTPBody(
    Buffer.from(bundle),
    "application/javascript",
    "https://www.nssctf.cn/js/index-CkEvamSt.js",
  );
  assert.equal(projected.truncatedForModel, true);
  assert.ok(projected.previewBytes <= ctfHTTPAssetPreviewBytes);
  assert.ok(projected.body.length < bundle.length);
  assert.ok(projected.totalBytes > ctfHTTPAssetPreviewBytes);
  assert.equal(projected.body.includes("x".repeat(20_000)), false);
});
