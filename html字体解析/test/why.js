/* =========================================================================
 * test/why.js —— 诊断"字体为什么被浏览器拒绝"
 *   · 原始文件字节（未经本工具任何改动）能不能被 Chromium 加载？
 *   · 本工具保存后的字节能不能被加载？
 * 两者分别抛出的错误消息，用于区分「字体本身不符合 OTS 校验」还是「工具的产物有问题」。
 * 浏览器控制台会额外打印 OTS 的具体拒绝原因（OTS parsing error: ...）。
 * 用法：await window.probeWhy()
 * ========================================================================= */
(function () {
  window.probeWhy = async function () {
    const out = { file: APP.font ? APP.font.fileName : '(no font)' };
    const tryLoad = async (bytes, label) => {
      if (!bytes) return label + ': 无字节';
      try {
        const f = new FontFace('why_' + label + '_' + Math.random(), bytes);
        await f.load();
        return label + ': OK';
      } catch (e) {
        return label + ': ' + ((e && e.message) || '未知');
      }
    };
    out.original = await tryLoad(APP.rawBytes, '原始文件字节');
    let saved = null;
    try { saved = FL.font.save(APP.font, { dropDSIG: true }).bytes; } catch (e) { saved = null; }
    out.saved = await tryLoad(saved, '本工具保存后的字节');
    let saved2 = null;
    try { saved2 = FL.font.save(APP.font, { dropDSIG: false, recompute: false, normalizeCmapLang: false }).bytes; } catch (e) { saved2 = null; }
    out.passthrough = await tryLoad(saved2, '直通保存（不做任何规范化）');
    out.tables = APP.font ? APP.font.tables.map((t) => t.tag.trim()).join(' ') : '';
    return out;
  };
})();
