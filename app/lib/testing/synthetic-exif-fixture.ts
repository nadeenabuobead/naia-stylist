// app/lib/testing/synthetic-exif-fixture.ts
//
// Test-only fixture builder/parser for validating the fl_force_strip fix.
// Not imported by any production route — used only by the metadata-strip
// validation harness. Builds a real, decodable JPEG (via the existing
// `canvas` dependency) with a hand-constructed EXIF APP1 segment containing
// a GPS IFD spliced in, and a generic enough EXIF/GPS scanner to confirm
// presence (on the source fixture) or absence (on the downloaded-back
// Cloudinary original) of those tags. No network, no credentials, no
// customer/DB access — pure buffer manipulation.

import { createCanvas } from "canvas";

// ── Build a real, decodable JPEG with embedded GPS/EXIF ──────────────────────
//
// Renders a trivial 300x300 image, encodes it as a genuine JPEG via `canvas`,
// then splices a minimal, spec-correct EXIF APP1 segment (TIFF header, IFD0
// with a single GPSInfo IFD pointer, GPS IFD with 4 populated tags) right
// after the SOI marker — the same technique real EXIF-writing libraries use.
export function buildSyntheticGpsJpeg(): Buffer {
  const canvas = createCanvas(300, 300);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a6ea5";
  ctx.fillRect(0, 0, 300, 300);
  ctx.fillStyle = "#f2c14e";
  ctx.fillRect(60, 60, 180, 180);
  const plainJpeg = canvas.toBuffer("image/jpeg", { quality: 0.9 });

  const exifApp1 = buildGpsExifApp1Segment();

  // SOI is always the first 2 bytes of any JPEG; insert APP1 right after it.
  return Buffer.concat([plainJpeg.subarray(0, 2), exifApp1, plainJpeg.subarray(2)]);
}

// ── Minimal EXIF APP1 segment with a 4-tag GPS IFD ────────────────────────────
//
// Little-endian TIFF. Layout (offsets relative to the TIFF header, i.e. right
// after the "Exif\0\0" identifier):
//   0-7    TIFF header (byte order + magic + IFD0 offset)
//   8-25   IFD0: 1 entry (GPSInfo IFD pointer, tag 0x8825) + next-IFD offset
//   26-79  GPS IFD: 4 entries + next-IFD offset
//   80-103 GPSLatitude data (3 RATIONALs)
//   104-127 GPSLongitude data (3 RATIONALs)
function buildGpsExifApp1Segment(): Buffer {
  const tiff = Buffer.alloc(128);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(0x002a, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 offset

  // IFD0: 1 entry
  let o = 8;
  tiff.writeUInt16LE(1, o); o += 2;
  writeIfdEntry(tiff, o, 0x8825, 4, 1, 26); o += 12; // GPSInfo IFD pointer -> offset 26
  tiff.writeUInt32LE(0, o); o += 4; // next IFD = none

  // GPS IFD at offset 26: 4 entries
  o = 26;
  tiff.writeUInt16LE(4, o); o += 2;
  writeIfdEntryInlineAscii(tiff, o, 0x0001, "N"); o += 12;      // GPSLatitudeRef
  writeIfdEntry(tiff, o, 0x0002, 5, 3, 80); o += 12;            // GPSLatitude -> data @80
  writeIfdEntryInlineAscii(tiff, o, 0x0003, "W"); o += 12;      // GPSLongitudeRef
  writeIfdEntry(tiff, o, 0x0004, 5, 3, 104); o += 12;           // GPSLongitude -> data @104
  tiff.writeUInt32LE(0, o); o += 4; // next IFD = none

  // GPSLatitude: 40 deg 41 min 21 sec (synthetic, arbitrary)
  writeRational(tiff, 80, 40, 1);
  writeRational(tiff, 88, 41, 1);
  writeRational(tiff, 96, 21, 1);
  // GPSLongitude: 74 deg 0 min 21 sec (synthetic, arbitrary)
  writeRational(tiff, 104, 74, 1);
  writeRational(tiff, 112, 0, 1);
  writeRational(tiff, 120, 21, 1);

  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const segmentLength = payload.length + 2; // length field counts itself

  const segment = Buffer.alloc(4 + payload.length);
  segment.writeUInt8(0xff, 0);
  segment.writeUInt8(0xe1, 1);
  segment.writeUInt16BE(segmentLength, 2);
  payload.copy(segment, 4);
  return segment;
}

function writeIfdEntry(buf: Buffer, offset: number, tag: number, type: number, count: number, value: number) {
  buf.writeUInt16LE(tag, offset);
  buf.writeUInt16LE(type, offset + 2);
  buf.writeUInt32LE(count, offset + 4);
  buf.writeUInt32LE(value, offset + 8);
}

function writeIfdEntryInlineAscii(buf: Buffer, offset: number, tag: number, ascii: string) {
  buf.writeUInt16LE(tag, offset);
  buf.writeUInt16LE(2, offset + 2); // type 2 = ASCII
  buf.writeUInt32LE(ascii.length + 1, offset + 4); // count includes null terminator
  buf.write(ascii + "\0", offset + 8, "ascii"); // fits inline (<=4 bytes)
}

function writeRational(buf: Buffer, offset: number, numerator: number, denominator: number) {
  buf.writeUInt32LE(numerator, offset);
  buf.writeUInt32LE(denominator, offset + 4);
}

// ── Generic EXIF/GPS presence scanner ─────────────────────────────────────────
//
// Walks the JPEG's marker segments looking for an APP1 "Exif\0\0" segment,
// then (if present) follows IFD0 to find a GPSInfo IFD pointer (tag 0x8825)
// and reports which of the standard GPS tags it finds there. Used both to
// sanity-check the source fixture (tags MUST be present) and to verify the
// downloaded-back Cloudinary original (tags MUST be absent after
// fl_force_strip).
export interface ExifGpsScanResult {
  hasExifApp1: boolean;
  hasGpsIfd: boolean;
  gpsTagsFound: string[];
}

const GPS_TAG_NAMES: Record<number, string> = {
  0x0001: "GPSLatitudeRef",
  0x0002: "GPSLatitude",
  0x0003: "GPSLongitudeRef",
  0x0004: "GPSLongitude",
};

export function scanForExifGpsTags(jpeg: Buffer): ExifGpsScanResult {
  const result: ExifGpsScanResult = { hasExifApp1: false, hasGpsIfd: false, gpsTagsFound: [] };
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return result;

  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) break;
    const marker = jpeg[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // SOS / EOI — no more APPn segments
    const segLen = jpeg.readUInt16BE(offset + 2);
    if (marker === 0xe1) {
      const segStart = offset + 4;
      const id = jpeg.toString("ascii", segStart, segStart + 6);
      if (id === "Exif\0\0") {
        result.hasExifApp1 = true;
        parseTiffForGps(jpeg, segStart + 6, result);
      }
    }
    offset += 2 + segLen;
  }
  return result;
}

function parseTiffForGps(jpeg: Buffer, tiffStart: number, result: ExifGpsScanResult) {
  if (tiffStart + 8 > jpeg.length) return;
  const byteOrder = jpeg.toString("ascii", tiffStart, tiffStart + 2);
  const little = byteOrder === "II";
  const readU16 = (o: number) => (little ? jpeg.readUInt16LE(o) : jpeg.readUInt16BE(o));
  const readU32 = (o: number) => (little ? jpeg.readUInt32LE(o) : jpeg.readUInt32BE(o));

  const ifd0Offset = tiffStart + readU32(tiffStart + 4);
  if (ifd0Offset + 2 > jpeg.length) return;
  const entryCount = readU16(ifd0Offset);

  let gpsIfdOffset: number | null = null;
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > jpeg.length) break;
    const tag = readU16(entryOffset);
    if (tag === 0x8825) {
      gpsIfdOffset = tiffStart + readU32(entryOffset + 8);
      break;
    }
  }
  if (gpsIfdOffset === null) return;

  result.hasGpsIfd = true;
  if (gpsIfdOffset + 2 > jpeg.length) return;
  const gpsEntryCount = readU16(gpsIfdOffset);
  for (let i = 0; i < gpsEntryCount; i++) {
    const entryOffset = gpsIfdOffset + 2 + i * 12;
    if (entryOffset + 12 > jpeg.length) break;
    const tag = readU16(entryOffset);
    const name = GPS_TAG_NAMES[tag] ?? `0x${tag.toString(16)}`;
    result.gpsTagsFound.push(name);
  }
}
