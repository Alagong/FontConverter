/* =========================================================================
 * test/check2.js —— 预览模式 / 轮廓渲染 探针
 * 用法：await window.probeModes()
 * ========================================================================= */
(function () {
  window.probeModes = async function () {
    const F = APP.font, FL = window.FL, FNT = FL.font;
    const out = {
      mode: APP.previewMode, ok: APP.fontLoadOK, err: APP.fontLoadErr,
      hasGlyf: !!F.tableMap['glyf'],
      outlineSvgs: document.querySelectorAll('.outline-svg').length,
      outlineCells: document.querySelectorAll('.outline-cell').length
    };
    // 复合字形：应该渲染为 <g><path/></g> 而不是把元素塞进 d 属性
    try {
      const cm = FNT.cmapMap(F);
      const cand = [0x00c1, 0x00e9, 0x0130, 0x1e0d, 0x4e2d];
      let checked = null;
      for (const cp of cand) {
        const gid = cm.get(cp);
        if (gid == null) continue;
        const svg = (FL.glyphSVG(F, gid).svg) || '';
        const nested = svg.indexOf('<path d="<') >= 0;   // 说明把元素当路径数据写了
        checked = { cp: 'U+' + cp.toString(16), gid: gid, paths: svg.split('<path').length - 1, nestedInD: nested, len: svg.length };
        if (!nested && svg.length > 200) break;
      }
      out.composite = checked;
    } catch (e) { out.composite = { error: e.message }; }
    // 轮廓排版自检
    try {
      const o = FL.outlineTextSVG(F, 'Ab永', 32);
      out.outlineText = o ? { w: o.width, h: o.height, paths: o.svg.split('<path').length - 1 } : null;
      const cell = FL.outlineGlyphSVG(F, 3);
      out.outlineCell = cell ? cell.length : null;
    } catch (e) { out.outlineText = { error: e.message }; }
    return out;
  };
})();
