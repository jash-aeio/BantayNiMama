#!/usr/bin/env node
// Downloads the MediaPipe MobileNetV3-Large image embedder (TR-20).
//
// This is a DEV-TIME download. TR-50/TR-51 forbid network I/O in the shipped
// app; they say nothing about the toolchain (see docs/TOOLING.md). The model is
// gitignored rather than committed so the repo stays lean, and this script is
// what makes that reproducible.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'assets', 'models', 'mobilenet_v3_large.tflite');
const URL =
  'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_large/float32/1/mobilenet_v3_large.tflite';

async function main() {
  await mkdir(dirname(DEST), { recursive: true });

  try {
    const existing = await readFile(DEST);
    if (existing.subarray(4, 8).toString('ascii') === 'TFL3') {
      console.log(`Model already present (${existing.length} bytes) — nothing to do.`);
      console.log(`sha256 ${createHash('sha256').update(existing).digest('hex')}`);
      return;
    }
    console.log('Existing file is not a valid TFLite model, re-downloading.');
  } catch {
    // Not present yet.
  }

  console.log(`Downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.subarray(4, 8).toString('ascii') !== 'TFL3') {
    throw new Error('Downloaded file is not a TFLite flatbuffer (missing TFL3 magic).');
  }

  await writeFile(DEST, buf);
  console.log(`Wrote ${DEST} (${buf.length} bytes)`);
  console.log(`sha256 ${createHash('sha256').update(buf).digest('hex')}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
