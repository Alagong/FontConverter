/* =========================================================================
 * sfnt.js —— 字体容器层
 *  - 解析 sfnt 表目录（支持 TrueType / OpenType / TTC / WOFF）
 *  - 重新组装字体（重算偏移、校验和、head.checkSumAdjustment）
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const sfnt = (FL.sfnt = {});

  const SFNT_VERSIONS = {
    0x00010000: 'TrueType 字体（0x00010000）',
    0x4f54544f: 'OpenType / CFF 字体（OTTO）',
    0x74727565: 'TrueType (Apple "true")',
    0x74797031: 'PostScript Type1 包装（"typ1"）'
  };

  /* ---------------------------------------------------------------------
   * 校验和
   * ------------------------------------------------------------------- */
  function checksum(bytes, from, len) {
    from = from || 0;
    len = len == null ? bytes.length : len;
    let sum = 0;
    const end = from + len;
    for (let i = from; i < end; i += 4) {
      let v = 0;
      for (let j = 0; j < 4; j++) {
        const p = i + j;
        v = (v << 8) | (p < end ? bytes[p] : 0);
      }
      sum = (sum + (v >>> 0)) % 4294967296;
    }
    return sum >>> 0;
  }
  sfnt.checksum = checksum;

  /* ---------------------------------------------------------------------
   * 解析
   * ------------------------------------------------------------------- */
  /**
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {number} fontIndex TTC 中要解析的字体序号
   * @returns 字体对象
   */
  sfnt.parse = function (buffer, fontIndex) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12) throw new Error('文件太小，不是有效的字体文件');

    const signature = view.getUint32(0);
    let flavor = signature;
    let collection = null;
    let dirStart = 0;    // 该字体的 OffsetTable 起点

    if (signature === 0x74746366) {  // 'ttcf' —— TrueType Collection
      const major = view.getUint16(4), minor = view.getUint16(6);
      const numFonts = view.getUint32(8);
      const offsets = [];
      for (let i = 0; i < numFonts; i++) {
        const off = view.getUint32(12 + i * 4);
        if (12 + i * 4 + 4 <= bytes.length && off + 12 <= bytes.length) offsets.push(off);
      }
      if (!offsets.length) throw new Error('TTC 集合中没有可用的字体');
      collection = { major: major, minor: minor, numFonts: offsets.length, offsets: offsets };
      fontIndex = Math.min(Math.max(fontIndex || 0, 0), offsets.length - 1);
      dirStart = offsets[fontIndex];
      flavor = view.getUint32(dirStart);
    } else {
      fontIndex = 0;
      dirStart = 0;
    }

    // OffsetTable：sfntVersion(4) numTables(2) searchRange(2) entrySelector(2) rangeShift(2)
    const numTables = view.getUint16(dirStart + 4);
    const searchRange = view.getUint16(dirStart + 6);
    const entrySelector = view.getUint16(dirStart + 8);
    const rangeShift = view.getUint16(dirStart + 10);

    const tables = [];
    const tableMap = {};
    for (let i = 0; i < numTables; i++) {
      const p = dirStart + 12 + i * 16;
      if (p + 16 > bytes.length) break;
      const tag = U.tag(view.getUint32(p));
      const sum = view.getUint32(p + 4);
      const offset = view.getUint32(p + 8);
      const length = view.getUint32(p + 12);
      // 目录中记录的校验和原样保留供查看；本工具不做一致性校验
      // （很多内部/中间态字体并不会维护它，保存时我们会按实际内容重新计算）
      const t = {
        tag: tag,
        checksum: sum,
        offset: offset,
        length: length,
        bytes: bytes.subarray(offset, Math.min(offset + length, bytes.length))
      };
      tables.push(t);
      tableMap[tag] = t;
    }
    if (!tables.length) throw new Error('未找到任何字体表，文件可能已损坏');

    const font = {
      fileName: '',
      fileSize: bytes.length,
      sfntVersion: flavor,
      sfntVersionText: SFNT_VERSIONS[flavor] || '未知版本 0x' + U.hex8(flavor),
      numTables: numTables,
      searchRange: searchRange,
      entrySelector: entrySelector,
      rangeShift: rangeShift,
      collection: collection,
      fontIndex: fontIndex,
      isCFF: flavor === 0x4f54544f,
      tables: tables,
      tableMap: tableMap,
      parsed: {},          // tag -> 解析结果
      rebuilds: {},        // tag -> Uint8Array（保存时使用重写后的表）
      dirty: {}            // tag -> 原因文本
    };

    // 常用全局信息
    if (tableMap['head'] && tableMap['head'].bytes.length >= 54) {
      const v = new DataView(tableMap['head'].bytes.buffer, tableMap['head'].bytes.byteOffset);
      font.unitsPerEm = v.getUint16(18);
      font.indexToLocFormat = v.getInt16(50);
    }
    if (tableMap['maxp'] && tableMap['maxp'].bytes.length >= 6) {
      const v = new DataView(tableMap['maxp'].bytes.buffer, tableMap['maxp'].bytes.byteOffset);
      font.numGlyphs = v.getUint16(4);
    }
    return font;
  };

  /* ---------------------------------------------------------------------
   * WOFF 解包（同步返回 Promise）
   * ------------------------------------------------------------------- */
  sfnt.isWOFF = (bytes) =>
    bytes.length > 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46;

  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('当前环境不支持 DecompressionStream，无法解压 WOFF');
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** WOFF → 还原为标准 sfnt 字节 */
  sfnt.woffToSfnt = async function (buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const flavor = view.getUint32(4);
    const numTables = view.getUint16(12);
    const entries = [];
    for (let i = 0; i < numTables; i++) {
      const p = 44 + i * 20;
      entries.push({
        tag: U.tag(view.getUint32(p)),
        offset: view.getUint32(p + 4),
        compLength: view.getUint32(p + 8),
        origLength: view.getUint32(p + 12),
        origChecksum: view.getUint32(p + 16)
      });
    }
    const out = [];
    for (const e of entries) {
      const raw = bytes.subarray(e.offset, e.offset + e.compLength);
      const data = e.compLength === e.origLength ? raw : await inflate(raw);
      out.push({ tag: e.tag, bytes: data });
    }
    return { sfntBytes: sfnt.build(out, { flavor: flavor }), entries: entries };
  };

  /* ---------------------------------------------------------------------
   * 组装（保存）
   * ------------------------------------------------------------------- */
  /**
   * @param {Array<{tag:string, bytes:Uint8Array}>} tables
   * @param {object} opts { flavor, dropDSIG, dropStale }
   */
  sfnt.build = function (tables, opts) {
    opts = opts || {};
    let list = tables.slice();

    // 去掉失效签名 / 过期点阵度量表（可选）
    if (opts.dropDSIG) list = list.filter((t) => t.tag !== 'DSIG');
    if (opts.dropStale) {
      const drop = { hdmx: 1, LTSH: 1, VDMX: 1, DSIG: 1 };
      list = list.filter((t) => !drop[t.tag]);
    }

    // 修正 head.checkSumAdjustment 为 0
    const head = list.find((t) => t.tag === 'head');
    let headAdjOffset = -1;
    if (head && head.bytes.length >= 12) {
      head.bytes = head.bytes.slice();          // 复制，避免污染源数据
      headAdjOffset = 8;
      new DataView(head.bytes.buffer).setUint32(8, 0);
    }

    // 表目录按 tag 升序
    list.sort((a, b) => (U.tagToInt(a.tag) >>> 0) - (U.tagToInt(b.tag) >>> 0));

    const n = list.length;
    let searchRange = 16, entrySelector = 0;
    while (searchRange * 2 <= n * 16) { searchRange *= 2; entrySelector++; }
    const rangeShift = n * 16 - searchRange;

    const headerSize = 12 + n * 16;
    // 计算偏移
    let offset = headerSize;
    const dir = [];
    for (const t of list) {
      const len = t.bytes.length;
      dir.push({ tag: t.tag, bytes: t.bytes, offset: offset, length: len, checksum: checksum(t.bytes) });
      offset += (len + 3) & ~3;
    }
    const total = offset;

    const out = new Uint8Array(total);
    const ov = new DataView(out.buffer);
    const flavor = opts.flavor != null ? opts.flavor : 0x00010000;
    ov.setUint32(0, flavor >>> 0);
    ov.setUint16(4, n);
    ov.setUint16(6, searchRange);
    ov.setUint16(8, entrySelector);
    ov.setUint16(10, rangeShift);

    dir.forEach((d, i) => {
      const p = 12 + i * 16;
      ov.setUint32(p, U.tagToInt(d.tag) >>> 0);
      ov.setUint32(p + 4, d.checksum);
      ov.setUint32(p + 8, d.offset);
      ov.setUint32(p + 12, d.length);
      out.set(d.bytes, d.offset);
    });

    // head.checkSumAdjustment = 0xB1B0AFBA - 整个文件校验和
    // 注意：head 表在目录中的校验和必须基于 checkSumAdjustment = 0 的状态计算（前面已写入），
    // 写入调整值后不能再改动目录，否则整个文件的校验和将不再是 0xB1B0AFBA。
    if (headAdjOffset >= 0) {
      const headDir = dir.find((d) => d.tag === 'head');
      if (headDir) {
        const totalSum = checksum(out);
        const adj = (0xb1b0afba - totalSum) >>> 0;
        ov.setUint32(headDir.offset + headAdjOffset, adj);
      }
    }
    return out;
  };

  /** 计算某表的校验和（供 UI 显示） */
  sfnt.tableChecksum = checksum;
})(typeof window !== 'undefined' ? window : globalThis);
