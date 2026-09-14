'use strict';
/* 校验所有表解析器返回的分区结构是否合法（矩阵行必须是数组等） */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
['js/util.js','js/binary.js','js/sfnt.js','js/tables/common.js','js/tables/basic.js','js/tables/os2.js',
 'js/tables/name.js','js/tables/cmap.js','js/glyf.js','js/tables/kern.js','js/tables/layout.js',
 'js/tables/cff.js','js/tables/misc.js','js/font.js'].forEach(f => require(path.join(root, f)));
const FL = globalThis.FL, FNT = FL.font;

const KINDS = { fields: 1, matrix: 1, note: 1, custom: 1 };
let problems = [];

function checkFont(file, index, label) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const f = FNT.parse(buf, path.basename(file), index || 0);
  console.log('\n=> ' + label + '（' + f.tables.length + ' 张表，' + f.numGlyphs + ' 字形）');
  f.tables.forEach((t) => {
    let res;
    try {
      res = FNT.tableInfo(f, t.tag);
    } catch (e) {
      problems.push(label + ' ' + t.tag + '：解析抛异常 ' + e.message);
      return;
    }
    res.sections.forEach((sec, si) => {
      const where = t.tag + ' 分区#' + si + '「' + (sec.title || '') + '」';
      if (!KINDS[sec.kind]) { problems.push(where + ' 未知类型 ' + sec.kind); return; }
      if (sec.kind === 'matrix') {
        if (!Array.isArray(sec.rows)) problems.push(where + ' rows 不是数组（' + typeof sec.rows + '）');
        if (!Array.isArray(sec.columns) || !sec.columns.length) problems.push(where + ' columns 缺失');
        (Array.isArray(sec.rows) ? sec.rows.slice(0, 5) : []).forEach((r, ri) => {
          if (typeof r !== 'object' || r === null) problems.push(where + ' 第 ' + ri + ' 行不是对象');
        });
      } else if (sec.kind === 'fields') {
        if (!Array.isArray(sec.fields) || !sec.fields.length) problems.push(where + ' fields 缺失或为空');
        (Array.isArray(sec.fields) ? sec.fields.slice(0, 5) : []).forEach((fd, fi) => {
          if (typeof fd.label !== 'string') problems.push(where + ' 字段#' + fi + ' 缺 label');
          if (fd.display === undefined) problems.push(where + ' 字段#' + fi + '(' + fd.label + ') 缺 display');
          if (fd.editable && fd.offset == null && !fd.editKind) problems.push(where + ' 字段#' + fi + '(' + fd.label + ') 可编辑但无 offset/editKind');
        });
      } else if (sec.kind === 'custom') {
        if (typeof sec.mount !== 'function') problems.push(where + ' custom 分区缺 mount');
      } else if (sec.kind === 'note') {
        if (typeof sec.text !== 'string') problems.push(where + ' note 缺 text');
      }
    });
  });
  console.log('   ' + f.tables.length + ' 张表结构校验完成');
}

checkFont('C:\\Windows\\Fonts\\arial.ttf', 0, 'arial.ttf');
checkFont('C:\\Windows\\Fonts\\msyh.ttc', 0, 'msyh.ttc[0]');
checkFont('C:\\Windows\\Fonts\\bahnschrift.ttf', 0, 'bahnschrift.ttf（可变字体）');
checkFont('C:\\Windows\\Fonts\\Sitka.ttc', 1, 'Sitka.ttc[1]');

console.log('\n==========================');
if (problems.length) {
  console.log('发现 ' + problems.length + ' 个结构问题：');
  problems.slice(0, 40).forEach((p) => console.log('  ✗ ' + p));
  process.exit(1);
} else {
  console.log('全部表分区结构检查通过 ✓');
}
