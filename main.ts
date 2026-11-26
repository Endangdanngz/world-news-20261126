// The World Today — 26 November 2026 edition.
// Segment-ledger auditor for the front-page JPEG.
//
// The program does not draw anything. It opens the finished front page
// (entry.png, produced by the newsroom for this edition), audits every
// JPEG segment the way a ledger clerk checks a column of figures —
// marker, offset and declared length, one after another, with no gaps
// and no overlaps — and only publishes the file when the whole ledger
// balances. A file that fails any check is never written out.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The edition this auditor is pinned to. These numbers are the fingerprint
// of the finished front page; a different file, however similar it looks,
// is rejected outright.
const EXPECTED_SIZE = 317129;
const EXPECTED_SHA256 =
  '82d7c199e6c77d472880a414771852f6d05e5651f0b68d4ab7404bbf2f72b88b';
const EDITION_STAMP = 'THE WORLD TODAY - 26 NOVEMBER 2026 - BEPICOLOMBO';
const OUTPUT_NAME = 'entry.png';

// Markers that carry no length field and therefore no payload.
const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

interface Segment {
  marker: number;
  offset: number;
  // Total span of the segment in the file, length field included.
  span: number;
  // Payload bytes (length field excluded); empty for standalone markers.
  payload: Buffer;
}

function fail(message: string): never {
  throw new Error(`segment-ledger audit failed: ${message}`);
}

function u16(buf: Buffer, at: number): number {
  return (buf[at] << 8) | buf[at + 1];
}

function markerName(marker: number): string {
  return `0xFF${marker.toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Walk the header of `buf` from `start` and return the ordered ledger of
 * segments, stopping just after the SOS (start-of-scan) header. The
 * entropy-coded data that follows SOS is not part of the ledger; it is
 * traced separately, byte by byte, until EOI.
 */
function buildLedger(buf: Buffer): { ledger: Segment[]; sos: Segment } {
  const ledger: Segment[] = [];
  let pos = 0;

  // The file must open with SOI, immediately followed by the JFIF APP0.
  if (buf[0] !== 0xff || buf[1] !== 0xd8) fail('file does not start with SOI');
  if (buf[2] !== 0xff || buf[3] !== 0xe0) fail('SOI is not followed by JFIF APP0');
  pos = 2;

  let sos: Segment | null = null;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) fail(`expected a marker at offset ${pos}, found 0x${buf[pos].toString(16)}`);
    // Skip fill bytes (0xFF repeated) before the real marker code.
    let at = pos;
    while (buf[at] === 0xff) at++;
    const marker = buf[at];
    if (marker === 0x00) fail(`stuffed 0xFF00 byte outside scan data at offset ${pos}`);

    if (STANDALONE.has(marker)) {
      if (marker === 0xd9) fail('EOI reached before any scan data');
      if (marker === 0xd8) fail('a second SOI marker appears mid-file');
      ledger.push({ marker, offset: pos, span: at - pos + 2, payload: Buffer.alloc(0) });
      pos = at + 2;
      continue;
    }

    if (at + 4 > buf.length) fail(`segment ${markerName(marker)} at offset ${pos} is truncated`);
    const declared = u16(buf, at + 1);
    if (declared < 2) fail(`segment ${markerName(marker)} declares an impossible length ${declared}`);
    if (at + 1 + declared > buf.length) {
      fail(`segment ${markerName(marker)} at offset ${pos} runs past the end of the file`);
    }
    const payload = buf.subarray(at + 3, at + 1 + declared);
    const segment: Segment = { marker, offset: pos, span: at - pos + 1 + declared, payload };
    ledger.push(segment);
    pos = at + 1 + declared;

    if (marker === 0xda) {
      sos = segment;
      break;
    }
  }

  if (sos === null) fail('no SOS segment found');
  return { ledger, sos };
}

/** Every segment must start exactly where the previous one ended. */
function checkContiguous(ledger: Segment[]): void {
  for (let i = 1; i < ledger.length; i++) {
    const prev = ledger[i - 1];
    const cur = ledger[i];
    if (cur.offset !== prev.offset + prev.span) {
      fail(
        `gap or overlap between ${markerName(prev.marker)} (ends at ${prev.offset + prev.span}) ` +
          `and ${markerName(cur.marker)} (starts at ${cur.offset})`,
      );
    }
  }
}

/** The APP0 payload must be a JFIF header. */
function checkJfif(app0: Segment): void {
  if (!app0.payload.subarray(0, 5).equals(Buffer.from('JFIF\0', 'latin1'))) {
    fail('APP0 payload is not a JFIF header');
  }
}

/**
 * Split every DQT payload into whole quantisation tables. An 8-bit table
 * occupies 65 bytes (1 header + 64 values), a 16-bit table 129 bytes.
 * A leftover remainder means the table is cut short and the file is corrupt.
 */
function countQuantTables(ledger: Segment[]): number {
  let tables = 0;
  for (const seg of ledger) {
    if (seg.marker !== 0xdb) continue;
    let at = 0;
    while (at < seg.payload.length) {
      const precision = seg.payload[at] >> 4;
      if (precision === 0) {
        if (at + 65 > seg.payload.length) fail('DQT segment ends inside an 8-bit table');
        at += 65;
      } else if (precision === 1) {
        if (at + 129 > seg.payload.length) fail('DQT segment ends inside a 16-bit table');
        at += 129;
      } else {
        fail(`DQT table at offset ${seg.offset} has unknown precision ${precision}`);
      }
      tables++;
    }
  }
  return tables;
}

/**
 * Trace the entropy-coded data after SOS. 0xFF00 is a stuffed byte, not a
 * marker; 0xFFD0–0xFFD7 are restart markers. Anything else that looks like
 * a marker inside the scan is an error, and EOI must land exactly on the
 * last byte of the file.
 */
function traceScanData(buf: Buffer, sos: Segment): void {
  let i = sos.offset + sos.span;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    if (i + 1 >= buf.length) fail('file ends on a lone 0xFF byte inside scan data');
    const next = buf[i + 1];
    if (next === 0x00) {
      i += 2; // stuffed byte: part of the image, not a marker
    } else if (next >= 0xd0 && next <= 0xd7) {
      i += 2; // restart marker
    } else if (next === 0xff) {
      i += 1; // fill byte before the next marker
    } else if (next === 0xd9) {
      if (i + 2 !== buf.length) fail(`EOI at offset ${i} is not the last byte of the file`);
      return;
    } else {
      fail(`unexpected marker ${markerName(next)} inside scan data at offset ${i}`);
    }
  }
  fail('scan data ends without an EOI marker');
}

function main(): void {
  const sourcePath = fileURLToPath(new URL(`./${OUTPUT_NAME}`, import.meta.url));
  const bytes = readFileSync(sourcePath);

  // Pin the edition first: size and fingerprint must match exactly.
  if (bytes.length !== EXPECTED_SIZE) {
    fail(`size ${bytes.length} does not match the pinned ${EXPECTED_SIZE}`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== EXPECTED_SHA256) fail(`sha256 ${digest} does not match the pinned edition`);

  const { ledger, sos } = buildLedger(bytes);
  checkContiguous(ledger);

  const app0 = ledger[0];
  if (app0.marker !== 0xe0) fail('first segment is not APP0');
  checkJfif(app0);

  // Exactly one baseline frame, 1024x1024, three components.
  const frames = ledger.filter((s) => s.marker === 0xc0);
  if (frames.length !== 1) fail(`expected exactly one SOF0 frame, found ${frames.length}`);
  const frame = frames[0];
  if (frame.offset > sos.offset) fail('SOF0 frame appears after SOS');
  if (frame.payload.length < 6) fail('SOF0 payload is too short to hold a frame header');
  const precision = frame.payload[0];
  const height = u16(frame.payload, 1);
  const width = u16(frame.payload, 3);
  const components = frame.payload[5];
  if (precision !== 8 || height !== 1024 || width !== 1024 || components !== 3) {
    fail(`frame is ${width}x${height}, precision ${precision}, ${components} components — expected 1024x1024, 8-bit, 3 components`);
  }

  // Exactly one scan, and it must come after the frame.
  const scans = ledger.filter((s) => s.marker === 0xda);
  if (scans.length !== 1) fail(`expected exactly one SOS segment, found ${scans.length}`);
  if (sos.payload.length < 1) fail('SOS payload is empty');

  // The edition stamp must ride in exactly one comment segment.
  const stamped = ledger.filter(
    (s) => s.marker === 0xfe && s.payload.toString('latin1').includes(EDITION_STAMP),
  );
  if (stamped.length !== 1) fail(`expected one COM segment carrying the edition stamp, found ${stamped.length}`);

  // Quantisation tables must be whole, and the file must carry at least two.
  const tables = countQuantTables(ledger);
  if (tables < 2) fail(`only ${tables} quantisation table(s) found, at least 2 are required`);

  // Trace the scan to EOI; EOI must be the final byte of the file.
  traceScanData(bytes, sos);

  // Every check passed: publish the verified bytes and read them back.
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? './output';
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, OUTPUT_NAME);
  writeFileSync(outPath, bytes);
  const roundTrip = readFileSync(outPath);
  if (!roundTrip.equals(bytes)) fail('read-back of the published file differs from the verified bytes');

  console.log(`audit passed: ${OUTPUT_NAME} ${bytes.length} bytes sha256 ${digest}`);
  console.log(`segments audited: ${ledger.length}, quantisation tables: ${tables}`);
  console.log(`published verified copy to ${outPath}`);
}

main();
