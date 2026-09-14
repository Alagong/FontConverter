/* =========================================================================
 * js/gvar.js —— 可变字体（TrueType）轮廓插值
 *
 * 用途：浏览器 OTS 拒绝加载某个可变字体时，本工具会退化为"轮廓预览"
 *       （自己解析 glyf 画轮廓）。此时若不读 gvar，轴值就不会有任何视觉变化。
 *       本模块实现 fvar → avar → gvar 的完整链路，把当前轴坐标作用到轮廓点上，
 *       让轮廓预览也能响应轴调节。
 *
 * 参考：OpenType 规范 fvar / avar / gvar；IUP 插值与 FreeType 的 iup_contour 一致。
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const gvar = (FL.gvar = {});

  const F2D = (v) => v / 16384;              // F2Dot14
  const f16 = (v) => v / 65536;              // 16.16 Fixed

  /** 该字体是否可以做轮廓级插值 */
  gvar.ready = function (font) {
    return !!(font && font.tableMap['fvar'] && font.tableMap['gvar'] && FL.glyfParse && FL.glyfParse(font));
  };

  /* ------------------------------------------------------------------ *
   * avar：轴向重映射
   * ------------------------------------------------------------------ */
  function readAvar(font) {
    const t = font.tableMap['avar'];
    if (!t || t.bytes.length < 8) return null;
    const v = new DataView(t.bytes.buffer, t.bytes.byteOffset, t.bytes.byteLength);
    const axisCount = v.getUint16(6);
    let p = 8;
    const maps = [];
    for (let i = 0; i < axisCount; i++) {
      if (p + 2 > t.bytes.length) break;
      const n = v.getUint16(p); p += 2;
      const pts = [];
      for (let k = 0; k < n; k++) {
        if (p + 4 > t.bytes.length) break;
        pts.push([F2D(v.getInt16(p)), F2D(v.getInt16(p + 2))]);
        p += 4;
      }
      maps.push(pts);
    }
    return maps;
  }

  /** 把归一化坐标按 avar 的分段线性映射重新映射 */
  function avarMap(pts, x) {
    if (!pts || pts.length < 2) return x;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (x === x1) return y1;
      if (x < x1) {
        if (x <= x0) return y0;
        const t = (x - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    return pts[pts.length - 1][1];
  }

  /* ------------------------------------------------------------------ *
   * 坐标归一化：用户坐标 → [-1,1]（含 avar）
   * ------------------------------------------------------------------ */
  gvar.normalize = function (font, userAxes) {
    const va = FL.font.variableAxes(font);
    if (!va || !va.axes.length) return null;
    const avar = readAvar(font);
    const coords = [];
    va.axes.forEach((ax, i) => {
      let v = userAxes && userAxes[ax.tag] != null ? Number(userAxes[ax.tag]) : ax.def;
      if (!isFinite(v)) v = ax.def;
      v = Math.min(ax.max, Math.max(ax.min, v));
      let n = 0;
      if (v < ax.def && ax.def !== ax.min) n = (v - ax.def) / (ax.def - ax.min);
      else if (v > ax.def && ax.max !== ax.def) n = (v - ax.def) / (ax.max - ax.def);
      n = Math.max(-1, Math.min(1, n));
      if (avar && avar[i]) n = avarMap(avar[i], n);
      coords.push(n);
    });
    return { coords: coords, axes: va.axes };
  };

  /* ------------------------------------------------------------------ *
   * gvar：读取某个字形的所有 "tuple 变体"
   * ------------------------------------------------------------------ */
  function readGvarTable(font) {
    if (font._gvarRaw !== undefined) return font._gvarRaw;
    const t = font.tableMap['gvar'];
    if (!t || t.bytes.length < 20) { font._gvarRaw = null; return null; }
    const v = new DataView(t.bytes.buffer, t.bytes.byteOffset, t.bytes.byteLength);
    const axisCount = v.getUint16(4);
    const sharedTupleCount = v.getUint16(6);
    const offToSharedTuples = v.getUint32(8);
    const glyphCount = v.getUint16(12);
    const flags = v.getUint16(14);
    const offToGlyphData = v.getUint32(16);
    const longOffsets = (flags & 1) !== 0;
    const offsets = [];
    const p0 = 20;
    for (let i = 0; i <= glyphCount; i++) {
      const p = p0 + i * (longOffsets ? 4 : 2);
      if (p + (longOffsets ? 4 : 2) > t.bytes.length) break;
      offsets.push(longOffsets ? v.getUint32(p) : v.getUint16(p) * 2);
    }
    const sharedTuples = [];
    for (let i = 0; i < sharedTupleCount; i++) {
      const p = offToSharedTuples + i * axisCount * 2;
      const tuple = [];
      for (let k = 0; k < axisCount; k++) {
        tuple.push(p + k * 2 + 2 <= t.bytes.length ? F2D(v.getInt16(p + k * 2)) : 0);
      }
      sharedTuples.push(tuple);
    }
    font._gvarRaw = { v: v, axisCount: axisCount, offsets: offsets, sharedTuples: sharedTuples, dataBase: offToGlyphData, len: t.bytes.length };
    return font._gvarRaw;
  }

  /** 解压 packed point numbers */
  function readPoints(v, start, end) {
    if (start >= end) return null;
    let p = start;
    const b0 = v.getUint8(p++);
    if (b0 === 0) return { all: true, points: null, next: p };
    let count = b0;
    if (b0 & 0x80) { if (p >= end) return null; count = ((b0 & 0x7f) << 8) | v.getUint8(p++); }
    const points = [];
    while (points.length < count && p < end) {
      const ctrl = v.getUint8(p++);
      const words = (ctrl & 0x80) !== 0;
      const runLen = (ctrl & 0x7f) + 1;
      for (let i = 0; i < runLen && points.length < count; i++) {
        if (p + (words ? 2 : 1) > end) break;
        points.push(words ? v.getUint16(p) : v.getUint8(p));
        p += words ? 2 : 1;
      }
    }
    return { all: false, points: points, next: p };
  }

  /** 解压 packed deltas（control byte: 0x80=全 0，0x40=word，低 6 位为 run 长度-1） */
  function readDeltas(v, start, end, count) {
    const out = new Array(count).fill(0);
    let p = start, i = 0;
    while (i < count && p < end) {
      const ctrl = v.getUint8(p++);
      const zero = (ctrl & 0x80) !== 0;
      const words = (ctrl & 0x40) !== 0;
      const runLen = (ctrl & 0x3f) + 1;
      for (let k = 0; k < runLen && i < count; k++, i++) {
        if (zero) { out[i] = 0; continue; }
        if (p + (words ? 2 : 1) > end) return { deltas: out, next: p };
        out[i] = words ? v.getInt16(p) : v.getInt8(p);
        p += words ? 2 : 1;
      }
    }
    return { deltas: out, next: p };
  }

  /**
   * 解析某个字形的 tuple 变体列表
   * @returns {Array<{peak:number[], start:number[]|null, end:number[]|null, points:number[]|null, dx:number[], dy:number[]}>}
   */
  function readGlyphTuples(raw, gid, numPoints) {
    if (!raw || gid + 1 >= raw.offsets.length) return null;
    const start = raw.dataBase + raw.offsets[gid];
    const end = raw.dataBase + raw.offsets[gid + 1];
    if (end <= start || end > raw.len) return null;
    const v = raw.v;
    let p = start;
    const tupleCountRaw = v.getUint16(p); p += 2;
    const dataOffset = v.getUint16(p); p += 2;
    const sharedPointsFlag = (tupleCountRaw & 0x8000) !== 0;
    const tupleCount = tupleCountRaw & 0x7fff;
    const headers = [];
    for (let i = 0; i < tupleCount; i++) {
      if (p + 4 > end) break;
      const variationDataSize = v.getUint16(p); p += 2;
      const tupleIndex = v.getUint16(p); p += 2;
      const embeddedPeak = (tupleIndex & 0x8000) !== 0;
      const hasInter = (tupleIndex & 0x4000) !== 0;
      const hasPrivate = (tupleIndex & 0x2000) !== 0;
      const sharedIdx = (tupleIndex & 0x0fff);
      let peak, startT = null, endT = null;
      if (embeddedPeak) {
        peak = [];
        for (let k = 0; k < raw.axisCount; k++) { peak.push(F2D(v.getInt16(p))); p += 2; }
      } else {
        peak = raw.sharedTuples[sharedIdx] ? raw.sharedTuples[sharedIdx].slice() : new Array(raw.axisCount).fill(0);
      }
      if (hasInter) {
        startT = []; endT = [];
        for (let k = 0; k < raw.axisCount; k++) { startT.push(F2D(v.getInt16(p))); p += 2; }
        for (let k = 0; k < raw.axisCount; k++) { endT.push(F2D(v.getInt16(p))); p += 2; }
      }
      headers.push({ variationDataSize: variationDataSize, peak: peak, start: startT, end: endT, hasPrivate: hasPrivate, dataPos: dataOffset + (p - start) });
    }
    // 序列化数据区起点（相对 glyph variation data 的开始）
    let pdata = start + dataOffset;
    let sharedPoints = null;
    if (sharedPointsFlag) {
      const r = readPoints(v, pdata, end);
      if (r) { sharedPoints = r.points; pdata = r.next; }
    }
    const tuples = [];
    headers.forEach((h) => {
      // 注意：variationDataSize 覆盖的是「私有点列表 + 增量数据」整体，
      // 所以数据区结束位置必须从该 tuple 的**起点**算，而不是从私有点列表之后算
      const tupleDataStart = pdata;
      const endOfTuple = Math.min(tupleDataStart + h.variationDataSize, end);
      let dp = tupleDataStart;
      let points = sharedPoints;
      if (h.hasPrivate) {
        const r = readPoints(v, dp, endOfTuple);
        if (r) { points = r.points; dp = r.next; }
      }
      let dx = [], dy = [];
      if (!points) {
        // "全部点"：增量覆盖 **字形点数 + 4 个幻影点**（幻影点表示左右承托与上下边界，
        // 用于 advance/度量变化），x、y 各这么多条。按字形点数解析会错位，
        // 导致后续 tuple 的私有点列表全读成垃圾。
        const n = numPoints + 4;
        if (numPoints > 0) {
          const rx = readDeltas(v, dp, endOfTuple, n);
          dx = rx.deltas;
          const ry = readDeltas(v, rx.next, endOfTuple, n);
          dy = ry.deltas;
        }
      } else {
        const rx = readDeltas(v, dp, endOfTuple, points.length);
        dx = rx.deltas;
        const ry = readDeltas(v, rx.next, endOfTuple, points.length);
        dy = ry.deltas;
      }
      tuples.push({ peak: h.peak, start: h.start, end: h.end, points: points, dx: dx, dy: dy, allPoints: !points });
      pdata = endOfTuple;
    });
    return tuples;
  }

  /* ------------------------------------------------------------------ *
   * tuple 标量（scalar）
   * ------------------------------------------------------------------ */
  function tupleScalar(peak, start, end, coords) {
    let s = 1;
    for (let i = 0; i < peak.length; i++) {
      const pk = peak[i];
      if (pk === 0) continue;
      const c = coords[i] || 0;
      let f;
      if (c === pk) f = 1;
      else if (c === 0) f = 0;
      else if (c < pk) {
        if (start) { const st = start[i]; f = st >= pk ? 0 : (c <= st ? 0 : (c - st) / (pk - st)); }
        else f = c / pk;
      } else {
        if (end) { const en = end[i]; f = en <= pk ? 0 : (c >= en ? 0 : (en - c) / (en - pk)); }
        else f = (1 - c) / (1 - pk);
      }
      if (f === 0) return 0;
      s *= f;
    }
    return s;
  }

  /* ------------------------------------------------------------------ *
   * IUP：为未明确给出增量的点插值（与 FreeType 一致）
   * ------------------------------------------------------------------ */
  function iupContour(deltas, touched, base, start, end) {
    const n = end - start + 1;
    if (n <= 0) return;
    const idx = [];
    for (let i = start; i <= end; i++) if (touched[i]) idx.push(i);
    if (!idx.length || idx.length === n) return;    // 全未触及 / 全触及 → 无需插值
    // 依次处理「被触及点 a → 下一个被触及点 b」之间的缺口（最后一个 b 环回到 idx[0]）
    for (let k = 0; k < idx.length; k++) {
      const a = idx[k];
      const b = idx[(k + 1) % idx.length];
      if (b === a) continue;
      const va = base[a], vb = base[b];
      let i = a + 1 > end ? start : a + 1;
      let guard = 0;
      while (i !== b && guard++ <= n) {
        const v = base[i];
        if (va === vb) deltas[i] = deltas[a];
        else if (v <= Math.min(va, vb)) deltas[i] = va < vb ? deltas[a] : deltas[b];
        else if (v >= Math.max(va, vb)) deltas[i] = va > vb ? deltas[a] : deltas[b];
        else deltas[i] = deltas[a] + (deltas[b] - deltas[a]) * (v - va) / (vb - va);
        i = i + 1 > end ? start : i + 1;
      }
    }
  }

  /** 调试用：列出某字形的 tuple 变体（峰值区间、点、标量） */
  gvar.debugTuples = function (font, gid, userAxes) {
    const raw = readGvarTable(font);
    if (!raw) return null;
    const all = FL.glyfParse(font);
    const gl = all && all.glyphs[gid];
    const numPoints = gl && gl.numPoints ? gl.numPoints : 0;
    const norm = gvar.normalize(font, userAxes || {});
    const tuples = readGlyphTuples(raw, gid, numPoints) || [];
    return tuples.map((t, i) => ({
      i: i,
      peak: t.peak.map((x) => +x.toFixed(3)),
      start: t.start ? t.start.map((x) => +x.toFixed(3)) : null,
      end: t.end ? t.end.map((x) => +x.toFixed(3)) : null,
      points: t.points ? t.points.length : 'all',
      pointsSample: t.points ? t.points.slice(0, 16) : null,
      dxSample: t.dx.slice(0, 6),
      numPoints: numPoints,
      allPoints: t.allPoints,
      dxLen: t.dx.length,
      dxNonZero: t.dx.filter((x) => x).length,
      scalar: norm ? +tupleScalar(t.peak, t.start, t.end, norm.coords).toFixed(3) : null,
      coords: norm ? norm.coords.map((x) => +x.toFixed(3)) : null
    }));
  };

  /** 调试用：某字形 gvar 数据区的原始字节与头部信息 */
  gvar.debugRaw = function (font, gid) {
    const raw = readGvarTable(font);
    if (!raw) return null;
    const start = raw.dataBase + raw.offsets[gid];
    const v = raw.v;
    const tupleCountRaw = v.getUint16(start);
    const dataOffset = v.getUint16(start + 2);
    const bytes = [];
    for (let i = 0; i < 48 && start + i < raw.len; i++) bytes.push(v.getUint8(start + i));
    const dataStart = start + dataOffset;
    const dataBytes = [];
    for (let i = 0; i < 32 && dataStart + i < raw.len; i++) dataBytes.push(v.getUint8(dataStart + i));
    return {
      start: start, tupleCountRaw: tupleCountRaw, sharedFlag: (tupleCountRaw & 0x8000) !== 0,
      tupleCount: tupleCountRaw & 0x7fff, dataOffset: dataOffset, dataStart: dataStart,
      headerHex: bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
      dataHex: dataBytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
    };
  };

  /* ------------------------------------------------------------------ *
   * 对外：插值上下文
   * ------------------------------------------------------------------ */
  /**
   * 建立插值上下文（带缓存）
   * @param {object} font
   * @param {object} userAxes { tag: value }
   * @returns {null|{coords:number[], deltas:function(gid):{dx:Float32Array,dy:Float32Array}|null}}
   */
  gvar.context = function (font, userAxes) {
    if (!gvar.ready(font)) return null;
    const norm = gvar.normalize(font, userAxes);
    if (!norm) return null;
    const raw = readGvarTable(font);
    if (!raw) return null;
    const key = norm.coords.map((x) => x.toFixed(4)).join(',');
    if (font._gvarCtx && font._gvarCtx.key === key) return font._gvarCtx.ctx;

    const all = FL.glyfParse(font);
    const cache = new Map();

    function deltasFor(gid) {
      if (cache.has(gid)) return cache.get(gid);
      let out = null;
      const gl = all.glyphs[gid];
      const numPoints = gl && gl.numPoints ? gl.numPoints : 0;
      if (!gl || !numPoints || gl.components) { cache.set(gid, null); return null; }
      const tuples = readGlyphTuples(raw, gid, numPoints);
      if (tuples && tuples.length) {
        const dx = new Float32Array(numPoints), dy = new Float32Array(numPoints);
        let any = false;
        tuples.forEach((tp) => {
          const s = tupleScalar(tp.peak, tp.start, tp.end, norm.coords);
          if (!s) return;
          // 每个 tuple 单独算增量 → 该 tuple 的增量先做 IUP 插值 → 再按标量累加
          const tdx = new Float32Array(numPoints), tdy = new Float32Array(numPoints);
          const touched = new Uint8Array(numPoints);
          if (tp.allPoints) {
            for (let i = 0; i < numPoints; i++) {
              tdx[i] = tp.dx[i] || 0;
              tdy[i] = tp.dy[i] || 0;
              touched[i] = 1;
            }
          } else {
            (tp.points || []).forEach((pi, k) => {
              if (pi < numPoints) { tdx[pi] = tp.dx[k] || 0; tdy[pi] = tp.dy[k] || 0; touched[pi] = 1; }
            });
            (gl.contours || []).forEach((c) => {
              iupContour(tdx, touched, gl.xs, c.start, c.end);
              iupContour(tdy, touched, gl.ys, c.start, c.end);
            });
          }
          for (let i = 0; i < numPoints; i++) { dx[i] += s * tdx[i]; dy[i] += s * tdy[i]; }
          any = true;
        });
        if (any) out = { dx: dx, dy: dy };
      }
      cache.set(gid, out);
      return out;
    }

    const ctx = { coords: norm.coords, deltas: deltasFor };
    font._gvarCtx = { key: key, ctx: ctx };
    return ctx;
  };
})(typeof window !== 'undefined' ? window : globalThis);
