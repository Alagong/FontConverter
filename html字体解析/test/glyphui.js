/* =========================================================================
 * test/glyphui.js —— 字形检查器配色 + 字形总览右侧详情的布局探针
 * 用法：await window.probeGlyphUI()
 * ========================================================================= */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.probeGlyphUI = async function () {
    const out = {};
    const FL = window.FL, FNT = FL.font, f = APP.font;

    // ---- 1) 找一个有轮廓的简单字形，检查 SVG 纯色 ----
    const cm = FNT.cmapMap(f);
    let gid = -1;
    for (let cp = 0x41; cp <= 0x5a && gid < 0; cp++) {
      const g = cm.get(cp);
      if (g != null && g > 0) gid = g;
    }
    out.gid = gid;
    const svg = FL.glyphSVG(f, gid).svg || '';
    out.svgHasGradient = /linearGradient|<stop/.test(svg);
    out.svgFillAttr = (/fill="([^"]*)"/.exec(svg) || [])[1] || '';

    // ---- 2) 字形总览：选中前后布局 ----
    const wrap = document.querySelector('#content .split-2col');
    out.layoutBeforeSelect = wrap ? {
      oneCol: wrap.classList.contains('one-col'),
      detailVisible: (() => { const d = wrap.querySelectorAll(':scope > .card')[1]; return d ? d.style.display !== 'none' : null; })(),
      cols: getComputedStyle(wrap).gridTemplateColumns
    } : null;

    const cell = document.querySelector('.glyph-cell');
    if (cell) { cell.click(); await sleep(400); }
    const cards = wrap ? wrap.querySelectorAll(':scope > .card') : [];
    const gridCard = cards[0], detail = cards[1];
    out.layoutAfterSelect = wrap ? {
      oneCol: wrap.classList.contains('one-col'),
      cols: getComputedStyle(wrap).gridTemplateColumns,
      gridRight: gridCard ? Math.round(gridCard.getBoundingClientRect().right) : null,
      detailLeft: detail ? Math.round(detail.getBoundingClientRect().left) : null,
      detailRight: detail ? Math.round(detail.getBoundingClientRect().right) : null,
      detailPosition: detail ? getComputedStyle(detail).position : null,
      sideBySide: !!(gridCard && detail && detail.getBoundingClientRect().left >= gridCard.getBoundingClientRect().right - 2)
    } : null;

    // ---- 3) 纯色取值（跟随主题）----
    const grab = () => {
      const gd = document.querySelector('.gd-svg');
      const gi = document.querySelector('.gi-canvas');
      const p = document.querySelector('.gd-svg path') || document.querySelector('.gi-canvas path');
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        solidVar: getComputedStyle(document.documentElement).getPropertyValue('--glyph-solid').trim(),
        gdColor: gd ? getComputedStyle(gd).color : '—',
        giColor: gi ? getComputedStyle(gi).color : '—',
        pathFill: p ? getComputedStyle(p).fill : '—'
      };
    };
    await APP.setTheme('light'); await sleep(350);
    out.light = await grab();
    await APP.setTheme('dark'); await sleep(350);
    out.dark = await grab();
    return out;
  };
})();
