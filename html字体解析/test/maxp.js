/* =========================================================================
 * test/maxp.js —— 检查 / 修正 maxp 的 maxZones（OTS 只接受 1 或 2）
 * 用法：node test/maxp.js C:\Windows\Fonts\msjhl.ttc 0 [fix]
 *   fix：把 maxZones 改成 2 并写出 test/maxpfix.ttf（用于继续探测后续 OTS 问题）
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

const file = process.argv[2] || 'C:\\Windows\\Fonts\\msjhl.ttc';
const idx = parseInt(process.argv[3] || '0', 10);
const doFix = (process.argv[4] || '') === 'fix';
const font = FNT.parse(new Uint8Array(fs.readFileSync(file)), path.basename(file), idx);

const t = font.tableMap['maxp'];
if (!t) { console.log('该字体没有 maxp 表'); process.exit(1); }
const v = new DataView(t.bytes.buffer, t.bytes.byteOffset, t.bytes.byteLength);
const fields = [
  ['version', t.bytes.length >= 4 ? '0x' + v.getUint32(0).toString(16) : '-'],
  ['numGlyphs', v.getUint16(4)],
  ['maxPoints', v.getUint16(6)],
  ['maxContours', v.getUint16(8)],
  ['maxCompositePoints', v.getUint16(10)],
  ['maxCompositeContours', v.getUint16(12)],
  ['maxZones', v.getUint16(14)],
  ['maxTwilightPoints', v.getUint16(16)],
  ['maxStorage', v.getUint16(18)],
  ['maxFunctionDefs', v.getUint16(20)],
  ['maxInstructionDefs', v.getUint16(22)],
  ['maxStackElements', v.getUint16(24)],
  ['maxSizeOfInstructions', v.getUint16(26)],
  ['maxComponentElements', v.getUint16(28)],
  ['maxComponentDepth', v.getUint16(30)]
];
console.log('文件：' + file + '（第 ' + idx + ' 个字体）');
fields.forEach(([k, val]) => console.log('  ' + k + ' = ' + val));

if (doFix) {
  v.setUint16(14, 2);                    // maxZones 必须是 1 或 2
  const res = FNT.save(font, { dropDSIG: true });
  fs.writeFileSync(path.join(__dirname, 'maxpfix.ttf'), res.bytes);
  console.log('\n已写出 test/maxpfix.ttf（maxZones 改为 2），' + (res.bytes.length / 1024).toFixed(0) + ' KB');
}
