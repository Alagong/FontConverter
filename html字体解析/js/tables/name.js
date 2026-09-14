/* =========================================================================
 * tables/name.js —— 名称表（name）
 *  支持解析所有平台/编码/语言的名称记录，可编辑字符串并重建整个表
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;
  const F = H.F;

  /** 快速编辑项：nameID -> 展示名 */
  const QUICK = [
    [1, '字体家族名（Family Name）', '用户在选择字体时看到的名字，例如「思源黑体」。中文系统常同时提供本地化名称（换用同 nameID 的多条记录）。'],
    [2, '子族名（Subfamily）', '家族内的样式名，例如 Regular、Bold、Italic。'],
    [4, '完整字体名（Full Name）', '通常为「家族名 + 子族名」，例如 Source Han Sans Bold。'],
    [6, 'PostScript 名', '无空格、仅 ASCII 的字体名（如 SourceHanSans-Bold），用于 PostScript/PDF 引用。'],
    [5, '版本字符串', '例如 Version 1.005；应与 head.fontRevision 保持一致。'],
    [16, '排版家族名（Preferred Family）', '当家族名超过了 4 个样式（如 Light/Regular/Bold/Black）时，用于分组显示。'],
    [17, '排版子族名（Preferred Subfamily）', '与排版家族名配套的样式名。'],
    [0, '版权声明', '版权信息，通常包含 © 符号与年份。'],
    [7, '商标声明', '商标信息。'],
    [8, '制造商', '字体厂商名称。'],
    [9, '设计者', '字体设计者名称。'],
    [13, '许可说明', '授权条款文本（如 SIL OFL 1.1）。'],
    [11, '厂商网址', '厂商网站地址。'],
    [19, '样例文本', '用于预览字体效果的样例文字。']
  ];

  T['name'] = {
    parse(font, table) {
      H.need(table, 6, 'name');
      const r = new FL.Reader(table.bytes);
      const b = table.bytes;
      const format = FL.TYPES.uint16.r(r.view, 0);
      const count = FL.TYPES.uint16.r(r.view, 2);
      const stringOffset = FL.TYPES.uint16.r(r.view, 4);
      const records = [];

      for (let i = 0; i < count; i++) {
        const p = 6 + i * 12;
        if (p + 12 > b.length) break;
        const rec = {
          platformID: FL.TYPES.uint16.r(r.view, p),
          encodingID: FL.TYPES.uint16.r(r.view, p + 2),
          languageID: FL.TYPES.uint16.r(r.view, p + 4),
          nameID: FL.TYPES.uint16.r(r.view, p + 6),
          length: FL.TYPES.uint16.r(r.view, p + 8),
          offset: FL.TYPES.uint16.r(r.view, p + 10),
          recOffset: p
        };
        const raw = b.subarray(stringOffset + rec.offset, stringOffset + rec.offset + rec.length);
        rec.raw = raw;
        rec.text = U.decodeText(raw, rec.platformID, rec.encodingID);
        records.push(rec);
      }

      // 语言名称
      const langName = (p, l) =>
        p === 3 ? U.WIN_LANGS[l] || '未知语言 (0x' + U.hex4(l) + ')'
          : p === 1 ? U.MAC_LANGS[l] || '未知语言 (' + l + ')'
            : p === 0 ? '（Unicode 平台）' : '—';

      const rows = records.map((rec, i) => ({
        __index: i,
        __rec: rec,
        __edit: {
          text: { kind: 'nameText', index: i },
          platformID: { kind: 'nameHdr', index: i, field: 'platformID' },
          encodingID: { kind: 'nameHdr', index: i, field: 'encodingID' },
          languageID: { kind: 'nameHdr', index: i, field: 'languageID' },
          nameID: { kind: 'nameHdr', index: i, field: 'nameID' }
        },
        platform: rec.platformID + ' ' + (U.PLATFORM_IDS[rec.platformID] || '未知'),
        encoding: encName(rec.platformID, rec.encodingID),
        language: rec.languageID + ' ' + langName(rec.platformID, rec.languageID),
        nameID: rec.nameID,
        nameDesc: (U.NAME_IDS[rec.nameID] || '未定义用途（可由厂商自定义）').split('（')[0],
        text: U.visible(rec.text),
        rawLen: rec.length
      }));

      const quickFields = QUICK.map((q) => {
        const nameID = q[0];
        const primary = pickPrimary(records, nameID);
        return {
          label: q[1], name: 'nameID=' + nameID, offset: primary ? primary.recOffset : null,
          size: 0, type: 'text', value: primary ? primary.text : '',
          display: primary ? U.visible(primary.text) : '（无此名称记录）',
          editable: true, editKind: 'nameQuick', nameId: nameID,
          description: q[2] + '　当前共 ' + records.filter((x) => x.nameID === nameID).length + ' 条记录（不同平台/语言）。修改将同时更新所有平台/语言的同名记录。'
        };
      });

      const sections = [
        H.sec('常用名称（快速编辑）',
          '这些是字体最重要的名称字段，修改后会同步更新所有平台/编码下的同名记录，并自动重建 name 表。', quickFields),
        H.sec('name 表头', '', [
          F(r, { offset: 0, type: 'uint16', name: 'format', label: '表格式', editable: true,
            description: '0 = 常规格式；1 = 增加了语言标签记录（language-tag records，少见）。本工具保存时统一输出格式 0。' }),
          F(r, { offset: 2, type: 'uint16', name: 'count', label: '记录数量', editable: true,
            description: '名称记录条数。修改不会自动增减记录，请通过下方表格编辑。' }),
          F(r, { offset: 4, type: 'uint16', name: 'stringOffset', label: '字符串区起始偏移', editable: false,
            description: '字符串存储区相对表头的偏移，保存重建时自动计算。' })
        ]),
        H.matrix('名称记录（Name Records）',
          '每 12 字节一条记录，指向字符串区中的一段文本。不同平台使用不同的编码：Windows(3) 与 Unicode(0) 平台为 UTF-16BE，Mac(1) 平台为 MacRoman 等传统编码。' +
          '可直接编辑文本、平台、编码、语言与 nameID（保存时会重建整表）。',
          [
            H.col('platform', '平台', { align: 'left', editable: true, width: '150px', description: '0 为 Unicode 平台，1 为 Macintosh，3 为 Microsoft(Windows)。' }),
            H.col('encoding', '编码', { align: 'left', width: '190px' }),
            H.col('language', '语言', { align: 'left', width: '170px' }),
            H.col('nameID', 'nameID', { editable: true, width: '80px' }),
            H.col('nameDesc', '名称用途', { align: 'left', width: '200px' }),
            H.col('text', '文本内容', { align: 'left', editable: true, editKind: 'nameText', width: '34%' }),
            H.col('rawLen', '字节数', { width: '70px' })
          ], rows, { pageSize: 100, filterable: true }),
        H.matrix('nameID 对照表', '规范定义的 nameID 含义（本表出现过的记录已在上方标注）。',
          [H.col('id', 'nameID', { width: '80px' }), H.col('desc', '含义', { align: 'left' })],
          Object.keys(U.NAME_IDS).sort((a, b2) => a - b2).map((id) => ({ __index: id, id: id, desc: U.NAME_IDS[id] })),
          { pageSize: 0 })
      ];

      return {
        sections: sections,
        model: { format: format, stringOffset: stringOffset, records: records, dirty: false }
      };
    },

    edit(font, table, ctx, value) {
      const model = table._model;
      if (!model) return false;
      if (ctx.field && ctx.field.editKind === 'nameQuick') {
        const id = ctx.field.nameId;
        const list = model.records.filter((x) => x.nameID === id);
        if (!list.length) return { error: '该字体没有 nameID=' + id + ' 的记录，无法修改' };
        list.forEach((rec) => { rec.text = String(value); });
        model.dirty = true;
        ctx.field.display = U.visible(String(value));
        return true;
      }
      const e = ctx.row.__edit[ctx.col.key];
      if (!e) return false;
      const rec = model.records[e.index];
      if (e.kind === 'nameText') rec.text = String(value);
      else {
        const v = parseInt(value, 10);
        if (isNaN(v) || v < 0 || v > 65535) return { error: '请输入 0~65535 之间的整数' };
        rec[e.field] = v;
      }
      model.dirty = true;
      return true;
    },

    /** 重建 name 表 */
    rebuild(font, table) {
      const model = table._model;
      if (!model) return null;
      const recs = model.records;
      // 1) 先编码所有字符串并计算每条记录在字符串区中的偏移
      const encoded = recs.map((rec) => U.encodeText(rec.text, rec.platformID, rec.encodingID));
      // 检查编码是否有损（例如中文写入 MacRoman 记录会变成 ?）
      const lossy = [];
      recs.forEach((rec, i) => {
        const back = U.decodeText(encoded[i], rec.platformID, rec.encodingID);
        if (back !== rec.text) {
          lossy.push('nameID=' + rec.nameID + '（平台 ' + rec.platformID + '/' + rec.encodingID + '）');
        }
      });
      model.lossy = lossy;
      const count = recs.length;
      const dirSize = 6 + count * 12;
      const offsets = [];
      let strOff = 0;
      encoded.forEach((e) => {
        offsets.push(strOff);
        strOff += e.length;
        if (strOff & 1) strOff++;      // 保持偶数对齐（与原表一致）
      });
      const stringLen = strOff;
      const b = new FL.Builder(dirSize + stringLen + 32);
      b.u16(0);                    // format 0
      b.u16(count);
      b.u16(6 + count * 12);       // stringOffset：记录区之后
      recs.forEach((rec, i) => {
        b.u16(rec.platformID);
        b.u16(rec.encodingID);
        b.u16(rec.languageID);
        b.u16(rec.nameID);
        b.u16(encoded[i].length);
        b.u16(offsets[i]);
        rec.offset = offsets[i];
        rec.length = encoded[i].length;
      });
      // 2) 写入字符串区
      encoded.forEach((e) => {
        b.bytes(e);
        if (e.length & 1) b.u8(0);
      });
      return b.toBytes();
    }
  };

  function encName(p, e) {
    if (p === 3) return 'Windows / ' + (U.WIN_ENCODINGS[e] || '编码 ' + e);
    if (p === 1) return 'Mac / ' + (U.MAC_ENCODINGS[e] || '编码 ' + e);
    if (p === 0) return 'Unicode / ' + (U.UNICODE_ENCODINGS[e] || '编码 ' + e);
    return '编码 ' + e;
  }

  /** 挑选一条"主记录"用于快速编辑展示（优先 Windows en-US / 中文，其次 Unicode） */
  function pickPrimary(records, nameID) {
    const list = records.filter((r) => r.nameID === nameID);
    if (!list.length) return null;
    const score = (r) => {
      let s = 0;
      if (r.platformID === 3) s += 100;
      if (r.platformID === 0) s += 60;
      if (r.languageID === 0x0409) s += 20;
      if (r.languageID === 0x0804 || r.languageID === 0x0404) s += 10;
      return s;
    };
    return list.slice().sort((a, b) => score(b) - score(a))[0];
  }
})(typeof window !== 'undefined' ? window : globalThis);
