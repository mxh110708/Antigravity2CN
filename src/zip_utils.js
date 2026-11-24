'use strict';

const zlib = require('node:zlib');

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function assertSafeEntryName(name) {
    if (typeof name !== 'string' || !name) {
        throw new Error('ZIP entry name must be a non-empty string.');
    }
    if (name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
        throw new Error(`Unsafe ZIP entry path: ${name}`);
    }
    const parts = name.split('/');
    for (const part of parts) {
        if (!part || part === '.' || part === '..') {
            throw new Error(`Unsafe ZIP entry segment: ${name}`);
        }
    }
}

/**
 * Create a deterministic standard ZIP buffer from an array of { name, data: Buffer }.
 */
function createZipBuffer(entries) {
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const entry of sorted) {
        assertSafeEntryName(entry.name);
        const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const crc = crc32(rawData);
        const deflated = zlib.deflateRawSync(rawData, { level: 9 });
        const useDeflate = deflated.length < rawData.length;
        const method = useDeflate ? 8 : 0;
        const compData = useDeflate ? deflated : rawData;

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4); // version needed
        localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(0, 10); // mod time
        localHeader.writeUInt16LE(0x0021, 12); // mod date (1980-01-01)
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compData.length, 18);
        localHeader.writeUInt32LE(rawData.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localChunks.push(localHeader, nameBuf, compData);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE((3 << 8) | 20, 4); // Unix creator + v2.0
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x0021, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compData.length, 20);
        centralHeader.writeUInt32LE(rawData.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file 0644
        centralHeader.writeUInt32LE(offset, 42);

        centralChunks.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + compData.length;
    }

    const centralDir = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(sorted.length, 8);
    eocd.writeUInt16LE(sorted.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localChunks, centralDir, eocd]);
}

/**
 * Parse and strictly verify a ZIP archive buffer (rejects symlinks, unsafe paths, CRC mismatches, and size bombs).
 */
function parseZipBuffer(buffer, options = {}) {
    const maxTotalBytes = options.maxTotalBytes || 20 * 1024 * 1024;
    const maxEntries = options.maxEntries || 256;

    if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
        throw new Error('Invalid ZIP archive: file too small.');
    }

    let eocdOffset = -1;
    const minOffset = Math.max(0, buffer.length - 65557);
    for (let i = buffer.length - 22; i >= minOffset; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            const commentLen = buffer.readUInt16LE(i + 20);
            if (i + 22 + commentLen === buffer.length) {
                eocdOffset = i;
                break;
            }
        }
    }
    if (eocdOffset === -1) {
        throw new Error('Invalid ZIP archive: End of Central Directory not found.');
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    const cdSize = buffer.readUInt32LE(eocdOffset + 12);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
    if (entryCount > maxEntries) {
        throw new Error(`ZIP archive exceeds maximum entry count (${maxEntries}).`);
    }
    if (cdOffset + cdSize > eocdOffset) {
        throw new Error('Invalid ZIP archive: central directory out of bounds.');
    }

    const files = new Map();
    let totalExtracted = 0;
    let pos = cdOffset;

    for (let i = 0; i < entryCount; i++) {
        if (pos + 46 > cdOffset + cdSize || buffer.readUInt32LE(pos) !== 0x02014b50) {
            throw new Error('Invalid ZIP archive: corrupted central directory header.');
        }
        const versionMadeBy = buffer.readUInt16LE(pos + 4);
        const flags = buffer.readUInt16LE(pos + 8);
        const method = buffer.readUInt16LE(pos + 10);
        const expectedCrc = buffer.readUInt32LE(pos + 16);
        const compSize = buffer.readUInt32LE(pos + 20);
        const uncompSize = buffer.readUInt32LE(pos + 24);
        const nameLen = buffer.readUInt16LE(pos + 28);
        const extraLen = buffer.readUInt16LE(pos + 30);
        const commentLen = buffer.readUInt16LE(pos + 32);
        const externalAttr = buffer.readUInt32LE(pos + 38);
        const localOffset = buffer.readUInt32LE(pos + 42);

        if (flags & 0x0001) {
            throw new Error('Encrypted ZIP entries are not supported.');
        }

        const nameStart = pos + 46;
        const nameEnd = nameStart + nameLen;
        if (nameEnd + extraLen + commentLen > cdOffset + cdSize) {
            throw new Error('Invalid ZIP archive: entry metadata out of bounds.');
        }
        const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
        pos = nameEnd + extraLen + commentLen;

        // Reject Unix symlinks or special file modes.
        const creatorOs = versionMadeBy >>> 8;
        if (creatorOs === 3) {
            const unixMode = (externalAttr >>> 16) & 0o170000;
            if (unixMode === 0o120000) {
                throw new Error(`ZIP archive contains forbidden symlink: ${name}`);
            }
            if (unixMode !== 0 && unixMode !== 0o100000 && unixMode !== 0o040000) {
                throw new Error(`ZIP archive contains unsupported special file: ${name}`);
            }
        }

        if (name.endsWith('/')) {
            continue;
        }
        assertSafeEntryName(name);
        if (files.has(name)) {
            throw new Error(`Duplicate ZIP entry: ${name}`);
        }
        if (totalExtracted + uncompSize > maxTotalBytes) {
            throw new Error(`ZIP extracted size exceeds limit (${maxTotalBytes} bytes).`);
        }

        if (localOffset + 30 > cdOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
            throw new Error(`Invalid local file header for ZIP entry: ${name}`);
        }
        const localNameLen = buffer.readUInt16LE(localOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compSize;
        if (dataEnd > cdOffset) {
            throw new Error(`ZIP entry data out of bounds: ${name}`);
        }

        const compData = buffer.subarray(dataStart, dataEnd);
        let data;
        if (method === 0) {
            data = Buffer.from(compData);
        } else if (method === 8) {
            data = zlib.inflateRawSync(compData, { maxOutputLength: maxTotalBytes - totalExtracted });
        } else {
            throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
        }

        if (data.length !== uncompSize) {
            throw new Error(`ZIP entry size mismatch for ${name}`);
        }
        if (crc32(data) !== expectedCrc) {
            throw new Error(`ZIP entry CRC32 mismatch for ${name}`);
        }

        totalExtracted += data.length;
        files.set(name, data);
    }

    return files;
}

module.exports = {
    crc32,
    assertSafeEntryName,
    createZipBuffer,
    parseZipBuffer,
};
