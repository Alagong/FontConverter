/* =========================================================================
 * test/contrast.js —— 主题可读性检查：计算关键元素的文字/背景对比度
 * 用法：await window.probeContrast()
 * 说明：background 取"元素自身背景"；若为透明则回退到主题基色（由调用方给出）。
 *       对比度按 WCAG 公式计算，正文建议 ≥ 4.5，小字/次要文本至少 ≥ 3。
 * ========================================================================= */
(function () {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({      // fg 叠在 bg 上
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
  };

  window.probeContrast = function (baseHex) {
    const base = parse('rgb(' + baseHex.split(',').join(',') + ')');
    const selectors = [
      '.fi-name', '.fi-sub', '.brand-sub', '.build-tag', '.tabs button', '.btn',
      '.side-search', '.side-search::placeholder', '.ti-tag', '.ti-label', '.ti-meta',
      '.ti-badge', '.edit-count', '.edit-item', '.card-desc', '.note-info', '.note-warn',
      '.th-tag', '.th-name', '.th-meta', '.th-desc', '.fields-table th', '.f-label', '.f-name', '.f-off',
      '.field-value', '.field-input', '.field-display', '.chip',
      '.matrix-filter', '.matrix-count', '.matrix-table th', '.matrix-table td', '.hex-byte', '.hex-ascii',
      '.opt', '.muted', '.preview-sample'
    ];
    const out = [];
    selectors.forEach((sel) => {
      if (sel.indexOf('::') >= 0) return;                    // 伪元素单独处理
      const el = document.querySelector(sel);
      if (!el) return;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) return;
      let bg = parse(cs.backgroundColor);
      let bgSrc = '元素';
      if (!bg || bg.a < 1) {
        // 向上找第一个不透明背景
        let node = el.parentElement, found = null;
        while (node && node !== document.documentElement) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c && c.a === 1) { found = c; break; }
          node = node.parentElement;
        }
        bg = found ? (bg ? over(bg, found) : found) : (bg ? over(bg, base) : base);
        bgSrc = found ? '祖先' : '主题基色';
      }
      out.push({
        sel: sel,
        fg: cs.color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        bgSrc: bgSrc,
        ratio: +ratio(fg, bg).toFixed(2)
      });
    });
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      low: out.filter((x) => x.ratio < 3.5).sort((a, b) => a.ratio - b.ratio),
      lowText: out.filter((x) => x.ratio < 4.5).sort((a, b) => a.ratio - b.ratio),
      all: out.sort((a, b) => a.ratio - b.ratio),
      count: out.length
    };
  };
})();
