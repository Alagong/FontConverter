/* =========================================================================
 * app.js —— 界面逻辑
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const FNT = FL.font;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /** 预览字体族名（用不常见的名字，避免与系统字体冲突） */
  const PREVIEW_FAMILY = 'FontLabPreview';

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) el.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  /** Uint8Array → base64（分块，避免大字体触发参数长度限制） */
  function bytesToBase64(bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }

  const app = {
    font: null,
    view: 'tables',
    tag: null,
    tab: 'parsed',            // parsed | hex
    state: {},                // per-table UI 状态（分页/筛选等）
    previewFace: null,
    previewFamily: null,
    glyphPage: 0,
    glyphFilter: '',
    selectedGid: null
  };
  window.APP = app;

  /** 构建标识：用于确认浏览器加载的是最新脚本（避免 file:// 下命中旧缓存） */
  app.BUILD = '20260914y';
  (function markBuild() {
    const tag = document.getElementById('buildTag');
    if (tag) tag.textContent = ' ' + app.BUILD;
    try { console.log('%c FontLab build ' + app.BUILD, 'color:#5b8cff'); } catch (e) { /* 忽略 */ }
  })();

  /* =====================================================================
   * 主题（暗色 / 亮色）
   * ---------------------------------------------------------------------
   * 颜色全部来自 css/style.css 里的变量，切换 <html data-theme> 即可换肤：
   * 内联 SVG（字形轮廓）也用 var(--glyph-*) 上色，所以无需重绘任何内容。
   * =================================================================== */
  const THEME_KEY = 'fontlab-theme';
  const THEME_ICONS = {
    // 月亮（当前为暗色，点击切到亮色）
    dark: '<path d="M12 3.2a6.6 6.6 0 0 0 8.8 8.8 9 9 0 1 1-8.8-8.8Z"/>',
    // 太阳（当前为亮色，点击切到暗色）
    light: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"/>'
  };
  const THEME_META = { dark: '#070b16', light: '#f6f8fc' };

  app.THEME_KEY = THEME_KEY;
  app.getTheme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  /**
   * 应用主题
   * @param {'light'|'dark'} theme
   * @param {{persist?:boolean}} [opts] persist:false 用于初始化（不覆盖用户的系统偏好判断）
   */
  app.setTheme = function (theme, opts) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    if (!opts || opts.persist !== false) {
      try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 隐私模式等忽略 */ }
    }
    const icon = $('#themeIcon');
    if (icon) icon.innerHTML = THEME_ICONS[t];
    const label = $('#themeText');
    if (label) label.textContent = t === 'light' ? '亮色' : '暗色';
    const meta = $('#metaTheme');
    if (meta) meta.setAttribute('content', THEME_META[t]);
    return t;
  };

  app.toggleTheme = function () {
    const next = app.getTheme() === 'light' ? 'dark' : 'light';
    app.setTheme(next);
    if (typeof app.toast === 'function') app.toast(next === 'light' ? '已切换到亮色主题' : '已切换到暗色主题');
    return next;
  };

  // 同步按钮图标/标签与 <meta theme-color>（主题本身已由 index.html 的内联脚本提前设好）
  app.setTheme(app.getTheme(), { persist: false });

  /* =====================================================================
   * 打开文件
   * =================================================================== */
  async function openFile(file) {
    if (!file) return;
    app.toast('正在读取 ' + file.name + ' …');
    try {
      let buf = new Uint8Array(await file.arrayBuffer());
      if (FL.sfnt.isWOFF(buf) || (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x32)) {
        if (buf[3] === 0x32) throw new Error('WOFF2 使用 Brotli 压缩与字形变换，本工具暂不支持。请先转换为 TTF/OTF。');
        app.toast('检测到 WOFF，正在解压…');
        const res = await FL.sfnt.woffToSfnt(buf);
        buf = res.sfntBytes;
      }
      setFont(buf, file.name);
    } catch (e) {
      app.toast('打开失败：' + e.message, 'error');
      console.error(e);
    }
  }

  function setFont(bytes, name, fontIndex) {
    app.rawBytes = bytes;
    app.fileName = name;
    app.fontIndex = fontIndex || 0;
    const f = FNT.parse(bytes, name, app.fontIndex);
    app.font = f;
    app.tag = null;
    app.state = {};
    purgePreviewFaces();
    app.previewFace = null;
    app.fontLoadOK = null;
    app.fontLoadErr = null;
    app.previewMode = null;      // font | outline | none
    app.selectedGid = null;
    app.state.axes = {};         // 可变字体各轴的当前取值（每次打开字体重置）
    app.glyphPage = 0;
    app.glyphFilter = '';
    document.body.classList.add('has-font');
    renderFileInfo();
    renderSidebar();
    // 自动选中第一个表或 head
    const first = ['head', 'hhea', 'maxp'].find((t) => f.tableMap[t]) || (f.tables[0] && f.tables[0].tag);
    if (first) selectTable(first);
    else renderContent();
    const gd = FL.glyfParse(f);
    app.toast('已打开 ' + name + '：' + f.tables.length + ' 张表，' + (f.numGlyphs || '?') + ' 个字形' +
      (f.collection ? '（TTC 第 ' + (f.fontIndex + 1) + ' 个字体）' : ''));
    if (gd) {
      // 预热字形缓存（供 hmtx 显示 RSB）
      renderSidebar();
    }
  }

  function renderFileInfo() {
    const f = app.font;
    const box = $('#fileInfo');
    if (!f) { box.innerHTML = '<span class="muted">未打开字体</span>'; return; }
    const nameInfo = FNT.tableInfo(f, 'name');
    let family = '', version = '';
    if (nameInfo && nameInfo.model && nameInfo.model.records) {
      const pick = (id) => {
        const list = nameInfo.model.records.filter((r) => r.nameID === id);
        const r0 = list.find((x) => x.platformID === 3 && x.languageID === 0x0409) || list.find((x) => x.platformID === 3) || list[0];
        return r0 ? r0.text : '';
      };
      family = pick(1) || pick(4);
      version = pick(5);
    }
    box.innerHTML =
      '<div class="fi-name">' + (family || f.fileName || '（未命名字体）') + '</div>' +
      '<div class="fi-sub">' + [
        f.fileName,
        (f.fileSize / 1024).toFixed(1) + ' KB',
        f.sfntVersionText,
        f.numGlyphs ? f.numGlyphs + ' 字形' : '',
        f.unitsPerEm ? 'UPM ' + f.unitsPerEm : '',
        version
      ].filter(Boolean).join(' · ') + '</div>';

    // TTC：允许切换集合内的字体
    if (f.collection && f.collection.numFonts > 1) {
      const sel = h('select', { class: 'ttc-select', title: '该文件是字体集合（TTC），可切换其中的字体' });
      for (let i = 0; i < f.collection.numFonts; i++) {
        const opt = h('option', { value: i, text: '集合内字体 #' + (i + 1) });
        if (i === f.fontIndex) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        if (app.font.edits.length || app.font.glyfDirty || Object.keys(app.font.rebuilds).length) {
          if (!confirm('切换字体会丢失当前未保存的修改，是否继续？')) { sel.value = app.fontIndex; return; }
        }
        setFont(app.rawBytes, app.fileName, +sel.value);
      });
      const line = h('div', { class: 'fi-ttc' }, [
        h('span', { class: 'muted small', text: 'TTC 字体集合：共 ' + f.collection.numFonts + ' 个字体 ' }),
        sel
      ]);
      box.appendChild(line);
    }
  }

  /* =====================================================================
   * 侧边栏（表列表）
   * =================================================================== */
  function renderSidebar() {
    const f = app.font;
    const side = $('#sidebar');
    side.innerHTML = '';
    if (!f) return;
    const search = h('input', { class: 'side-search', placeholder: '搜索表（标签 / 名称）…', value: app.state.tableFilter || '' });
    // 输入法组合期间不重绘列表，避免选词时列表跟着跳
    let sideComposing = false;
    search.addEventListener('compositionstart', () => { sideComposing = true; });
    search.addEventListener('compositionend', () => {
      sideComposing = false;
      app.state.tableFilter = search.value;
      renderTableList();
    });
    search.addEventListener('input', (e) => {
      app.state.tableFilter = search.value;
      if (sideComposing || (e && e.isComposing)) return;
      renderTableList();
    });
    side.appendChild(search);
    const list = h('div', { class: 'table-list', id: 'tableList' });
    side.appendChild(list);
    const edits = h('div', { class: 'side-footer', id: 'sideFooter' });
    side.appendChild(edits);
    renderTableList();
    renderSideFooter();
  }

  function renderTableList() {
    const f = app.font;
    const list = $('#tableList');
    if (!list || !f) return;
    const q = (app.state.tableFilter || '').toLowerCase();
    list.innerHTML = '';
    f.tables.forEach((t) => {
      const info = U.TABLE_INFO[t.tag] || {};
      const txt = (t.tag + ' ' + (info.name || '')).toLowerCase();
      if (q && txt.indexOf(q) < 0) return;
      const el = h('div', {
        class: 'table-item' + (app.tag === t.tag ? ' active' : ''),
        onclick: () => selectTable(t.tag)
      }, [
        h('div', { class: 'ti-tag', title: '表标签' }, [
          h('span', { text: t.tag }),
          f.rebuilds[t.tag] ? h('i', { class: 'dot', title: '有未保存的修改，保存时会重建该表' }) : null
        ]),
        h('div', { class: 'ti-body' }, [
          h('div', { class: 'ti-name' }, [
            h('span', { class: 'ti-label', text: info.name || '（未知表）' }),
            f.glyfDirty && t.tag === 'glyf' ? h('span', { class: 'ti-badge info', text: '已改动' }) : null
          ]),
          h('div', { class: 'ti-meta', text: t.length + ' B  ·  @' + t.offset })
        ])
      ]);
      el.title = (info.desc || '') + '\n长度：' + t.length + ' 字节';
      list.appendChild(el);
    });
  }

  function renderSideFooter() {
    const f = app.font;
    const box = $('#sideFooter');
    if (!box || !f) return;
    const n = f.edits.length;
    const rebuilds = Object.keys(f.rebuilds);
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'edit-count' }, [
      h('span', { text: '待保存修改：' }),
      h('b', { text: String(n + (f.glyfDirty ? 1 : 0)) })
    ]));
    if (rebuilds.length) {
      box.appendChild(h('div', {
        class: 'small muted',
        text: '需要重建的表：' + rebuilds.join('、') + (f.glyfDirty ? '、glyf' : '')
      }));
    }
    if (n) {
      box.appendChild(h('div', { class: 'edit-list' }, f.edits.slice(-12).reverse().map((e) =>
        h('div', { class: 'edit-item', title: e.detail }, [h('b', { text: e.tag }), ' ' + e.label]))));
      box.appendChild(h('button', { class: 'btn small danger', text: '撤销全部修改', onclick: () => {
        FNT.undoAll(f);
        app.parsedCacheClear();
        renderFileInfo(); renderSidebar(); renderContent();
        app.toast('已撤销全部修改');
      } }));
    }
    // 有未保存修改时让「保存为字体」按钮呼吸发光
    const saveBtn = $('#btnSave');
    if (saveBtn) saveBtn.classList.toggle('has-changes', n + (f.glyfDirty ? 1 : 0) > 0);
    if (f.glyfDirty) {
      box.appendChild(h('button', { class: 'btn small danger', text: '放弃字形修改', title: '清除所有字形的"已修改"标记，不再重建 glyf 表', onclick: () => {
        const gd = FL.glyfParse(f);
        if (gd) gd.glyphs.forEach((gl) => { gl.dirty = false; });
        f.glyfDirty = false;
        renderSideFooter(); renderContent();
        app.toast('已放弃字形修改');
      } }));
    }
  }

  app.parsedCacheClear = function () {
    const f = app.font;
    if (!f) return;
    f.parsed = {};
    f._names = null;
    f._cmapMap = null;
    f._cmapRaw = null;
    f._gidChars = null;
    f._gidCharMap = null;
    f.tables.forEach((t) => { t._model = null; });
  };

  /* =====================================================================
   * 主内容区
   * =================================================================== */
  function selectTable(tag) {
    app.tag = tag;
    app.tab = 'parsed';
    app.state = app.state || {};
    renderSidebar();
    renderContent();
  }

  function renderContent() {
    const f = app.font;
    const main = $('#content');
    main.innerHTML = '';
    if (!f) {
      main.innerHTML = '<div class="empty-state"><h2>打开一个字体文件开始探索</h2>' +
        '<p>支持 TrueType（.ttf）、OpenType/CFF（.otf）、字体集合（.ttc）与 WOFF（.woff）。</p>' +
        '<p class="muted">拖拽文件到窗口任意位置，或点击右上角「打开字体」。</p></div>';
      return;
    }
    if (app.view === 'preview') { renderPreview(main); return; }
    if (app.view === 'glyphs') { renderGlyphGrid(main); return; }
    if (app.view === 'changes') { renderChanges(main); return; }
    if (!app.tag) { main.innerHTML = '<div class="empty-state"><p>请选择左侧的一张表。</p></div>'; return; }

    const t = f.tableMap[app.tag];
    const info = U.TABLE_INFO[app.tag] || {};
    const head = h('div', { class: 'table-head' }, [
      h('div', { class: 'th-title' }, [
        h('span', { class: 'th-tag', text: app.tag }),
        h('span', { class: 'th-name', text: info.name || '（未知表）' })
      ]),
      h('div', { class: 'th-meta', html:
        '长度 <b>' + t.length + '</b> 字节 · 偏移 <b>' + t.offset + '</b>' +
        (f.rebuilds[app.tag] ? ' · <span class="warn">待重建：' + f.rebuilds[app.tag] + '</span>' : '') +
        (app.tag === 'glyf' && f.glyfDirty ? ' · <span class="warn">有字形被修改，保存时将重建</span>' : '') })
    ]);
    if (info.desc) head.appendChild(h('p', { class: 'th-desc', text: info.desc }));
    main.appendChild(head);

    const tabs = h('div', { class: 'subtabs' }, [
      h('button', { class: app.tab === 'parsed' ? 'active' : '', text: '解析视图', onclick: () => { app.tab = 'parsed'; renderContent(); } }),
      h('button', { class: app.tab === 'hex' ? 'active' : '', text: '原始数据（可编辑）', onclick: () => { app.tab = 'hex'; renderContent(); } })
    ]);
    main.appendChild(tabs);

    if (app.tab === 'hex') { renderHex(main, t); return; }

    const res = FNT.tableInfo(f, app.tag);
    if (!res) { main.appendChild(h('p', { class: 'muted', text: '无法解析该表。' })); return; }
    // 相邻的 pair-left / pair-right 分区会并排渲染（左：列表；右：检查器，随页面吸顶）
    const secs = res.sections.filter(Boolean);
    for (let i = 0; i < secs.length; i++) {
      const sec = secs[i];
      const next = secs[i + 1];
      if (sec.layout === 'pair-left' && next && next.layout === 'pair-right') {
        const grid = h('div', { class: 'split-2col' });
        grid.appendChild(renderSection(sec, t, res));
        grid.appendChild(renderSection(next, t, res));
        main.appendChild(grid);
        i++;
      } else {
        main.appendChild(renderSection(sec, t, res));
      }
    }
  }

  /* ---------------------------------------------------------------------
   * 分区渲染
   * ------------------------------------------------------------------- */
  function renderSection(sec, table, res) {
    const wrap = h('section', { class: 'card sec-' + sec.kind });
    if (sec.title) {
      wrap.appendChild(h('div', { class: 'card-head' }, [
        h('h3', { text: sec.title }),
        sec.description ? h('p', { class: 'card-desc', text: sec.description }) : null
      ]));
    }
    if (sec.kind === 'note') {
      wrap.appendChild(h('div', { class: 'note note-' + (sec.level || 'info'), text: sec.text }));
      return wrap;
    }
    if (sec.kind === 'fields') {
      const tb = h('table', { class: 'fields-table' });
      tb.appendChild(h('thead', null, [h('tr', null, [
        h('th', { text: '名称', class: 'c1' }),
        h('th', { text: '值', class: 'c2' }),
        h('th', { text: '说明', class: 'c3' })
      ])]));
      const tbody = h('tbody');
      sec.fields.forEach((fld) => tbody.appendChild(renderFieldRow(fld, table, res)));
      tb.appendChild(tbody);
      wrap.appendChild(tb);
      return wrap;
    }
    if (sec.kind === 'matrix') {
      wrap.appendChild(renderMatrix(sec, table, res));
      return wrap;
    }
    if (sec.kind === 'custom') {
      const box = h('div', { class: 'custom-box' });
      wrap.appendChild(box);
      try {
        sec.mount(box, {
          font: app.font, table: table, app: app, state: app.state,
          markRebuild: (tag, reason) => app.markRebuild(tag, reason),
          refresh: () => refreshKeepingScroll()
        });
      } catch (e) {
        box.innerHTML = '<p class="muted">自定义视图渲染失败：' + e.message + '</p>';
      }
      return wrap;
    }
    return wrap;
  }

  function fieldInputType(fld) {
    switch (fld.type) {
      case 'fixed': case 'ufixed': case 'f2dot14': return { type: 'number', step: '0.00001' };
      case 'longdatetime': return { type: 'datetime-local' };
      case 'tag': return { type: 'text', maxlength: 4 };
      default:
        if (fld.type === 'text' || fld.editKind) return { type: 'text' };
        return { type: 'number', step: '1' };
    }
  }

  function renderFieldRow(fld, table, res) {
    const tr = h('tr', { class: fld.editable ? 'editable' : '' });
    tr.appendChild(h('td', { class: 'c1' }, [
      h('div', { class: 'f-label', text: fld.label || fld.name || '' }),
      fld.name && fld.name !== '—' ? h('div', { class: 'f-name', text: fld.name }) : null,
      fld.offset != null ? h('div', { class: 'f-off', text: '偏移 ' + fld.offset + '（' + fld.size + 'B, ' + fld.type + '）' }) : null
    ]));
    const valCell = h('td', { class: 'c2' });
    if (fld.editable) {
      const it = fieldInputType(fld);
      let inputValue;
      if (fld.type === 'longdatetime') inputValue = U.longDateTimeToDate(fld.value).toISOString().slice(0, 16);
      else inputValue = fld.value;
      const inp = h('input', { class: 'field-input', type: it.type, step: it.step, maxlength: it.maxlength, value: inputValue });
      inp.addEventListener('change', () => app.editField(fld, inp, valCell, table, res));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      valCell.appendChild(inp);
      const disp = h('div', { class: 'field-display', text: fld.display });
      valCell.appendChild(disp);
      fld._dispEl = disp;
    } else {
      valCell.appendChild(h('div', { class: 'field-value', text: fld.display }));
      if (fld.bits && fld.value) {
        const chips = h('div', { class: 'bits' });
        for (const k in fld.bits) if (fld.value & (1 << Number(k))) chips.appendChild(h('span', { class: 'chip', text: fld.bits[k] }));
        if (chips.childNodes.length) valCell.appendChild(chips);
      }
    }
    tr.appendChild(valCell);
    tr.appendChild(h('td', { class: 'c3', text: fld.description || '' }));
    return tr;
  }

  app.editField = function (fld, input, valCell, table, res) {
    const f = app.font;
    let value;
    if (fld.type === 'longdatetime') {
      const d = new Date(input.value + ':00Z');
      if (isNaN(d.getTime())) { app.toast('日期格式无效', 'error'); return; }
      value = U.dateToLongDateTime(d);
    } else if (fld.editKind || fld.type === 'text' || fld.type === 'tag') {
      value = input.value;
    } else {
      value = fld.type === 'fixed' || fld.type === 'ufixed' || fld.type === 'f2dot14'
        ? parseFloat(input.value) : parseInt(input.value, 10);
      if (isNaN(value)) { app.toast('请输入有效数字', 'error'); return; }
    }
    const mod = FL.tables[table.tag];
    if (fld.editKind && mod && mod.edit) {
      const r = mod.edit(f, table, { field: fld }, value);
      if (r && r.error) { app.toast(r.error, 'error'); return; }
      if (!r) { app.toast('该字段无法修改', 'error'); return; }
      app.markRebuild(table.tag, '已修改 ' + fld.label);
      app.toast('已修改：' + fld.label);
      refreshKeepingScroll();
      return;
    }
    if (fld.offset == null) { app.toast('该字段不可直接修改', 'error'); return; }
    const r = FNT.patch(f, table.tag, fld.offset, fld.type, value, { label: fld.label, detail: fld.type + ' @' + fld.offset });
    if (r.error) { app.toast(r.error, 'error'); return; }
    fld.value = value;
    fld.display = FL.tables.helper.display(fld);
    if (fld._dispEl) fld._dispEl.textContent = fld.display;
    // 特殊影响：hhea.numberOfHMetrics → 需要重建 hmtx
    if (table.tag === 'hhea' && fld.name === 'numberOfHMetrics') app.markRebuild('hmtx', 'numberOfHMetrics 已改变');
    if (table.tag === 'head' && fld.name === 'indexToLocFormat') app.toast('提示：loca 表格式与数据必须匹配，随意修改可能导致字体损坏', 'warn');
    app.toast('已修改：' + fld.label + ' → ' + fld.display);
    renderSideFooter();
  };

  /* ---------------------------------------------------------------------
   * 矩阵渲染
   * ------------------------------------------------------------------- */
  function renderMatrix(sec, table, res) {
    // 说明：sec.rows 中的额外字段（如字形列表的 codes）不显示为列，但会参与筛选
    const f = app.font;
    const stateKey = table.tag + '#' + (sec.title || '') + '#' + (sec.subId || '');
    const st = (app.state[stateKey] = app.state[stateKey] || {
      filter: '', limit: sec.pageSize ? (sec.pageSize || 100) : 0, pageSize: sec.pageSize
    });
    const box = h('div', { class: 'matrix-box' });
    const bar = h('div', { class: 'matrix-bar' });
    const allRows = sec.rows || [];

    /** 按当前筛选词从全量行中过滤（每次都重新计算） */
    function filteredRows() {
      if (!st.filter) return allRows;
      const q = st.filter.toLowerCase();
      const out = [];
      for (let i = 0; i < allRows.length; i++) {
        const r = allRows[i];
        let hit = false;
        for (const k in r) {
          if (k.charCodeAt(0) === 95 && k.charAt(1) === '_') continue;   // 跳过 __ 内部字段
          const v = r[k];
          if (v == null) continue;
          if (String(v).toLowerCase().indexOf(q) >= 0) { hit = true; break; }
        }
        if (hit) out.push(r);
      }
      return out;
    }

    if (sec.filterable !== false) {
      const inp = h('input', {
        class: 'matrix-filter',
        placeholder: '筛选（匹配任意列的文本/数值）…',
        value: st.filter
      });
      let timer = null;
      let composing = false;
      // 输入法组合期间不刷新表格，等选词结束（compositionend）再一次性刷新
      inp.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
      inp.addEventListener('compositionend', () => {
        composing = false;
        st.filter = inp.value;
        clearTimeout(timer);
        refreshMatrix();
      });
      inp.addEventListener('input', (e) => {
        st.filter = inp.value;
        if (composing || (e && e.isComposing)) return;
        clearTimeout(timer);
        timer = setTimeout(() => { refreshMatrix(); }, 120);   // 大表输入时防抖
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { inp.value = ''; st.filter = ''; refreshMatrix(); } });
      bar.appendChild(inp);
      if (st.filter) {
        bar.appendChild(h('button', {
          class: 'btn tiny', text: '清除筛选',
          onclick: () => { st.filter = ''; inp.value = ''; refreshMatrix(); }
        }));
      }
    }
    const cnt = h('span', { class: 'matrix-count', text: '' });
    bar.appendChild(cnt);
    box.appendChild(bar);
    const tblWrap = h('div', { class: 'matrix-wrap' });
    box.appendChild(tblWrap);

    function refreshMatrix() {
      const rows = filteredRows();
      let shown = rows;
      if (st.pageSize && st.limit && rows.length > st.limit) shown = rows.slice(0, st.limit);
      const tb = h('table', { class: 'matrix-table' });
      const thead = h('thead');
      const hr = h('tr');
      sec.columns.forEach((c) => {
        const th = h('th', { text: c.label, class: c.align === 'left' ? 'left' : '' });
        if (c.width) th.style.width = c.width;
        if (c.description) th.title = c.description;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      tb.appendChild(thead);
      const tbody = h('tbody');
      shown.forEach((row) => {
        const tr = h('tr');
        if (row.__summary) tr.className = 'summary-row';
        sec.columns.forEach((c) => {
          const td = h('td', { class: c.align === 'left' ? 'left' : '' });
          const editable = c.editable && !row.__summary;
          if (editable) {
            const inp = h('input', { class: 'cell-input', value: row[c.key] == null ? '' : row[c.key] });
            inp.addEventListener('change', () => app.editMatrix(FL.tables[table.tag] || FL.tables['*'], table,
              { row: row, col: c, section: sec }, inp.value));
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
            td.appendChild(inp);
          } else {
            const v = row[c.key];
            if (c.hclass === 'char-cell') {
              td.innerHTML = '<span class="char-in-font">' + escapeHtml(String(row[c.key] == null ? '' : row[c.key])) + '</span>';
            } else if (typeof v === 'string' && v.indexOf('<span class="swatch"') === 0) {
              td.innerHTML = v;
            } else td.textContent = v == null ? '' : String(v);
          }
          tr.appendChild(td);
        });
        if (sec.selectable === 'glyph') {
          tr.classList.add('clickable');
          tr.addEventListener('click', () => {
            app.selectedGid = row.glyph;
            $$('tr', tbody).forEach((x) => x.classList.remove('selected'));
            tr.classList.add('selected');
            if (typeof app.onSelectGlyph === 'function') app.onSelectGlyph(row.glyph);
          });
        }
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);
      tblWrap.innerHTML = '';
      tblWrap.appendChild(tb);
      const old = $('.matrix-more', box);
      if (old) old.remove();
      if (st.pageSize && st.limit && rows.length > st.limit) {
        box.appendChild(h('button', {
          class: 'btn small matrix-more',
          text: '显示更多（还有 ' + (rows.length - st.limit) + ' 行）',
          onclick: () => { st.limit += st.pageSize * 2; refreshMatrix(); }
        }));
      }
      cnt.textContent = rows.length === allRows.length
        ? '共 ' + allRows.length + ' 行' + (shown.length < rows.length ? '（显示前 ' + shown.length + ' 行）' : '')
        : '筛选命中 ' + rows.length + ' / ' + allRows.length + ' 行' + (shown.length < rows.length ? '（显示前 ' + shown.length + ' 行）' : '');
    }
    refreshMatrix();
    return box;
  }

  app.editMatrix = function (mod, table, ctx, value) {
    const f = app.font;
    if (mod && mod.edit) {
      const r = mod.edit(f, table, ctx, value);
      if (r && r.error) { app.toast(r.error, 'error'); return { ok: false }; }
      if (r === false) { app.toast('该单元格不可修改', 'error'); return { ok: false }; }
      app.markRebuild(table.tag, '已修改 ' + (ctx.col.label || ctx.col.key));
      app.toast('已修改 ' + (ctx.col.label || ctx.col.key) + ' = ' + value);
      renderSideFooter();
      return { ok: true };
    }
    // 通用：按偏移打补丁
    const e = ctx.row.__edit && ctx.row.__edit[ctx.col.key];
    if (e && e.kind === 'patch') {
      const v = parseInt(value, 10);
      if (isNaN(v)) { app.toast('请输入整数', 'error'); return { ok: false }; }
      const r = FNT.patch(f, table.tag, e.offset, e.type, v, { label: ctx.col.label + ' (第 ' + ctx.row.__index + ' 行)' });
      if (r.error) { app.toast(r.error, 'error'); return { ok: false }; }
      ctx.row[ctx.col.key] = v;
      app.toast('已修改 ' + ctx.col.label + ' = ' + v);
      renderSideFooter();
      return { ok: true };
    }
    app.toast('该表暂不支持直接编辑，请使用「原始数据」标签页或相关编辑面板', 'warn');
    return { ok: false };
  };

  app.markRebuild = function (tag, reason) {
    if (!app.font) return;
    FNT.markRebuild(app.font, tag, reason);
    if (tag === 'glyf') app.font.glyfDirty = true;
    renderSideFooter();
    const th = $('.th-meta');
    if (th) th.innerHTML += ' · <span class="warn">待重建：' + reason + '</span>';
  };

  /* ---------------------------------------------------------------------
   * 十六进制视图（可编辑）
   * ------------------------------------------------------------------- */
  function renderHex(main, table) {
    const b = table.bytes;
    const stateKey = 'hex#' + table.tag;
    const st = (app.state[stateKey] = app.state[stateKey] || { start: 0, per: 256 });
    const box = h('div', { class: 'card' });
    box.appendChild(h('div', { class: 'card-head' }, [
      h('h3', { text: '原始数据（共 ' + b.length + ' 字节）' }),
      h('p', { class: 'card-desc', text: '点击任意字节即可直接修改其值（十进制或 0x 十六进制）。修改会立即写入内存中的表数据，保存时输出。可用于修改本工具未提供编辑界面的字段。' })
    ]));
    const bar = h('div', { class: 'matrix-bar' });
    bar.appendChild(h('button', { class: 'btn small', text: '◀ 上一页', onclick: () => { st.start = Math.max(0, st.start - st.per); renderContent(); } }));
    bar.appendChild(h('span', { class: 'matrix-count', text: '偏移 ' + st.start + ' – ' + Math.min(b.length, st.start + st.per) }));
    bar.appendChild(h('button', { class: 'btn small', text: '下一页 ▶', onclick: () => { st.start = Math.min(Math.max(0, b.length - 1), st.start + st.per); renderContent(); } }));
    const jump = h('input', { class: 'matrix-filter small', placeholder: '跳转到偏移…', style: 'max-width:140px' });
    jump.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = parseInt(jump.value, 16);
        if (!isNaN(v)) { st.start = Math.max(0, Math.min(b.length - 1, v - (v % 16))); renderContent(); }
      }
    });
    bar.appendChild(jump);
    box.appendChild(bar);

    const pre = h('div', { class: 'hex-view' });
    const end = Math.min(b.length, st.start + st.per);
    for (let off = st.start; off < end; off += 16) {
      const line = h('div', { class: 'hex-line' });
      line.appendChild(h('span', { class: 'hex-off', text: off.toString(16).padStart(8, '0') }));
      const bytesBox = h('span', { class: 'hex-bytes' });
      for (let i = 0; i < 16; i++) {
        const p = off + i;
        if (p >= end) { bytesBox.appendChild(h('span', { class: 'hex-pad', text: '   ' })); continue; }
        const sp = h('span', { class: 'hex-byte', text: U.hex2(b[p]), title: '偏移 ' + p + '（十进制 ' + b[p] + '）' });
        sp.addEventListener('click', () => editByte(sp, p, table));
        bytesBox.appendChild(sp);
      }
      line.appendChild(bytesBox);
      const asc = h('span', { class: 'hex-ascii' });
      for (let i = 0; i < 16; i++) {
        const p = off + i;
        if (p >= end) break;
        const c = b[p];
        asc.appendChild(h('span', { text: c >= 32 && c < 127 ? String.fromCharCode(c) : '·' }));
      }
      line.appendChild(asc);
      pre.appendChild(line);
    }
    box.appendChild(pre);
    main.appendChild(box);
    cacheHexRefs(table, b);
  }

  function cacheHexRefs(table, bytes) {
    // 保存引用供 editByte 更新显示
    app._hexRefs = { table: table, bytes: bytes };
  }

  function editByte(span, offset, table) {
    const b = table.bytes;
    const input = h('input', { class: 'hex-input', value: U.hex2(b[offset]) });
    span.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const raw = input.value.trim();
      let v = /^0x/i.test(raw) ? parseInt(raw, 16) : (/^[0-9]+$/.test(raw) ? parseInt(raw, 10) : parseInt(raw, 16));
      if (isNaN(v) || v < 0 || v > 255) { app.toast('请输入 0~255 的数值', 'error'); v = b[offset]; }
      const before = b[offset];
      if (v !== before) {
        b[offset] = v;
        FNT.pushUndo(app.font, '字节修改', table.tag + ' @' + offset + '：' + U.hex2(before) + ' → ' + U.hex2(v),
          () => { b[offset] = before; });
        app.toast('已修改偏移 ' + offset + '：' + U.hex2(before) + ' → ' + U.hex2(v));
        renderSideFooter();
        app.parsedCacheClear();
      }
      const sp = h('span', { class: 'hex-byte', text: U.hex2(v), title: '偏移 ' + offset });
      sp.addEventListener('click', () => editByte(sp, offset, table));
      input.replaceWith(sp);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = U.hex2(b[offset]); input.blur(); } });
  }

  /* =====================================================================
   * 预览视图
   * =================================================================== */
  function renderPreview(main) {
    const f = app.font;
    const box = h('div', { class: 'card' });
    box.appendChild(h('div', { class: 'card-head' }, [
      h('h3', { text: '字体预览' }),
      h('p', { class: 'card-desc', text: '预览使用浏览器渲染当前内存中的字体数据（包含尚未保存的修改）。点击「生成/刷新预览」后会重新构建字体文件并加载。' })
    ]));
    const bar = h('div', { class: 'matrix-bar' });
    const ta = h('textarea', { class: 'preview-text', rows: '5' });
    ta.value = app.state.previewText ||
      '字体之美 Typeface 1234567890\n手写体测试：The quick brown fox jumps over the lazy dog.\n中文测试：永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭。\n标点符号：，。！？；：“”‘’（）【】—…《》';
    ta.addEventListener('input', () => { app.state.previewText = ta.value; updateText(); autoGrow(); });
    const size = h('input', { type: 'range', min: '10', max: '80', value: app.state.previewSize || 32 });
    const sizeLabel = h('span', { class: 'matrix-count', text: (app.state.previewSize || 32) + ' px' });
    size.addEventListener('input', () => {
      app.state.previewSize = +size.value;
      sizeLabel.textContent = size.value + ' px';
      updateText();
    });
    bar.appendChild(h('button', { class: 'btn small primary', text: '生成 / 刷新预览', onclick: () => refreshPreviewFont(true) }));
    bar.appendChild(size);
    bar.appendChild(sizeLabel);
    box.appendChild(bar);
    const axesPanel = buildAxesPanel();
    if (axesPanel) box.appendChild(axesPanel);
    box.appendChild(ta);
    // 输入框按内容自适应高度：默认内容不出现滚动条，行数多了才长高（到上限后转为滚动）
    let lastAuto = 0, manualResized = false;
    ta.addEventListener('mouseup', () => {
      // 用户拖拽过右下角把手后就不再自动改高度，尊重其设定
      if (!manualResized && lastAuto && Math.abs(ta.getBoundingClientRect().height - lastAuto) > 4) manualResized = true;
    });
    function autoGrow() {
      if (manualResized) return;
      const cap = Math.max(160, Math.round(window.innerHeight * 0.45));
      ta.style.overflowY = 'hidden';
      ta.style.height = 'auto';
      const need = ta.scrollHeight;
      lastAuto = Math.min(need, cap);
      ta.style.height = lastAuto + 'px';
      if (need > cap) ta.style.overflowY = 'auto';
    }

    /** 可变字体（fvar）的轴滑块面板；非可变字体返回 null */
    function buildAxesPanel() {
      let va = null;
      try { va = FNT.variableAxes(f); } catch (e) { va = null; }
      if (!va || !va.axes.length) return null;
      const st = app.state.axes || (app.state.axes = {});
      const fmt = (x) => (Math.abs(x - Math.round(x)) < 0.001 ? String(Math.round(x)) : x.toFixed(1));
      const panel = h('div', { class: 'axes-panel' });
      const head = h('div', { class: 'axes-head' }, [
        h('span', { class: 'axes-title', text: '可变轴（fvar）' }),
        h('span', { class: 'matrix-count', text: va.axes.length + ' 个轴' + (va.instances.length ? ' · ' + va.instances.length + ' 个命名实例' : '') })
      ]);
      const sel = h('select', { class: 'axes-instance', title: '选择 fvar 里预置的命名实例' });
      sel.appendChild(h('option', { value: '-1', text: '命名实例…' }));
      va.instances.forEach((ins, i) => sel.appendChild(h('option', { value: String(i), text: ins.name })));
      sel.disabled = !va.instances.length;
      sel.addEventListener('change', () => {
        const i = parseInt(sel.value, 10);
        if (i >= 0 && va.instances[i]) { Object.assign(st, va.instances[i].coords); sync(); }
      });
      head.appendChild(sel);
      head.appendChild(h('button', { class: 'btn tiny', text: '回到默认值', onclick: () => { va.axes.forEach((ax) => { st[ax.tag] = ax.def; }); sel.value = '-1'; sync(); } }));
      panel.appendChild(head);
      // 状态提示：明确告诉用户"拖了会不会有反应"（文案由 applyPreviewFont 动态刷新）
      panel.appendChild(h('div', { class: 'axes-hint axes-state', text: previewStateText() }));
      // 可变数据诊断：有 fvar 但缺 gvar/CFF2 时浏览器不会产生任何插值（拖了肯定不会变）
      const diag = [];
      diag.push('fvar ' + (f.tableMap['fvar'] ? '✓' : '✗'));
      diag.push('gvar ' + (f.tableMap['gvar'] ? '✓' : '✗'));
      diag.push('CFF2 ' + (f.tableMap['CFF2'] ? '✓' : '✗'));
      ['avar', 'HVAR', 'MVAR', 'STAT'].forEach((t) => { if (f.tableMap[t]) diag.push(t + ' ✓'); });
      const noOutlineData = !f.tableMap['gvar'] && !f.tableMap['CFF2'];
      panel.appendChild(h('div', {
        class: 'axes-hint axes-diag',
        text: '可变数据：' + diag.join(' · ') + (noOutlineData ? ' ⚠ 缺少 gvar/CFF2，插值无法生效' : '')
      }));

      const rows = h('div', { class: 'axes-rows' });
      const controls = [];
      va.axes.forEach((ax) => {
        if (st[ax.tag] == null) st[ax.tag] = ax.def;
        // 轴数据异常（min/max 非有限值或反了）时给个安全的回退范围，避免滑块不可用
        let lo = Number(ax.min), hi = Number(ax.max);
        if (!isFinite(lo) || !isFinite(hi) || hi <= lo) { lo = 0; hi = 1; }
        if (!isFinite(Number(st[ax.tag]))) st[ax.tag] = isFinite(Number(ax.def)) ? Number(ax.def) : lo;
        const step = (hi - lo) > 20 ? 1 : 0.1;
        const rng = h('input', {
          type: 'range', class: 'axis-range', min: String(lo), max: String(hi),
          step: String(step), value: String(st[ax.tag]), title: ax.tag + '：' + lo + ' ~ ' + hi
        });
        const val = h('span', { class: 'axis-val', text: fmt(st[ax.tag]) });
        rng.addEventListener('input', () => {
          st[ax.tag] = parseFloat(rng.value);
          val.textContent = fmt(st[ax.tag]);
          sync();
        });
        // 拖动结束：轮廓模式下的字形总览网格需要整体重画（拖的过程中不动，避免打断拖动）
        rng.addEventListener('change', () => {
          if (app.previewMode !== 'font' && app.view === 'glyphs') rerenderCurrentView();
        });
        controls.push(() => { rng.value = String(st[ax.tag]); val.textContent = fmt(st[ax.tag]); });
        rows.appendChild(h('div', { class: 'axis-row' }, [
          h('div', { class: 'axis-name' }, [
            h('b', { text: ax.tag }),
            h('span', { class: 'axis-label', text: (ax.name || '') + (ax.hidden ? '（隐藏轴）' : '') })
          ]),
          rng,
          val
        ]));
      });
      panel.appendChild(rows);
      /**
       * 把当前轴值同步到：滑块读数 → 字体对象（供轮廓插值用）→ 预览
       * 字体模式：只改 CSS，浏览器即时重绘；
       * 轮廓模式（浏览器拒绝加载该字体）：用 gvar 插值重画本工具自己的 SVG。
       */
      function sync() {
        controls.forEach((fn) => fn());
        if (f) f.varAxes = Object.assign({}, st);
        applyPreviewFont();
        if (app.previewMode !== 'font') updateText();
      }
      if (f) f.varAxes = Object.assign({}, st);     // 首帧就带上轴值（此时 updateText 尚未定义，不能调 sync）
      return panel;
    }
    const sample = h('div', { class: 'preview-sample', id: 'previewSample', text: ta.value });
    box.appendChild(sample);
    // 多字号展示
    const multi = h('div', { class: 'preview-multi', id: 'previewMulti' });
    box.appendChild(multi);

    function updateText() {
      const px = app.state.previewSize || 32;
      sample.style.fontSize = px + 'px';
      multi.innerHTML = '';
      const firstLine = ta.value.split('\n')[0];
      // 轮廓模式：浏览器拒绝了该字体，改用本工具自己解析的 glyf 轮廓绘制
      if (app.previewMode === 'outline') {
        const o = FL.outlineTextSVG ? FL.outlineTextSVG(f, ta.value, px) : null;
        if (o) sample.innerHTML = o.svg;
        else sample.textContent = ta.value;
        [12, 16, 24, 36, 48, 72].forEach((s) => {
          const line = h('div', { class: 'pv-line' });
          line.appendChild(h('span', { class: 'pv-size', text: s + 'px' }));
          const o2 = FL.outlineTextSVG ? FL.outlineTextSVG(f, firstLine, s) : null;
          if (o2) line.insertAdjacentHTML('beforeend', o2.svg);
          else line.appendChild(document.createTextNode(firstLine));
          multi.appendChild(line);
        });
        return;
      }
      if (app.previewMode === 'none') {
        sample.textContent = '（该字体无法预览：轮廓数据不可解析）';
        return;
      }
      sample.textContent = ta.value;
      [12, 16, 24, 36, 48, 72].forEach((s) => {
        multi.appendChild(h('div', { class: 'pv-line', style: 'font-size:' + s + 'px', text: s + 'px  ' + firstLine }));
      });
    }
    updateText();
    main.appendChild(box);
    autoGrow();     // 必须在插入文档之后调用，否则拿不到 scrollHeight
    // previewMode 为 null 表示还没尝试过；失败后不再自动重试，避免"失败→重绘→再失败"的循环
    if (app.previewMode === null && !app.previewFace) refreshPreviewFont(true);
    else applyPreviewFont();
  }

  /**
   * 轴值 → 可安全写进 CSS 的 'tag value' 片段
   * 会剔除非法数据（tag 必须 4 个 ASCII 字符、数值必须有限），并把数值夹到 min~max，
   * 否则写出来的 font-variation-settings 非法，整条声明会被浏览器丢弃（表现为"拖了没反应"）。
   */
  function axisParts(va) {
    const st = app.state.axes || (app.state.axes = {});
    const parts = [];
    const skipped = [];
    va.axes.forEach((ax) => {
      const tag = String(ax.tag == null ? '' : ax.tag).replace(/[^A-Za-z0-9 ]/g, '');
      if (tag.length !== 4) { skipped.push(String(ax.tag) + '(标签非法)'); return; }
      let v = st[ax.tag];
      if (v == null) v = ax.def;
      v = Number(v);
      if (!isFinite(v)) v = Number(ax.def);
      if (!isFinite(v)) { skipped.push(tag + '(数值无效)'); return; }
      const lo = Number(ax.min), hi = Number(ax.max);
      if (isFinite(lo) && isFinite(hi) && hi > lo) v = Math.min(hi, Math.max(lo, v));
      parts.push('"' + tag + '" ' + v);
    });
    if (skipped.length) app.axisSkipped = skipped;
    return parts;
  }

  /** 轴面板的状态文案（说明当前拖动滑块是否会有反应） */
  function previewStateText() {
    if (app.previewMode === 'outline') {
      const canVar = !!(app.font && FL.gvar && FL.gvar.ready(app.font));
      return canVar
        ? '轮廓预览（浏览器拒绝加载该字体）：轴值由本工具按 gvar 插值重画，仍可实时看到变化'
        : '⚠ 轮廓预览：浏览器拒绝加载该字体，且该字体无 gvar 数据，轴值无法影响预览（保存仍保留可变数据）';
    }
    if (app.previewMode === 'none') return '⚠ 预览不可用（浏览器拒绝该字体，且该字体无 glyf 轮廓可画）';
    if (app.previewMode == null) return '预览字体生成中…';
    return '拖动滑块即时生效（仅影响预览，保存仍是原可变字体）';
  }

  /** 当前可变轴取值 → CSS font-variation-settings（非可变字体返回空串） */
  function variationCSS() {
    const f = app.font;
    if (!f) return '';
    let va = null;
    try { va = FNT.variableAxes(f); } catch (e) { return ''; }
    if (!va || !va.axes.length) return '';
    const parts = axisParts(va);
    if (!parts.length) return '';
    app.axisLog = parts.slice();
    return 'font-variation-settings:' + parts.join(',') + ';font-optical-sizing:none;';
  }

  /** 清掉所有本工具注册的预览字体（避免旧字体残留在同一字族里导致"拖轴没反应"） */
  function purgePreviewFaces() {
    try {
      const doomed = [];
      document.fonts.forEach((face) => {
        const fam = String(face.family || '').replace(/["']/g, '');
        if (fam === PREVIEW_FAMILY) doomed.push(face);
      });
      doomed.forEach((face) => { try { document.fonts.delete(face); } catch (e) { /* 忽略 */ } });
      return doomed.length;
    } catch (e) { return 0; }
  }

  function applyPreviewFont() {
    const style = $('#previewStyle') || (() => {
      const s = h('style', { id: 'previewStyle' });
      document.head.appendChild(s);
      return s;
    })();
    // 不使用 url() 引用：字体由 FontFace(ArrayBuffer) 直接注册到 document.fonts，
    // 这样在 file:// 下也不会触发 "file: URLs are treated as unique security origins" 拦截
    // 可变字体：把当前轴值写成 font-variation-settings，浏览器即时重绘，无需重新加载字体
    style.textContent = '.preview-sample,.preview-multi .pv-line,.gc-char{' +
      'font-family:' + PREVIEW_FAMILY + ',serif;' + variationCSS() + '}';
    const stateEl = $('.axes-state');          // 同步轴面板里的状态提示
    if (stateEl) stateEl.textContent = previewStateText();
  }


  /** 构造一个 FontFace（优先二进制源，失败退回 data: URL） */
  function makeFace(bytes) {
    try {
      // 二进制源不产生任何 URL，file:// 下也不会被来源策略拦截
      return new FontFace(PREVIEW_FAMILY, bytes, { display: 'block' });
    } catch (e) {
      return new FontFace(PREVIEW_FAMILY, 'url(data:font/otf;base64,' + bytesToBase64(bytes) + ')', { display: 'block' });
    }
  }

  /**
   * 浏览器拒绝加载预览字体时的处理：
   *  1) 用"未经任何改动的原始字节"再试一次，区分是「本工具的输出有问题」还是「该字体本身就不符合 OTS 校验」
   *  2) 若字体本身被拒绝且是 TrueType 轮廓 → 切换到轮廓预览（本工具自己解析 glyf 绘制）
   */
  async function handlePreviewLoadFail(msg, savedBytes) {
    const f = app.font;
    app.fontLoadOK = false;
    app.fontLoadErr = msg;
    app.previewFace = null;

    // 原始字节：非 TTC 直接用文件原始字节；TTC 用不做任何重建的直通保存结果
    let origBytes = null;
    try {
      origBytes = f.collection
        // 直通保存：关掉全部兼容性修复，才能真实反映"这个字体本来的样子"
        ? FNT.save(f, {
          dropDSIG: false, dropStale: false, recompute: false,
          normalizeCmapLang: false, fixMaxZones: false, dropEmptyTables: false
        }).bytes
        : app.rawBytes;
    } catch (e) { origBytes = null; }

    let origErr = null;
    if (origBytes) {
      try { await makeFace(origBytes).load(); origErr = null; }
      catch (e2) { origErr = (e2 && e2.message) || '未知原因'; }
    }

    if (origErr === null && origBytes) {
      // 原始字体能加载 → 说明是我们保存出来的字节有问题，先退回原始字体保证预览可用
      try {
        const loaded = await makeFace(origBytes).load();
        document.fonts.add(loaded);
        app.previewFace = loaded;
        app.previewMode = 'font';
        app.fontLoadOK = true;
        app.toast('保存后的字体被浏览器拒绝（' + msg + '），已回退为原始字体预览。请把此提示反馈给工具作者。', 'warn');
        rerenderCurrentView();
        return;
      } catch (e) { /* 继续走下面的分支 */ }
    }

    const outlineOK = !!(FL.outlineTextSVG && FL.outlineTextSVG(f, '测', 12));
    app.previewMode = outlineOK ? 'outline' : 'none';
    if (outlineOK) {
      app.toast('该字体本身不符合浏览器的字体校验（' + (origErr || msg) +
        '），Chromium 无法加载它（Windows 及其他软件仍可正常使用）。已切换为轮廓预览：由本工具解析 glyf 轮廓直接绘制。', 'warn');
    } else {
      app.toast('该字体不符合浏览器的字体校验（' + (origErr || msg) + '），且' +
        (f.isCFF ? '它是 CFF 轮廓字体，本工具暂不支持轮廓预览。' : '本工具无法解析其轮廓，预览不可用。'), 'error');
    }
    rerenderCurrentView();
  }

  /** 按当前视图重绘（用于预览模式切换后刷新界面） */
  function rerenderCurrentView() {
    if (app.view === 'preview') { const m = $('#content'); if (m) { m.innerHTML = ''; renderPreview(m); } }
    else if (app.view === 'glyphs') { const m = $('#content'); if (m) { m.innerHTML = ''; renderGlyphGrid(m); } }
  }

  function refreshPreviewFont(showToast) {
    const f = app.font;
    if (!f) return;
    try {
      const res = FNT.save(f, Object.assign({ dropDSIG: true, dropStale: false, recompute: true }, app.state.saveOpts || {}));
      app.previewBytes = res.bytes;
      applyPreviewFont();
      purgePreviewFaces();
      app.previewFace = null;
      const face = makeFace(res.bytes);
      app.previewFace = face;
      face.load().then(
        (loaded) => {
          document.fonts.add(loaded);
          const wasOutline = app.previewMode === 'outline';
          app.fontLoadOK = true;
          app.fontLoadErr = null;
          app.previewMode = 'font';
          applyPreviewFont();          // 字体就绪后再写一次轴设置，确保可变轴立刻生效
          if (wasOutline) rerenderCurrentView();
        },
        (e) => { handlePreviewLoadFail((e && e.message) || '未知原因', res.bytes); }
      );
      if (showToast) app.toast('预览已生成（' + (res.bytes.length / 1024).toFixed(1) + ' KB）' + (res.notes.length ? '：' + res.notes[res.notes.length - 1] : ''));
    } catch (e) {
      app.toast('预览生成失败：' + e.message, 'error');
    }
  }

  /* =====================================================================
   * 字形总览
   * =================================================================== */
  function renderGlyphGrid(main) {
    const f = app.font;
    const PER_PAGE = 240;
    // 首次进入时构建预览字体（让网格用真实字体渲染）；失败过就不再重试，避免循环
    if (app.previewMode === null && !app.previewFace) refreshPreviewFont(false);
    const box = h('div', { class: 'card' });
    box.appendChild(h('div', { class: 'card-head' }, [
      h('h3', { text: '字形总览' }),
      h('p', { class: 'card-desc', text: '按 cmap 映射列出字形。点击任意字形查看轮廓与点数据；字体较大时分页显示。' })
    ]));
    const bar = h('div', { class: 'matrix-bar' });
    const inp = h('input', {
      class: 'matrix-filter glyph-grid-filter',
      placeholder: '按字符 / U+码点 / 字形名 / GID 筛选…',
      value: app.glyphFilter
    });
    const cnt = h('span', { class: 'matrix-count', text: '' });
    const pageLbl = h('span', { class: 'matrix-count', text: '' });
    bar.appendChild(inp);
    bar.appendChild(cnt);
    bar.appendChild(h('div', { class: 'glyph-nav' }, [
      h('button', { class: 'btn small', text: '◀', title: '上一页', onclick: () => { app.glyphPage--; refreshGrid(); } }),
      pageLbl,
      h('button', { class: 'btn small', text: '▶', title: '下一页', onclick: () => { app.glyphPage++; refreshGrid(); } })
    ]));
    box.appendChild(bar);

    const m = FNT.cmapMap(f);
    if (!m) {
      box.appendChild(h('div', { class: 'note note-warn', text: '该字体没有可用的 Unicode cmap 子表，无法列出字符。' }));
      main.appendChild(box);
      return;
    }
    const allEntries = Array.from(m.entries()).map(([cp, gid]) => [cp, gid]);
    const grid = h('div', { class: 'glyph-grid' });
    box.appendChild(grid);

    // 左右分栏：左侧字形网格，右侧「字形详情」（未选中字形时详情隐藏，网格占满宽度）
    const wrap = h('div', { class: 'split-2col one-col' });
    wrap.appendChild(box);
    const detail = h('div', { class: 'card', style: 'display:none' });
    const detailHead = h('div', { class: 'card-head' });
    const dbox = h('div', { class: 'glyph-detail' });
    detail.appendChild(detailHead);
    detail.appendChild(dbox);
    wrap.appendChild(detail);
    main.appendChild(wrap);

    /** 按当前筛选词计算条目（不触碰 DOM） */
    function filteredEntries() {
      if (!app.glyphFilter) return allEntries;
      const q = app.glyphFilter.trim().toLowerCase();
      if (!q) return allEntries;
      return allEntries.filter(([cp, gid]) =>
        (q.indexOf('u+') === 0 && cp.toString(16) === q.slice(2).replace(/^0+/, '')) ||
        String.fromCodePoint(cp).toLowerCase() === q ||
        (FNT.glyphName(f, gid) || '').toLowerCase().indexOf(q) >= 0 ||
        String(gid) === q);
    }

    /**
     * 只重绘网格与页码。
     * 注意：绝不重建输入框本身 —— 否则中文输入法组合期间输入框被替换，
     * 候选词窗口会失去宿主元素，界面就会乱跳。
     */
    function refreshGrid() {
      const entries = filteredEntries();
      const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
      app.glyphPage = Math.min(Math.max(0, app.glyphPage), pages - 1);
      const slice = entries.slice(app.glyphPage * PER_PAGE, app.glyphPage * PER_PAGE + PER_PAGE);
      cnt.textContent = entries.length + ' 个字符' + (entries.length !== allEntries.length ? '（共 ' + allEntries.length + '）' : '');
      pageLbl.textContent = '第 ' + (app.glyphPage + 1) + ' / ' + pages + ' 页';
      grid.innerHTML = '';
      slice.forEach(([cp, gid]) => {
        const cell = h('div', {
          class: 'glyph-cell' + (app.selectedGid === gid ? ' selected' : ''),
          title: 'U+' + cp.toString(16).toUpperCase() + '  GID ' + gid + '  ' + FNT.glyphName(f, gid)
        });
        if (app.previewMode === 'outline' && FL.outlineGlyphSVG) {
          // 轮廓模式：浏览器无法加载该字体，网格改用本工具绘制的轮廓
          const g = h('div', { class: 'gc-char gc-outline' });
          const osvg = FL.outlineGlyphSVG(f, gid);
          if (osvg) g.innerHTML = osvg; else g.textContent = String.fromCodePoint(cp);
          cell.appendChild(g);
        } else {
          cell.appendChild(h('div', { class: 'gc-char', text: String.fromCodePoint(cp) }));
        }
        cell.appendChild(h('div', { class: 'gc-meta', text: gid }));
        cell.addEventListener('click', () => {
          app.selectedGid = gid;
          $$('.glyph-cell', grid).forEach((c) => c.classList.remove('selected'));
          cell.classList.add('selected');
          renderDetail();
        });
        grid.appendChild(cell);
      });
    }

    function renderDetail() {
      if (app.selectedGid == null) {
        detail.style.display = 'none';
        wrap.classList.add('one-col');       // 没有选中字形时不预留右栏
        return;
      }
      detail.style.display = '';
      wrap.classList.remove('one-col');
      detailHead.innerHTML = '';
      detailHead.appendChild(h('h3', { text: '字形详情 · GID ' + app.selectedGid + ' ' + FNT.glyphName(f, app.selectedGid) }));
      dbox.innerHTML = '';
      const res = FL.glyphSVG(f, app.selectedGid);
      if (res.svg) dbox.innerHTML = '<div class="gd-svg">' + res.svg + '</div>';
      else dbox.innerHTML = '<p class="muted">' + (res.reason || '无法渲染该字形') + '</p>';
      const info = FL.glyfParse(f);
      const glyph = info && info.glyphs[app.selectedGid];
      if (glyph) {
        dbox.appendChild(h('table', { class: 'mini-table' }, [h('tbody', null, [
          h('tr', null, [h('th', { text: '轮廓数' }), h('td', { text: glyph.components ? '（复合字形，' + glyph.components.length + ' 个组件）' : String(glyph.numberOfContours || 0) })]),
          h('tr', null, [h('th', { text: '点数' }), h('td', { text: glyph.components ? '—' : String(glyph.numPoints || 0) })]),
          h('tr', null, [h('th', { text: '边界框' }), h('td', { text: glyph.xMin + ',' + glyph.yMin + ' → ' + glyph.xMax + ',' + glyph.yMax })]),
          h('tr', null, [h('th', { text: '提示指令' }), h('td', { text: (glyph.instructions ? glyph.instructions.length : 0) + ' 字节' })]),
          h('tr', null, [h('th', { text: '数据长度' }), h('td', { text: glyph.length + ' 字节' })])
        ])]));
      }
    }

    /* 输入：组合期（输入法正在选词）不刷新，等 compositionend 再一次性刷新 */
    let composing = false;
    let timer = null;
    const schedule = (delay) => {
      clearTimeout(timer);
      timer = setTimeout(refreshGrid, delay == null ? 140 : delay);
    };
    inp.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
    inp.addEventListener('compositionend', () => {
      composing = false;
      app.glyphFilter = inp.value;
      app.glyphPage = 0;
      schedule(0);
    });
    inp.addEventListener('input', (e) => {
      app.glyphFilter = inp.value;
      app.glyphPage = 0;
      if (composing || (e && e.isComposing)) return;      // 等选词结束
      schedule();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { inp.value = ''; app.glyphFilter = ''; app.glyphPage = 0; refreshGrid(); }
    });

    refreshGrid();
    renderDetail();
  }

  /* =====================================================================
   * 修改记录
   * =================================================================== */
  function renderChanges(main) {
    const f = app.font;
    const box = h('div', { class: 'card' });
    box.appendChild(h('div', { class: 'card-head' }, [
      h('h3', { text: '修改记录与保存' }),
      h('p', { class: 'card-desc', text: '这里列出本次打开后做过的全部修改。保存时会重建被标记的表，重新计算校验和，并输出可下载的字体文件。' })
    ]));
    const opts = app.state.saveOpts = app.state.saveOpts || {
      dropDSIG: true, dropStale: false, recompute: true,
      normalizeCmapLang: true, fixMaxZones: true, dropEmptyTables: true
    };
    if (opts.normalizeCmapLang === undefined) opts.normalizeCmapLang = true;
    if (opts.fixMaxZones === undefined) opts.fixMaxZones = true;
    if (opts.dropEmptyTables === undefined) opts.dropEmptyTables = true;
    const optBox = h('div', { class: 'options' });
    [['dropDSIG', '保存时移除 DSIG 数字签名表（推荐，避免签名失效导致加载问题）'],
      ['dropStale', '保存时移除 hdmx / LTSH / VDMX 设备度量表（改动字形后这些表会失配）'],
      ['recompute', '自动重算派生度量（head 边界框、hhea 的最大宽度/最小承托、maxp 上限）'],
      ['normalizeCmapLang', '兼容性修复：把 cmap 子表的 language 字段规范化为 0（非 0 时浏览器 OTS 校验会拒绝加载字体）'],
      ['fixMaxZones', '兼容性修复：把 maxp.maxZones 修正为 2（规范只允许 1/2；写成 7 之类会被浏览器 OTS 拒绝，报 maxp: Bad maxZones）'],
      ['dropEmptyTables', '兼容性修复：移除长度为 0 的表（不携带数据，但浏览器 OTS 会以 zero-length table 拒绝整个字体）']].forEach(([k, label]) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!opts[k];
      cb.addEventListener('change', () => { opts[k] = cb.checked; });
      optBox.appendChild(h('label', { class: 'opt' }, [cb, h('span', { text: label })]));
    });
    box.appendChild(optBox);

    if (!f) { box.appendChild(h('p', { class: 'muted', text: '尚未打开字体。' })); main.appendChild(box); return; }
    if (!f.edits.length && !f.glyfDirty && !Object.keys(f.rebuilds).length) {
      box.appendChild(h('p', { class: 'muted', text: '当前没有任何修改。' }));
    } else {
      const tbl = h('table', { class: 'matrix-table' });
      tbl.appendChild(h('thead', null, [h('tr', null, [
        h('th', { text: '#' }), h('th', { text: '表' }), h('th', { text: '修改内容' }), h('th', { text: '详情', class: 'left' }), h('th', { text: '操作' })
      ])]));
      const tb = h('tbody');
      f.edits.slice().reverse().forEach((e, i) => {
        tb.appendChild(h('tr', null, [
          h('td', { text: String(f.edits.length - i) }),
          h('td', { text: e.tag }),
          h('td', { text: e.label }),
          h('td', { class: 'left', text: e.detail || '' }),
          h('td', null, [h('button', { class: 'btn tiny', text: '撤销', onclick: () => {
            e.undo();
            const idx = f.edits.indexOf(e);
            if (idx >= 0) f.edits.splice(idx, 1);
            app.parsedCacheClear();
            renderFileInfo(); renderSideFooter(); renderContent();
            app.toast('已撤销该条修改');
          } })])
        ]));
      });
      tbl.appendChild(tb);
      box.appendChild(tbl);
      if (Object.keys(f.rebuilds).length || f.glyfDirty) {
        box.appendChild(h('div', { class: 'note note-info', text: '保存时将重建：' + Object.keys(f.rebuilds).join('、') + (f.glyfDirty ? '、glyf/loca' : '') }));
      }
    }
    const actions = h('div', { class: 'matrix-bar' });
    actions.appendChild(h('button', { class: 'btn primary', text: '保存为字体文件', onclick: () => doSave() }));
    actions.appendChild(h('button', { class: 'btn', text: '仅刷新预览', onclick: () => refreshPreviewFont(true) }));
    box.appendChild(actions);
    main.appendChild(box);
  }

  function doSave() {
    const f = app.font;
    if (!f) return;
    const opts = app.state.saveOpts || { dropDSIG: true };
    try {
      const res = FNT.save(f, opts);
      const ext = f.sfntVersion === 0x4f54544f ? '.otf' : '.ttf';
      const base = (f.fileName || 'font').replace(/\.[^.]+$/, '');
      const name = base + '.edited' + ext;
      // file:// 下浏览器禁止 blob: URL，改用 data: URL 下载（http(s) 下仍用 blob，省内存）
      const useData = location.protocol === 'file:';
      const href = useData
        ? 'data:font/otf;base64,' + bytesToBase64(res.bytes)
        : URL.createObjectURL(new Blob([res.bytes], { type: 'font/otf' }));
      const a = h('a', { href: href, download: name });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { if (!useData) URL.revokeObjectURL(href); a.remove(); }, 2000);
      app.lastSave = res;
      app.toast('已导出 ' + name + '（' + (res.bytes.length / 1024).toFixed(1) + ' KB）。' + res.notes.join('；'), 'success');
      // 用保存后的数据重新加载，使后续编辑基于新字体
      reloadFromSaved(res.bytes, f.fileName);
    } catch (e) {
      console.error(e);
      app.toast('保存失败：' + e.message, 'error');
    }
  }

  function reloadFromSaved(bytes, name) {
    const keepTag = app.tag;
    const copy = bytes.slice();
    app.rawBytes = copy;
    const f = FNT.parse(copy, name, 0);
    app.fontIndex = 0;
    app.font = f;
    renderFileInfo();
    renderSidebar();
    if (keepTag && f.tableMap[keepTag]) { app.tag = keepTag; }
    app.parsedCacheClear();
    renderContent();
    refreshPreviewFont(false);
  }

  /* =====================================================================
   * 通用 UI
   * =================================================================== */
  let toastTimer = [];
  app.toast = function (msg, type) {
    const box = $('#toasts');
    const el = h('div', { class: 'toast ' + (type || ''), text: msg });
    box.appendChild(el);
    setTimeout(() => { el.classList.add('show'); }, 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 7000 : 4000);
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function refreshKeepingScroll() {
    const y = window.scrollY;
    renderContent();
    window.scrollTo(0, y);
  }

  /* =====================================================================
   * 初始化
   * =================================================================== */
  function init() {
    const themeBtn = $('#btnTheme');
    if (themeBtn) themeBtn.addEventListener('click', () => app.toggleTheme());
    $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) openFile(file);
      e.target.value = '';
    });
    $('#btnSave').addEventListener('click', () => {
      app.view = 'changes';
      syncTabs();
      renderContent();
      doSave();
    });
    $('#btnPreview').addEventListener('click', () => {
      app.view = 'preview'; syncTabs(); renderContent();
    });
    $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
      app.view = b.dataset.view;
      syncTabs();
      renderContent();
    }));
    // 拖拽
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#dropzone').classList.add('show'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { dragDepth--; if (dragDepth <= 0) $('#dropzone').classList.remove('show'); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      $('#dropzone').classList.remove('show');
      const file = e.dataTransfer.files[0];
      if (file) openFile(file);
    });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (app.font) doSave(); return; }
      // T 键快速切换主题（正在输入框里打字时不触发）
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 't' && e.key !== 'T') return;
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || e.isComposing) return;
      e.preventDefault();
      app.toggleTheme();
    });
    syncTabs();
    renderContent();
    renderFileInfo();
  }

  function syncTabs() {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === app.view));
    document.body.classList.toggle('view-tables', app.view === 'tables');
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
