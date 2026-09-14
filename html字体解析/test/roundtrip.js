/* 端到端验证脚本（Node）：解析 → 展示 → 修改 → 保存 → 重新解析校验 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
[
  'js/util.js', 'js/binary.js', 'js/sfnt.js',
  'js/tables/common.js', 'js/tables/basic.js', 'js/tables/os2.js', 'js/tables/name.js',
  'js/tables/cmap.js', 'js/glyf.js', 'js/tables/kern.js', 'js/tables/layout.js',
  'js/tables/cff.js', 'js/tables/misc.js', 'js/font.js'
].forEach((f) => require(path.join(root, f)));

const FL = globalThis.FL;
const FNT = FL.font;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}

function loadFont(file, index) {
  const buf = fs.readFileSync(file);
  return { font: FNT.parse(new Uint8Array(buf), path.basename(file), index || 0), size: buf.length };
}

/** 在所有分区中按技术名查找字段 */
function findField(res, name) {
  for (const s of res.sections) {
    if (s.kind !== 'fields') continue;
    const fd = s.fields.find((x) => x.name === name);
    if (fd) return fd;
  }
  return null;
}

/* ------------------------------------------------------------------ */
function testFont(file, index) {
  console.log('\n================ ' + file + (index ? ' [TTC #' + index + ']' : '') + ' ================');
  const { font } = loadFont(file, index);
  console.log('字体版本: ' + font.sfntVersionText);
  console.log('表数量: ' + font.tables.length + '，字形数: ' + font.numGlyphs + '，UPM: ' + font.unitsPerEm);
  console.log('表列表: ' + font.tables.map((t) => t.tag.trim() + '(' + t.length + ')').join(' '));

  // 1) 全部表解析
  let parseErr = [];
  font.tables.forEach((t) => {
    try {
      const res = FNT.tableInfo(font, t.tag);
      const secs = res.sections.length;
      if (!secs) parseErr.push(t.tag + ': 无内容');
    } catch (e) {
      parseErr.push(t.tag + ': ' + e.message);
    }
  });
  check('所有表都能解析并产出分区', parseErr.length === 0, parseErr.join(' | '));

  // 2) 命名
  const nm = (f, gid) => FNT.glyphName(f, gid);
  check('字形命名可用', !!nm(font, 0) && !!nm(font, 1), nm(font, 0) + ', ' + nm(font, 1));

  // 3) 无修改保存 → 逐表比对字节
  const res0 = FNT.save(font, { dropDSIG: false, dropStale: false, recompute: false });
  const f2 = FNT.parse(res0.bytes, file, index);
  let same = 0, diff = [];
  f2.tables.forEach((t) => {
    const orig = font.tableMap[t.tag];
    if (!orig) { diff.push(t.tag + '(新增)'); return; }
    let eq = orig.length === t.length;
    // head 表含 checkSumAdjustment，重排后必然不同，单独校验
    if (eq && t.tag !== 'head') for (let i = 0; i < orig.length; i++) if (orig.bytes[i] !== t.bytes[i]) { eq = false; break; }
    if (eq) same++; else diff.push(t.tag);
  });
  check('保存后表数据逐字节一致（' + same + '/' + f2.tables.length + '，head 除外）', diff.length === 0, diff.length ? '差异表: ' + diff.join(',') : '');

  // 4) 校验和 / checkSumAdjustment（解析层不再做校验，这里按实际内容重算）
  let csOK = true;
  const badSum = [];
  f2.tables.forEach((t) => {
    if (t.tag === 'head') return;
    if (FL.sfnt.checksum(t.bytes) !== t.checksum) { csOK = false; badSum.push(t.tag); }
  });
  check('保存后写入的表校验和全部正确', csOK, badSum.join(','));
  const hv = new DataView(f2.tableMap['head'].bytes.buffer, f2.tableMap['head'].bytes.byteOffset);
  const fileSum = FL.sfnt.checksum(res0.bytes);
  check('head.checkSumAdjustment 生效（全文件校验和 = 0xB1B0AFBA）',
    (fileSum >>> 0) === 0xb1b0afba, '0x' + (fileSum >>> 0).toString(16));

  return { font, savedBytes: res0.bytes };
}

/* ------------------------------------------------------------------ */
function testEdits(file, index) {
  console.log('\n---------------- 编辑与重建测试: ' + path.basename(file) + ' ----------------');
  const { font } = loadFont(file, index);

  // 1) head.fontRevision
  const head = FNT.tableInfo(font, 'head');
  const rev = findField(head, 'fontRevision');
  const r1 = FNT.patch(font, 'head', rev.offset, 'fixed', 2.5, { label: 'fontRevision' });
  check('修改 head.fontRevision', !!r1.ok);
  // 2) unitsPerEm
  const upmF = findField(head, 'unitsPerEm');
  FNT.patch(font, 'head', upmF.offset, 'uint16', 2048, { label: 'unitsPerEm' });
  // 3) OS/2 usWeightClass
  let os2 = FNT.tableInfo(font, 'OS/2');
  const wc = findField(os2, 'usWeightClass');
  FNT.patch(font, 'OS/2', wc.offset, 'uint16', 700, { label: 'usWeightClass' });

  // 4) name 表：修改家族名
  const nameRes = FNT.tableInfo(font, 'name');
  const rec = nameRes.model.records.find((r) => r.nameID === 1 && r.platformID === 3) || nameRes.model.records[0];
  const oldName = rec.text;
  rec.text = '测试家族名 TestFamily';
  FNT.markRebuild(font, 'name', '家族名已修改');
  check('修改 name 表家族名', rec.text !== oldName, oldName + ' → ' + rec.text);

  // 5) cmap：把第一个映射指向字形 2
  const cmapRes = FNT.tableInfo(font, 'cmap');
  const sub = cmapRes.model.subtables.find((s) => s.mapping && s.mapping.length);
  const testCode = sub.mapping[0][0], oldGid = sub.mapping[0][1];
  sub.mapping[0][1] = 2;
  sub.dirty = true;
  FNT.markRebuild(font, 'cmap', '字符映射已修改');
  check('修改 cmap 映射', testCode + ': GID ' + oldGid + ' → 2');

  // 6) hmtx：修改 advance
  const hmtxRes = FNT.tableInfo(font, 'hmtx');
  const m0 = hmtxRes.model;
  m0.advances[1] = 1234;
  FNT.markRebuild(font, 'hmtx', 'advance 已修改');

  // 7) post：重命名字形（仅 TrueType 且有 post 2.0）
  let renamed = false;
  const postRes = font.tableMap['post'] ? FNT.tableInfo(font, 'post') : null;
  if (postRes && postRes.model.glyphNames) {
    postRes.model.glyphNames[1] = 'renamed_one';
    postRes.model.dirty = true;
    FNT.markRebuild(font, 'post', '字形名已修改');
    renamed = true;
  }

  // 8) glyf：移动第一个非空简单字形的第一个点
  let moved = false, movedGid = -1, movedGl = null;
  const gd = FL.glyfParse(font);
  if (gd) {
    const gid = gd.glyphs.findIndex((x) => x.numberOfContours > 0 && x.numPoints > 0);
    const gl = gd.glyphs[gid];
    if (gl) {
      gl.xs[0] += 25;
      gl.ys[0] += 13;
      gl.dirty = true;
      font.glyfDirty = true;
      moved = true;
      movedGid = gid;
      movedGl = gl;
    }
  }

  // 保存
  const res = FNT.save(font, { dropDSIG: true, dropStale: false, recompute: true });
  console.log('保存说明: ' + res.notes.join(' | '));
  check('保存成功并输出字节', res.bytes.length > 1000, (res.bytes.length / 1024).toFixed(1) + ' KB');

  // 重新解析校验
  const f2 = FNT.parse(res.bytes, 'edited.ttf', 0);
  const head2 = FNT.tableInfo(f2, 'head');
  check('fontRevision 已写入', findField(head2, 'fontRevision').value === 2.5);
  check('unitsPerEm 已写入', findField(head2, 'unitsPerEm').value === 2048);
  const os22 = FNT.tableInfo(f2, 'OS/2');
  check('OS/2 usWeightClass 已写入', findField(os22, 'usWeightClass').value === 700);
  const name2 = FNT.tableInfo(f2, 'name');
  check('name 表已重建（家族名生效）',
    name2.model.records.some((r) => r.text === '测试家族名 TestFamily'),
    name2.model.records.filter((r) => r.nameID === 1).map((r) => r.text).join(' / '));
  const cmap2 = FNT.tableInfo(f2, 'cmap');
  const sub2 = cmap2.model.subtables.find((s) => s.mapping && s.mapping.length);
  const item2 = sub2.mapping.find((x) => x[0] === testCode);
  check('cmap 映射已生效', item2 && item2[1] === 2, 'U+' + testCode.toString(16) + ' → ' + (item2 && item2[1]));
  const hmtx2 = FNT.tableInfo(f2, 'hmtx');
  check('hmtx advance 已生效', hmtx2.model.advances[1] === 1234, String(hmtx2.model.advances[1]));
  if (renamed) {
    check('post 表已重建', FNT.glyphName(f2, 1) === 'renamed_one', FNT.glyphName(f2, 1));
  }
  if (moved) {
    const gd2 = FL.glyfParse(f2);
    const a = gd2.glyphs[movedGid];
    check('glyf 点坐标已写入（GID ' + movedGid + '）', a.xs[0] === movedGl.xs[0] && a.ys[0] === movedGl.ys[0],
      '(' + a.xs[0] + ',' + a.ys[0] + ') 期望 (' + movedGl.xs[0] + ',' + movedGl.ys[0] + ')');
    check('loca 表与 glyf 一致（末偏移 = glyf 长度）', (() => {
      const loca = FNT.tableInfo(f2, 'loca');
      const offs = loca.model.offsets;
      return offs[offs.length - 1] === f2.tableMap['glyf'].length;
    })(), 'glyf = ' + f2.tableMap['glyf'].length + ' B');
  }
  let csOK = true;
  f2.tables.forEach((t) => { if (t.tag !== 'head' && FL.sfnt.checksum(t.bytes) !== t.checksum) csOK = false; });
  check('重建后所有表校验和正确', csOK);
  const fileSum = FL.sfnt.checksum(res.bytes);
  check('重建后全文件校验和正确', (fileSum >>> 0) === 0xb1b0afba, '0x' + (fileSum >>> 0).toString(16));
  return res.bytes;
}

/* ------------------------------------------------------------------ */
function testWOFF(file) {
  console.log('\n---------------- WOFF 解包测试 ----------------');
  const buf = fs.readFileSync(file);
  const src = new Uint8Array(buf);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numTables = dv.getUint16(4);
  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    entries.push({
      tag: src.subarray(p, p + 4), checksum: dv.getUint32(p + 4),
      offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12)
    });
  }
  let total = 0;
  const comp = entries.map((e) => {
    const raw = src.subarray(e.offset, e.offset + e.length);
    const def = zlib.deflateSync(Buffer.from(raw));
    const use = def.length < raw.length ? def : raw;
    total += use.length;
    return { tag: Buffer.from(e.tag).toString('latin1'), comp: use, orig: raw, checksum: e.checksum };
  });
  // 构造 WOFF
  let off = 44 + numTables * 20;
  const out = Buffer.alloc(off + total);
  out.write('wOFF', 0, 'latin1');
  out.writeUInt32BE(0x00010000, 4);
  out.writeUInt32BE(out.length, 8);
  out.writeUInt16BE(numTables, 12);
  out.writeUInt32BE(off + total, 16);
  comp.forEach((e, i) => {
    const p = 44 + i * 20;
    out.write(e.tag, p, 4, 'latin1');
    out.writeUInt32BE(off, p + 4);
    out.writeUInt32BE(e.comp.length, p + 8);
    out.writeUInt32BE(e.orig.length, p + 12);
    out.writeUInt32BE(e.checksum, p + 16);
    out.set(e.comp, off);
    off += e.comp.length;
  });
  fs.writeFileSync(path.join(__dirname, 'generated.woff'), out);
  return FL.sfnt.woffToSfnt(new Uint8Array(out)).then((res) => {
    const f = FNT.parse(res.sfntBytes, 'generated.woff', 0);
    check('WOFF 解包后可解析出全部表', f.tables.length === numTables, f.tables.length + '/' + numTables + ' 表');
    const n = FNT.tableInfo(f, 'name');
    const fam = n.model.records.find((r) => r.nameID === 1);
    check('WOFF 中 name 表可读', !!fam, fam && fam.text);
    const res2 = FNT.save(f, { dropDSIG: false });
    const f3 = FNT.parse(res2.bytes, 'woff-out.ttf', 0);
    check('WOFF → TTF 输出可解析', f3.tables.length === numTables, f3.tables.length + ' 表');
    const res3 = FNT.save(f, { dropDSIG: true });
    const f4 = FNT.parse(res3.bytes, 'woff-out2.ttf', 0);
    check('保存时移除 DSIG 生效', f4.tables.length === numTables - 1, f4.tables.length + ' 表');
  });
}

/* ------------------------------------------------------------------ */
/** 合成一个最小 CFF 表，验证 CFF INDEX / DICT 解析与名称解析 */
function testCFF() {
  console.log('\n---------------- CFF 表解析测试（合成数据） ----------------');
  const dictLen = 13 + 6 + 6 + 11;          // FontBBox + FullName + CharStrings + Private
  const nameStr = 'TestFont';
  const nameIndexLen = 2 + 1 + 2 + nameStr.length;
  const topIndexLen = 2 + 1 + 2 + dictLen;
  const customStr = 'MyFont-Regular';
  const stringIndexLen = 2 + 1 + 2 + customStr.length;
  const gsubrLen = 2;
  const headerLen = 4;
  const nameOff = headerLen;
  const topOff = nameOff + nameIndexLen;
  const strOff = topOff + topIndexLen;
  const gsubrOff = strOff + stringIndexLen;
  const charStringsOff = gsubrOff + gsubrLen;
  const css = [[0x0e], [0x00, 0x0e], [0x00, 0x00, 0x0e]];
  const csDataLen = css.reduce((a, c) => a + c.length, 0);
  const csIndexLen = 2 + 1 + 4 + csDataLen;
  const privateOff = charStringsOff + csIndexLen;
  const privateLen = 15;
  const total = privateOff + privateLen;
  const b = Buffer.alloc(total);
  let p = 0;
  // 头部
  b[0] = 1; b[1] = 0; b[2] = 4; b[3] = 1; p = 4;
  // Name INDEX
  b.writeUInt16BE(1, p); b[p + 2] = 1; b[p + 3] = 1; b[p + 4] = 1 + nameStr.length;
  b.write(nameStr, p + 5, 'latin1'); p = nameOff + nameIndexLen;
  // Top DICT INDEX
  b.writeUInt16BE(1, p); b[p + 2] = 1; b[p + 3] = 1; b[p + 4] = 1 + dictLen;
  let q = p + 5;
  const pushI32 = (v) => { b[q++] = 29; b.writeInt32BE(v, q); q += 4; };
  const pushI16 = (v) => { b[q++] = 28; b.writeInt16BE(v, q); q += 2; };
  pushI16(0); pushI16(-200); pushI16(600); pushI16(800); b[q++] = 5;   // FontBBox
  pushI32(391); b[q++] = 2;                                            // FullName = 自定义字符串 #0
  pushI32(charStringsOff); b[q++] = 17;                                // CharStrings
  pushI32(privateLen); pushI32(privateOff); b[q++] = 18;               // Private
  p = strOff;
  // String INDEX
  b.writeUInt16BE(1, p); b[p + 2] = 1; b[p + 3] = 1; b[p + 4] = 1 + customStr.length;
  b.write(customStr, p + 5, 'latin1'); p = gsubrOff;
  // Global Subr INDEX（空）
  b.writeUInt16BE(0, p); p = charStringsOff;
  // CharStrings INDEX
  b.writeUInt16BE(css.length, p); b[p + 2] = 1;
  let off = 1;
  for (let i = 0; i <= css.length; i++) { b[p + 3 + i] = off; if (i < css.length) off += css[i].length; }
  let d = p + 3 + css.length + 1;
  css.forEach((c) => { c.forEach((x) => { b[d++] = x; }); });
  // Private DICT：BlueValues [-15 0 700 720]、StdVW 80
  p = privateOff;
  pushI16At(b, p, -15); pushI16At(b, p + 3, 0); pushI16At(b, p + 6, 700); pushI16At(b, p + 9, 720);
  b[p + 12] = 6; b[p + 13] = 219; b[p + 14] = 11;
  function pushI16At(buf, pos, v) { buf[pos] = 28; buf.writeInt16BE(v, pos + 1); }

  // 组装成一个 OTTO 字体（借用 arial 的其它表）
  const base = FNT.parse(new Uint8Array(fs.readFileSync('C:\\Windows\\Fonts\\arial.ttf')), 'arial.ttf', 0);
  const tables = base.tables.filter((t) => t.tag !== 'glyf' && t.tag !== 'loca' && t.tag !== 'DSIG')
    .map((t) => ({ tag: t.tag, bytes: t.bytes }));
  tables.push({ tag: 'CFF ', bytes: new Uint8Array(b) });
  const maxp = base.tableMap['maxp'].bytes.slice();
  new DataView(maxp.buffer).setInt32(0, 0x00005000);   // maxp 0.5（CFF）
  tables.find((t) => t.tag === 'maxp').bytes = new Uint8Array(maxp);
  const otto = FL.sfnt.build(tables, { flavor: 0x4f54544f });
  const f = FNT.parse(otto, 'test.otf', 0);
  check('合成 OTTO 字体可解析', f.isCFF && f.tables.length === tables.length, f.sfntVersionText);

  const cff = FNT.tableInfo(f, 'CFF ');
  const titles = cff.sections.map((s) => s.title).join(' | ');
  check('解析出 Top DICT 与 Private DICT', /Top DICT/.test(titles) && /Private DICT/.test(titles));
  const topRows = cff.sections.find((s) => /Top DICT/.test(s.title)).rows;
  const fullName = topRows.find((r) => r.name === 'FullName');
  check('SID 名称解析正确（自定义字符串）', fullName && fullName.extra.indexOf('MyFont-Regular') >= 0, fullName && fullName.extra);
  const csRow = topRows.find((r) => r.name === 'CharStrings');
  check('CharStrings 偏移解析正确', csRow && parseInt(csRow.values, 10) === charStringsOff, csRow && csRow.values);
  const privRows = cff.sections.find((s) => /Private DICT/.test(s.title)).rows;
  check('Private DICT 的 BlueValues 已解析', privRows.some((r) => r.name === 'BlueValues'), privRows.map((r) => r.name).join(','));
  const csSec = cff.sections.find((s) => s.title === 'CharStrings INDEX');
  check('CharStrings INDEX 字形数正确', csSec && csSec.fields.find((x) => x.label === '字形数量').display === '3');

  // 保存（CFF 表原样保留）
  const res = FNT.save(f, { dropDSIG: true });
  const f2 = FNT.parse(res.bytes, 'out.otf', 0);
  check('CFF 字体保存后仍为 OTTO 且 CFF 表完好',
    f2.sfntVersion === 0x4f54544f && f2.tableMap['CFF '].bytes.length === b.length);
}

/* ------------------------------------------------------------------ */
(async () => {
  const win = 'C:\\Windows\\Fonts\\';
  testFont(win + 'arial.ttf');
  testEdits(win + 'arial.ttf');
  if (fs.existsSync(win + 'Sitka.ttc')) {
    console.log('\n########## TTC 集合（第二个字体） ##########');
    const f = loadFont(win + 'Sitka.ttc', 1).font;
    console.log('字形数: ' + f.numGlyphs + '，表数: ' + f.tables.length + '，集合内字体数: ' + (f.collection ? f.collection.numFonts : 0));
    check('TTC 可指定解析第 N 个字体', f.fontIndex === 1);
    const n = FNT.tableInfo(f, 'name');
    check('TTC 中的 name 表可读', n.model.records.length > 0, n.model.records[0].text.slice(0, 20));
    const res = FNT.save(f, { dropDSIG: true, recompute: false });
    const f2 = FNT.parse(res.bytes, 'sitka.otf', 0);
    check('从 TTC 提取的字体可独立保存并再次解析', f2.tables.length === f.tables.length, (res.bytes.length / 1024).toFixed(1) + ' KB');
  }
  testCFF();
  if (fs.existsSync(win + 'msyh.ttc')) {
    console.log('\n########## 大字体（CJK, TTC） ##########');
    const t0 = Date.now();
    const f = loadFont(win + 'msyh.ttc', 0).font;
    const t1 = Date.now();
    FL.glyfParse(f);
    const t2 = Date.now();
    FNT.tableInfo(f, 'cmap');
    const t3 = Date.now();
    FNT.tableInfo(f, 'hmtx');
    const t4 = Date.now();
    console.log('解析容器 ' + (t1 - t0) + 'ms，glyf/loca ' + (t2 - t1) + 'ms，cmap ' + (t3 - t2) + 'ms，hmtx ' + (t4 - t3) + 'ms');
    check('大字体可完整解析', f.numGlyphs > 20000, f.numGlyphs + ' 字形');
    const t5 = Date.now();
    const errs = [];
    f.tables.forEach((t) => {
      try {
        const r = FNT.tableInfo(f, t.tag);
        if (!r.sections.length) errs.push(t.tag + '(空)');
      } catch (e) { errs.push(t.tag + ':' + e.message); }
    });
    check('大字体所有表解析成功（' + (Date.now() - t5) + 'ms）', errs.length === 0, errs.join(' | '));
    const cm = FNT.cmapMap(f);
    check('大字体 cmap 覆盖字符数合理', cm && cm.size > 10000, cm ? cm.size + ' 个字符' : 'null');
    const gs = FL.glyphSVG(f, cm.get(0x6c38));  // 永
    check('CJK 字形可生成 SVG 轮廓', !!(gs && gs.svg), gs && gs.svg ? gs.svg.length + ' 字节 SVG' : gs.reason);
    const res = FNT.save(f, { dropDSIG: true, recompute: false });
    check('大字体可保存', res.bytes.length > 1000, (res.bytes.length / 1024 / 1024).toFixed(1) + ' MB');
  }
  testWOFF('C:\\Windows\\Fonts\\arial.ttf');
  await new Promise((r) => setTimeout(r, 200));

  console.log('\n==========================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
