'use strict';
/* 校验浏览器导出的字体：结构、校验和、被修改的字段 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
['js/util.js','js/binary.js','js/sfnt.js','js/tables/common.js','js/tables/basic.js','js/tables/os2.js',
 'js/tables/name.js','js/tables/cmap.js','js/glyf.js','js/tables/kern.js','js/tables/layout.js',
 'js/tables/cff.js','js/tables/misc.js','js/font.js'].forEach(f => require(path.join(root, f)));
const FL = globalThis.FL, FNT = FL.font;

let pass = 0, fail = 0;
const check = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n + (e ? ' — ' + e : ''))) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };
const findField = (res, name) => {
  for (const s of res.sections) if (s.kind === 'fields') { const f = s.fields.find(x => x.name === name); if (f) return f; }
  return null;
};

const file = process.argv[2] || path.join(__dirname, 'out-e2e.ttf');
const buf = new Uint8Array(fs.readFileSync(file));
console.log('校验文件: ' + file + '  ' + (buf.length / 1024).toFixed(1) + ' KB');
const f = FNT.parse(buf, path.basename(file), 0);
console.log('表: ' + f.tables.map(t => t.tag.trim()).join(' '));

check('字体可解析', f.tables.length > 10, f.tables.length + ' 张表');
let csOK = true, bad = [];
f.tables.forEach(t => { if (t.tag !== 'head' && FL.sfnt.checksum(t.bytes) !== t.checksum) { csOK = false; bad.push(t.tag); } });
check('所有表校验和正确', csOK, bad.join(','));
check('全文件校验和 = 0xB1B0AFBA', (FL.sfnt.checksum(buf) >>> 0) === 0xb1b0afba);

const head = FNT.tableInfo(f, 'head');
const name = FNT.tableInfo(f, 'name');
const fams = name.model.records.filter(r => r.nameID === 1).map(r => r.text);
const mode = process.argv[3] || '';
if (mode !== 'glyph') {
  const rev = findField(head, 'fontRevision');
  check('浏览器中修改的 fontRevision 已保存', Math.abs(rev.value - 9.99) < 0.001, String(rev.value));
  check('浏览器中修改的家族名已保存', fams.some(x => x === 'E2E测试字体'), fams.join(' / '));
}
const os2 = FNT.tableInfo(f, 'OS/2');
const os2FieldCount = os2.sections.filter(s => s.kind === 'fields').reduce((a, s) => a + s.fields.length, 0);
check('OS/2 表字段齐全', os2FieldCount > 20, os2FieldCount + ' 个字段');
const hmtx = FNT.tableInfo(f, 'hmtx');
check('hmtx 行数 = numGlyphs', hmtx.model.advances.length === f.numGlyphs, hmtx.model.advances.length + '');
const cmap = FNT.tableInfo(f, 'cmap');
const m = FNT.cmapMap(f);
check('cmap 可构建 Unicode 映射', m && m.get(0x41) > 0, 'A → GID ' + (m && m.get(0x41)));
const gd = FL.glyfParse(f);
check('glyf 轮廓可解析', gd && gd.glyphs.length === f.numGlyphs, gd ? gd.glyphs.length + ' 个字形' : 'null');
if (process.argv[3] === 'glyph') {
  const a = gd.glyphs[36];
  check('字形 36 的点坐标修改已保存', a.xs[0] === 397, '第 1 点 X = ' + a.xs[0] + '（应为 397）');
  check('字形 36 边界框已随之重算', a.xMin <= 397, 'xMin=' + a.xMin + '，bbox=' + [a.xMin, a.yMin, a.xMax, a.yMax].join(','));
  const fams2 = name.model.records.filter(r => r.nameID === 1).map(r => r.text);
  check('家族名修改已保存', fams2.some(x => x === 'PointEditFamily'), fams2.join(' / '));
  // glyf 长度应与 loca 末项一致
  const loca = FNT.tableInfo(f, 'loca');
  const offs = loca.model.offsets;
  check('loca 末偏移 = glyf 长度', offs[offs.length - 1] === f.tableMap['glyf'].length,
    offs[offs.length - 1] + ' / ' + f.tableMap['glyf'].length);
  const hhea = FNT.tableInfo(f, 'hhea');
  check('hhea 最大前进宽度已重算', findField(hhea, 'advanceWidthMax').value > 0, String(findField(hhea, 'advanceWidthMax').value));
}
const svg = FL.glyphSVG(f, m.get(0x41));
check('字形 A 可渲染', !!(svg && svg.svg), svg && svg.svg ? svg.svg.length + ' 字节' : svg.reason);
check('DSIG 已按选项移除', !f.tableMap['DSIG']);
// 逐表二次保存比对（含重建表）
const res = FNT.save(f, { dropDSIG: false, recompute: false });
const f2 = FNT.parse(res.bytes, 'again.ttf', 0);
let same = 0, diff = [];
f2.tables.forEach(t => {
  const o = f.tableMap[t.tag];
  if (!o) { diff.push(t.tag); return; }
  let eq = o.length === t.length;
  if (eq && t.tag !== 'head') for (let i = 0; i < o.length; i++) if (o.bytes[i] !== t.bytes[i]) { eq = false; break; }
  eq ? same++ : diff.push(t.tag);
});
check('二次保存稳定（' + same + '/' + f2.tables.length + '）', diff.length === 0, diff.join(','));

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
