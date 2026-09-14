/* =========================================================================
 * tables/os2.js —— OS/2 度量表（版本 0~5）
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;
  const F = H.F;

  const FAMILY_CLASS = {
    0: 'No Classification 无分类', 1: 'Oldstyle Serifs 旧体衬线',
    2: 'Transitional Serifs 过渡体衬线', 3: 'Modern Serifs 现代衬线',
    4: 'Clarendon Serifs 克拉伦登衬线', 5: 'Slab Serifs 粗衬线（埃及体）',
    6: '（保留）', 7: 'Freeform Serifs 自由形式衬线', 8: 'Sans Serif 无衬线',
    9: 'Ornamentals 装饰体', 10: 'Scripts 手写体', 11: '（保留）', 12: 'Symbolic 符号字体'
  };

  const VERSION_NOTES = {
    0: '版本 0：最初的 TrueType/OpenType 定义（78 字节）',
    1: '版本 1：增加代码页范围 ulCodePageRange1/2（86 字节）',
    2: '版本 2：增加 x 高度、大写高度、默认字符等（96 字节）—— 目前最常见的版本',
    3: '版本 3：增加默认字符/断行字符语义（96 字节）',
    4: '版本 4：为 usDefaultChar/usBreakChar 增加 Unicode 平面说明（96 字节）',
    5: '版本 5：增加光学尺寸下限/上限（100 字节）—— 用于可变光学尺寸字体'
  };

  T['OS/2'] = {
    parse(font, table) {
      H.need(table, 78, 'OS/2');
      const r = new FL.Reader(table.bytes);
      const version = FL.TYPES.uint16.r(r.view, 0);
      const b = table.bytes;

      const fields = [
        F(r, { offset: 0, type: 'uint16', name: 'version', label: '表版本', editable: true,
          description: (VERSION_NOTES[version] || '未知版本 ' + version) + '。版本决定了表长与可用字段。' }),
        F(r, { offset: 2, type: 'int16', name: 'xAvgCharWidth', label: '平均字符宽度', editable: true, unit: 'units',
          description: '所有非零宽度字形 advance 的平均值（近似值）。排版软件用它估算文本总宽，可留 0（表示未计算）。' }),
        F(r, { offset: 4, type: 'uint16', name: 'usWeightClass', label: '字重等级', editable: true, enumMap: U.WEIGHT_CLASS,
          description: '字体的笔画粗细等级，100~900（100 最细，400 为常规，700 为粗体）。CSS 的 font-weight 直接映射到该值。' }),
        F(r, { offset: 6, type: 'uint16', name: 'usWidthClass', label: '字宽等级', editable: true, enumMap: U.WIDTH_CLASS,
          description: '字体的宽度等级 1~9（1 极窄，5 标准，9 极宽）。对应 CSS font-stretch。' }),
        F(r, { offset: 8, type: 'uint16', name: 'fsType', label: '嵌入权限', editable: true, bits: U.FSTYPE_BITS,
          description: '声明字体在文档中的嵌入许可。bit0 为 1 表示受限制（不可嵌入）；否则由 bit1（预览打印）/bit2（可编辑）决定。' }),
        F(r, { offset: 10, type: 'int16', name: 'ySubscriptXSize', label: '下标字号（X 尺寸）', editable: true, unit: 'units', description: '下标字形的水平缩放尺寸，通常为 em 的 65%。' }),
        F(r, { offset: 12, type: 'int16', name: 'ySubscriptYSize', label: '下标字号（Y 尺寸）', editable: true, unit: 'units', description: '下标字形的垂直缩放尺寸。' }),
        F(r, { offset: 14, type: 'int16', name: 'ySubscriptXOffset', label: '下标水平偏移', editable: true, unit: 'units', description: '下标相对基线的水平偏移量。' }),
        F(r, { offset: 16, type: 'int16', name: 'ySubscriptYOffset', label: '下标垂直偏移', editable: true, unit: 'units', description: '下标相对基线的垂直偏移量（通常为负，向下偏移）。' }),
        F(r, { offset: 18, type: 'int16', name: 'ySuperscriptXSize', label: '上标字号（X 尺寸）', editable: true, unit: 'units', description: '上标字形的水平缩放尺寸。' }),
        F(r, { offset: 20, type: 'int16', name: 'ySuperscriptYSize', label: '上标字号（Y 尺寸）', editable: true, unit: 'units', description: '上标字形的垂直缩放尺寸。' }),
        F(r, { offset: 22, type: 'int16', name: 'ySuperscriptXOffset', label: '上标水平偏移', editable: true, unit: 'units', description: '上标相对基线的水平偏移量。' }),
        F(r, { offset: 24, type: 'int16', name: 'ySuperscriptYOffset', label: '上标垂直偏移', editable: true, unit: 'units', description: '上标相对基线的垂直偏移量（通常为正，向上偏移）。' }),
        F(r, { offset: 26, type: 'int16', name: 'yStrikeoutSize', label: '删除线粗细', editable: true, unit: 'units', description: '删除线（strikeout）的笔画粗细，通常等于下划线粗细。' }),
        F(r, { offset: 28, type: 'int16', name: 'yStrikeoutPosition', label: '删除线位置', editable: true, unit: 'units', description: '删除线中心相对基线的 y 坐标，常用值为 x-height 的一半左右。' }),
        F(r, {
          offset: 30, type: 'int16', name: 'sFamilyClass', label: '字体族分类',
          editable: true, value: null,
          description: 'IBM 字体族分类：高字节为 class（见下），低字节为 subclass。用于旧式字体匹配。'
        }),
        F(r, { offset: 62, type: 'uint16', name: 'fsSelection', label: '样式选择位', editable: true, bits: U.FSSELECTION_BITS,
          description: '字体的样式位：斜体、粗体、常规、下划线等，以及是否使用 Typo 度量作为推荐行高（USE_TYPO_METRICS）。' }),
        F(r, { offset: 64, type: 'uint16', name: 'usFirstCharIndex', label: '最小字符码', editable: true, unit: 'Unicode 码点',
          description: '字体支持的最小字符编码，十进制数值。例如 0x0020 表示从空格开始。' }),
        F(r, { offset: 66, type: 'uint16', name: 'usLastCharIndex', label: '最大字符码', editable: true, unit: 'Unicode 码点',
          description: '字体支持的最大字符编码。< 0xFFFF 时可用于快速判断 cmap 覆盖范围。' }),
        F(r, { offset: 68, type: 'int16', name: 'sTypoAscender', label: 'Typo 上升部', editable: true, unit: 'units',
          description: '推荐用于行高计算的上升部，通常等于 hhea.ascender，但两者含义独立（Typo 度量用于排版，Win 度量用于 UI 裁剪）。' }),
        F(r, { offset: 70, type: 'int16', name: 'sTypoDescender', label: 'Typo 下降部', editable: true, unit: 'units',
          description: '推荐用于行高计算的下降部（负值）。默认行高 = sTypoAscender - sTypoDescender + sTypoLineGap。' }),
        F(r, { offset: 72, type: 'int16', name: 'sTypoLineGap', label: 'Typo 行距', editable: true, unit: 'units',
          description: '推荐的行间距，很多字体的习惯做法是设置为 0 或 UPM 的 20%。' }),
        F(r, { offset: 74, type: 'uint16', name: 'usWinAscent', label: 'Win 上升部', editable: true, unit: 'units',
          description: 'Windows 下字形裁剪框的上升部。必须大于等于所有字形的最大 yMax，否则顶部会被裁掉。' }),
        F(r, { offset: 76, type: 'uint16', name: 'usWinDescent', label: 'Win 下降部', editable: true, unit: 'units',
          description: 'Windows 下裁剪框的下降部（正值，表示基线向下多少）。必须覆盖最深的降部。' })
      ];

      if (version >= 1 && b.length >= 86) {
        fields.push(F(r, { offset: 78, type: 'uint32', name: 'ulCodePageRange1', label: '代码页范围 1（位 0~31）', editable: true,
          description: '声明字体支持的 DOS/Windows 代码页，见下方「已启用的代码页」。' }));
        fields.push(F(r, { offset: 82, type: 'uint32', name: 'ulCodePageRange2', label: '代码页范围 2（位 32~63）', editable: true,
          description: '代码页范围的扩展位（多为 IBM/DOS 传统代码页）。' }));
      }
      if (version >= 2 && b.length >= 96) {
        fields.push(F(r, { offset: 86, type: 'int16', name: 'sxHeight', label: 'x 高度', editable: true, unit: 'units',
          description: '小写字母 x 的高度，用于光学对齐和行内计算。应与字形 "x" 的实际高度一致。' }));
        fields.push(F(r, { offset: 88, type: 'int16', name: 'sCapHeight', label: '大写高度', editable: true, unit: 'units',
          description: '大写字母（如 H）的高度，用于光学对齐。' }));
        fields.push(F(r, { offset: 90, type: 'uint16', name: 'usDefaultChar', label: '默认字符', editable: true,
          description: '无法显示字符时使用的替代字符（通常为 0，表示用 .notdef）。' }));
        fields.push(F(r, { offset: 92, type: 'uint16', name: 'usBreakChar', label: '断行字符', editable: true,
          description: '用于断行的字符，通常为 32（空格）。' }));
        fields.push(F(r, { offset: 94, type: 'uint16', name: 'usMaxContext', label: '最大上下文长度', editable: true,
          description: 'GSUB/GPOS 中上下文规则所需的最大字形回溯/前瞻长度，供引擎分配缓冲区。' }));
      }
      if (version >= 5 && b.length >= 100) {
        fields.push(F(r, { offset: 96, type: 'uint16', name: 'usLowerOpticalPointSize', label: '光学尺寸下限', editable: true, unit: 'twips (1/20 pt)',
          description: '可变光学尺寸（opsz 轴）的最小字号，以 twips 表示（20 twips = 1pt）。' }));
        fields.push(F(r, { offset: 98, type: 'uint16', name: 'usUpperOpticalPointSize', label: '光学尺寸上限', editable: true, unit: 'twips (1/20 pt)',
          description: '可变光学尺寸的最大字号。' }));
      }

      // ---- Panose ----
      const panoseBytes = b.subarray(32, 42);
      const fam = panoseBytes[0];
      const panoseRows = [];
      for (let i = 0; i < 10; i++) {
        let desc = '';
        if (i === 0) desc = U.PANOSE_FAMILY[panoseBytes[0]] || '未知族';
        else if (fam === 2 && U.PANOSE_LATIN[i]) {
          const def = U.PANOSE_LATIN[i];
          desc = def.name + '：' + (def.values[panoseBytes[i]] || '未知(' + panoseBytes[i] + ')');
        } else desc = '数值 ' + panoseBytes[i] + '（该字体族下含义见 PANOSE 规范）';
        panoseRows.push({ __index: i, pos: i, value: panoseBytes[i], desc: desc });
      }

      // ---- Unicode 范围 ----
      const urRows = [];
      if (b.length >= 58) {
        const ranges = [FL.TYPES.uint32.r(r.view, 42), FL.TYPES.uint32.r(r.view, 46), FL.TYPES.uint32.r(r.view, 50), FL.TYPES.uint32.r(r.view, 54)];
        for (let i = 0; i < 128; i++) {
          const w = ranges[i >> 5];
          if (w & (1 << (i & 31))) {
            urRows.push({ __index: i, bit: i, word: (i >> 5) + 1, name: U.UNICODE_RANGES[i] || '（保留位）' });
          }
        }
      }

      // ---- 代码页范围 ----
      const cpRows = [];
      if (version >= 1 && b.length >= 86) {
        const cps = [FL.TYPES.uint32.r(r.view, 78), FL.TYPES.uint32.r(r.view, 82)];
        for (let i = 0; i < 64; i++) {
          if (cps[i >> 5] & (1 << (i & 31))) {
            cpRows.push({ __index: i, bit: i, word: (i >> 5) + 1, name: U.CODEPAGE_RANGES[i] || '（保留位）' });
          }
        }
      }

      const vendID = U.printable(U.bytesToStr(b, 58, 4));

      const sections = [
        H.sec('OS/2 概览', 'OS/2 表是字体在 Windows 上被正确识别与排版的关键表。', [
          { label: '字重 / 字宽', name: '—', offset: null, size: 0, type: 'text', value: '', display:
            (U.WEIGHT_CLASS[FL.TYPES.uint16.r(r.view, 4)] || FL.TYPES.uint16.r(r.view, 4)) + ' / ' +
            (U.WIDTH_CLASS[FL.TYPES.uint16.r(r.view, 6)] || FL.TYPES.uint16.r(r.view, 6)),
            editable: false, description: '字重与字宽的等级，展示字体在字体家族中的位置。' },
          { label: '字体族分类', name: '—', offset: null, size: 0, type: 'text', value: '', display:
            (FAMILY_CLASS[(FL.TYPES.int16.r(r.view, 30) >> 8) & 0xff] || '未知') + '，子类 ' + (FL.TYPES.int16.r(r.view, 30) & 0xff),
            editable: false, description: 'sFamilyClass 的高字节为 class、低字节为 subclass 编号。' },
          { label: '厂商 ID', name: 'achVendID', offset: 58, size: 4, type: 'text', value: vendID, display: vendID || '（空）',
            editable: false, description: '4 字符的厂商标识，例如 "MS  "、"ADBE"、"GOOG"，由 Microsoft 分配。' },
          { label: '嵌入权限摘要', name: '—', offset: null, size: 0, type: 'text', value: '', display: (() => {
            const fs = FL.TYPES.uint16.r(r.view, 8);
            if (fs & 2) return '禁止嵌入（Restricted License）';
            if (fs & 8) return '允许可编辑嵌入';
            if (fs & 4) return '允许预览与打印嵌入';
            return '未声明（按预览打印处理）';
          })(), editable: false, description: '由 fsType 位推导出的嵌入许可结论。' }
        ]),
        H.sec('OS/2 表字段', '共 ' + b.length + ' 字节（版本 ' + version + '）。', fields),
        H.matrix('Panose 字族分类', 'Panose 是一套用于字体替换与匹配的分类数字，共 10 个字节。第一个字节是字体族，其后 9 个字节的含义随族而定（下表按"拉丁文本"族解释）。', [
          H.col('pos', '字节', { width: '60px' }),
          H.col('value', '数值', { width: '80px' }),
          H.col('desc', '含义', { align: 'left' })
        ], panoseRows, { pageSize: 20 }),
        H.matrix('已启用的 Unicode 范围', 'ulUnicodeRange1~4 共 128 位，每一位代表一个 Unicode 区块，声明字体覆盖了哪些区块（供系统做字体匹配）。以下仅列出已置位的区块。', [
          H.col('bit', '位序号', { width: '80px' }),
          H.col('word', '所在字', { width: '80px' }),
          H.col('name', 'Unicode 区块', { align: 'left' })
        ], urRows, { pageSize: 0 }),
        cpRows.length
          ? H.matrix('已启用的代码页', 'ulCodePageRange1~2 共 64 位，声明字体覆盖的传统代码页。', [
            H.col('bit', '位序号', { width: '80px' }),
            H.col('word', '所在字', { width: '80px' }),
            H.col('name', '代码页', { align: 'left' })
          ], cpRows, { pageSize: 0 })
          : H.note('代码页范围', '该表版本为 ' + version + '，不含代码页范围字段。')
      ];

      return { sections: sections, model: { version: version, fields: fields } };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
