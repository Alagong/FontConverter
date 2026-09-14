/* =========================================================================
 * font.js —— 字体模型层
 *  - 名称/字形索引查询
 *  - 编辑记录（可撤销）
 *  - 保存：重建各表 → 重算校验和 → 输出字体字节
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const font = (FL.font = {});

  /* ------------------------------------------------------------------
   * 创建 / 解析
   * ------------------------------------------------------------------ */
  font.parse = function (buffer, fileName, fontIndex) {
    const f = FL.sfnt.parse(buffer, fontIndex);
    f.fileName = fileName || '';
    f.edits = [];
    f.rebuilds = {};
    f.glyfDirty = false;
    f._names = null;
    f._cmapMap = null;
    f._gidChars = null;
    return f;
  };

  /** 取某个表的解析结果（带缓存，带递归占位保护） */
  font.tableInfo = function (f, tag) {
    if (f.parsed[tag]) return f.parsed[tag];
    const t = f.tableMap[tag];
    if (!t) return null;
    const mod = FL.tables[tag] || FL.tables['*'];
    // 先放占位对象：解析过程中若发生递归调用（如 cmap 行需要字形名），可以安全返回
    f.parsed[tag] = { sections: [], model: {}, _parsing: true };
    let res;
    try {
      res = mod.parse(f, t);
    } catch (e) {
      console.error('解析 ' + tag + ' 表失败', e);
      res = {
        sections: [{ kind: 'note', level: 'warn', title: '解析失败', text: e.message }],
        model: {}
      };
    }
    t._model = res.model || {};
    f.parsed[tag] = res;
    return res;
  };

  /** 轻量读取 cmap 映射（不构造 UI 数据，供字形名/字符反查使用） */
  font.cmapRaw = function (f) {
    if (f._cmapRaw) return f._cmapRaw;
    const t = f.tableMap['cmap'];
    if (!t || !FL.tables['cmap'].readSubtables) return null;
    try {
      f._cmapRaw = FL.tables['cmap'].readSubtables(t.bytes);
    } catch (e) {
      f._cmapRaw = null;
    }
    return f._cmapRaw;
  };

  /* ------------------------------------------------------------------
   * 字形名称
   * ------------------------------------------------------------------ */
  function buildNames(f) {
    const names = [];
    const numGlyphs = f.numGlyphs || 0;
    const post = f.tableMap['post'];
    if (post && post.bytes.length >= 34) {
      const dv = new DataView(post.bytes.buffer, post.bytes.byteOffset, post.bytes.byteLength);
      const ver = dv.getInt32(0) / 65536;
      if (Math.abs(ver - 2) < 0.001) {
        const count = dv.getUint16(32);
        const idx = [];
        for (let i = 0; i < count; i++) idx.push(dv.getUint16(34 + i * 2));
        let p = 34 + count * 2;
        const custom = [];
        while (p < post.bytes.length && custom.length < 65536) {
          const len = post.bytes[p];
          custom.push(U.macRomanDecode(post.bytes.subarray(p + 1, p + 1 + len)));
          p += 1 + len;
        }
        for (let i = 0; i < numGlyphs; i++) {
          const v = idx[i];
          if (v == null) names.push('glyph' + i);
          else if (v < 258) names.push(U.STANDARD_MAC_GLYPH_NAMES[v] || 'glyph' + i);
          else names.push(custom[v - 258] !== undefined ? custom[v - 258] : 'glyph' + i);
        }
      } else if (Math.abs(ver - 1) < 0.001) {
        for (let i = 0; i < numGlyphs; i++) names.push(U.STANDARD_MAC_GLYPH_NAMES[i] || 'glyph' + i);
      }
    }
    return names;
  }

  /** 取字形名（post 表优先，其次用 cmap 反查，最后用编号） */
  font.glyphName = function (f, gid) {
    if (gid == null || gid < 0) return '';
    if (!f._names) f._names = buildNames(f);
    let n = f._names[gid];
    if (n) return n;
    const chars = font.gidChars(f);
    const cp = chars && chars.get(gid);
    if (cp != null) return U.charLabel(cp) ? U.charLabel(cp) + ' (U+' + cp.toString(16).toUpperCase() + ')' : 'uni' + cp.toString(16).toUpperCase();
    return 'glyph' + gid;
  };

  /** cmap 最优 Unicode 映射（Map<code, gid>） */
  font.cmapMap = function (f) {
    if (f._cmapMap) return f._cmapMap;
    const raw = font.cmapRaw(f);
    if (!raw || !raw.subtables) return null;
    const subs = raw.subtables;
    const scored = subs.filter((s) => s.mapping && s.mapping.length).map((s) => {
      let sc = s.format === 12 ? 40 : s.format === 4 ? 30 : s.format === 6 ? 20 : 0;
      (s.platforms || []).forEach((p) => {
        if (p.platformID === 3 && p.encodingID === 10) sc += 100;
        else if (p.platformID === 3 && p.encodingID === 1) sc += 60;
        else if (p.platformID === 0) sc += 40;
      });
      return { s: s, sc: sc };
    }).sort((a, b) => b.sc - a.sc);
    if (!scored.length) return null;
    const m = new Map();
    scored[0].s.mapping.forEach(([c, gid]) => { if (!m.has(c)) m.set(c, gid); });
    f._cmapMap = m;
    return m;
  };

  /** 字形 → 码点（每个字形取第一个能映射到的字符） */
  font.gidChars = function (f) {
    if (f._gidChars) return f._gidChars;
    const m = font.cmapMap(f);
    const rev = new Map();
    if (m) m.forEach((gid, cp) => { if (!rev.has(gid)) rev.set(gid, cp); });
    f._gidChars = rev;
    return rev;
  };

  /**
   * 字形 → 码点数组（同一字形可能被多个码点映射到，例如同一汉字的多编码）
   * 用于字形列表按字符/码点筛选
   */
  font.gidCharMap = function (f) {
    if (f._gidCharMap) return f._gidCharMap;
    const m = font.cmapMap(f);
    const out = new Map();
    if (m) {
      m.forEach((gid, cp) => {
        let arr = out.get(gid);
        if (!arr) { arr = []; out.set(gid, arr); }
        if (arr.length < 8) arr.push(cp);
      });
    }
    f._gidCharMap = out;
    return out;
  };

  /** 字形 → 可读字符名（用于 kern 等表展示） */
  font.cmapName = function (f, gid) {
    const rev = font.gidChars(f);
    const cp = rev && rev.get(gid);
    const nm = font.glyphName(f, gid);
    if (cp == null) return nm;
    return (nm.indexOf('glyph') === 0 ? nm : nm) + '  [' + U.charLabel(cp) + ' U+' + cp.toString(16).toUpperCase() + ']';
  };

  /* ------------------------------------------------------------------
   * 编辑
   * ------------------------------------------------------------------ */
  let editSeq = 0;

  /** 就地写入字节并记录一条可撤销的编辑 */
  font.patch = function (f, tag, offset, type, value, meta) {
    const t = f.tableMap[tag];
    if (!t) return { error: '表不存在：' + tag };
    const size = FL.TYPES[type].size;
    const before = t.bytes.slice(offset, offset + size);
    FL.patchBytes(t.bytes, offset, type, value);
    const edit = {
      id: ++editSeq,
      tag: tag,
      label: (meta && meta.label) || (tag + ' @' + offset),
      detail: (meta && meta.detail) || (type + ' = ' + value),
      undo: () => { FL.writeBytesAt(t.bytes, offset, before); }
    };
    f.edits.push(edit);
    return { ok: true, edit: edit };
  };

  /**
   * 读取可变字体（fvar）的设计轴与命名实例
   * 轴记录：axisTag(4) minValue(Fixed) defaultValue(Fixed) maxValue(Fixed) flags(2) axisNameID(2)
   * @returns {{axes:Array, instances:Array}|null}
   */
  font.variableAxes = function (f) {
    if (f._axes !== undefined) return f._axes;
    const t = f.tableMap['fvar'];
    if (!t || t.bytes.length < 16) { f._axes = null; return null; }
    const v = new DataView(t.bytes.buffer, t.bytes.byteOffset, t.bytes.byteLength);
    const axesArrayOffset = v.getUint16(4);
    const axisCount = v.getUint16(8);
    const axisSize = v.getUint16(10) || 20;
    const instanceCount = v.getUint16(12);
    const instanceSize = v.getUint16(14) || (4 + axisCount * 4 + 2);
    if (!axisCount || axesArrayOffset + axisCount * axisSize > t.bytes.length) { f._axes = null; return null; }
    const U16 = (o) => v.getUint16(o);
    const FIX = (o) => v.getInt32(o) / 65536;
    const nameStr = (id) => {
      const h = FL.tables.helper;
      try { return (h && h.nameStr) ? (h.nameStr(f, id) || '') : ''; } catch (e) { return ''; }
    };
    const axes = [];
    for (let i = 0; i < axisCount; i++) {
      const p = axesArrayOffset + i * axisSize;
      // 字段偏移：tag(0,4B) minValue(4,4B) defaultValue(8,4B) maxValue(12,4B) flags(16,2B) axisNameID(18,2B)
      const nameID = U16(p + 18);
      const flags = U16(p + 16);
      axes.push({
        tag: FL.util.tag(v.getUint32(p)),
        min: FIX(p + 4), def: FIX(p + 8), max: FIX(p + 12),
        flags: flags, nameID: nameID,
        name: nameStr(nameID) || '',
        hidden: (flags & 1) !== 0
      });
    }
    const instBase = axesArrayOffset + axisCount * axisSize;
    const instances = [];
    for (let i = 0; i < instanceCount; i++) {
      const p = instBase + i * instanceSize;
      if (p + instanceSize > t.bytes.length) break;
      const subID = U16(p);
      const coords = {};
      axes.forEach((ax, k) => { coords[ax.tag] = FIX(p + 4 + k * 4); });
      let psName = '';
      const q = p + 4 + axisCount * 4;
      if (q + 2 <= t.bytes.length && instanceSize >= 4 + axisCount * 4 + 2) psName = nameStr(U16(q));
      instances.push({ subfamilyNameID: subID, name: nameStr(subID) || '(未命名)', coords: coords, psName: psName });
    }
    f._axes = { axes: axes, instances: instances };
    return f._axes;
  };

  /** 标记某表需要重建 */
  font.markRebuild = function (f, tag, reason) {
    f.rebuilds[tag] = reason || '内容已修改';
  };

  /** 记录一条自定义撤销动作（用于重建类修改） */
  font.pushUndo = function (f, label, detail, undoFn) {
    const edit = { id: ++editSeq, tag: label, label: label, detail: detail, undo: undoFn };
    f.edits.push(edit);
    return edit;
  };

  font.undoAll = function (f) {
    for (let i = f.edits.length - 1; i >= 0; i--) {
      try { f.edits[i].undo(); } catch (e) { /* 忽略 */ }
    }
    f.edits.length = 0;
    f.rebuilds = {};
    f.glyfDirty = false;
    f._names = null;
    f._cmapMap = null;
    f._cmapRaw = null;
    f._gidChars = null;
    f._gidCharMap = null;
    f.parsed = {};
    f.tables.forEach((t) => { t._model = null; });
  };

  /* ------------------------------------------------------------------
   * 保存
   * ------------------------------------------------------------------ */
  function recomputeMetrics(f, byTag) {
    const all = FL.glyfParse(f);
    if (!all) return [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    let maxAdv = 0, minLsb = 1e9, minRsb = 1e9, maxExt = -1e9;
    const numGlyphs = f.numGlyphs || 0;
    const hhea = f.tableMap['hhea'];
    const numLong = hhea ? new DataView(hhea.bytes.buffer, hhea.bytes.byteOffset).getUint16(34) : numGlyphs;
    const hmtx = f.tableMap['hmtx'];
    let hover = null, mview = null;
    if (hmtx) mview = new DataView(hmtx.bytes.buffer, hmtx.bytes.byteOffset, hmtx.bytes.byteLength);
    for (let i = 0; i < numGlyphs; i++) {
      const gl = all.glyphs[i];
      if (gl && !gl.empty) {
        if (gl.xMin < x0) x0 = gl.xMin;
        if (gl.yMin < y0) y0 = gl.yMin;
        if (gl.xMax > x1) x1 = gl.xMax;
        if (gl.yMax > y1) y1 = gl.yMax;
      }
      if (mview) {
        let adv, lsb;
        if (i < numLong) { adv = mview.getUint16(i * 4); lsb = mview.getInt16(i * 4 + 2); }
        else { adv = numLong > 0 ? mview.getUint16((numLong - 1) * 4) : 0; lsb = mview.getInt16(numLong * 4 + (i - numLong) * 2); }
        if (adv > maxAdv) maxAdv = adv;
        if (lsb < minLsb) minLsb = lsb;
        if (gl && !gl.empty) {
          const rsb = adv - lsb - (gl.xMax - gl.xMin);
          if (rsb < minRsb) minRsb = rsb;
          const ext = lsb + gl.xMax;
          if (ext > maxExt) maxExt = ext;
        }
      }
    }
    const notes = [];
    if (x0 <= x1 && byTag['head']) {
      const hb = byTag['head'].bytes.slice();
      const dv = new DataView(hb.buffer);
      dv.setInt16(36, Math.max(-32768, Math.min(32767, x0)));
      dv.setInt16(38, Math.max(-32768, Math.min(32767, y0)));
      dv.setInt16(40, Math.max(-32768, Math.min(32767, x1)));
      dv.setInt16(42, Math.max(-32768, Math.min(32767, y1)));
      byTag['head'].bytes = hb;
      notes.push('head 全局边界框 → [' + x0 + ',' + y0 + '] – [' + x1 + ',' + y1 + ']');
    }
    if (byTag['hhea'] && mview) {
      const hb = byTag['hhea'].bytes.slice();
      const dv = new DataView(hb.buffer);
      dv.setUint16(10, Math.max(0, Math.min(65535, maxAdv)));
      dv.setInt16(12, Math.max(-32768, Math.min(32767, minLsb)));
      dv.setInt16(14, Math.max(-32768, Math.min(32767, minRsb)));
      dv.setInt16(16, Math.max(-32768, Math.min(32767, maxExt)));
      byTag['hhea'].bytes = hb;
      notes.push('hhea 度量 → 最大宽度 ' + maxAdv + '，最小 LSB ' + minLsb + '，最小 RSB ' + minRsb + '，最大延伸 ' + maxExt);
    }
    return notes;
  }

  /**
   * 保存字体
   * @param {object} opts { dropDSIG, dropStale, recompute }
   * @returns {{bytes:Uint8Array, notes:string[]}}
   */
  font.save = function (f, opts) {
    opts = Object.assign({
      dropDSIG: true, dropStale: false, recompute: true,
      normalizeCmapLang: true, fixMaxZones: true, dropEmptyTables: true
    }, opts || {});
    const notes = [];
    const tables = f.tables.map((t) => ({ tag: t.tag, bytes: t.bytes }));
    const byTag = {};
    tables.forEach((t) => { byTag[t.tag] = t; });

    // 0a) （见步骤 2.5：maxp.maxZones 的修正必须放在最后，否则会被 maxpRecompute 覆盖）

    // 0) 兼容性修复：cmap 子表的 language 字段必须为 0（浏览器 OTS 校验会拒绝非 0 值）
    if (opts.normalizeCmapLang && byTag['cmap'] && FL.tables['cmap'].readSubtables) {
      try {
        const raw = FL.tables['cmap'].readSubtables(byTag['cmap'].bytes);
        const bad = raw.subtables.filter((s) => s.language != null && s.language !== 0);
        if (bad.length) {
          const info = font.tableInfo(f, 'cmap');
          (info.model.subtables || []).forEach((s) => { if (s.language != null && s.language !== 0) s.language = 0; });
          info.model.dirty = true;
          f.rebuilds['cmap'] = '规范化 language 字段';
          notes.push('已将 cmap 子表的 language 字段由 ' +
            bad.map((s) => s.language).join('/') + ' 规范化为 0（浏览器 OTS 校验要求必须为 0）');
        }
      } catch (e) { /* 忽略，不影响保存 */ }
    }

    // 1) glyf / loca 重建
    if (f.glyfDirty && byTag['glyf']) {
      const res = FL.glyfRebuild(f);
      if (res) {
        byTag['glyf'].bytes = res.glyf;
        if (byTag['loca']) byTag['loca'].bytes = res.loca;
        if (byTag['head']) {
          const hb = byTag['head'].bytes.slice();
          new DataView(hb.buffer).setInt16(50, res.indexToLocFormat);
          byTag['head'].bytes = hb;
        }
        notes.push('glyf 表已重建：' + res.glyf.length + ' 字节（loca 使用 ' + (res.indexToLocFormat ? 'long' : 'short') + ' 格式）');
        if (opts.recompute && byTag['maxp']) {
          const mp = FL.maxpRecompute(f);
          if (mp) { byTag['maxp'].bytes = mp; notes.push('maxp 轮廓/点数上限已重算'); }
        }
      }
      if (opts.recompute) notes.push.apply(notes, recomputeMetrics(f, byTag));
    }

    // 2) 各表自定义重建
    for (const tag in f.rebuilds) {
      const t = f.tableMap[tag];
      const target = byTag[tag];
      if (!t || !target) continue;
      const mod = FL.tables[tag];
      if (mod && typeof mod.rebuild === 'function') {
        try {
          const nb = mod.rebuild(f, t, opts);
          if (nb) {
            target.bytes = nb;
            notes.push(tag + ' 表已重建（' + nb.length + ' 字节）：' + f.rebuilds[tag]);
            if (t._model && t._model.lossy && t._model.lossy.length) {
              notes.push('⚠ 以下名称记录的目标编码无法表示新文本，已用 "?" 替代（如需跨语言名称，建议为这些 nameID 使用 Windows/Unicode 平台记录）：' + t._model.lossy.join('、'));
            }
          }
        } catch (e) {
          notes.push('⚠ ' + tag + ' 表重建失败，已保留原始数据：' + e.message);
        }
      }
    }

    // 2.5) 兼容性修复：maxp.maxZones 只能是 1 或 2
    //      规范规定如此，浏览器 OTS 会以 "maxp: Bad maxZones: 7" 为由拒绝整个字体，
    //      而 Windows 与多数软件并不检查这个字段，所以这类字体平时看起来完全正常。
    //      必须放在这里：maxpRecompute 会重建 maxp，早做会被它覆盖掉。
    if (opts.fixMaxZones && byTag['maxp'] && byTag['maxp'].bytes.length >= 16) {
      const mb = byTag['maxp'].bytes.slice();
      const mv = new DataView(mb.buffer, mb.byteOffset, mb.byteLength);
      const zones = mv.getUint16(14);
      if (zones !== 1 && zones !== 2) {
        mv.setUint16(14, 2);
        byTag['maxp'].bytes = mb;
        notes.push('已把 maxp.maxZones 由 ' + zones + ' 修正为 2（规范只允许 1 或 2，浏览器 OTS 校验会因此拒绝整个字体）');
      }
    }

    // 2.6) 兼容性修复：丢弃长度为 0 的表
    //      空表不携带任何数据，但 OTS 会以 "<tag>: zero-length table" 为由拒绝整个字体
    //      （实例：HarmonyOS.ttf 里的 syma）。表目录本身也必须按 tag 升序，
    //      否则 OTS 报 "Table directory is not correctly ordered"——组装器已排序，这里不用管。
    let list = tables;
    if (opts.dropEmptyTables) {
      const empty = tables.filter((t) => !t.bytes || t.bytes.length === 0);
      if (empty.length) {
        list = tables.filter((t) => t.bytes && t.bytes.length > 0);
        empty.forEach((t) => { delete byTag[t.tag]; });
        notes.push('已移除长度为 0 的表：' + empty.map((t) => t.tag).join('、') +
          '（这类表不携带数据，但浏览器 OTS 校验会以 zero-length table 为由拒绝整个字体）');
      }
    }

    // 3) 组装 sfnt（表目录由组装器按 tag 升序排列，重新计算校验和）
    const bytes = FL.sfnt.build(list, {
      flavor: f.sfntVersion,
      dropDSIG: opts.dropDSIG,
      dropStale: opts.dropStale
    });
    if (opts.dropDSIG && byTag['DSIG']) notes.push('已移除 DSIG 数字签名表（修改后的字体签名必然失效）');
    if (opts.dropStale) notes.push('已移除 hdmx / LTSH / VDMX 等设备度量表（改动字形后这些表会失配）');
    notes.push('已重新计算所有表校验和与 head.checkSumAdjustment');
    return { bytes: bytes, notes: notes };
  };


})(typeof window !== 'undefined' ? window : globalThis);
