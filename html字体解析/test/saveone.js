/* =========================================================================
 * test/saveone.js —— 用本工具（Node 端同一套 js/）加载字体并保存，输出到 test/saved.ttf
 *   并打印表清单与保存说明，方便在浏览器里校验"保存后的字节能不能被加载"
 * 用法：node test/saveone.js <字体文件> [index]
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
['js/util.js', 'js/binary.js', 'js/sfnt.js', 'js/tables/common.js', 'js/tables/basic.js',
  'js/tables/os2.js', 'js/tables/name.js', 'js/tables/cmap.js', 'js/glyf.js', 'js/gvar.js',
  'js/tables/kern.js', 'js/tables/layout.js', 'js/tables/cff.js', 'js/tables/misc.js', 'js/font.js']
  .forEach((f) => require(path.join(root, f)));
const FL = globalThis.FL;
const FNT = FL.font;

const file = process.argv[2];
const idx = parseInt(process.argv[3] || '0', 10);
const font = FNT.parse(new Uint8Array(fs.readFileSync(file)), path.basename(file), idx);

console.log('表清单（' + font.tables.length + '）：');
font.tables.forEach((t) => {
  const flag = t.bytes.length === 0 ? '   ← 长度为 0！' : '';
  console.log('  ' + t.tag + '  ' + String(t.bytes.length).padStart(9) + flag);
});

const res = FNT.save(font, { dropDSIG: true, recompute: true });
fs.writeFileSync(path.join(__dirname, 'saved.ttf'), res.bytes);
console.log('\n保存说明：');
res.notes.forEach((n) => console.log('  - ' + n));
console.log('已写出 test/saved.ttf，' + (res.bytes.length / 1024 / 1024).toFixed(2) + ' MB');
