import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { sha256, sha256Hex, hmacSha256, pbkdf2, toHex, utf8 } from "../src/sha256.js";

test("sha256 matches node:crypto on vectors", () => {
  assert.strictEqual(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.strictEqual(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.strictEqual(
    sha256Hex("The quick brown fox jumps over the lazy dog"),
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
  );
});

test("sha256 matches node:crypto on random inputs", () => {
  for (let i = 0; i < 50; i++) {
    const s = "x".repeat(i) + Math.random().toString(36).slice(2) + String.fromCharCode(0x4e00 + (i % 100));
    assert.strictEqual(sha256Hex(s), crypto.createHash("sha256").update(s, "utf8").digest("hex"), "mismatch for length " + s.length);
  }
});

test("hmac-sha256 matches node:crypto", () => {
  for (let i = 0; i < 20; i++) {
    const key = "k" + Math.random().toString(36).slice(2);
    const msg = "m" + Math.random().toString(36).slice(2);
    const mine = toHex(hmacSha256(utf8(key), utf8(msg)));
    const ref = crypto.createHmac("sha256", key).update(msg, "utf8").digest("hex");
    assert.strictEqual(mine, ref);
  }
});

test("pbkdf2 matches node:crypto", () => {
  for (const iter of [1, 2, 10, 1000]) {
    const mine = toHex(pbkdf2("password123", "salty", iter, 32));
    const ref = crypto.pbkdf2Sync("password123", "salty", iter, 32, "sha256").toString("hex");
    assert.strictEqual(mine, ref, "mismatch at " + iter + " iterations");
  }
});
