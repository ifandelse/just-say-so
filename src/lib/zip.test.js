import { describe, it, expect } from 'vitest';
import { readZip, writeZip } from './zip.js';

/*
 * Branch map — src/lib/zip.js
 *   readZip: deflated and stored entries round-trip · directories left out ·
 *     not a zip · zip64 marker refused · unsupported method refused
 */

describe('zip', () => {
  it('should read deflated and stored entries back, leaving directories out', () => {
    const files = { 'A/': '', 'A/one.yml': 'extends: existence\nmessage: "x"\n', 'A/sub/two.txt': 'hello ünïcode' };
    for (const deflate of [true, false]) {
      const entries = readZip(writeZip(files, { deflate })).map((e) => [e.name, e.data.toString('utf8')]);
      expect(entries).toEqual([
        ['A/one.yml', 'extends: existence\nmessage: "x"\n'],
        ['A/sub/two.txt', 'hello ünïcode']
      ]);
    }
  });

  it('should refuse what it cannot read, by name', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/no end-of-central-directory/);
    const zip64 = writeZip({ 'a.txt': 'a' });
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
    expect(() => readZip(zip64)).toThrow(/zip64/);
    const odd = writeZip({ 'a.txt': 'a' }, { deflate: false });
    odd.writeUInt16LE(12, 8); // local header method
    odd.writeUInt16LE(12, odd.length - 22 - 46 - 5 + 10); // central entry method, one 5-byte name
    expect(() => readZip(odd)).toThrow(/unsupported zip compression method 12/);
  });
});
