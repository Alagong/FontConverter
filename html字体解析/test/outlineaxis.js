/* =========================================================================
 * test/outlineaxis.js —— 端到端：轮廓模式下拖动轴滑块，预览内容是否真的变了
 * 用法：切到"字体预览"后 await window.probeOutlineAxis()
 * ========================================================================= */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.probeOutlineAxis = async function () {
    const out = {};
    // 强制轮廓模式（模拟"浏览器拒绝加载该字体"）
    APP.previewMode = 'outline';
    APP.fontLoadOK = false;
    APP.state.axes = {};
    document.querySelector('#tabs button[data-view=tables]').click();
    await sleep(300);
    document.querySelector('#tabs button[data-view=preview]').click();
    await sleep(800);

    const sample = () => {
      const el = document.querySelector('#previewSample');
      if (!el) return null;
      const svg = el.querySelector('svg');
      return {
        svgCount: document.querySelectorAll('.outline-svg').length,
        dLen: svg ? (svg.innerHTML.match(/d="[^"]*"/) || [''])[0].length : 0,
        svgLen: svg ? svg.innerHTML.length : 0,
        sig: svg ? svg.innerHTML.slice(0, 120) + '|' + svg.innerHTML.length : 'none'
      };
    };

    out.mode = APP.previewMode;
    out.before = sample();

    const ranges = [...document.querySelectorAll('.axis-range')];
    out.axes = ranges.map((r) => r.title);
    const rng = ranges[0];

    const move = async (v) => {
      rng.value = String(v);
      rng.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(450);
      return sample();
    };

    out.atMax = await move(rng.max);
    out.atMin = await move(rng.min);
    out.varAxes = JSON.stringify(APP.font.varAxes || {});
    out.previewUpdates = !!(out.atMax && out.atMin && out.atMax.sig !== out.atMin.sig);
    out.allSamplesDiffer = !!(out.before && out.atMax && out.atMin &&
      out.before.sig !== out.atMax.sig && out.atMax.sig !== out.atMin.sig);
    return out;
  };
})();
