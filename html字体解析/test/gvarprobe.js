/* =========================================================================
 * test/gvarprobe.js —— 轮廓模式下的可变插值（gvar）验证
 * 直接调用 FL.outlineTextSVG（即"轮廓预览"用的渲染器），比较不同轴值下的：
 *   · SVG 路径是否不同
 *   · 栅格化后的墨迹像素数（更粗的轴值应该有更多墨迹）
 * 用法：await window.probeGvar()
 * ========================================================================= */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function inkOf(svg) {
    if (!svg) return -1;
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('SVG 栅格化失败'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/#/g, '%23'));
    });
    const w = img.naturalWidth || 600, h = img.naturalHeight || 200;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) n++;
    return n;
  }

  window.probeGvar = async function () {
    const f = APP.font, FL = window.FL;
    if (!f) return { error: '未打开字体' };
    if (!FL.gvar) return { error: 'gvar.js 未加载' };
    if (!FL.gvar.ready(f)) return { error: '该字体没有可用的 fvar + gvar + glyf 组合' };
    const va = FL.font.variableAxes(f);
    const pick = va.axes.find((a) => a.tag.trim() === 'wght') || va.axes[0];
    const tag = pick.tag.trim();

    const at = async (v) => {
      f.varAxes = {};
      f.varAxes[tag] = v;
      f._gvarCtx = null;                      // 清掉上一次的插值缓存
      const o = FL.outlineTextSVG(f, 'Hamburgefonstiv', 72);
      return { svg: o ? o.svg : null, ink: o ? await inkOf(o.svg) : -1, pathLen: o && o.svg ? o.svg.length : 0 };
    };

    const lo = await at(pick.min);
    const mid = await at(pick.def);
    const hi = await at(pick.max);
    f.varAxes = {};                            // 收尾：恢复默认（不加轴）

    return {
      tag: tag,
      range: [pick.min, pick.def, pick.max],
      ink: { min: lo.ink, def: mid.ink, max: hi.ink },
      pathLen: { min: lo.pathLen, def: mid.pathLen, max: hi.pathLen },
      svgDiffers: lo.svg !== hi.svg,
      inkIncreases: lo.ink < hi.ink,
      ok: lo.svg !== hi.svg && lo.ink < hi.ink
    };
  };
})();
