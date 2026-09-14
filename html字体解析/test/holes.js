/* =========================================================================
 * test/holes.js —— 检查"字怀（洞）"是否被正确挖空
 *
 * 原理：TrueType/OpenType 用**非零环绕**规则 —— 外轮廓与字怀轮廓方向相反。
 *     1) 用鞋带公式算每个轮廓的带符号面积，找出与"最大轮廓（外轮廓）"方向相反的那些；
 *     2) 这些轮廓内部应该**透明**（被挖空）；
 *     3) 同时统计整体不透明像素比例，防止"什么都没画出来"。
 * 若把每个轮廓拆成独立 <path> 各自填充，字怀就会被填实 → 步骤 2 失败。
 *
 * 用法：await window.probeHoles(['0','O','8','B','口','回','日'])
 * ========================================================================= */
(function () {
  /** 轮廓带符号面积（字体单位，y 向上） */
  function signedArea(gl, c) {
    let a = 0;
    for (let i = c.start; i <= c.end; i++) {
      const j = i === c.end ? c.start : i + 1;
      a += gl.xs[i] * gl.ys[j] - gl.xs[j] * gl.ys[i];
    }
    return a / 2;
  }
  /** 轮廓点的平均值（对凸形状来说落在内部，足够作为"取样点"） */
  function centerOf(gl, c) {
    let x = 0, y = 0, n = c.end - c.start + 1;
    for (let i = c.start; i <= c.end; i++) { x += gl.xs[i]; y += gl.ys[i]; }
    return [x / n, y / n];
  }

  window.probeHoles = async function (chars) {
    const FL = window.FL, FNT = FL.font, f = APP.font;
    if (!f) return { error: '未打开字体' };
    const cm = FNT.cmapMap(f);
    const all = FL.glyfParse(f);
    if (!cm || !all) return { error: '无 cmap 或 glyf' };

    const W = 220, H = 220;
    const list = chars || ['0', 'O', 'o', '8', 'B', 'g', '口', '回', '日', '田', '國'];
    const items = [];

    for (const ch of list) {
      const gid = cm.get(ch.codePointAt(0));
      const gl = gid == null ? null : all.glyphs[gid];
      if (!gl || !gl.contours || gl.contours.length < 2) continue;

      let svg = (FL.glyphSVG(f, gid, { color: '#000000' }).svg) || '';
      if (!svg) continue;
      const vb = /viewBox="([^"]+)"/.exec(svg)[1].trim().split(/\s+/).map(Number);
      svg = svg.replace(/width="100%"/, 'width="' + W + '"').replace(/height="100%"/, 'height="' + H + '"')
        .replace(/<svg([^>]*)>/, '<svg$1 preserveAspectRatio="none">');
      const img = new Image();
      try {
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error('SVG 栅格化失败'));
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/#/g, '%23'));
        });
      } catch (e) { items.push({ ch: ch, gid: gid, error: e.message }); continue; }

      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);

      // viewBox → 画布像素。
      // SVG 内部用 scale(1,-1) 翻转，所以字体坐标 y 对应 SVG 的 -y；
      // viewBox 的 y 区间是 [-y0-h, -y0]，换算后：py = (-vb[1] - y) / vb[3] * H
      const toPx = (x, y) => [
        Math.round((x - vb[0]) / vb[2] * W),
        Math.round((-vb[1] - y) / vb[3] * H)
      ];

      // 找外轮廓（面积绝对值最大），其余方向相反的就是字怀
      let outer = 0, maxA = 0;
      gl.contours.forEach((c, i) => { const a = Math.abs(signedArea(gl, c)); if (a > maxA) { maxA = a; outer = i; } });
      const outerSign = Math.sign(signedArea(gl, gl.contours[outer]));
      const holeIdx = [];
      gl.contours.forEach((c, i) => { if (i !== outer && Math.sign(signedArea(gl, c)) === -outerSign) holeIdx.push(i); });

      const holes = holeIdx.map((i) => {
        const [x, y] = centerOf(gl, gl.contours[i]);
        const [px, py] = toPx(x, y);
        if (px < 0 || py < 0 || px >= W || py >= H) return { idx: i, alpha: -1, oob: true };
        return { idx: i, alpha: ctx.getImageData(px, py, 1, 1).data[3] };
      });

      // 整体覆盖率，防止"空图"
      const data = ctx.getImageData(0, 0, W, H).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 128) opaque++;
      const coverage = +(opaque / (W * H)).toFixed(4);

      items.push({
        ch: ch, gid: gid, contours: gl.contours.length, holes: holes.length,
        holeAlphas: holes.map((h) => h.alpha),
        coverage: coverage,
        // 字怀必须透明，且整体确实画出了东西
        ok: holes.every((h) => h.alpha >= 0 && h.alpha < 40) && coverage > 0.03
      });
    }
    const checked = items.filter((x) => !x.error);
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      items: items,
      allOK: checked.length > 0 && checked.every((x) => x.ok)
    };
  };
})();
