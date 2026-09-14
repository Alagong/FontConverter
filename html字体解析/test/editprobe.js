/* =========================================================================
 * test/editprobe.js —— 在真实页面里逐个走"修改 → 刷新预览 → 浏览器加载校验"链路
 * 用法（在页面中注入后调用）：await window.probeEdits()
 * ========================================================================= */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.probeEdits = async function () {
    const F = APP.font, FL = window.FL, FNT = FL.font, T = FL.tables;
    const out = [];
    if (!F) return [['无字体', 'fail']];

    const toastText = () => (document.getElementById('toasts') || {}).innerText || '';

    async function preview(label) {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '仅刷新预览');
      if (!btn) { out.push({ label: label, ok: null, msg: '未找到「仅刷新预览」按钮' }); return; }
      btn.click();
      await sleep(1800);
      const ok = APP.fontLoadOK;
      const msgs = toastText().split('\n').filter((x) => /未能被浏览器加载|生成失败/.test(x));
      out.push({ label: label, ok: ok, msg: ok ? '' : (msgs[msgs.length - 1] || toastText().slice(-200)) });
    }

    // 进入「修改与导出」视图（预览刷新按钮在这里）
    const tab = document.querySelector('#tabs button[data-view=changes]');
    if (tab) tab.click();
    await sleep(400);

    await preview('0 基线（未做任何修改）');

    // 1) 数值补丁：OS/2.usWeightClass
    try {
      const t = F.tableMap['OS/2'];
      if (t) {
        const res = FNT.tableInfo(F, 'OS/2');
        const fld = res.sections.filter((s) => s.fields).map((s) => s.fields).reduce((a, b) => a.concat(b), [])
          .find((x) => x.name === 'usWeightClass');
        if (fld) APP.editField(fld, { value: '700' }, document.createElement('div'), t, res);
      }
    } catch (e) { out.push({ label: '1 OS/2 修改异常', ok: false, msg: e.message }); }
    await preview('1 OS/2.usWeightClass = 700（按偏移补丁）');

    // 2) name 文本重建
    try {
      const t = F.tableMap['name'];
      if (t) {
        FNT.tableInfo(F, 'name');
        APP.editMatrix(T['name'], t, { row: { __edit: { text: { kind: 'nameText', index: 0 } } }, col: { key: 'text', label: '文本' } }, 'ProbeFamily');
      }
    } catch (e) { out.push({ label: '2 name 修改异常', ok: false, msg: e.message }); }
    await preview('2 name 文本修改（重建 name 表）');

    // 3) cmap 映射重建
    try {
      const t = F.tableMap['cmap'];
      if (t) {
        const res = FNT.tableInfo(F, 'cmap');
        const subs = res.model.subtables || [];
        const si = subs.findIndex((s) => s.mapping && s.mapping.length > 5);
        if (si >= 0) {
          const code = subs[si].mapping[3][0];
          APP.editMatrix(T['cmap'], t, {
            row: { __edit: { gid: { kind: 'cmapGid', si: si, code: code } } },
            col: { key: 'gid', label: '字形索引' }
          }, 1);
        }
      }
    } catch (e) { out.push({ label: '3 cmap 修改异常', ok: false, msg: e.message }); }
    await preview('3 cmap 映射修改（重建子表）');

    // 4) post 字形名重建
    try {
      const t = F.tableMap['post'];
      if (t) {
        const res = FNT.tableInfo(F, 'post');
        if (res.model.glyphNames && res.model.glyphNames.length > 3) {
          APP.editMatrix(T['post'], t, { row: { __edit: { name: { kind: 'postName', gid: 3 } } }, col: { key: 'name', label: '字形名称' } }, 'probe_glyph');
        } else out.push({ label: '4 post 不支持名称编辑', ok: null, msg: 'post 版本为 ' + res.model.version });
      }
    } catch (e) { out.push({ label: '4 post 修改异常', ok: false, msg: e.message }); }
    await preview('4 post 字形名修改（重建 post 表）');

    // 5) kern 值
    try {
      const t = F.tableMap['kern'];
      if (t) {
        const res = FNT.tableInfo(F, 'kern');
        const st = (res.model.subtables || []).find((s) => s.pairs && s.pairs.length);
        if (st) {
          const si = res.model.subtables.indexOf(st);
          APP.editMatrix(T['kern'], t, { row: { __edit: { value: { kind: 'kernValue', si: si, k: 0 } } }, col: { key: 'value', label: '调整值' } }, -50);
        }
      }
    } catch (e) { out.push({ label: '5 kern 修改异常', ok: false, msg: e.message }); }
    await preview('5 kern 调整值修改');

    // 6) glyf 点坐标（触发整表重建）
    let gid = -1;
    try {
      const t = F.tableMap['glyf'];
      if (t) {
        const res = FNT.tableInfo(F, 'glyf');
        const all = res.model.all;
        gid = all.glyphs.findIndex((g) => g && !g.components && g.numberOfContours === 1 && g.xs && g.xs.length > 1);
        if (gid >= 0) {
          APP.editMatrix(T['glyf'], t, { row: { __gid: gid, __pi: 0 }, col: { key: 'x', editKind: 'glyfPoint', label: 'x 坐标' } }, 123);
        } else out.push({ label: '6 未找到可编辑简单字形', ok: null, msg: 'gid=' + gid });
      } else out.push({ label: '6 无 glyf 表（CFF 字体）', ok: null, msg: '' });
    } catch (e) { out.push({ label: '6 glyf 点修改异常', ok: false, msg: e.message }); }
    await preview('6 glyf 点坐标修改（重建 glyf/loca/maxp）');

    // 7) glyf 边界框
    try {
      const t = F.tableMap['glyf'];
      if (t && gid >= 0) {
        APP.editMatrix(T['glyf'], t, { row: { __gid: gid }, col: { key: 'xMax', editKind: 'glyfBBox', label: 'xMax' } }, 500);
      }
    } catch (e) { out.push({ label: '7 glyf 边界框异常', ok: false, msg: e.message }); }
    await preview('7 glyf 边界框修改');

    return out;
  };
})();
