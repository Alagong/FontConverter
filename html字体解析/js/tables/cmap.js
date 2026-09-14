/* =========================================================================
 * tables/cmap.js —— 字符映射表
 *  支持格式 0 / 2 / 4 / 6 / 8 / 10 / 12 / 13 / 14 的解析；
 *  可修改某码点对应的字形索引，保存时重建整张 cmap 表
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;

  const MAX_ENTRIES = 300000;   // 展开映射的条目上限（防止异常字体爆内存）

  function parseSubtable(bytes, off) {
    const r = new FL.Reader(bytes, off);
    const format = r.u16();
    const st = { offset: off, format: format, mapping: null, entries: [], info: {} };
    if (format === 0) {
      const length = r.u16(); const language = r.u16();
      const map = [];
      for (let i = 0; i < 256; i++) {
        const gid = r.u8();
        if (gid) map.push([i, gid]);
      }
      st.length = length; st.language = language; st.mapping = map;
      st.info = { 说明: '256 个单字节编码到字形索引的直接查表。' };
    } else if (format === 2) {
      st.length = r.u16(); st.language = r.u16();
      st.info = { 说明: '高字节映射表，用于混合单/双字节编码（如旧版中日韩字体）。本工具仅显示概要。' };
      st.raw = bytes.subarray(off, off + st.length);
    } else if (format === 4) {
      const length = r.u16(); const language = r.u16();
      const segCountX2 = r.u16();
      const segCount = segCountX2 / 2;
      const searchRange = r.u16();
      const entrySelector = r.u16();
      const rangeShift = r.u16();
      const endCodes = []; const startCodes = []; const idDeltas = []; const idRangeOffsets = [];
      for (let i = 0; i < segCount; i++) endCodes.push(r.u16());
      r.u16(); // reservedPad
      for (let i = 0; i < segCount; i++) startCodes.push(r.u16());
      for (let i = 0; i < segCount; i++) idDeltas.push(r.i16());
      // 注意：idRangeOffset 相对于"该元素自身"的位置，需要加上子表在 cmap 表中的偏移
      const idRangeOffsetPos = off + r.pos;
      for (let i = 0; i < segCount; i++) idRangeOffsets.push(r.u16());
      const map = [];
      for (let i = 0; i < segCount; i++) {
        const start = startCodes[i], end = endCodes[i];
        if (start > end) continue;
        for (let c = start; c <= end; c++) {
          let gid;
          if (idRangeOffsets[i] === 0) gid = (c + idDeltas[i]) & 0xffff;
          else {
            const p = idRangeOffsetPos + i * 2 + idRangeOffsets[i] + (c - start) * 2;
            gid = p + 2 <= bytes.length ? ((bytes[p] << 8) | bytes[p + 1]) : 0;
            if (gid !== 0) gid = (gid + idDeltas[i]) & 0xffff;
          }
          if (gid !== 0 && !(c === 0xffff)) map.push([c, gid]);
          if (map.length > MAX_ENTRIES) { c = end + 1; }
        }
        if (map.length > MAX_ENTRIES) break;
      }
      st.length = length; st.language = language; st.mapping = map;
      st.info = {
        段数: segCount,
        查找参数: 'searchRange=' + searchRange + '，entrySelector=' + entrySelector + '，rangeShift=' + rangeShift,
        说明: '分段映射：每段给出 [startCode, endCode] 与 delta 或 glyphIdArray 偏移，是 BMP 最常用的格式。'
      };
    } else if (format === 6) {
      st.length = r.u16(); st.language = r.u16();
      const first = r.u16(); const cnt = r.u16();
      const map = [];
      for (let i = 0; i < cnt; i++) {
        const gid = r.u16();
        if (gid) map.push([first + i, gid]);
      }
      st.mapping = map;
      st.info = { 起始码: '0x' + U.hex4(first), 条目数: cnt, 说明: '修剪映射：仅记录一段连续字符区间。' };
    } else if (format === 8) {
      r.u16(); st.length = r.u32(); st.language = r.u32();
      st.info = { 说明: '混合 16/32 位映射（is32 位图 + 32 位组），极罕见。' };
      st.raw = bytes.subarray(off, Math.min(off + st.length, bytes.length));
    } else if (format === 10) {
      r.u16(); st.length = r.u32(); st.language = r.u32();
      const start = r.u32(); const num = r.u32();
      const map = [];
      for (let i = 0; i < num && i < MAX_ENTRIES; i++) {
        const gid = r.u16();
        if (gid) map.push([start + i, gid]);
      }
      st.mapping = map;
      st.info = { 起始码: 'U+' + start.toString(16).toUpperCase(), 条目数: num, 说明: '32 位修剪数组。' };
    } else if (format === 12 || format === 13) {
      r.u16(); st.length = r.u32(); st.language = r.u32();
      const nGroups = r.u32();
      const map = [];
      let total = 0;
      for (let i = 0; i < nGroups; i++) {
        const s = r.u32(), e = r.u32(), g = r.u32();
        total += e - s + 1;
        if (map.length < MAX_ENTRIES) {
          for (let c = s; c <= e && map.length < MAX_ENTRIES; c++) {
            const gid = format === 12 ? g + (c - s) : g;
            if (gid) map.push([c, gid]);
          }
        }
      }
      st.mapping = map;
      st.info = {
        分组数: nGroups,
        说明: format === 12
          ? '分段覆盖：每组 [startChar, endChar, startGlyphID] 按顺序递增映射，可覆盖全部 Unicode 平面。'
          : '多对一映射：一组字符全部映射到同一个字形（最后手段字体常用）。',
        展开条目: total
      };
    } else if (format === 14) {
      st.length = r.u32(); const numRec = r.u32();
      const recs = [];
      for (let i = 0; i < numRec; i++) {
        recs.push({ selector: r.u24(), defOff: r.u32(), nonDefOff: r.u32() });
      }
      st.info = {
        变体选择符数量: numRec,
        说明: 'Unicode 变体序列（如 emoji 的文本/彩色变体）。',
        选择符: recs.map((x) => 'U+' + x.selector.toString(16).toUpperCase()).join('、')
      };
      st.varSelectors = recs;
      st.raw = bytes.subarray(off, Math.min(off + st.length, bytes.length));
    } else {
      st.info = { 说明: '本工具未解析该格式（格式 ' + format + '）。' };
      st.length = 0;
      st.raw = bytes.subarray(off);
    }
    // 兜底：记录本子表的原始字节（视图，不复制），重建失败时原样保留，避免写出空子表
    if (!st.raw && st.length) st.raw = bytes.subarray(off, Math.min(off + st.length, bytes.length));
    return st;
  }

  /** 重建一个 format 4 子表（language 固定写 0：浏览器 OTS 要求） */
  function buildFormat4(map) {
    const items = map.filter((x) => x[0] >= 0 && x[0] <= 0xfffe).sort((a, b) => a[0] - b[0]);
    // 组装连续段
    const segs = [];
    let cur = null;
    for (const [c, g] of items) {
      if (cur && c === cur.end + 1) { cur.end = c; cur.items.push([c, g]); }
      else { cur = { start: c, end: c, items: [[c, g]] }; segs.push(cur); }
    }
    segs.push({ start: 0xffff, end: 0xffff, items: [], terminator: true });

    const segCount = segs.length;
    const b = new FL.Builder(16 + segCount * 8 + items.length * 2 + 16);
    b.u16(4);
    const lengthPos = b.offset; b.u16(0);
    b.u16(0);
    b.u16(segCount * 2);
    let pow = 1, sel = 0;
    while (pow * 2 <= segCount) { pow *= 2; sel++; }
    b.u16(pow * 2);
    b.u16(sel);
    b.u16(segCount * 2 - pow * 2);
    segs.forEach((s) => b.u16(s.end));
    b.u16(0);
    segs.forEach((s) => b.u16(s.start));
    // idDelta
    const deltaPos = b.offset;
    segs.forEach(() => b.i16(0));
    const rangePos = b.offset;
    segs.forEach(() => b.u16(0));
    // glyphIdArray
    const glyphArray = [];
    const rangeVals = [];
    segs.forEach((s) => {
      if (s.terminator) { rangeVals.push(0); return; }
      const delta = (s.items[0][1] - s.items[0][0]) & 0xffff;
      const uniform = s.items.every((it) => ((it[1] - it[0]) & 0xffff) === delta);
      if (uniform && s.items.length === s.end - s.start + 1) {
        rangeVals.push(0);
      } else {
        // 使用 glyphIdArray（需要补齐区间内所有码点）
        const startIdx = glyphArray.length;
        const gm = {};
        s.items.forEach((it) => { gm[it[0]] = it[1]; });
        for (let c = s.start; c <= s.end; c++) glyphArray.push(gm[c] || 0);
        const segIdx = segs.indexOf(s);
        const val = (segCount - segIdx) * 2 + startIdx * 2;
        rangeVals.push(val);
      }
    });
    // 写入 idDelta
    segs.forEach((s, i) => {
      let delta = 0;
      if (s.terminator) delta = 1;
      else if (rangeVals[i] === 0) delta = (s.items[0][1] - s.items[0][0]) & 0xffff;
      b.setInt16At(deltaPos + i * 2, delta > 32767 ? delta - 65536 : delta);
    });
    rangeVals.forEach((v, i) => b.setUint16At(rangePos + i * 2, v & 0xffff));
    glyphArray.forEach((g) => b.u16(g));
    const bytes = b.toBytes();
    const view = new DataView(bytes.buffer);
    view.setUint16(lengthPos, bytes.length);
    return bytes;
  }

  /** 重建 format 0 子表（language 固定写 0：浏览器 OTS 要求） */
  function buildFormat0(map) {
    const b = new FL.Builder(262);
    b.u16(0); b.u16(262); b.u16(0);
    const arr = new Uint8Array(256);
    map.forEach(([c, g]) => { if (c >= 0 && c < 256) arr[c] = g & 0xff; });
    b.bytes(arr);
    return b.toBytes();
  }

  /** 重建 format 6 子表（language 固定写 0：浏览器 OTS 要求） */
  function buildFormat6(map, oldRaw) {
    const items = map.slice().sort((a, b) => a[0] - b[0]);
    if (!items.length) return oldRaw;
    const first = items[0][0];
    const last = items[items.length - 1][0];
    const cnt = last - first + 1;
    // 格式 6 的 count/length 都是 uint16，跨度过大时退回原数据（否则会截断成非法表）
    if (cnt > 0xffff || 10 + cnt * 2 > 0xffff) return oldRaw || buildFormat12(map);
    const b = new FL.Builder(10 + cnt * 2);
    b.u16(6); b.u16(10 + cnt * 2); b.u16(0);
    b.u16(first); b.u16(cnt);
    const gm = {};
    items.forEach((it) => { gm[it[0]] = it[1]; });
    for (let c = first; c <= last; c++) b.u16(gm[c] || 0);
    return b.toBytes();
  }

  /** 重建 format 12 子表 */
  function buildFormat12(map, language) {
    const items = map.filter((x) => x[1] !== 0).sort((a, b) => a[0] - b[0]);
    const groups = [];
    let cur = null;
    for (const [c, g] of items) {
      if (cur && c === cur.e + 1 && g === cur.g + (c - cur.s)) { cur.e = c; }
      else { cur = { s: c, e: c, g: g }; groups.push(cur); }
    }
    const b = new FL.Builder(16 + groups.length * 12);
    b.u16(12); b.u16(0);
    const lenPos = b.offset;    // length 字段位置（format/reserved 之后）
    b.u32(0);                   // 占位：末尾回填实际长度
    b.u32(0);                   // language 必须为 0（OTS 校验要求）
    b.u32(groups.length);
    groups.forEach((g) => { b.u32(g.s); b.u32(g.e); b.u32(g.g); });
    const bytes = b.toBytes();
    new DataView(bytes.buffer).setUint32(lenPos, bytes.length);
    return bytes;
  }

  /**
   * 纯数据解析：读取 cmap 表头、编码记录与各子表的映射
   * （不构造 UI 行，可安全地在字形名查询等场景中反复调用）
   */
  function readSubtables(bytes) {
    const b = bytes;
    const r = new FL.Reader(b);
    const version = r.u16();
    const numTables = r.u16();
    const records = [];
    for (let i = 0; i < numTables; i++) {
      const platformID = r.u16(), encodingID = r.u16(), offset = r.u32();
      if (offset + 4 <= b.length) records.push({ platformID: platformID, encodingID: encodingID, offset: offset });
    }
    const subByOff = {};
    const subtables = [];
    records.forEach((rec) => {
      let st = subByOff[rec.offset];
      if (!st) {
        try { st = parseSubtable(b, rec.offset); }
        catch (e) { st = { offset: rec.offset, format: -1, info: { 说明: '解析失败：' + e.message }, mapping: [] }; }
        subByOff[rec.offset] = st;
        subtables.push(st);
        st.platforms = [];
      }
      st.platforms.push(rec);
    });
    return { version: version, records: records, subtables: subtables, byOffset: subByOff };
  }

  T['cmap'] = {
    parse(font, table) {
      H.need(table, 4, 'cmap');
      const parsed = readSubtables(table.bytes);
      const b = table.bytes;
      const recs = parsed.records;
      const subByOff = parsed.byOffset;
      const subtables = parsed.subtables;

      const encRows = recs.map((rec, i) => {
        const st = subByOff[rec.offset];
        return {
          __index: i, __rec: rec,
          platform: rec.platformID + ' ' + (U.PLATFORM_IDS[rec.platformID] || ''),
          encoding: encName(rec),
          format: st ? st.format : '?',
          offset: rec.offset,
          count: st && st.mapping ? st.mapping.length : 0
        };
      });

      const sections = [];
      sections.push(H.matrix('编码记录（Encoding Records）',
        'cmap 表头列出多组「平台 + 编码 → 子表」的对应关系。一个子表可能被多条记录共用。' +
        'Windows 平台 (3,1) 表示 Unicode BMP，(3,10) 表示全 Unicode；(1,0) 为 Mac Roman。',
        [
          H.col('platform', '平台', { align: 'left' }),
          H.col('encoding', '编码', { align: 'left' }),
          H.col('format', '子表格式', { width: '90px' }),
          H.col('offset', '表内偏移', { width: '90px' }),
          H.col('count', '映射条目数', { width: '110px' })
        ], encRows, { pageSize: 0 }));

      // 每个子表一个区块
      const model = { subtables: subtables, records: recs, dirty: false };
      subtables.forEach((st, si) => {
        const infoFields = [];
        infoFields.push({ label: '格式', name: 'format', offset: st.offset, size: 2, type: 'uint16', value: st.format, display: st.format + ' —— ' + (U.CMAP_FORMATS[st.format] || '未知格式'), editable: false, description: '子表使用的映射格式。' });
        infoFields.push({ label: '长度', name: 'length', offset: null, size: 0, type: 'text', value: st.length, display: String(st.length || '—'), editable: false, description: '子表字节长度（格式 8/10/12/13 为 32 位）。' });
        if (st.language != null) {
          infoFields.push({
            label: '语言', name: 'language', offset: null, size: 0, type: 'text', value: st.language,
            display: String(st.language) + (st.language === 0
              ? '（与语言无关，规范推荐值）'
              : '　⚠ 非 0 值：浏览器（OTS 校验）会拒绝加载该字体，导出时可在「修改与导出」中勾选兼容性修复自动改为 0'),
            editable: false,
            description: 'Mac 语言代码（1=法语、2=德语…）。该字段已废弃，现代规范与浏览器校验均要求为 0。'
          });
        }
        for (const k in st.info) {
          infoFields.push({ label: k, name: '—', offset: null, size: 0, type: 'text', value: st.info[k], display: String(st.info[k]), editable: false, description: '' });
        }
        infoFields.push({ label: '使用该子表的记录', name: '—', offset: null, size: 0, type: 'text', value: '',
          display: st.platforms.map((p) => '(' + p.platformID + ',' + p.encodingID + ')').join('、'), editable: false, description: '平台/编码组合。' });
        sections.push(H.sec('子表 #' + (si + 1) + ' 概况', '位于表内偏移 ' + st.offset + '。', infoFields));

        if (st.mapping && st.mapping.length) {
          const rows = st.mapping.map(([code, gid], i) => ({
            __index: i, __code: code,
            __edit: { gid: { kind: 'cmapGid', si: si, code: code } },
            code: code,
            hex: 'U+' + code.toString(16).toUpperCase().padStart(4, '0'),
            chr: U.charLabel(code),
            gid: gid,
            name: FL.font ? FL.font.glyphName(font, gid) : ''
          }));
          sections.push(H.matrix('子表 #' + (si + 1) + ' 字符映射表（共 ' + rows.length + ' 条）',
            '修改右侧的字形索引即可把该字符指向别的字形；保存时会自动重建该子表（格式 0/4/6/12/13 支持重建，其它格式保持原样）。',
            [
              H.col('code', '码点（十进制）', { width: '110px' }),
              H.col('hex', 'Unicode', { width: '100px' }),
              H.col('chr', '字符', { align: 'left', width: '90px', hclass: 'char-cell' }),
              H.col('gid', '字形索引', { editable: true, editKind: 'cmapGid', width: '100px', description: '该码点映射到的字形编号（GID），0 表示 .notdef。' }),
              H.col('name', '字形名', { align: 'left' })
            ], rows, { pageSize: 200, filterable: true, subId: si }));
        }
      });

      // 覆盖统计
      const uni = pickUnicodeMap(subtables);
      if (uni) {
        const codes = [];
        let max = 0;
        uni.forEach((v, k) => { codes.push(k); if (k > max) max = k; });
        codes.sort((a, b2) => a - b2);
        const sectionsStat = H.sec('覆盖统计', '基于最具代表性的 Unicode 子表（(3,10) 或 (3,1) 或 (0,x)）统计。', [
          { label: '映射字符数', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(codes.length), editable: false, description: '该子表中非 0 的映射条目数量。' },
          { label: '最大码点', name: '—', offset: null, size: 0, type: 'text', value: '', display: 'U+' + max.toString(16).toUpperCase(), editable: false, description: '覆盖范围的上界。' },
          { label: '前 10 个码点', name: '—', offset: null, size: 0, type: 'text', value: '', display: codes.slice(0, 10).map((c) => 'U+' + c.toString(16).toUpperCase() + '(' + U.charLabel(c) + ')').join(' '), editable: false, description: '' },
          { label: '后 10 个码点', name: '—', offset: null, size: 0, type: 'text', value: '', display: codes.slice(-10).map((c) => 'U+' + c.toString(16).toUpperCase() + '(' + U.charLabel(c) + ')').join(' '), editable: false, description: '' }
        ]);
        sections.unshift(sectionsStat);
      }

      return { sections: sections, model: model };
    },

    edit(font, table, ctx, value) {
      const model = table._model;
      if (!model) return false;
      const e = ctx.row.__edit && ctx.row.__edit.gid;
      if (!e) return false;
      const gid = parseInt(value, 10);
      if (isNaN(gid) || gid < 0 || gid > 65535) return { error: '字形索引必须是 0~65535 的整数' };
      const st = model.subtables[e.si];
      if (!st || !st.mapping) return false;
      const item = st.mapping.find((x) => x[0] === e.code);
      if (!item) return false;
      item[1] = gid;
      st.dirty = true;
      model.dirty = true;
      return true;
    },

    /** 重建 cmap 表（仅重建可重建的格式，其它格式原样保留） */
    rebuild(font, table) {
      const model = table._model;
      if (!model) return null;
      const subs = model.subtables;
      const out = subs.map((st) => {
        let bytes = null;
        try {
          if (st.format === 0 && st.mapping) bytes = buildFormat0(st.mapping);
          else if (st.format === 4 && st.mapping) bytes = buildFormat4(st.mapping);
          else if (st.format === 6 && st.mapping) bytes = buildFormat6(st.mapping, st.raw);
          else if ((st.format === 12 || st.format === 13) && st.mapping) {
            bytes = st.format === 12 ? buildFormat12(st.mapping) : buildFormat13(st.mapping);
          }
        } catch (err) {
          bytes = null;
        }
        // 无法重建的格式（2/8/10/14 等）或重建失败：原样保留该子表字节
        if (!bytes) bytes = st.raw ? st.raw.slice() : (st.mapping ? buildFormat12(st.mapping) : new Uint8Array(0));
        return bytes;
      });
      const numRec = model.records.length;
      const headerSize = 4 + numRec * 8;
      let off = headerSize;
      const offsets = out.map((b) => { const o = off; off += (b.length + 3) & ~3; return o; });
      const total = off;
      const buf = new Uint8Array(total);
      const dv = new DataView(buf.buffer);
      dv.setUint16(0, 0);
      dv.setUint16(2, numRec);
      // 记录 -> 子表偏移（按 offset 去重映射）
      const offToNew = {};
      subs.forEach((st, i) => { offToNew[st.offset] = offsets[i]; });
      model.records.forEach((rec, i) => {
        dv.setUint16(4 + i * 8, rec.platformID);
        dv.setUint16(4 + i * 8 + 2, rec.encodingID);
        dv.setUint32(4 + i * 8 + 4, offToNew[rec.offset] != null ? offToNew[rec.offset] : 0);
      });
      out.forEach((b2, i) => buf.set(b2, offsets[i]));
      return buf;
    }
  };

  function buildFormat13(map) {
    const items = map.slice().sort((a, b) => a[0] - b[0]);
    const groups = [];
    let cur = null;
    for (const [c, g] of items) {
      if (cur && c === cur.e + 1 && g === cur.g) cur.e = c;
      else { cur = { s: c, e: c, g: g }; groups.push(cur); }
    }
    const b = new FL.Builder(16 + groups.length * 12);
    b.u16(13); b.u16(0);
    const lenPos = b.offset;    // length 字段位置（format/reserved 之后）
    b.u32(0);                   // 占位：末尾回填实际长度
    b.u32(0);                   // language 必须为 0（OTS 校验要求）
    b.u32(groups.length);
    groups.forEach((g) => { b.u32(g.s); b.u32(g.e); b.u32(g.g); });
    const bytes = b.toBytes();
    new DataView(bytes.buffer).setUint32(lenPos, bytes.length);
    return bytes;
  }

  function encName(rec) {
    const p = rec.platformID, e = rec.encodingID;
    if (p === 3) return 'Windows / ' + (U.WIN_ENCODINGS[e] || '编码 ' + e);
    if (p === 1) return 'Mac / ' + (U.MAC_ENCODINGS[e] || '编码 ' + e);
    if (p === 0) return 'Unicode / ' + (U.UNICODE_ENCODINGS[e] || '编码 ' + e);
    return '平台 ' + p + ' / 编码 ' + e;
  }

  /** 选取最有代表性的 Unicode 子表并返回 Map(code -> gid) */
  function pickUnicodeMap(subtables) {
    const score = (st) => {
      let s = st.format === 12 ? 40 : st.format === 4 ? 30 : st.format === 6 ? 20 : st.format === 0 ? 5 : 0;
      for (const p of st.platforms || []) {
        if (p.platformID === 3 && p.encodingID === 10) s += 100;
        else if (p.platformID === 3 && p.encodingID === 1) s += 60;
        else if (p.platformID === 0) s += 40;
        else if (p.platformID === 1 && p.encodingID === 0) s += 10;
      }
      return s;
    };
    const cands = subtables.filter((st) => st.mapping && st.mapping.length).sort((a, b) => score(b) - score(a));
    if (!cands.length) return null;
    const m = new Map();
    cands[0].mapping.forEach(([c, g]) => m.set(c, g));
    return m;
  }
  T['cmap'].pickUnicodeMap = pickUnicodeMap;
  T['cmap'].readSubtables = readSubtables;
})(typeof window !== 'undefined' ? window : globalThis);
