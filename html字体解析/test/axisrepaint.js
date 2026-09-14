/* =========================================================================
 * test/axisrepaint.js —— 拖动轴滑块后，"预览区里已经渲染好的那段文字"是否真的变了
 * 之前只验证了 CSS 文本与临时 span，这里直接量 .preview-sample 自身第一行的宽度。
 * 用法：await window.probeAxisRepaint()
 * ========================================================================= */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 量某个元素「第一行文本」的宽度（Range 只取到第一个换行符之前） */
  function firstLineWidth(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const tn = el.firstChild;
    if (!tn || tn.nodeType !== 3) return null;
    const s = tn.data;
    let end = s.indexOf('\n');
    if (end < 0) end = s.length;
    const r = document.createRange();
    r.setStart(tn, 0);
    r.setEnd(tn, end);
    const w = r.getBoundingClientRect();
    return { width: Math.round(w.width * 10) / 10, height: Math.round(w.height * 10) / 10 };
  }

  window.probeAxisRepaint = async function () {
    const ranges = [...document.querySelectorAll('.axis-range')];
    if (!ranges.length) return { error: '没有轴滑块' };
    const out = { steps: [] };
    const titles = ranges.map((r) => r.title);

    const sample = () => ({
      line1: firstLineWidth('.preview-sample'),
      pvLine1: firstLineWidth('.preview-multi .pv-line'),
      css: ((document.getElementById('previewStyle') || {}).textContent || '').slice(-90)
    });

    const set = async (rng, v) => {
      rng.value = String(v);
      rng.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(260);
    };

    // 优先用 wdth（会改字宽），否则第一个轴
    const idx = titles.findIndex((t) => t.indexOf('wdth') === 0);
    const rng = ranges[idx >= 0 ? idx : 0];
    out.axis = rng.title;

    await set(rng, rng.max);
    out.atMax = sample();
    await set(rng, rng.min);
    out.atMin = sample();
    await set(rng, rng.max);
    out.backToMax = sample();

    out.previewUpdates = !!(out.atMax.line1 && out.atMin.line1 &&
      (out.atMax.line1.width !== out.atMin.line1.width || out.atMax.line1.height !== out.atMin.line1.height));
    return out;
  };
})();
