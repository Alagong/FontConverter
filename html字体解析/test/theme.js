/* =========================================================================
 * test/theme.js —— 主题切换探针
 * 用法：await window.probeTheme()
 * 返回两套主题下的关键颜色（用于人工/自动比对是否真的换肤、是否有对比度问题）
 * ========================================================================= */
(function () {
  const pick = () => {
    const cs = getComputedStyle(document.body);
    const card = document.querySelector('.card');
    const btn = document.querySelector('.btn');
    const svgPath = document.querySelector('.gd-svg path, .gi-canvas path');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      label: (document.getElementById('themeText') || {}).textContent,
      stored: (() => { try { return localStorage.getItem('fontlab-theme'); } catch (e) { return 'n/a'; } })(),
      metaTheme: (document.getElementById('metaTheme') || {}).content,
      bodyInk: cs.color,
      bodyBg: cs.backgroundImage.slice(0, 60),
      cardBg: card ? getComputedStyle(card).backgroundColor + ' | ' + getComputedStyle(card).borderColor : '—',
      cardInk: card ? getComputedStyle(card).color : '—',
      btnBg: btn ? getComputedStyle(btn).backgroundColor + ' / ' + getComputedStyle(btn).color : '—',
      matrixHead: (() => { const th = document.querySelector('.matrix-table th'); return th ? getComputedStyle(th).backgroundImage.slice(0, 40) + ' / ' + getComputedStyle(th).color : '—'; })(),
      glyphFill: svgPath ? getComputedStyle(svgPath).fill : '—',
      sideSearchBg: (() => { const el = document.querySelector('.side-search'); return el ? getComputedStyle(el).backgroundColor : '—'; })()
    };
  };

  window.probeTheme = async function () {
    const out = { steps: [] };
    out.initial = pick();
    document.getElementById('btnTheme').click();
    await new Promise((r) => setTimeout(r, 420));
    out.afterToggle = pick();
    document.getElementById('btnTheme').click();
    await new Promise((r) => setTimeout(r, 420));
    out.afterToggleBack = pick();
    // 直接设置（供截图用）
    window.__setTheme = (t) => APP.setTheme(t);
    return out;
  };
})();
