/* =========================================================================
 * test/axes.js —— 可变字体轴滑块探针
 * 用法：await window.probeAxes()
 * 客观验证：把同一段文字在轴的最小值 / 默认值 / 最大值下各测一次宽度，
 *          宽度必须随轴值变化（说明 font-variation-settings 真的生效了）。
 * ========================================================================= */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.probeAxes = async function () {
    const panel = document.querySelector('.axes-panel');
    if (!panel) return { error: '当前字体没有可变轴面板（或无 fvar 表）' };
    const ranges = [...document.querySelectorAll('.axis-range')];
    const labels = [...document.querySelectorAll('.axis-label')].map((x) => x.textContent);
    const titles = ranges.map((x) => x.title);

    // 用真实 CSS 管线测量：给临时 span 挂上 .gc-char（命中预览字体 + font-variation-settings 规则）
    const probeSpan = document.createElement('span');
    probeSpan.className = 'gc-char';
    probeSpan.textContent = 'Hamburgefonstiv 12345';
    probeSpan.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:64px;line-height:1;white-space:nowrap;display:inline-block;';
    document.body.appendChild(probeSpan);
    const measure = () => Math.round(probeSpan.getBoundingClientRect().width);

    // 选一个"会改变字宽"的轴来量宽度：优先 wdth，否则用第一个轴
    const wdthIdx = titles.findIndex((t) => t.indexOf('wdth') === 0);
    const first = ranges[wdthIdx >= 0 ? wdthIdx : 0];
    const tag = /^([^：]+)/.exec(first.title)[1];
    const setAxis = async (v) => {
      first.value = String(v);
      first.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(180);
      return measure();
    };
    const wMin = await setAxis(first.min);
    const wMax = await setAxis(first.max);
    probeSpan.remove();

    // 拖动第一个滑块到最大值，检查状态与 CSS 同步
    first.value = first.max;
    first.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
    const readout = first.parentElement.querySelector('.axis-val').textContent;
    const css = (document.getElementById('previewStyle') || {}).textContent || '';

    // 命名实例：选第一个，看是否把各轴写到实例坐标
    const sel = document.querySelector('.axes-instance');
    let instanceApplied = null;
    if (sel && sel.options.length > 1) {
      sel.value = '1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      instanceApplied = {
        name: sel.options[1].text,
        values: ranges.map((r) => r.parentElement.querySelector('.axis-val').textContent),
        css: (document.getElementById('previewStyle') || {}).textContent || ''
      };
    }

    return {
      theme: document.documentElement.getAttribute('data-theme'),
      sliderCount: ranges.length,
      titles: titles,
      labels: labels,
      instances: sel ? sel.options.length - 1 : 0,
      widthAtMin: wMin,
      widthAtMax: wMax,
      widthChanges: wMin !== wMax,
      readoutAfterDrag: readout,
      cssHasVariation: /font-variation-settings/.test(css),
      css: css,
      instanceApplied: instanceApplied,
      outlineMode: APP.previewMode === 'outline'
    };
  };
})();
