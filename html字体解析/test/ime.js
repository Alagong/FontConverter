/* =========================================================================
 * test/ime.js —— 字形总览筛选框的输入法（IME）行为探针
 * 模拟：compositionstart → 多次 input（拼音字母）→ compositionend（选中汉字）
 * 关键断言：整个过程输入框 DOM 节点始终是同一个（没有被重绘替换），
 *          且组合期间网格不刷新、组合结束才刷新。
 * 用法：await window.probeIme()
 * ========================================================================= */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.probeIme = async function () {
    const out = { steps: [] };
    const inp = document.querySelector('.glyph-grid-filter');
    if (!inp) return { error: '未找到字形总览筛选框（先切到「字形总览」视图）' };
    const cntEl = () => document.querySelector('.glyph-grid-filter').closest('.card').querySelector('.matrix-count');
    const cells = () => document.querySelectorAll('.glyph-cell').length;

    out.beforeCount = cntEl().textContent;
    out.beforeCells = cells();

    const fire = (type, data) => {
      const ev = type === 'input'
        ? new InputEvent('input', { bubbles: true, data: data || null })
        : new CompositionEvent(type, { bubbles: true, data: data || '' });
      inp.dispatchEvent(ev);
    };

    // ---- 组合开始，逐个拼音字母 ----
    fire('compositionstart');
    for (const s of ['y', 'yo', 'yon', 'yong']) {          // yong → 永
      inp.value = s;
      fire('input', s);
      await sleep(60);
    }
    await sleep(220);
    out.during = {
      sameNode: document.querySelector('.glyph-grid-filter') === inp,
      count: cntEl().textContent,          // 组合期间应保持原样（未刷新）
      cells: cells()
    };

    // ---- 选词结束 ----
    inp.value = '永';
    fire('compositionend', '永');
    await sleep(320);
    out.afterComposition = {
      sameNode: document.querySelector('.glyph-grid-filter') === inp,
      count: cntEl().textContent,          // 此时应已刷新
      cells: cells(),
      value: document.querySelector('.glyph-grid-filter').value
    };

    // ---- 翻页 / 清除：输入框都不应被替换 ----
    const nextBtn = [...document.querySelectorAll('.glyph-nav .btn')].find((b) => b.textContent.trim() === '▶');
    if (nextBtn) {
      nextBtn.click();
      await sleep(160);
      out.afterPageNav = { sameNode: document.querySelector('.glyph-grid-filter') === inp };
    }
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(160);
    out.afterEscape = {
      sameNode: document.querySelector('.glyph-grid-filter') === inp,
      value: document.querySelector('.glyph-grid-filter').value,
      count: cntEl().textContent
    };

    // ---- 点击单元格：详情卡片出现，输入框仍在 ----
    const cell = document.querySelector('.glyph-cell');
    if (cell) {
      cell.click();
      await sleep(220);
      out.afterCellClick = {
        sameNode: document.querySelector('.glyph-grid-filter') === inp,
        selected: document.querySelectorAll('.glyph-cell.selected').length,
        detailVisible: (() => { const c = document.querySelectorAll('.card'); const d = c[c.length - 1]; return d ? d.style.display !== 'none' : false; })()
      };
    }
    return out;
  };
})();
