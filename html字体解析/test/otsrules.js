/* =========================================================================
 * test/otsrules.js —— 浏览器 OTS 校验规则的本地复现（回归测试）
 *
 * 浏览器用 OTS(OpenType Sanitizer) 解析 @font-face / FontFace 的二进制字体，
 * 不合规就抛出 "Invalid font data in ArrayBuffer."。本脚本把踩过的坑固化成断言：
 *   1. sfnt 目录按 tag 升序、偏移 4 字节对齐、各表校验和正确
 *   2. head.checkSumAdjustment 使整文件校验和为 0xB1B0AFBA
 *   3. 必需表齐全（TrueType 需要 glyf+loca；CFF 需要 CFF 表）
 *   4. cmap：所有子表 language 必须为 0（格式 0/4/6/12/13）
 *   5. cmap 格式 4：段按 endCode 升序、末段必须 0xFFFF、startCode<=endCode、长度字段一致
 *   6. cmap 格式 12/13：长度 == 16 + 12×分组数、分组升序不重叠
 *   7. cmap 格式 0/6：长度字段一致
 *   8. maxp.numGlyphs 与 loca 条目数一致，loca 单调不减且不超出 glyf
 *
 * 用法：node test/otsrules.js            对一批系统字体做"原始 + 各类编辑后保存"的校验
 *       node test/otsrules.js <文件> [index]   只校验指定文件
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
['js/util.js', 'js/binary.js', 'js/sfnt.js', 'js/tables/common.js', 'js/tables/basic.js',
  'js/tables/os2.js', 'js/tables/name.js', 'js/tables/cmap.js', 'js/glyf.js', 'js/tables/kern.js',
  'js/tables/layout.js', 'js/tables/cff.js', 'js/tables/misc.js', 'js/font.js']
  .forEach((f) => require(path.join(root, f)));
const FL = globalThis.FL;
const FNT = FL.font;
const SFNT = FL.sfnt;

/* ------------------------------------------------------------------ *
 * 校验器
 * ------------------------------------------------------------------ */
function validate(bytes, label, opts) {
  opts = opts || {};
  const errs = [];
  // 原始文件里可能本来就存在 OTS 会拒绝的内容（如 cmap language≠0），
  // 这类问题只能作为提示，不能算工具的失败
  const warn = (m) => {
    // 原始文件本身就存在的缺陷（保存时会被工具修好）→ 只作提示，不算失败
    if (opts.soft && /language=.*必须为 0|maxp\.maxZones|表长度为 0|未按 tag 升序|校验和不符|checkSumAdjustment/.test(m)) opts.notes.push(label + '：' + m);
    else errs.push(m);
  };
  let font;
  try {
    font = SFNT.parse(bytes, 0);
  } catch (e) {
    return [label + '：无法解析（' + e.message + '）'];
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 1) 目录：tag 升序 + 偏移 4 字节对齐 + 校验和
  const tags = font.tables.map((t) => t.tag);
  const sorted = tags.slice().sort((a, b) => (FL.util.tagToInt(a) >>> 0) - (FL.util.tagToInt(b) >>> 0));
  if (tags.join() !== sorted.join()) warn('目录未按 tag 升序：' + tags.join(','));
  font.tables.forEach((t) => {
    if (t.offset % 4) warn(t.tag + ' 偏移未 4 字节对齐：' + t.offset);
    if (t.offset + t.length > bytes.length) warn(t.tag + ' 超出文件范围');
    if (t.tag !== 'head' && SFNT.checksum(t.bytes) !== t.checksum) warn(t.tag + ' 校验和不符');
  });

  // 2) head.checkSumAdjustment（TTC 中每个字体的校验和只覆盖自己的表，不能按整文件算）
  const headT = font.tableMap['head'];
  if (!headT) warn('缺少 head 表');
  else {
    const upm = view.getUint16(headT.offset + 18);
    if (!upm) warn('unitsPerEm 为 0');
    if (!font.collection) {
      const adj = view.getUint32(headT.offset + 8);
      const copy = bytes.slice();
      new DataView(copy.buffer).setUint32(headT.offset + 8, 0);
      const sum = SFNT.checksum(copy);
      if (((sum + adj) >>> 0) !== 0xb1b0afba) warn('checkSumAdjustment 错误（sum=0x' + sum.toString(16) + ' adj=0x' + adj.toString(16) + '）');
    }
  }

  // 3) 必需表
  if (font.isCFF) {
    if (!font.tableMap['CFF ']) warn('OTTO 字体缺少 CFF 表');
  } else {
    ['glyf', 'loca'].forEach((t) => { if (!font.tableMap[t]) warn('TrueType 字体缺少 ' + t + ' 表'); });
  }
  ['hhea', 'hmtx', 'maxp', 'cmap', 'name'].forEach((t) => { if (!font.tableMap[t]) warn('缺少必需表 ' + t); });

  // 4~7) cmap
  const cmapT = font.tableMap['cmap'];
  if (!cmapT) warn('缺少 cmap 表');
  else {
    const cb = cmapT.bytes;
    const dv = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);
    const numRec = dv.getUint16(2);
    const seen = {};
    for (let i = 0; i < numRec; i++) {
      const off = dv.getUint32(4 + i * 8 + 4);
      if (off + 4 > cb.length) { warn('cmap 记录 ' + i + ' 偏移越界：' + off); continue; }
      if (seen[off]) continue;
      seen[off] = 1;
      const fmt = dv.getUint16(off);
      if (fmt === 0 || fmt === 4 || fmt === 6) {
        const len = dv.getUint16(off + 2), lang = dv.getUint16(off + 4);
        if (lang !== 0) warn('cmap 子表 @' + off + ' 格式 ' + fmt + ' language=' + lang + '，必须为 0');
        if (fmt === 0 && len !== 262) warn('cmap 格式 0 长度应为 262，实际 ' + len);
        if (off + len > cb.length) warn('cmap 子表 @' + off + ' 长度越界');
        if (fmt === 4) {
          const segX2 = dv.getUint16(off + 6);
          const segCount = segX2 / 2;
          if (segX2 % 2) warn('cmap 格式 4 segCountX2 非偶数');
          if (len < 16 + segCount * 8) warn('cmap 格式 4 长度 ' + len + ' 小于最小值 ' + (16 + segCount * 8));
          const ends = [], starts = [];
          for (let k = 0; k < segCount; k++) ends.push(dv.getUint16(off + 14 + k * 2));
          const startBase = off + 16 + segCount * 2;
          for (let k = 0; k < segCount; k++) starts.push(dv.getUint16(startBase + k * 2));
          if (ends[segCount - 1] !== 0xffff) warn('cmap 格式 4 末段 endCode=0x' + ends[segCount - 1].toString(16) + '，必须为 0xFFFF');
          for (let k = 0; k < segCount; k++) {
            if (starts[k] > ends[k]) warn('cmap 格式 4 段 ' + k + ' startCode>endCode');
            if (k && ends[k] <= ends[k - 1]) warn('cmap 格式 4 段 ' + k + ' endCode 未递增');
          }
        }
        if (fmt === 6) {
          // 长度允许含尾部填充（如 Corbel 的 524 = 10 + 2×256 + 2），只要不少于最小长度
          const cnt = dv.getUint16(off + 8);
          if (len < 10 + cnt * 2) warn('cmap 格式 6 长度字段 ' + len + ' 小于 10+2×' + cnt);
        }
      } else if (fmt === 12 || fmt === 13) {
        const len = dv.getUint32(off + 4), lang = dv.getUint32(off + 8), n = dv.getUint32(off + 12);
        if (lang !== 0) warn('cmap 格式 ' + fmt + ' language=' + lang + '，必须为 0');
        if (len !== 16 + n * 12) warn('cmap 格式 ' + fmt + ' 长度 ' + len + ' != 16+12×' + n);
        if (off + len > cb.length) warn('cmap 格式 ' + fmt + ' 长度越界');
        let prevEnd = -1;
        for (let k = 0; k < n; k++) {
          const p = off + 16 + k * 12;
          const s = dv.getUint32(p), e = dv.getUint32(p + 4);
          if (s > e) warn('cmap 格式 ' + fmt + ' 分组 ' + k + ' 起止码反向');
          if (e > 0x10ffff) warn('cmap 格式 ' + fmt + ' 分组 ' + k + ' 超出 Unicode 上限');
          if (s <= prevEnd) warn('cmap 格式 ' + fmt + ' 分组 ' + k + ' 未递增/重叠');
          prevEnd = e;
        }
      }
      const lenForBound = (fmt === 12 || fmt === 13 || fmt === 8 || fmt === 10) ? dv.getUint32(off + 4) : dv.getUint16(off + 2);
      if (fmt !== 14 && off + lenForBound > cb.length) warn('cmap 子表 @' + off + ' 声明长度超出表范围');
    }
  }

  // 7.4) 不允许长度为 0 的表
  //      OTS 会以 "<tag>: zero-length table" 为由拒绝整个字体（实例：HarmonyOS.ttf 的 syma）；
  //      表目录必须按 tag 升序（"Table directory is not correctly ordered"）见上面第 1 条。
  font.tables.forEach((t) => { if (!t.bytes || t.bytes.length === 0) warn(t.tag + ' 表长度为 0（OTS 会拒绝整个字体）'); });

  // 7.5) maxp.maxZones 只能是 1 或 2
  //      OTS 会以 "maxp: Bad maxZones: 7" 为由拒绝整个字体（例如 msjhl.ttc）
  const maxpT = font.tableMap['maxp'];
  if (maxpT && maxpT.bytes.length >= 16) {
    const mv = new DataView(maxpT.bytes.buffer, maxpT.bytes.byteOffset, maxpT.bytes.byteLength);
    const zones = mv.getUint16(14);
    if (zones !== 1 && zones !== 2) warn('maxp.maxZones = ' + zones + '（规范只允许 1 或 2）');
  }

  // 8) loca / maxp
  const loca = font.tableMap['loca'], glyf = font.tableMap['glyf'], maxp = font.tableMap['maxp'];
  if (loca && glyf && maxp) {
    const n = font.numGlyphs;
    const longFmt = font.indexToLocFormat === 1;
    const need = (n + 1) * (longFmt ? 4 : 2);
    if (loca.bytes.length < need) warn('loca 表长度 ' + loca.bytes.length + ' 不足（需要 ' + need + '）');
    else {
      const lv = new DataView(loca.bytes.buffer, loca.bytes.byteOffset, loca.bytes.byteLength);
      let prev = 0;
      for (let i = 0; i <= n; i++) {
        const v = longFmt ? lv.getUint32(i * 4) : lv.getUint16(i * 2) * 2;
        if (v < prev) { warn('loca 第 ' + i + ' 项回退（' + v + ' < ' + prev + '）'); break; }
        if (v > glyf.bytes.length) { warn('loca 第 ' + i + ' 项 ' + v + ' 超出 glyf 长度 ' + glyf.bytes.length); break; }
        prev = v;
      }
    }
  }
  return errs.map((e) => label + '：' + e);
}

/* ------------------------------------------------------------------ *
 * 编辑用例：覆盖所有"重建"路径，保存后校验
 * ------------------------------------------------------------------ */
function editCases(font) {
  const F = font, T = FL.tables;
  const cases = [];

  // cmap：每个可重建子表都改一条映射
  const cm = FNT.tableInfo(F, 'cmap');
  if (cm && cm.model.subtables) {
    cm.model.subtables.forEach((st, si) => {
      if (!st.mapping || st.mapping.length < 2) return;
      const code = st.mapping[1][0];
      cases.push({
        name: 'cmap #' + si + '（格式 ' + st.format + '）改映射',
        apply: () => {
          const item = st.mapping.find((x) => x[0] === code);
          item[1] = item[1] === 1 ? 2 : 1;
          st.dirty = true; cm.model.dirty = true;
          FNT.markRebuild(F, 'cmap', '回归测试');
        }
      });
    });
  }
  // name
  const nm = FNT.tableInfo(F, 'name');
  if (nm && nm.model.records.length) {
    cases.push({
      name: 'name 文本修改',
      apply: () => {
        nm.model.records[0].text = 'Regression Family';
        nm.model.dirty = true;
        FNT.markRebuild(F, 'name', '回归测试');
      }
    });
  }
  // post 字形名
  const po = FNT.tableInfo(F, 'post');
  if (po && po.model.glyphNames && po.model.glyphNames.length > 2) {
    cases.push({
      name: 'post 字形名修改',
      apply: () => {
        po.model.glyphNames[2] = 'regression_glyph';
        po.model.dirty = true;
        FNT.markRebuild(F, 'post', '回归测试');
      }
    });
  }
  // hmtx（改一条 advance + 一侧承托）
  const hm = FNT.tableInfo(F, 'hmtx');
  if (hm && hm.model.advances && hm.model.advances.length) {
    cases.push({
      name: 'hmtx advance 修改',
      apply: () => {
        hm.model.advances[0] = (hm.model.advances[0] || 500) + 1;
        hm.model.dirty = true;
        FNT.markRebuild(F, 'hmtx', '回归测试');
      }
    });
  }
  // glyf：改一个简单字形的点 + 边界框
  const gd = FL.glyfParse(F);
  if (gd) {
    const gid = gd.glyphs.findIndex((g) => g && !g.components && g.numberOfContours === 1 && g.xs && g.xs.length > 1);
    if (gid >= 0) {
      cases.push({
        name: 'glyf 点坐标 + 边界框修改',
        apply: () => {
          const gl = gd.glyphs[gid];
          gl.xs[0] = (gl.xs[0] || 0) + 5;
          gl.dirty = true;
          F.glyfDirty = true;
          FNT.markRebuild(F, 'glyf', '回归测试');
        }
      });
    }
  }
  // kern
  const kn = FNT.tableInfo(F, 'kern');
  if (kn && kn.model.subtables) {
    const st = kn.model.subtables.find((s) => s.pairs && s.pairs.length);
    if (st) {
      cases.push({
        name: 'kern 调整值修改',
        apply: () => {
          st.pairs[0].value = -42;
          st.dirty = true;
          FNT.markRebuild(F, 'kern', '回归测试');
        }
      });
    }
  }
  return cases;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
const files = [];
if (process.argv[2]) {
  files.push({ file: process.argv[2], index: parseInt(process.argv[3] || '0', 10) });
} else {
  const dir = 'C:\\Windows\\Fonts';
  ['msyh.ttc', 'simsun.ttc', 'msyhl.ttc', 'cambria.ttc', 'calibri.ttf', 'consola.ttf', 'segoeui.ttf',
    'tahoma.ttf', 'arial.ttf', 'times.ttf', 'georgia.ttf', 'GILLUBCD.TTF', 'BELL.TTF', 'webdings.ttf',
    'wingding.ttf', 'seguiemj.ttf', 'Sitka.ttc', 'Candara.ttf', 'Corbel.ttf', 'Gabriola.ttf',
    'BAHNSCHRIFT.TTF', 'Inkfree.ttf'].forEach((n) => {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) files.push({ file: p, index: 0 });
    });
}

let total = 0, failed = 0;
files.forEach((item) => {
  const raw = new Uint8Array(fs.readFileSync(item.file));
  const name = path.basename(item.file);
  // 原始文件（本身不保证符合 OTS，语言字段等问题仅作提示）
  const notes0 = [];
  const errs0 = validate(raw, name + '（原始）', { soft: true, notes: notes0 });
  total++; if (errs0.length) { failed++; console.log('✗ ' + errs0.join('\n✗ ')); }
  else console.log('✓ ' + name + ' 原始' + (notes0.length ? '（提示：' + notes0.length + ' 处原始文件不符 OTS，保存时会被修复）' : ''));

  // 直接保存（不修改）
  let font;
  try { font = FNT.parse(raw, name, item.index); } catch (e) { console.log('  跳过：' + e.message); return; }
  const saved = FNT.save(font, { dropDSIG: true, dropStale: false, recompute: true });
  const errs1 = validate(saved.bytes, name + '（原样保存）');
  total++; if (errs1.length) { failed++; console.log('✗ ' + errs1.join('\n✗ ')); }
  else console.log('✓ ' + name + ' 原样保存');

  // 各个编辑用例（每个用例用干净的字体对象）
  const probe = FNT.parse(raw, name, item.index);
  const cases = editCases(probe);
  cases.forEach((cs) => {
    const f2 = FNT.parse(raw, name, item.index);
    // 重新构造同一用例并应用（针对 f2）
    const cs2 = editCases(f2).find((x) => x.name === cs.name);
    if (!cs2) return;
    cs2.apply();
    const r = FNT.save(f2, { dropDSIG: true, dropStale: false, recompute: true });
    const errs = validate(r.bytes, name + '（' + cs.name + '）');
    total++; if (errs.length) { failed++; console.log('✗ ' + errs.join('\n✗ ')); }
    else console.log('✓ ' + name + ' ' + cs.name);
  });
});

console.log('\n共 ' + total + ' 项校验，失败 ' + failed + ' 项' + (failed ? ' ✗' : ' ✓'));
process.exit(failed ? 1 : 0);
