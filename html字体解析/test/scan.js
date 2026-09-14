/* =========================================================================
 * test/scan.js —— 扫描字体目录，找出"可能被浏览器 OTS 拒绝"的字体特征
 *  1) cmap 子表 language != 0（保存时会被我们规范化 → 触发 cmap 重建）
 *  2) 缺少 OTS 必需表
 *  3) 非常规 sfnt 版本 / 表标签
 * 用法：node test/scan.js [目录]
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

const dir = process.argv[2] || 'C:\\Windows\\Fonts';
const REQUIRED_TTF = ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'glyf', 'loca', 'name', 'post', 'OS/2'];

const files = [];
fs.readdirSync(dir).forEach((n) => {
  const ext = path.extname(n).toLowerCase();
  if (['.ttf', '.otf', '.ttc'].indexOf(ext) < 0) return;
  const p = path.join(dir, n);
  try { if (fs.statSync(p).isFile()) files.push({ n: n, p: p, size: fs.statSync(p).size }); } catch (e) { }
});
files.sort((a, b) => a.size - b.size);

const issues = [];
const seenFlavor = {};
const tableSet = {};

files.forEach((it) => {
  let font;
  try {
    font = FNT.parse(new Uint8Array(fs.readFileSync(it.p)), it.n, 0);
  } catch (e) {
    issues.push({ n: it.n, kind: '解析失败', detail: e.message });
    return;
  }
  seenFlavor[font.sfntVersionText] = (seenFlavor[font.sfntVersionText] || 0) + 1;
  font.tables.forEach((t) => { tableSet[t.tag.trim()] = (tableSet[t.tag.trim()] || 0) + 1; });

  // 缺必需表
  if (!font.isCFF) {
    const missing = REQUIRED_TTF.filter((t) => !font.tableMap[t]);
    if (missing.length) issues.push({ n: it.n, kind: '缺必需表', detail: missing.join(',') });
  } else if (!font.tableMap['CFF ']) {
    issues.push({ n: it.n, kind: 'OTTO 但无 CFF 表', detail: '' });
  }

  // cmap language != 0
  if (font.tableMap['cmap'] && FL.tables['cmap'].readSubtables) {
    try {
      const raw = FL.tables['cmap'].readSubtables(font.tableMap['cmap'].bytes);
      const bad = raw.subtables.filter((s) => s.language != null && s.language !== 0);
      if (bad.length) {
        issues.push({ n: it.n, kind: 'cmap language≠0', detail: 'lang=' + bad.map((s) => s.language).join('/') + ' fmt=' + bad.map((s) => s.format).join('/') });
      }
      // 无 Unicode 子表（OTS 会拒绝）
      const hasUni = raw.subtables.some((s) => s.platforms.some((p) =>
        (p.platformID === 0) || (p.platformID === 3 && (p.encodingID === 1 || p.encodingID === 10))));
      if (!hasUni) issues.push({ n: it.n, kind: '无 Unicode cmap', detail: raw.subtables.map((s) => s.format + ':' + s.platforms.map((p) => p.platformID + '/' + p.encodingID).join(',')).join(' ') });
      const famts = raw.subtables.map((s) => s.format);
      if (famts.some((f) => f === 2 || f === 8)) issues.push({ n: it.n, kind: '包含少见 cmap 格式', detail: famts.join(',') });
    } catch (e) {
      issues.push({ n: it.n, kind: 'cmap 读取异常', detail: e.message });
    }
  }
});

console.log('扫描 ' + files.length + ' 个字体文件\n');
console.log('sfnt 版本分布：');
Object.keys(seenFlavor).forEach((k) => console.log('  ' + k + ' × ' + seenFlavor[k]));
console.log('\n问题清单（' + issues.length + ' 项）：');
issues.forEach((i) => console.log('  [' + i.kind + '] ' + i.n + (i.detail ? '  ' + i.detail : '')));
console.log('\n出现的表标签（' + Object.keys(tableSet).length + ' 种）：' + Object.keys(tableSet).sort().join(' '));
