/* =========================================================================
 * tables/kern.js —— 字距调整表（kern）、栅格化参数表（gasp）、控制值表（cvt ）
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;
  const F = H.F;

  /* =====================================================================
   * kern
   * =================================================================== */
  T['kern'] = {
    parse(font, table) {
      H.need(table, 4, 'kern');
      const b = table.bytes;
      const r = new FL.Reader(b);
      const version = r.u16();
      const nTables = r.u16();
      const subs = [];
      let p = 4;
      for (let i = 0; i < nTables && p + 6 <= b.length; i++) {
        const sVersion = FL.TYPES.uint16.r(r.view, p);
        const sLength = FL.TYPES.uint16.r(r.view, p + 2);
        const coverage = FL.TYPES.uint16.r(r.view, p + 4);
        const format = coverage >> 8;
        const flags = coverage & 0xff;
        const st = {
          index: i, offset: p, version: sVersion, length: sLength, format: format, flags: flags,
          horizontal: !!(flags & 1), minimum: !!(flags & 2), crossStream: !!(flags & 4), override: !!(flags & 8),
          pairs: null
        };
        if (format === 0) {
          const nPairs = FL.TYPES.uint16.r(r.view, p + 6);
          const pairs = [];
          const base = p + 14;
          for (let k = 0; k < nPairs; k++) {
            const q = base + k * 6;
            if (q + 6 > b.length) break;
            pairs.push({
              left: FL.TYPES.uint16.r(r.view, q),
              right: FL.TYPES.uint16.r(r.view, q + 2),
              value: FL.TYPES.int16.r(r.view, q + 4),
              byteOffset: q + 4
            });
          }
          st.pairs = pairs;
          st.nPairs = nPairs;
        }
        subs.push(st);
        if (sLength <= 0) break;
        p += sLength;
      }

      const sections = [];
      const head = H.sec('kern 表概况', 'kern 表给出特定字符对之间的额外间距（可为负值），排版时加到右侧字符的坐标上。OpenType 字体更推荐使用 GPOS 的 kern 特性，但很多字体仍同时保留 kern 表以兼容旧软件。', [
        F(r, { offset: 0, type: 'uint16', name: 'version', label: '表版本', editable: true, description: 'kern 表版本，通常为 0（Microsoft/OpenType 定义）。' }),
        F(r, { offset: 2, type: 'uint16', name: 'nTables', label: '子表数量', editable: false, description: 'kern 表可包含多个子表，分别面向不同书写方向/字号/附加功能（Apple 扩展）。' })
      ]);
      sections.push(head);

      subs.forEach((st, i) => {
        const infoFields = [
          { label: '子表偏移', name: 'offset', offset: null, size: 0, type: 'text', value: st.offset, display: String(st.offset), editable: false, description: '本子表在 kern 表内的字节偏移。' },
          { label: '子表版本', name: 'version', offset: null, size: 0, type: 'text', value: st.version, display: String(st.version), editable: false, description: '0 表示 16 位长度字段的原始格式；1 为 Apple 扩展（32 位长度）。' },
          { label: '长度', name: 'length', offset: null, size: 0, type: 'text', value: st.length, display: st.length + ' 字节', editable: false, description: '子表总长度（含表头）。' },
          { label: '格式（Format）', name: '—', offset: null, size: 0, type: 'text', value: st.format,
            display: st.format + (st.format === 0 ? ' —— 逐个字符对列表（最常见）' : st.format === 2 ? ' —— 类映射（kerning classes）' : st.format === 3 ? ' —— 简单索引' : '（其它格式）'),
            editable: false, description: '子表的数据组织方式。' },
          { label: '覆盖标志', name: '—', offset: null, size: 0, type: 'text', value: '', display:
            (st.horizontal ? '水平字距' : '垂直字距') + (st.minimum ? '、取最小值' : '') + (st.crossStream ? '、跨流' : '') + (st.override ? '、覆盖' : ''),
            editable: false, description: 'bit0 水平方向；bit1 取最小值（Apple）；bit2 跨流（垂直方向调整）；bit3 覆盖其它调整。' },
          { label: '配对数量', name: '—', offset: null, size: 0, type: 'text', value: st.nPairs || 0, display: st.pairs ? String(st.nPairs) : '—',
            editable: false, description: '仅格式 0 有此字段。' }
        ];
        sections.push(H.sec('子表 #' + (i + 1) + ' 概况', '', infoFields));

        if (st.pairs) {
          const rows = st.pairs.map((pr, k) => ({
            __index: k, __pair: pr,
            __edit: { value: { kind: 'kernValue', si: i, k: k } },
            left: pr.left,
            leftName: FL.font.cmapName(font, pr.left),
            right: pr.right,
            rightName: FL.font.cmapName(font, pr.right),
            value: pr.value
          }));
          const nonzero = st.pairs.filter((x) => x.value !== 0).length;
          rows.unshift({
            __index: -1, __summary: true,
            left: '（共 ' + st.pairs.length + ' 对）', leftName: '非零调整 ' + nonzero + ' 对',
            right: '', rightName: '', value: '—'
          });
          sections.push(H.matrix('子表 #' + (i + 1) + ' 字距配对（' + st.pairs.length + ' 对）',
            '每行格式为「左字形 + 右字形 = 调整值」。正值表示加宽（更松散），负值表示收紧（更紧凑）。可直接修改调整值；保存时写回表内。',
            [
              H.col('left', '左 GID', { width: '80px' }),
              H.col('leftName', '左字形', { align: 'left', width: '150px' }),
              H.col('right', '右 GID', { width: '80px' }),
              H.col('rightName', '右字形', { align: 'left', width: '150px' }),
              H.col('value', '调整值 (units)', { editable: true, editKind: 'kernValue', width: '130px', description: '加到该字符对上的额外间距，单位为设计单位（FUnit）。' })
            ], rows, { pageSize: 200, filterable: true }));
        } else {
          sections.push(H.note('子表数据', '格式 ' + st.format + ' 的数据本工具暂不解码，可用「原始数据」标签页查看/编辑字节。'));
        }
      });

      sections.push({
        kind: 'custom', id: 'kern-editor', title: '配对编辑（新增 / 修改 / 删除）',
        description: '输入左右字形索引与调整值即可新增或覆盖一个配对；选择已有配对后点"删除"可移除。保存时会重建 kern 表。',
        mount: mountKernEditor
      });

      return { sections: sections, model: { version: version, subs: subs, dirty: false } };
    },

    edit(font, table, ctx, value) {
      const model = table._model;
      const e = ctx.row.__edit && ctx.row.__edit.value;
      if (!e) return false;
      const v = parseInt(value, 10);
      if (isNaN(v) || v < -32768 || v > 32767) return { error: '调整值必须是 -32768 ~ 32767 之间的整数' };
      const ok = FL.patchBytes(table.bytes, e.si === 0 || model.subs.length === 1
        ? model.subs[e.si].pairs[e.k].byteOffset
        : model.subs[e.si].pairs[e.k].byteOffset, 'int16', v);
      model.subs[e.si].pairs[e.k].value = v;
      model.dirty = true;
      return true;
    },

    /** 重建 kern 表（全部子表按格式 0 重写，其它格式原样保留） */
    rebuild(font, table) {
      const model = table._model;
      if (!model) return null;
      const subs = model.subs;
      const parts = subs.map((st) => {
        if (st.format !== 0 || !st.pairs) {
          const len = st.length || 0;
          if (st.offset + len <= table.bytes.length) return table.bytes.subarray(st.offset, st.offset + len);
          return new Uint8Array(0);
        }
        const pairs = st.pairs.slice().sort((a, b) => (a.left - b.left) || (a.right - b.right));
        const nPairs = pairs.length;
        const len = 14 + nPairs * 6;
        const b = new FL.Builder(len);
        b.u16(0);                       // version
        b.u16(len);                     // length
        const cov = ((0 << 8) | (st.flags & 0xff)) & 0xffff;
        b.u16(cov);
        b.u16(nPairs);
        let pow = 1, sel = 0;
        while (pow * 2 <= nPairs && nPairs > 0) { pow *= 2; sel++; }
        const searchRange = nPairs ? pow * 6 : 0;
        b.u16(searchRange);
        b.u16(nPairs ? sel : 0);
        b.u16(nPairs ? nPairs * 6 - searchRange : 0);
        pairs.forEach((p) => { b.u16(p.left); b.u16(p.right); b.i16(p.value); });
        return b.toBytes();
      });
      const total = parts.reduce((a, x) => a + x.length, 0);
      const out = new Uint8Array(4 + total);
      const dv = new DataView(out.buffer);
      dv.setUint16(0, model.version || 0);
      dv.setUint16(2, subs.length);
      let p = 4;
      parts.forEach((x) => { out.set(x, p); p += x.length; });
      return out;
    }
  };

  /* ------------------------------------------------------------------ */
  function mountKernEditor(el, ctx) {
    const font = ctx.font;
    const model = ctx.table._model;
    const st = model.subs.find((s) => s.format === 0 && s.pairs);
    if (!st) { el.innerHTML = '<p class="muted">该字体没有格式 0 的字距子表，无法在此编辑。</p>'; return; }
    const wrap = document.createElement('div');
    wrap.className = 'pair-editor';
    wrap.innerHTML =
      '<div class="pe-row">' +
      '<label>左字形 <input type="number" id="pe-left" min="0" max="' + (font.numGlyphs - 1) + '" value="36"></label>' +
      '<label>右字形 <input type="number" id="pe-right" min="0" max="' + (font.numGlyphs - 1) + '" value="65"></label>' +
      '<label>调整值 <input type="number" id="pe-value" value="-30"></label>' +
      '<button class="btn" id="pe-set">新增 / 覆盖配对</button>' +
      '<button class="btn danger" id="pe-del">删除该配对</button>' +
      '</div><p class="muted small" id="pe-msg"></p>' +
      '<p class="muted small">提示：字形索引即 GID，可用上表搜索字形名确认。例如常见做法是为 "A" + "V" 设置负值以收紧间距。</p>';
    el.appendChild(wrap);
    const msg = (t, err) => { wrap.querySelector('#pe-msg').textContent = t; wrap.querySelector('#pe-msg').style.color = err ? '#d34' : '#3a3'; };
    const getVals = () => ({
      left: parseInt(wrap.querySelector('#pe-left').value, 10),
      right: parseInt(wrap.querySelector('#pe-right').value, 10),
      value: parseInt(wrap.querySelector('#pe-value').value, 10)
    });
    wrap.querySelector('#pe-set').addEventListener('click', () => {
      const v = getVals();
      if (isNaN(v.left) || isNaN(v.right) || isNaN(v.value)) return msg('请输入有效的整数', true);
      if (v.left < 0 || v.left >= font.numGlyphs || v.right < 0 || v.right >= font.numGlyphs) return msg('字形索引超出范围', true);
      const ex = st.pairs.find((p) => p.left === v.left && p.right === v.right);
      if (ex) { ex.value = v.value; msg('已更新配对 (' + v.left + ',' + v.right + ') = ' + v.value); }
      else { st.pairs.push({ left: v.left, right: v.right, value: v.value }); msg('已新增配对 (' + v.left + ',' + v.right + ') = ' + v.value); }
      model.dirty = true;
      ctx.app.markRebuild(ctx.table.tag, 'kern 配对已修改');
      ctx.app.refreshTable(ctx.table.tag);
    });
    wrap.querySelector('#pe-del').addEventListener('click', () => {
      const v = getVals();
      const idx = st.pairs.findIndex((p) => p.left === v.left && p.right === v.right);
      if (idx < 0) return msg('未找到该配对', true);
      st.pairs.splice(idx, 1);
      model.dirty = true;
      ctx.app.markRebuild(ctx.table.tag, 'kern 配对已删除');
      msg('已删除配对 (' + v.left + ',' + v.right + ')');
      ctx.app.refreshTable(ctx.table.tag);
    });
  }

  /* =====================================================================
   * gasp —— 栅格化参数
   * =================================================================== */
  T['gasp'] = {
    parse(font, table) {
      H.need(table, 4, 'gasp');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const numRanges = r.u16();
      const fields = [
        F(r, { offset: 0, type: 'uint16', name: 'version', label: '表版本', editable: true, description: '目前为 0 或 1。版本 1 允许未来扩展。' }),
        F(r, { offset: 2, type: 'uint16', name: 'numRanges', label: '范围数量', editable: false, description: '下表记录条数。' })
      ];
      const rows = [];
      for (let i = 0; i < numRanges; i++) {
        const p = 4 + i * 4;
        if (p + 4 > table.bytes.length) break;
        const maxPPEM = FL.TYPES.uint16.r(r.view, p);
        const behavior = FL.TYPES.uint16.r(r.view, p + 2);
        rows.push({
          __index: i,
          __edit: {
            maxPPEM: { kind: 'gaspRange', offset: p, type: 'uint16' },
            behavior: { kind: 'gaspRange', offset: p + 2, type: 'uint16' }
          },
          maxPPEM: maxPPEM,
          behavior: behavior,
          behaviorText: U.formatBits(behavior, U.GASP_BEHAVIOR_BITS)
        });
      }
      return {
        sections: [
          H.sec('gasp 表头', 'gasp（Grid-fitting and Scan-conversion Procedure）告诉渲染器在不同像素尺寸下应采用哪种栅格化策略：小字号通常开启网格拟合以保证清晰，大字号则使用灰度/平滑渲染。', fields),
          H.matrix('范围表', '每一行声明"像素尺寸 ≤ rangeMaxPPEM 时使用以下策略"。第一个范围的值表示适用于 0 到该值的所有尺寸。',
            [
              H.col('maxPPEM', '适用最大像素尺寸 (ppem)', { editable: true, editKind: 'gaspRange', width: '190px', description: '该规则适用的最大 ppem；通常最后一条为 65535 表示"以上都适用"。' }),
              H.col('behavior', '行为位', { editable: true, editKind: 'gaspRange', width: '110px', description: '位标志数值：bit0 网格拟合，bit1 灰度，bit2 对称平滑，bit3 对称网格拟合。' }),
              H.col('behaviorText', '含义', { align: 'left' })
            ], rows, { pageSize: 0 })
        ],
        model: { rows: rows }
      };
    },
    edit(font, table, ctx, value) {
      const e = ctx.row.__edit[ctx.col.key];
      const v = parseInt(value, 10);
      if (isNaN(v) || v < 0 || v > 65535) return { error: '请输入 0~65535 的整数' };
      FL.patchBytes(table.bytes, e.offset, e.type, v);
      ctx.row[ctx.col.key] = v;
      if (ctx.col.key === 'behavior') ctx.row.behaviorText = U.formatBits(v, U.GASP_BEHAVIOR_BITS);
      return true;
    }
  };

  /* =====================================================================
   * cvt  —— 控制值表
   * =================================================================== */
  T['cvt '] = {
    parse(font, table) {
      const n = Math.floor(table.bytes.length / 2);
      const r = new FL.Reader(table.bytes);
      const rows = [];
      const maxp = font.tableMap['maxp'];
      for (let i = 0; i < n; i++) {
        const v = FL.TYPES.int16.r(r.view, i * 2);
        rows.push({ __index: i, __edit: { value: { kind: 'cvt', offset: i * 2 } }, index: i, value: v });
      }
      return {
        sections: [
          H.sec('cvt 表概况', 'cvt（Control Value Table）存放一组经过挑选的关键尺寸（如 x 高度、笔画粗细），供 TrueType 提示指令通过索引引用，以便在不同字号下保持一致的视觉尺寸。', [
            { label: '控制值数量', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(n), editable: false, description: '每个控制值占 2 字节（int16）。' },
            { label: '表长度', name: '—', offset: null, size: 0, type: 'text', value: '', display: table.bytes.length + ' 字节', editable: false, description: '应等于控制值数量 × 2。' },
            { label: '说明', name: '—', offset: null, size: 0, type: 'text', value: '', display: maxp && maxp.bytes.length >= 32 ? '需要 ' + FL.TYPES.uint16.r(new FL.Reader(maxp.bytes).view, 18) + ' 个存储单元执行提示程序（maxStorage）' : '—', editable: false, description: '所有控制值由 fpgm/prep 中的指令使用。' }
          ]),
          H.matrix('控制值', '索引 → 值（单位为设计单位）。可修改数值；提示程序中的引用索引不变。',
            [H.col('index', '索引', { width: '80px' }), H.col('value', '控制值', { editable: true, editKind: 'cvt', width: '130px', description: 'int16 数值，通常为正数，表示一个关键距离。' })],
            rows, { pageSize: 200 })
        ],
        model: {}
      };
    },
    edit(font, table, ctx, value) {
      const v = parseInt(value, 10);
      if (isNaN(v) || v < -32768 || v > 32767) return { error: '控制值必须是 int16（-32768 ~ 32767）' };
      FL.patchBytes(table.bytes, ctx.row.__edit.value.offset, 'int16', v);
      ctx.row.value = v;
      return true;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
