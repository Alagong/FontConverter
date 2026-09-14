'use strict';
/* 检查字体 cmap 各子表的 language 字段（OTS 要求必须为 0） */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
['js/util.js','js/binary.js','js/sfnt.js','js/tables/common.js','js/tables/basic.js','js/tables/os2.js',
 'js/tables/name.js','js/tables/cmap.js','js/glyf.js','js/tables/kern.js','js/tables/layout.js',
 'js/tables/cff.js','js/tables/misc.js','js/font.js'].forEach(f => require(path.join(root, f)));
const FL = globalThis.FL, FNT = FL.font;

function show(file, idx) {
  const f = FNT.parse(new Uint8Array(fs.readFileSync(file)), path.basename(file), idx || 0);
  const t = f.tableMap['cmap'];
  if (!t) { console.log(file + '：无 cmap'); return; }
  const raw = FL.tables['cmap'].readSubtables(t.bytes);
  const langs = raw.subtables.map((s) => 'fmt' + s.format + '(language=' + (s.language == null ? '—' : s.language) + ')');
  const bad = raw.subtables.filter((s) => s.language != null && s.language !== 0);
  console.log(path.basename(file) + '：' + langs.join(' ') + (bad.length ? '  ← 有非 0 language（OTS 会拒绝）' : '  ✓ 全部为 0'));
  // 重建后再次检查（开启兼容性修复）
  const res = FNT.save(f, { dropDSIG: false, recompute: false, normalizeCmapLang: true });
  const f2 = FNT.parse(res.bytes, 'rebuilt', 0);
  const raw2 = FL.tables['cmap'].readSubtables(f2.tableMap['cmap'].bytes);
  const langs2 = raw2.subtables.map((s) => 'fmt' + s.format + '(language=' + (s.language == null ? '—' : s.language) + ')');
  const note = res.notes.filter((n) => n.indexOf('language') >= 0).join('');
  console.log('   兼容性修复后：' + langs2.join(' ') + (note ? '  [' + note.slice(0, 60) + '…]' : ''));
  // 关闭修复时保持原样
  const f3 = FNT.parse(new Uint8Array(fs.readFileSync(file)), path.basename(file), idx || 0);
  const res3 = FNT.save(f3, { dropDSIG: false, recompute: false, normalizeCmapLang: false });
  const raw3 = FL.tables['cmap'].readSubtables(FNT.parse(res3.bytes, 'x', 0).tableMap['cmap'].bytes);
  console.log('   关闭修复：' + raw3.subtables.map((s) => 'fmt' + s.format + '(language=' + (s.language == null ? '—' : s.language) + ')').join(' '));
}

['BELL.TTF', 'BOOKOS.TTF', 'ARLRDBD.TTF', 'GARA.TTF', 'arial.ttf'].forEach((n) => show('C:\\Windows\\Fonts\\' + n, 0));
