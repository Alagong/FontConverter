/* =========================================================================
 * test/ots.js —— 生成"浏览器 OTS 校验"测试素材
 *
 * 对指定目录下的字体逐个：解析 → 按预览同一套参数保存 → 同时导出原始字节，
 * 供 test/ots.html 在真实浏览器里用 FontFace 加载校验（Chromium 的 OTS 会拒绝
 * 不合规的字体，报 "Invalid font data in ArrayBuffer."）。
 *
 * 用法：node test/ots.js [字体目录] [最多数量]
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
const limit = parseInt(process.argv[3] || '60', 10);
const filter = (process.argv[4] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const MAX_BYTES = parseInt(process.argv[5] || String(9 * 1024 * 1024), 10);   // 超过此大小跳过
const outDir = path.join(__dirname, 'out');

/** 与 app.js 的 refreshPreviewFont 完全一致的保存参数 */
const PREVIEW_OPTS = { dropDSIG: true, dropStale: false, recompute: true };

function listFonts() {
  const res = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { console.error('无法读取目录: ' + dir); process.exit(1); }
  names.forEach((n) => {
    const ext = path.extname(n).toLowerCase();
    if (ext !== '.ttf' && ext !== '.otf' && ext !== '.ttc') return;
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch (e) { return; }
    if (!st.isFile() || st.size > MAX_BYTES) return;
    if (filter.length && !filter.some((k) => n.toLowerCase().indexOf(k) >= 0)) return;
    res.push({ file: p, name: n, size: st.size });
  });
  res.sort((a, b) => b.size - a.size);          // 小字体优先，覆盖更多样本
  res.reverse();
  return limit > 0 ? res.slice(0, limit) : res;
}

function flavorExt(f) { return f.sfntVersion === 0x4f54544f ? '.otf' : '.ttf'; }

(function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];
  const list = listFonts();
  console.log('扫描 ' + dir + '，候选 ' + list.length + ' 个字体\n');
  list.forEach((item, i) => {
    const buf = fs.readFileSync(item.file);
    const base = path.parse(item.name).name.replace(/[^\w.-]/g, '_');
    let font;
    try {
      font = FNT.parse(new Uint8Array(buf), item.name, 0);
    } catch (e) {
      console.log('  [' + i + '] ' + item.name + ' —— 解析失败: ' + e.message);
      return;
    }
    let saved = null, err = '';
    try {
      const r = FNT.save(font, PREVIEW_OPTS);
      saved = r.bytes;
    } catch (e) { err = e.message; }
    const ext = flavorExt(font);
    const entry = {
      index: i,
      name: item.name,
      base: base,
      flavor: font.sfntVersion,
      flavorText: font.sfntVersionText,
      numGlyphs: font.numGlyphs,
      tables: font.tables.length,
      orig: 'orig_' + base + ext,
      saved: saved ? 'saved_' + base + ext : null,
      saveError: err || null
    };
    fs.writeFileSync(path.join(outDir, entry.orig), buf);
    if (saved) fs.writeFileSync(path.join(outDir, entry.saved), Buffer.from(saved));
    manifest.push(entry);
    console.log('  [' + i + '] ' + item.name + ' → ' + (saved ? (saved.length / 1024).toFixed(0) + 'KB' + entry.flavorText.slice(0, 6) : '保存失败:' + err));
  });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('\n素材已写入 test/out/，共 ' + manifest.length + " 项。打开 test/ots.html 做浏览器校验。");
})();
