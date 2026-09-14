/* =========================================================================
 * glyf.js —— TrueType 轮廓（glyf / loca）
 *  - 解析简单字形（点、轮廓、提示指令）与复合字形（组件、变换）
 *  - 生成 SVG 路径用于预览
 *  - 支持修改点坐标并重建 glyf / loca / maxp / head
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;

  const CNT_ON = 0x01, CNT_XSHORT = 0x02, CNT_YSHORT = 0x04, CNT_REPEAT = 0x08,
    CNT_XSAME = 0x10, CNT_YSAME = 0x20, CNT_OVERLAP = 0x40;

  const CF_ARGS_WORDS = 0x0001, CF_ARGS_XY = 0x0002, CF_ROUND = 0x0004,
    CF_SCALE = 0x0008, CF_MORE = 0x0020, CF_XY_SCALE = 0x0040, CF_2X2 = 0x0080,
    CF_INSTRUCTIONS = 0x0100, CF_USE_MY_METRICS = 0x0200, CF_OVERLAP = 0x0400,
    CF_SCALED_OFFSET = 0x0800, CF_UNSCALED_OFFSET = 0x1000;

  const glyphCache = new WeakMap();
  FL.glyfCache = glyphCache;

  /* ------------------------------------------------------------------ */
  function parseLoca(font) {
    const head = font.tableMap['head'];
    const loca = font.tableMap['loca'];
    if (!head || !loca) return null;
    const format = FL.TYPES.int16.r(new FL.Reader(head.bytes).view, 50);
    const n = (font.numGlyphs || 0) + 1;
    const offs = new Array(Math.min(n, 1 << 20));
    const bytes = loca.bytes;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < offs.length; i++) {
      if (format === 0) offs[i] = i * 2 + 2 <= bytes.length ? dv.getUint16(i * 2) * 2 : 0;
      else offs[i] = i * 4 + 4 <= bytes.length ? dv.getUint32(i * 4) : 0;
      if (offs[i] > -1 && offs[i] > 0x7fffffff) offs[i] = 0;
    }
    return { format: format, offsets: offs };
  }

  function parseGlyph(bytes, off, len) {
    const gl = { offset: off, length: len, empty: len === 0, dirty: false };
    if (len === 0) {
      return Object.assign(gl, { numberOfContours: 0, xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: [], contours: [], instructions: new Uint8Array(0), components: null });
    }
    const r = new FL.Reader(bytes, off);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    gl.numberOfContours = dv.getInt16(off);
    gl.xMin = dv.getInt16(off + 2);
    gl.yMin = dv.getInt16(off + 4);
    gl.xMax = dv.getInt16(off + 6);
    gl.yMax = dv.getInt16(off + 8);
    let p = off + 10;
    if (gl.numberOfContours >= 0) {
      const n = gl.numberOfContours;
      const endPts = [];
      for (let i = 0; i < n; i++, p += 2) endPts.push(dv.getUint16(p));
      gl.endPts = endPts;
      const numPoints = n ? endPts[n - 1] + 1 : 0;
      const instrLen = p + 2 <= off + len ? dv.getUint16(p) : 0;
      p += 2;
      gl.instructionLength = instrLen;
      gl.instructions = bytes.subarray(p, Math.min(p + instrLen, off + len));
      p += instrLen;
      // flags
      const flags = new Uint8Array(numPoints);
      let i = 0;
      while (i < numPoints && p < off + len) {
        const f = bytes[p++];
        flags[i++] = f;
        if (f & CNT_REPEAT) {
          let rep = bytes[p++];
          while (rep-- > 0 && i < numPoints) flags[i++] = f;
        }
      }
      // x
      const xs = new Int16Array(numPoints), ys = new Int16Array(numPoints);
      let x = 0;
      for (let k = 0; k < numPoints; k++) {
        const f = flags[k];
        if (f & CNT_XSHORT) {
          const v = bytes[p++];
          x += (f & CNT_XSAME) ? v : -v;
        } else if (!(f & CNT_XSAME)) {
          x += dv.getInt16(p); p += 2;
        }
        xs[k] = x;
      }
      let y = 0;
      for (let k = 0; k < numPoints; k++) {
        const f = flags[k];
        if (f & CNT_YSHORT) {
          const v = bytes[p++];
          y += (f & CNT_YSAME) ? v : -v;
        } else if (!(f & CNT_YSAME)) {
          y += dv.getInt16(p); p += 2;
        }
        ys[k] = y;
      }
      gl.numPoints = numPoints;
      gl.flags = flags;
      gl.xs = xs;
      gl.ys = ys;
      // 轮廓分组
      const contours = [];
      let start = 0;
      endPts.forEach((e) => { contours.push({ start: start, end: e }); start = e + 1; });
      gl.contours = contours;
      gl.instructionsRaw = bytes.subarray(p - instrLen, p);
    } else {
      // 复合字形
      const comps = [];
      let p2 = off + 10;
      let hasInstr = false;
      while (p2 + 4 <= off + len) {
        const flags = dv.getUint16(p2);
        const glyphIndex = dv.getUint16(p2 + 2);
        const comp = { flags: flags, glyphIndex: glyphIndex, flagOffset: p2, offset: p2 };
        let q = p2 + 4;
        if (flags & CF_ARGS_WORDS) {
          comp.arg1 = dv.getInt16(q); comp.arg2 = dv.getInt16(q + 2); q += 4;
          comp.argsSize = 4; comp.argsOffset = p2 + 4;
        } else {
          comp.arg1 = dv.getInt8(q); comp.arg2 = dv.getInt8(q + 1); q += 2;
          comp.argsSize = 2; comp.argsOffset = p2 + 4;
        }
        if (flags & CF_SCALE) { comp.a = comp.d = FL.TYPES.f2dot14.r(dv, q); q += 2; comp.type = 'scale'; }
        else if (flags & CF_XY_SCALE) { comp.a = FL.TYPES.f2dot14.r(dv, q); comp.d = FL.TYPES.f2dot14.r(dv, q + 2); q += 4; comp.type = 'xy'; }
        else if (flags & CF_2X2) { comp.a = FL.TYPES.f2dot14.r(dv, q); comp.b = FL.TYPES.f2dot14.r(dv, q + 2); comp.c = FL.TYPES.f2dot14.r(dv, q + 4); comp.d = FL.TYPES.f2dot14.r(dv, q + 6); q += 8; comp.type = '2x2'; }
        else { comp.a = 1; comp.b = 0; comp.c = 0; comp.d = 1; comp.type = 'none'; }
        comp.end = q;
        if (flags & CF_INSTRUCTIONS) hasInstr = true;
        comps.push(comp);
        if (!(flags & CF_MORE)) { p2 = q; break; }
        p2 = q;
      }
      if (hasInstr && p2 + 2 <= off + len) {
        const ilen = dv.getUint16(p2);
        gl.instructionLength = ilen;
        gl.instructions = bytes.subarray(p2 + 2, Math.min(p2 + 2 + ilen, off + len));
      } else {
        gl.instructionLength = 0;
        gl.instructions = new Uint8Array(0);
      }
      gl.components = comps;
    }
    gl.raw = bytes.subarray(off, off + len);
    return gl;
  }

  /** 解析整个 glyf（带缓存） */
  function parseAll(font) {
    if (glyphCache.has(font)) return glyphCache.get(font);
    const glyf = font.tableMap['glyf'];
    const loca = parseLoca(font);
    if (!glyf || !loca) return null;
    const numGlyphs = font.numGlyphs || 0;
    const glyphs = [];
    for (let i = 0; i < numGlyphs; i++) {
      const start = loca.offsets[i] || 0;
      const end = loca.offsets[i + 1] != null ? loca.offsets[i + 1] : start;
      let len = end - start;
      if (len < 0 || start + len > glyf.bytes.length) len = 0;
      try {
        glyphs.push(parseGlyph(glyf.bytes, start, len));
      } catch (e) {
        glyphs.push({ offset: start, length: len, empty: true, error: e.message, numberOfContours: 0, points: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0 });
      }
    }
    const data = { loca: loca, glyphs: glyphs, isComposite: glyphs.map((x) => x.components ? 1 : 0) };
    glyphCache.set(font, data);
    return data;
  }
  FL.glyfParse = parseAll;

  /* ------------------------------------------------------------------
   * SVG 路径
   * ------------------------------------------------------------------ */
  /** 当前轴取值下的 gvar 插值上下文（没有 gvar 或未设轴时返回 null） */
  function varCtx(font) {
    if (!font || !font.varAxes || !FL.gvar || !FL.gvar.ready(font)) return null;
    try { return FL.gvar.context(font, font.varAxes); } catch (e) { return null; }
  }

  /**
   * @param {object} vctx 可选的 gvar 插值上下文（轮廓预览用：浏览器拒绝加载字体时也能响应轴值）
   * @param {number} gid  字形索引（取增量需要）
   */
  function glyphPath(gl, font, depth, vctx, gid) {
    depth = depth || 0;
    if (!gl) return '';
    const dl = (vctx && gid != null) ? vctx.deltas(gid) : null;
    const ox = dl ? dl.dx : null, oy = dl ? dl.dy : null;
    const parts = [];
    if (gl.numberOfContours > 0 && gl.xs && depth < 6) {
      const segs = [];
      gl.contours.forEach((c) => {
        const n = c.end - c.start + 1;
        if (n <= 0) return;
        const seg = [];
        const on = (i) => (gl.flags[c.start + i] & CNT_ON) !== 0;
        const px = (i) => gl.xs[c.start + i] + (ox ? ox[c.start + i] : 0);
        const py = (i) => gl.ys[c.start + i] + (oy ? oy[c.start + i] : 0);
        let startI;
        if (on(0)) startI = 0;
        else if (on(n - 1)) startI = n - 1;
        else startI = -1;
        if (startI >= 0) {
          seg.push('M' + px(startI) + ',' + py(startI));
          for (let k = 1; k <= n; k++) {
            const i = (startI + k) % n;
            if (on(i)) seg.push('L' + px(i) + ',' + py(i));
            else {
              const j = (i + 1) % n;
              if (on(j)) { seg.push('Q' + px(i) + ',' + py(i) + ' ' + px(j) + ',' + py(j)); k++; }
              else {
                const mx = (px(i) + px(j)) / 2, my = (py(i) + py(j)) / 2;
                seg.push('Q' + px(i) + ',' + py(i) + ' ' + mx + ',' + my);
              }
            }
          }
        } else {
          // 全部为控制点：从最后一个点与第一个点的中点开始
          const mx = (px(0) + px(n - 1)) / 2, my = (py(0) + py(n - 1)) / 2;
          seg.push('M' + mx + ',' + my);
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            if (on(j)) { seg.push('Q' + px(i) + ',' + py(i) + ' ' + px(j) + ',' + py(j)); i++; }
            else {
              const mx2 = (px(i) + px(j)) / 2, my2 = (py(i) + py(j)) / 2;
              seg.push('Q' + px(i) + ',' + py(i) + ' ' + mx2 + ',' + my2);
            }
          }
        }
        seg.push('Z');
        segs.push(seg.join(' '));
      });
      // 关键：一个字形（简单字形）的所有轮廓必须写进**同一个** <path> 的 d 里。
      // TrueType/OpenType 规定用非零环绕规则（外轮廓顺时针、字怀逆时针），
      // 拆成多个 <path> 会让每个轮廓各自填充，字怀（洞）就被填实了。
      if (segs.length) parts.push('<path d="' + segs.join(' ') + '"/>');
    } else if (gl.components && depth < 6) {
      const all = parseAll(font);
      gl.components.forEach((cp) => {
        const sub = all && all.glyphs[cp.glyphIndex];
        if (!sub || sub.empty) return;
        const dx = (cp.flags & CF_ARGS_XY) ? cp.arg1 : 0;
        const dy = (cp.flags & CF_ARGS_XY) ? cp.arg2 : 0;
        const t = 'translate(' + dx + ',' + dy + ')' +
          (cp.type && cp.type !== 'none' ? ' matrix(' + cp.a + ',' + (cp.b || 0) + ',' + (cp.c || 0) + ',' + cp.d + ',0,0)' : '');
        const inner = glyphPath(sub, font, depth + 1, vctx, cp.glyphIndex);
        if (inner) parts.push('<g transform="' + t + '">' + inner + '</g>');
      });
    }
    return parts.join('');
  }

  /**
   * 生成完整 SVG 字符串（字形坐标系，y 轴向上）
   * 轮廓用**纯色**绘制：默认 fill="currentColor"，由容器决定颜色
   * （字形检查器 / 字形详情里是 --glyph-solid：暗色主题为白、亮色主题为黑），
   * 因此切换主题时无需重绘 SVG。opts.color 可显式指定颜色。
   */
  FL.glyphSVG = function (font, gid, opts) {
    const all = parseAll(font);
    opts = opts || {};
    if (!all) {
      if (font.isCFF) return { svg: null, reason: 'CFF 字体：轮廓存放在 CFF 表中，本工具不渲染 CFF 轮廓（可查看 CFF 表详情）。' };
      return { svg: null, reason: '字体中不含 glyf 表。' };
    }
    const gl = all.glyphs[gid];
    if (!gl) return { svg: null, reason: '字形索引超出范围' };
    if (gl.empty) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text x="0" y="0.5" font-size="0.3" fill="currentColor">空字形</text></svg>', empty: true };
    const raw = glyphPath(gl, font, 0, varCtx(font), gid);
    if (!raw) return { svg: null, reason: '未能生成轮廓路径' };
    const pad = 60;
    const x0 = Math.min(0, gl.xMin) - pad, y0 = Math.min(0, gl.yMin) - pad;
    const w = Math.max(gl.xMax, 0) - Math.min(gl.xMin, 0) + pad * 2;
    const h = Math.max(gl.yMax, 0) - Math.min(gl.yMin, 0) + pad * 2;
    const upm = font.unitsPerEm || 1000;
    const fill = opts.color || 'currentColor';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + x0 + ' ' + (-y0 - h) + ' ' + w + ' ' + h + '" width="100%" height="100%">' +
      '<g transform="scale(1,-1)" fill="' + fill + '" fill-rule="nonzero">' + raw + '</g>' +
      // 基线 / 参考线
      '<line x1="' + (x0) + '" y1="0" x2="' + (x0 + w) + '" y2="0" class="guide-base" stroke-opacity="0.75" stroke-width="' + (upm / 110) + '" stroke-dasharray="' + (upm / 30) + ' ' + (upm / 40) + '"/>' +
      '<line x1="0" y1="' + (-y0 - h) + '" x2="0" y2="' + (-y0) + '" class="guide-origin" stroke-opacity="0.7" stroke-width="' + (upm / 110) + '"/>' +
      '</svg>';
    return { svg: svg, glyph: gl };
  };

  /* ------------------------------------------------------------------
   * 轮廓排版：不依赖浏览器字体引擎，直接用本工具解析的 glyf 轮廓画文字
   * （用于浏览器 OTS 拒绝该字体时的兜底预览）
   * ------------------------------------------------------------------ */

  /** hhea 中的竖直度量（4=ascender，6=descender） */
  function hheaMetric(font, off, fallback) {
    const t = font.tableMap['hhea'];
    if (t && t.bytes.length >= off + 2) {
      const v = new DataView(t.bytes.buffer, t.bytes.byteOffset, t.bytes.byteLength);
      return v.getInt16(off);
    }
    return fallback;
  }

  /** 某字形的水平前进宽度（来自 hmtx） */
  FL.advanceOf = function (font, gid) {
    const hmtx = font.tableMap['hmtx'], hhea = font.tableMap['hhea'];
    const upm = font.unitsPerEm || 1000;
    if (!hmtx || !hhea || hmtx.bytes.length < 4 || hhea.bytes.length < 36) return Math.round(upm * 0.5);
    const mv = new DataView(hmtx.bytes.buffer, hmtx.bytes.byteOffset, hmtx.bytes.byteLength);
    const hv = new DataView(hhea.bytes.buffer, hhea.bytes.byteOffset, hhea.bytes.byteLength);
    const numLong = hv.getUint16(34);
    if (!numLong) return 0;
    if (gid < numLong) return mv.getUint16(gid * 4);
    // 超出 numberOfHMetrics 的字形只在 hmtx 里存 LSB，前进宽度沿用最后一个
    return mv.getUint16((numLong - 1) * 4);
  };

  /**
   * 把一段文字排成 SVG（字体单位 → 像素由 scale 完成）
   * @returns {{svg:string,width:number,height:number}|null} 无 glyf/CFF 字体返回 null
   */
  FL.outlineTextSVG = function (font, text, px, opts) {
    opts = opts || {};
    const all = parseAll(font);
    if (!all) return null;
    const cm = FL.font && FL.font.cmapMap ? FL.font.cmapMap(font) : null;
    if (!cm) return null;
    const vctx = varCtx(font);      // 可变字体：按当前轴值插值
    const upm = font.unitsPerEm || 1000;
    const s = (px || 32) / upm;
    const asc = hheaMetric(font, 4, Math.round(upm * 0.8));
    const desc = hheaMetric(font, 6, -Math.round(upm * 0.2));
    const lineH = opts.lineHeight || (asc - desc) * 1.25;
    const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    const pathCache = new Map();
    const parts = [];
    let maxW = 0;
    lines.forEach((line, li) => {
      let x = 0;
      const baseY = (asc + li * lineH) * s;
      Array.from(line).forEach((ch) => {          // 按码点拆分，代理对不会拆散
        const cp = ch.codePointAt(0);
        const gid = cm.has(cp) ? cm.get(cp) : null;
        const gl = gid != null ? all.glyphs[gid] : null;
        if (gl && !gl.empty) {
          let d = pathCache.get(gid);
          if (d === undefined) { d = glyphPath(gl, font, 0, vctx, gid) || ''; pathCache.set(gid, d); }
          if (d) {
            parts.push('<g transform="translate(' + x.toFixed(2) + ',' + baseY.toFixed(2) +
              ') scale(' + s + ',' + (-s) + ')">' + d + '</g>');
          }
        }
        x += FL.advanceOf(font, gid == null ? 0 : gid) * s;
      });
      if (x > maxW) maxW = x;
    });
    const w = Math.max(1, Math.ceil(maxW) + 2);
    const h = Math.max(1, Math.ceil((asc - desc + (lines.length - 1) * lineH) * s) + 2);
    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="outline-svg" viewBox="0 0 ' + w + ' ' + h +
        '" width="' + w + '" height="' + h + '" fill="currentColor" fill-rule="nonzero">' + parts.join('') + '</svg>',
      width: w, height: h
    };
  };

  /** 单字形小图（字形总览在轮廓模式下使用），按字体 em 方框对齐 */
  FL.outlineGlyphSVG = function (font, gid) {
    const all = parseAll(font);
    if (!all) return null;
    const gl = all.glyphs[gid];
    if (!gl || gl.empty) return null;
    const d = glyphPath(gl, font, 0, varCtx(font), gid);
    if (!d) return null;
    const upm = font.unitsPerEm || 1000;
    const asc = hheaMetric(font, 4, Math.round(upm * 0.8));
    const desc = hheaMetric(font, 6, -Math.round(upm * 0.2));
    const adv = Math.max(1, Math.round(FL.advanceOf(font, gid) || upm * 0.5));
    return '<svg xmlns="http://www.w3.org/2000/svg" class="outline-cell" viewBox="0 0 ' + adv + ' ' + (asc - desc) +
      '" preserveAspectRatio="xMidYMid meet" fill="currentColor" fill-rule="nonzero">' +
      '<g transform="translate(0,' + asc + ') scale(1,-1)">' + d + '</g></svg>';
  };

  /* ------------------------------------------------------------------
   * 重建 glyf / loca
   * ------------------------------------------------------------------ */
  function encodeSimpleGlyph(gl) {
    const n = gl.numPoints || 0;
    const b = new FL.Builder(64 + n * 5);
    b.i16(gl.numberOfContours);
    b.i16(gl.xMin); b.i16(gl.yMin); b.i16(gl.xMax); b.i16(gl.yMax);
    gl.endPts.forEach((e) => b.u16(e));
    const instr = gl.instructions || new Uint8Array(0);
    b.u16(instr.length);
    b.bytes(instr);
    // 计算差分
    const dx = new Int32Array(n), dy = new Int32Array(n);
    let px = 0, py = 0;
    for (let i = 0; i < n; i++) { dx[i] = gl.xs[i] - px; dy[i] = gl.ys[i] - py; px = gl.xs[i]; py = gl.ys[i]; }
    // 两遍：先写 flags，再写坐标数据
    const flags = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let f = 0;
      if (gl.flags[i] & CNT_ON) f |= CNT_ON;
      if (i === 0 && gl.flags[i] & CNT_OVERLAP) f |= CNT_OVERLAP;
      const x = dx[i], y = dy[i];
      if (x === 0) f |= CNT_XSAME;
      else if (x >= -255 && x <= 255) { f |= CNT_XSHORT; if (x > 0) f |= CNT_XSAME; }
      if (y === 0) f |= CNT_YSAME;
      else if (y >= -255 && y <= 255) { f |= CNT_YSHORT; if (y > 0) f |= CNT_YSAME; }
      flags[i] = f;
    }
    // flags（不使用重复标志，保证简单可靠）
    const fbytes = new Uint8Array(n);
    fbytes.set(flags);
    b.bytes(fbytes);
    for (let i = 0; i < n; i++) {
      const f = flags[i], x = dx[i];
      if (f & CNT_XSHORT) b.u8(Math.abs(x));
      else if (!(f & CNT_XSAME)) b.i16(x);
    }
    for (let i = 0; i < n; i++) {
      const f = flags[i], y = dy[i];
      if (f & CNT_YSHORT) b.u8(Math.abs(y));
      else if (!(f & CNT_YSAME)) b.i16(y);
    }
    return b.toBytes();
  }

  /** 重算 bbox */
  function recomputeBBox(gl) {
    if (gl.numberOfContours > 0 && gl.numPoints) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < gl.numPoints; i++) {
        const x = gl.xs[i], y = gl.ys[i];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      gl.xMin = x0; gl.yMin = y0; gl.xMax = x1; gl.yMax = y1;
    }
  }

  /**
   * 重建 glyf 表与 loca 表
   * @returns {{glyf:Uint8Array, loca:Uint8Array, indexToLocFormat:number}|null}
   */
  FL.glyfRebuild = function (font) {
    const all = parseAll(font);
    if (!all) return null;
    const chunks = [];
    const offsets = [];
    let total = 0;
    const pad = (n) => (n & 1 ? n + 1 : n);   // 字形数据需按偶数长度对齐
    all.glyphs.forEach((gl, i) => {
      offsets.push(total);
      let bytes;
      if (gl.dirty) {
        if (gl.numberOfContours >= 0) {
          recomputeBBox(gl);
          bytes = encodeSimpleGlyph(gl);
        } else {
          bytes = gl.raw.slice();
        }
      } else {
        bytes = gl.empty ? new Uint8Array(0) : gl.raw.slice();
      }
      const padded = pad(bytes.length);
      total += padded;
      chunks.push({ bytes: bytes, padded: padded });
    });
    offsets.push(total);
    const useLong = total > 0x1fffe;
    const loca = new Uint8Array((all.glyphs.length + 1) * (useLong ? 4 : 2));
    const dv = new DataView(loca.buffer);
    offsets.forEach((o, i) => {
      if (useLong) dv.setUint32(i * 4, o);
      else dv.setUint16(i * 2, Math.min(o / 2, 0xffff));
    });
    const glyf = new Uint8Array(total);
    let p = 0;
    chunks.forEach((c) => { glyf.set(c.bytes, p); p += c.padded; });
    return { glyf: glyf, loca: loca, indexToLocFormat: useLong ? 1 : 0 };
  };

  /** 重算 maxp 中的轮廓/点数上限 */
  FL.maxpRecompute = function (font) {
    const all = parseAll(font);
    const maxp = font.tableMap['maxp'];
    if (!all || !maxp || maxp.bytes.length < 32) return null;
    let maxPoints = 0, maxContours = 0, maxInstr = 0;
    all.glyphs.forEach((gl) => {
      if (gl.numberOfContours > 0) {
        maxPoints = Math.max(maxPoints, gl.numPoints || 0);
        maxContours = Math.max(maxContours, gl.numberOfContours);
      }
      maxInstr = Math.max(maxInstr, (gl.instructions && gl.instructions.length) || 0);
    });
    const b = maxp.bytes.slice();
    const dv = new DataView(b.buffer);
    dv.setUint16(6, maxPoints);
    dv.setUint16(8, maxContours);
    dv.setUint16(26, maxInstr);
    return b;
  };

  /* =====================================================================
   * loca 表视图
   * =================================================================== */
  T['loca'] = {
    parse(font, table) {
      const head = font.tableMap['head'];
      if (!head) throw new Error('缺少 head 表，无法确定 loca 格式');
      const format = FL.TYPES.int16.r(new FL.Reader(head.bytes).view, 50);
      const numGlyphs = font.numGlyphs || 0;
      const dv = new DataView(table.bytes.buffer, table.bytes.byteOffset, table.bytes.byteLength);
      const glyf = font.tableMap['glyf'];
      const rows = [];
      let p = 0;
      const offs = [];
      for (let i = 0; i <= numGlyphs; i++) {
        if (format === 0) { offs.push(p + 2 <= table.bytes.length ? dv.getUint16(p) * 2 : 0); p += 2; }
        else { offs.push(p + 4 <= table.bytes.length ? dv.getUint32(p) : 0); p += 4; }
      }
      for (let i = 0; i < numGlyphs; i++) {
        rows.push({
          __index: i,
          glyph: i,
          name: FL.font.glyphName(font, i),
          offset: offs[i],
          length: Math.max(0, offs[i + 1] - offs[i]),
          size: Math.max(0, offs[i + 1] - offs[i]),
          sum: offs[i] + Math.max(0, offs[i + 1] - offs[i])
        });
      }
      const fields = [
        { label: '偏移量格式', name: 'indexToLocFormat', offset: null, size: 0, type: 'text', value: format, display: format + '（' + U.INDEX_TO_LOC_FORMAT[format] + '）', editable: false,
          description: '由 head.indexToLocFormat 决定：0 表示每项为 uint16 且实际偏移为值×2；1 表示每项为 uint32。' },
        { label: '条目数', name: '—', offset: null, size: 0, type: 'text', value: '', display: (numGlyphs + 1) + '（numGlyphs + 1）', editable: false,
          description: '记录 n+1 个偏移，第 i 个字形占据 [offsets[i], offsets[i+1]) 区间。' },
        { label: '表长度', name: '—', offset: null, size: 0, type: 'text', value: '', display: table.bytes.length + ' 字节（预期 ' + (numGlyphs + 1) * (format === 0 ? 2 : 4) + ' 字节）', editable: false,
          description: '若实际长度与预期不符，说明 loca 表与 maxp 不一致。' },
        { label: 'glyf 表长度', name: '—', offset: null, size: 0, type: 'text', value: '', display: glyf ? glyf.bytes.length + ' 字节' : '（无 glyf 表）', editable: false,
          description: '最后一个字形的偏移应等于 glyf 表长度。' }
      ];
      return {
        sections: [
          H.sec('loca 表概况', 'loca（location）表是一张纯偏移数组，本身不含字形数据，仅用于在 glyf 表中定位每个字形。', fields),
          H.matrix('偏移数组', '每个字形的起始偏移与长度。修改轮廓后本工具会自动重建本表。',
            [
              H.col('glyph', '字形索引', { width: '90px' }),
              H.col('name', '字形名', { align: 'left', width: '160px' }),
              H.col('offset', '起始偏移', { width: '110px' }),
              H.col('length', '长度（字节）', { width: '110px' }),
              H.col('sum', '结束偏移', { width: '110px' })
            ], rows, { pageSize: 300, filterable: true })
        ],
        model: { offsets: offs, format: format }
      };
    }
  };

  /** 字符显示优先级：字母/汉字/假名/谚文 优于标点符号 */
  function dispRank(cp) {
    return ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ||
      (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0xac00 && cp <= 0xd7af)) ? 0 : 1;
  }

  /* =====================================================================
   * glyf 表视图
   * =================================================================== */
  T['glyf'] = {
    parse(font, table) {
      const all = parseAll(font);
      if (!all) throw new Error('无法解析 glyf 表（loca 表缺失）');
      const glyphs = all.glyphs;
      let simple = 0, composite = 0, empty = 0, totalPoints = 0, totalInstr = 0;
      // 字形 → 码点（用于「字符」列与按字符/码点筛选）
      const charMap = FL.font.gidCharMap ? FL.font.gidCharMap(font) : null;
      const rows = [];
      glyphs.forEach((gl, i) => {
        if (gl.empty) empty++;
        else if (gl.components) composite++;
        else simple++;
        if (gl.numberOfContours > 0) totalPoints += gl.numPoints || 0;
        totalInstr += (gl.instructions && gl.instructions.length) || 0;
        const cps = (charMap && charMap.get(i)) || [];
        // 同一字形可能被多个码点映射：显示时优先选字母/汉字（而非标点），其余仍可用于筛选
        const ordered = cps.slice().sort((a, b) => (dispRank(a) - dispRank(b)) || (a - b));
        let charText = '', allChars = '';
        try {
          charText = ordered.filter((cp) => cp >= 33 && cp !== 0x7f).slice(0, 3)
            .map((cp) => String.fromCodePoint(cp)).join('');
          allChars = ordered.filter((cp) => cp >= 33 && cp !== 0x7f).slice(0, 8)
            .map((cp) => String.fromCodePoint(cp)).join('');
        } catch (e) { /* 忽略异常码点 */ }
        rows.push({
          __index: i,
          glyph: i,
          char: charText,
          // 以下为隐藏字段（不显示为列，但参与筛选）：
          // chars 提供该字形的全部字符，codes 提供 U+XXXX 与十进制码点，便于用任意一种写法检索
          chars: allChars,
          codes: cps.map((cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') + ' ' + cp).join(' '),
          name: FL.font.glyphName(font, i),
          type: gl.empty ? '空' : gl.components ? '复合（' + gl.components.length + ' 组件）' : '简单',
          contours: gl.empty ? '' : gl.numberOfContours,
          points: gl.empty ? '' : gl.components ? '' : (gl.numPoints || 0),
          bbox: gl.empty ? '' : gl.xMin + ',' + gl.yMin + ' → ' + gl.xMax + ',' + gl.yMax,
          instr: (gl.instructions && gl.instructions.length) || 0,
          comp: gl.components ? gl.components.map((c) => '#' + c.glyphIndex).join(' ') : ''
        });
      });
      const stats = H.sec('glyf 表概况', 'glyf 表存放 TrueType 二次贝塞尔轮廓。轮廓坐标使用相对设计网格的整数（称为 FUnit），坐标原点在基线左端。', [
        { label: '字形总数', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(glyphs.length), editable: false, description: '与 maxp.numGlyphs 一致。' },
        { label: '简单 / 复合 / 空', name: '—', offset: null, size: 0, type: 'text', value: '', display: simple + ' / ' + composite + ' / ' + empty, editable: false, description: '简单字形直接给出点坐标；复合字形引用其它字形并叠加变换；空字形长度为 0（如空格、组合标记载体）。' },
        { label: '总点数', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(totalPoints), editable: false, description: '所有简单字形的点数合计。' },
        { label: '提示指令总字节', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(totalInstr), editable: false, description: '所有字形内嵌 TrueType 指令的字节数总和。' },
        { label: '表长度', name: '—', offset: null, size: 0, type: 'text', value: '', display: table.bytes.length + ' 字节', editable: false, description: 'glyf 表原始字节数。' }
      ]);

      const sections = [
        stats,
        H.matrix('字形列表', '点击任意行可在右侧「字形检查器」中查看轮廓并编辑点坐标。筛选框可直接输入字符（如「我」）、字形名、U+ 码点或 GID。',
          [
            H.col('glyph', 'GID', { width: '70px' }),
            H.col('char', '字符', { align: 'left', width: '80px', hclass: 'char-cell', description: '该字形在 cmap 中对应的字符（优先显示字母/汉字，最多 3 个）。筛选框支持输入字符、字形名、U+ 码点或 GID；即使某字符未显示在这里，只要它映射到该字形也能搜到。' }),
            H.col('name', '字形名', { align: 'left', width: '150px' }),
            H.col('type', '类型', { align: 'left', width: '150px' }),
            H.col('contours', '轮廓数', { width: '80px' }),
            H.col('points', '点数', { width: '80px' }),
            H.col('bbox', '边界框', { align: 'left', width: '210px', description: '字形边界框（xMin,yMin → xMax,yMax），复合字形为转换后的整体框。' }),
            H.col('instr', '指令字节', { width: '90px' }),
            H.col('comp', '引用字形', { align: 'left', description: '复合字形所引用的组件字形编号。' })
          ], rows, { pageSize: 300, filterable: true, selectable: 'glyph', layout: 'pair-left' }),
        {
          kind: 'custom',
          id: 'glyph-inspector',
          title: '字形检查器',
          description: '选择一个字形查看轮廓、点数据与复合组件。点坐标可编辑；编辑后会标记该字形为脏，保存时重新编码。',
          mount: mountGlyphInspector,
          layout: 'pair-right'
        }
      ];
      return { sections: sections, model: { all: all, glyphs: glyphs } };
    },

    edit(font, table, ctx, value) {
      const all = table._model.all;
      font.glyfDirty = true;   // 任何字形改动都需要重建 glyf / loca
      if (ctx.col && ctx.col.editKind === 'glyfPoint') {
        const gid = ctx.row.__gid, i = ctx.row.__pi;
        const gl = all.glyphs[gid];
        const v = parseInt(value, 10);
        if (isNaN(v) || v < -32768 || v > 32767) { font.glyfDirty = !!all.glyphs.some((g) => g.dirty); return { error: '坐标必须是 -32768 ~ 32767 之间的整数' }; }
        if (ctx.col.key === 'x') gl.xs[i] = v; else gl.ys[i] = v;
        gl.dirty = true;
        return true;
      }
      if (ctx.col && ctx.col.editKind === 'glyfBBox') {
        const gl = all.glyphs[ctx.row.__gid];
        const v = parseInt(value, 10);
        if (isNaN(v) || v < -32768 || v > 32767) return { error: '边界框数值必须是 int16' };
        gl[ctx.col.key] = v;
        gl.dirty = true;
        return true;
      }
      if (ctx.col && ctx.col.editKind === 'glyfComp') {
        const gl = all.glyphs[ctx.row.__gid];
        const cp = gl.components[ctx.row.__ci];
        const v = parseInt(value, 10);
        if (ctx.col.key === 'glyphIndex') {
          if (isNaN(v) || v < 0 || v > font.numGlyphs - 1) return { error: '组件字形索引超出范围' };
          cp.glyphIndex = v;
        } else if (ctx.col.key === 'arg1' || ctx.col.key === 'arg2') {
          if (isNaN(v)) return { error: '参数必须是整数' };
          if (cp.argsSize === 4) { if (v < -32768 || v > 32767) return { error: 'int16 参数范围 -32768~32767' }; }
          else { if (v < -128 || v > 127) return { error: 'int8 参数范围 -128~127' }; }
          cp[ctx.col.key] = v;
        }
        gl.dirty = true;
        return { rebuildGlyf: false };
      }
      return false;
    },

    /** glyf 的"重建"在保存流程中特殊处理（同时影响 loca/maxp/head） */
    rebuild: null
  };

  /* ------------------------------------------------------------------ */
  function mountGlyphInspector(el, ctx) {
    const font = ctx.font;
    const all = ctx.table._model.all;
    let gid = ctx.state.gid == null ? (font.cmapFirstGid || 1) : ctx.state.gid;
    const wrap = document.createElement('div');
    wrap.className = 'glyph-inspector';

    const head = document.createElement('div');
    head.className = 'gi-head';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gi-input';
    input.placeholder = 'GID / 字符 / U+码点';
    input.title = '可输入字形索引（如 36）、单个字符（如 我）或 Unicode 码点（如 U+6211）';
    input.value = gid;
    const label = document.createElement('div');
    label.className = 'gi-label';
    head.appendChild(document.createElement('span')).textContent = '定位字形：';
    head.appendChild(input);
    head.appendChild(label);
    wrap.appendChild(head);

    /** 码点 → 字形索引（借助 cmap） */
    function gidOfCodePoint(cp) {
      const m = FL.font.cmapMap(font);
      const g = m && m.get(cp);
      return g == null ? NaN : g;
    }

    const body = document.createElement('div');
    body.className = 'gi-body';
    const canvasBox = document.createElement('div');
    canvasBox.className = 'gi-canvas';
    const tableBox = document.createElement('div');
    tableBox.className = 'gi-table';
    body.appendChild(canvasBox);
    body.appendChild(tableBox);
    wrap.appendChild(body);
    el.appendChild(wrap);

    function render() {
      ctx.state.gid = gid;
      const gl = all.glyphs[gid];
      label.textContent = ' ' + FL.font.glyphName(font, gid) + (gl ? '' : '（无效）');
      if (!gl) { canvasBox.innerHTML = '<p class="muted">无效的字形索引</p>'; tableBox.innerHTML = ''; return; }
      const res = FL.glyphSVG(font, gid);
      if (res.svg) canvasBox.innerHTML = res.svg;
      else canvasBox.innerHTML = '<p class="muted">' + (res.reason || '无法渲染') + '</p>';

      if (gl.empty) { tableBox.innerHTML = '<p class="muted">空字形（长度 0）。</p>'; return; }
      if (gl.components) {
        const html = [];
        html.push('<table class="mini-table"><thead><tr><th>组件</th><th>引用字形</th><th>参数1</th><th>参数2</th><th>变换</th><th>标志</th></tr></thead><tbody>');
        gl.components.forEach((c, i) => {
          const flags = [];
          if (c.flags & CF_ARGS_XY) flags.push('坐标为偏移');
          else flags.push('坐标为目标点');
          if (c.flags & CF_ROUND) flags.push('取整');
          if (c.flags & CF_USE_MY_METRICS) flags.push('使用其度量');
          if (c.flags & CF_OVERLAP) flags.push('重叠');
          if (c.flags & CF_SCALED_OFFSET) flags.push('缩放偏移');
          if (c.flags & CF_UNSCALED_OFFSET) flags.push('不缩放偏移');
          html.push('<tr><td>' + i + '</td><td><input class="cell-input" data-kind="glyphIndex" data-ci="' + i + '" value="' + c.glyphIndex + '"></td>' +
            '<td><input class="cell-input" data-kind="arg1" data-ci="' + i + '" value="' + c.arg1 + '"></td>' +
            '<td><input class="cell-input" data-kind="arg2" data-ci="' + i + '" value="' + c.arg2 + '"></td>' +
            '<td>' + (c.type === 'none' ? '无' : c.type) + ' a=' + c.a + ' b=' + (c.b || 0) + ' c=' + (c.c || 0) + ' d=' + c.d + '</td>' +
            '<td class="small">' + flags.join('、') + '</td></tr>');
        });
        html.push('</tbody></table>');
        html.push('<p class="muted small">复合字形通过引用其它字形并应用 2×2 变换矩阵组合而成。参数为"偏移"时表示平移量；为"目标点"时表示与父字形第 N 点对齐。</p>');
        tableBox.innerHTML = html.join('');
        tableBox.querySelectorAll('input').forEach((inp) => {
          inp.addEventListener('change', () => {
            const ci = +inp.dataset.ci;
            const kind = inp.dataset.kind;
            ctx.app.editMatrix(T['glyf'], ctx.table,
              { row: { __gid: gid, __ci: ci }, col: { key: kind, editKind: 'glyfComp' } }, inp.value);
          });
        });
        return;
      }

      // 简单字形：点表格
      const html = [];
      html.push('<div class="point-toolbar">轮廓数 ' + gl.numberOfContours + '，点数 ' + gl.numPoints +
        '，指令 ' + gl.instructions.length + ' 字节</div>');
      html.push('<table class="mini-table"><thead><tr><th>点</th><th>轮廓</th><th>X</th><th>Y</th><th>类型</th></tr></thead><tbody>');
      let ci = 0;
      for (let i = 0; i < gl.numPoints; i++) {
        while (ci < gl.contours.length - 1 && i > gl.contours[ci].end) ci++;
        const on = (gl.flags[i] & CNT_ON) !== 0;
        html.push('<tr><td>' + i + '</td><td>' + ci + '</td>' +
          '<td><input class="cell-input" data-kind="x" data-pi="' + i + '" value="' + gl.xs[i] + '"></td>' +
          '<td><input class="cell-input" data-kind="y" data-pi="' + i + '" value="' + gl.ys[i] + '"></td>' +
          '<td>' + (on ? '曲线上' : '控制点') + '</td></tr>');
        if (i > 4000) { html.push('<tr><td colspan="5">… 点过多，仅显示前 4000 个</td></tr>'); break; }
      }
      html.push('</tbody></table>');
      html.push('<p class="muted small">"曲线上"表示该点是轮廓的实际顶点；"控制点"表示二次贝塞尔曲线的控制点。</p>');
      tableBox.innerHTML = html.join('');
      tableBox.querySelectorAll('input').forEach((inp) => {
        inp.addEventListener('change', () => {
          const pi = +inp.dataset.pi;
          const key = inp.dataset.kind;
          const r = ctx.app.editMatrix(T['glyf'], ctx.table,
            { row: { __gid: gid, __pi: pi }, col: { key: key, editKind: 'glyfPoint' } }, inp.value);
          if (r && r.ok) { const res2 = FL.glyphSVG(font, gid); if (res2.svg) canvasBox.innerHTML = res2.svg; }
        });
      });
      // 边界框编辑
      const bbox = document.createElement('div');
      bbox.className = 'gi-bbox';
      bbox.innerHTML = '<span class="muted small">边界框：</span>' +
        ['xMin', 'yMin', 'xMax', 'yMax'].map((k) =>
          '<label>' + k + ' <input class="cell-input" data-bbox="' + k + '" value="' + gl[k] + '"></label>').join('');
      tableBox.appendChild(bbox);
      bbox.querySelectorAll('input').forEach((inp) => {
        inp.addEventListener('change', () => {
          ctx.app.editMatrix(T['glyf'], ctx.table,
            { row: { __gid: gid }, col: { key: inp.dataset.bbox, editKind: 'glyfBBox' } }, inp.value);
        });
      });
    }

    // 支持输入：字形索引（36）、U+ 码点（U+6211）、单个字符（我）
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      let v = NaN;
      if (/^\d+$/.test(raw)) v = parseInt(raw, 10);
      else if (/^u\+[0-9a-f]{1,6}$/i.test(raw)) v = gidOfCodePoint(parseInt(raw.slice(2), 16));
      else if (raw) v = gidOfCodePoint(raw.codePointAt(0));
      if (!isNaN(v) && v >= 0 && v < all.glyphs.length) {
        gid = v;
        render();
      } else {
        input.value = gid;
        if (raw) ctx.app.toast('未找到「' + raw + '」对应的字形（可能未被该字体的 cmap 覆盖）', 'warn');
      }
    });
    const selectGlyph = (newGid) => {
      gid = newGid;
      input.value = gid;
      render();
    };
    ctx.onSelectGlyph = selectGlyph;
    ctx.app.onSelectGlyph = selectGlyph;   // 供上方字形列表的点击行联动
    render();
  }

  T.glyf.parseAll = parseAll;
  T.glyf.glyphPath = glyphPath;
})(typeof window !== 'undefined' ? window : globalThis);
