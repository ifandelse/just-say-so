// A reader for the zip archives Vale packages ship as: the central
// directory, then each entry's local header and data, stored or deflated.
// Node has zlib and no zip module, and a dependency for this would be the
// runtime's first. Zip64 archives are refused; a package archive is a few
// hundred kilobytes at most.
import zlib from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEocd(buf) {
  // The end record sits in the last 22 bytes plus an optional comment of
  // up to 65535 bytes.
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error('not a zip archive: no end-of-central-directory record');
}

/**
 * The entries of a zip archive held in a Buffer: [{ name, data }] for
 * every file entry, directories left out. Throws on a malformed archive
 * or an unsupported compression method.
 */
export function readZip(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('zip64 archives are not supported');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL) throw new Error('malformed zip: bad central directory entry');
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error('zip64 archives are not supported');
    if (buf.readUInt32LE(local) !== LOCAL) throw new Error('malformed zip: bad local header');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

// A writer for the tests and for nothing else: stored or deflated entries,
// no extra fields, no comment.
export function writeZip(files, { deflate = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content);
    const method = deflate ? 8 : 0;
    const payload = deflate ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, payload);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(centrals.length / 2, 8);
  eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
