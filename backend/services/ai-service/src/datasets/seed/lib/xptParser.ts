/**
 * Minimal SAS Transport (XPT) file parser — SAS Version 5 Transport Format.
 *
 * Reference: SAS record layout specification
 * https://support.sas.com/content/dam/SAS/support/en/technical-papers/
 *            record-layout-of-a-sas-version-5-or-6-data-set-in-sas-transport-xport-format.pdf
 *
 * The format uses 80-byte fixed-width records. Key parts:
 *   • XPORT file header (2 records)
 *   • Member header (2 records)
 *   • Variable descriptors (1 record per variable)
 *   • Observation records (80-byte rows, padded)
 *
 * Numeric values use IBM System/360 floating-point (big-endian).
 */

/** Convert an 8-byte IBM System/360 floating-point to a JavaScript number. */
function ibmFloatToDouble(buf: Buffer, offset: number): number | null {
  const byte0 = buf[offset];
  if (byte0 === 0x2e || byte0 === 0x5f) return null; // missing: '.' or '_'

  const sign = (byte0 & 0x80) === 0 ? 1 : -1;
  const exponent = (byte0 & 0x7f) - 64; // biased exponent, base 16
  let mantissa = 0;
  for (let i = 1; i < 8; i++) {
    mantissa = mantissa * 256 + buf[offset + i];
  }
  if (mantissa === 0) return 0;
  // mantissa is in units of 16^(-14) … not 2^(-56)
  // value = sign * mantissa * 16^(exponent - 14)
  const value = sign * mantissa * Math.pow(16, exponent - 14);
  return value;
}

function readFixedStr(buf: Buffer, start: number, len: number): string {
  return buf
    .subarray(start, start + len)
    .toString("ascii")
    .trimEnd();
}

export interface XptColumn {
  name: string;
  label: string;
  type: "numeric" | "character";
  length: number;
  format: string;
}

export interface XptParseResult {
  columns: XptColumn[];
  rows: Record<string, number | string | null>[];
  datasetName: string;
  label: string;
}

/**
 * Parse a SAS XPT file buffer and return columns + rows.
 * Only columns listed in `keepCols` are returned (pass empty array to keep all).
 */
export function parseXpt(
  data: Buffer,
  keepCols: string[] = [],
): XptParseResult {
  const keepSet = new Set(keepCols.map((c) => c.toUpperCase()));
  const RECORD = 80;
  let pos = 0;

  function readRecord(): Buffer {
    const rec = data.subarray(pos, pos + RECORD);
    pos += RECORD;
    return rec;
  }

  // ── Scan for magic strings (more robust than fixed record offsets) ─────────
  // XPT V5 and V8 have slightly different record layouts; scanning is safer.

  function findMagic(magic: string, from = 0): number {
    const mb = Buffer.from(magic, "ascii");
    for (let p = from; p + 80 <= data.length; p += 80) {
      if (data.subarray(p, p + mb.length).equals(mb)) return p;
    }
    return -1;
  }

  const libPos = findMagic("HEADER RECORD*******LIBR", 0);
  if (libPos < 0) throw new Error("Not an XPT file (LIBRARY header not found)");

  const memberPos = findMagic("HEADER RECORD*******MEMBER", libPos + 80);
  if (memberPos < 0) throw new Error("MEMBER header not found");

  // Record immediately after member header contains the dataset name
  const memberInfoRec = data.subarray(memberPos + 80, memberPos + 160);
  const datasetName = readFixedStr(memberInfoRec, 8, 8);
  const labelRecord = readFixedStr(memberInfoRec, 40, 40);

  const nsHdrPos = findMagic("HEADER RECORD*******NAMESTR", memberPos + 80);
  if (nsHdrPos < 0) throw new Error("NAMESTR header not found");
  pos = nsHdrPos;

  // ── Read NAMESTR header; compute nvar from NAMESTR data size ─────────────
  pos = nsHdrPos; // ensure pos is at NAMESTR header
  readRecord(); // consume NAMESTR header (advances pos by 80)

  // We find the OBS header FIRST and use the distance to back-calculate nvar.
  // This is more reliable than parsing the variable-count field, which has
  // inconsistent formatting across XPT versions (ASCII vs. binary, different offsets).
  const obsPos = findMagic("HEADER RECORD*******OBS", nsHdrPos + 80);
  if (obsPos < 0) throw new Error("Missing OBS header record");

  // NAMESTR data occupies the bytes between the NAMESTR header and the OBS header.
  // Each NAMESTR record is 140 bytes, padded to 80-byte boundaries.
  const namestrDataBytes = obsPos - nsHdrPos - 80; // bytes between nsHdr and obsHdr
  // Back-calculate nvar: find smallest integer such that ceil(nvar*140/80)*80 = namestrDataBytes
  let nvar = 0;
  for (let n = 1; n <= 5000; n++) {
    if (Math.ceil((n * 140) / 80) * 80 === namestrDataBytes) {
      nvar = n;
      break;
    }
  }
  if (nvar <= 0)
    throw new Error(
      `Cannot determine variable count from NAMESTR data size (${namestrDataBytes} bytes)`,
    );

  // ── Dataset label from DSCRPTR record (optional) ──────────────────────────
  const dscrPtr = findMagic("HEADER RECORD*******DSCRPTR", memberPos + 80);
  const dataLabel =
    dscrPtr >= 0 && dscrPtr < nsHdrPos
      ? readFixedStr(data.subarray(dscrPtr + 80, dscrPtr + 160), 8, 40)
      : labelRecord;

  // ── Variable descriptor records (NAMESTR) ─────────────────────────────────
  // NAMESTR layout (140 bytes per variable):
  //   0-1:   ntype (1=num, 2=char)
  //   4-5:   nlng  (variable length: 1..8 for num, 1..200 for char)
  //   8-15:  nname (variable name, 8 chars)
  //   16-55: nlabel (variable label, 40 chars)
  //   56-63: nform  (format name, 8 chars)
  const NAMESTR_LEN = 140;
  const totalNamestrBytes = nvar * NAMESTR_LEN;
  const namestrPad = Math.ceil(totalNamestrBytes / RECORD) * RECORD;
  const namestrBuf = data.subarray(pos, pos + namestrPad);
  pos += namestrPad;

  const columns: XptColumn[] = [];
  for (let v = 0; v < nvar; v++) {
    const off = v * NAMESTR_LEN;
    const ntype = namestrBuf.readUInt16BE(off + 0);
    const nlng = namestrBuf.readUInt16BE(off + 4);
    const nname = readFixedStr(namestrBuf, off + 8, 8);
    const nlabel = readFixedStr(namestrBuf, off + 16, 40);
    const nform = readFixedStr(namestrBuf, off + 56, 8);
    columns.push({
      name: nname,
      label: nlabel,
      type: ntype === 2 ? "character" : "numeric",
      length: nlng,
      format: nform,
    });
  }

  // ── Advance past OBS header to start of data records ─────────────────────
  pos = obsPos + RECORD; // obsPos was already found above

  // ── Calculate observation width ────────────────────────────────────────────
  const obsWidth = columns.reduce((sum, c) => sum + c.length, 0);
  const obsPaddedWidth = Math.ceil(obsWidth / RECORD) * RECORD;

  // ── Parse observations ─────────────────────────────────────────────────────
  const rows: Record<string, number | string | null>[] = [];
  const keepAll = keepSet.size === 0;

  while (pos + obsPaddedWidth <= data.length) {
    const obs = data.subarray(pos, pos + obsPaddedWidth);
    pos += obsPaddedWidth;

    // Check for EOF marker (all zeros or padding)
    if (obs.every((b) => b === 0)) break;

    const row: Record<string, number | string | null> = {};
    let colOff = 0;

    for (const col of columns) {
      const include = keepAll || keepSet.has(col.name.toUpperCase());
      if (col.type === "numeric") {
        const val = ibmFloatToDouble(obs, colOff);
        if (include)
          row[col.name] = val !== null ? Math.round(val * 10000) / 10000 : null;
      } else {
        const str = obs
          .subarray(colOff, colOff + col.length)
          .toString("ascii")
          .trimEnd();
        if (include) row[col.name] = str || null;
      }
      colOff += col.length;
    }

    if (Object.keys(row).length > 0) rows.push(row);
  }

  return { columns, rows, datasetName, label: dataLabel || labelRecord };
}
