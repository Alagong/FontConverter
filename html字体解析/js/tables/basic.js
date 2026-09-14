/* =========================================================================
 * tables/basic.js —— head / hhea / vhea / maxp / post / hmtx / vmtx
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;
  const F = H.F;

  /* =====================================================================
   * head —— 字体头表
   * =================================================================== */
  T['head'] = {
    parse(font, table) {
      H.need(table, 54, 'head');
      const r = new FL.Reader(table.bytes);
      const E = (v) => v;      // 占位，保持可读性
      const fields = [
        F(r, { offset: 0, type: 'uint32', name: 'version', label: '表版本', display: '0x' + U.hex8(FL.TYPES.uint32.r(r.view, r.base + 0)),
          description: 'head 表的版本号，固定为 0x00010000。' }),
        F(r, { offset: 4, type: 'fixed', name: 'fontRevision', label: '字体版本号', editable: true,
          description: '由字体厂商自行设定的版本号（Fixed 16.16 定点数）。OS/2 与 name 表中的版本字符串常与之对应，例如 1.5 表示版本 1.5。' }),
        F(r, { offset: 8, type: 'uint32', name: 'checkSumAdjustment', label: '校验和调整值',
          description: '使整个字体文件的校验和为 0xB1B0AFBA 的补偿值。保存时由本工具自动重新计算，无需手工修改。' }),
        F(r, { offset: 12, type: 'uint32', name: 'magicNumber', label: '魔数', display: '0x' + U.hex8(FL.TYPES.uint32.r(r.view, r.base + 12)),
          description: '固定值 0x5F0F3CF5，用于识别合法的 head 表。不可修改。' }),
        F(r, { offset: 16, type: 'uint16', name: 'flags', label: '标志位', editable: true, bits: U.HEAD_FLAGS,
          description: '字体全局标志：如基线位置、是否依赖字号执行提示、是否针对 ClearType 优化等。' }),
        F(r, { offset: 18, type: 'uint16', name: 'unitsPerEm', label: '每 em 单位数', editable: true, unit: 'units/em',
          description: '设计网格大小（em 方形包含的设计单位数），常见为 1000（PostScript 传统）或 2048（TrueType 传统）。所有坐标都以此为基准；改大该值相当于提高设计精度。' }),
        F(r, { offset: 20, type: 'longdatetime', name: 'created', label: '创建时间', editable: true, editType: 'datetime',
          description: '字体创建时间，格式为自 1904-01-01 00:00:00 UTC 起的秒数（LONGDATETIME）。' }),
        F(r, { offset: 28, type: 'longdatetime', name: 'modified', label: '修改时间', editable: true, editType: 'datetime',
          description: '字体最后修改时间（LONGDATETIME）。发布字体前通常应更新此值。' }),
        F(r, { offset: 36, type: 'int16', name: 'xMin', label: '全局 X 最小值', editable: true, unit: 'units',
          description: '所有字形轮廓的最小 x 坐标（通常为负，来自伸出基线的字形）。用于计算整体边界框。' }),
        F(r, { offset: 38, type: 'int16', name: 'yMin', label: '全局 Y 最小值', editable: true, unit: 'units',
          description: '所有字形轮廓的最小 y 坐标（如 p、g 的降部）。' }),
        F(r, { offset: 40, type: 'int16', name: 'xMax', label: '全局 X 最大值', editable: true, unit: 'units',
          description: '所有字形轮廓的最大 x 坐标（如 f、W 的右端），影响排版时的最大宽度计算。' }),
        F(r, { offset: 42, type: 'int16', name: 'yMax', label: '全局 Y 最大值', editable: true, unit: 'units',
          description: '所有字形轮廓的最大 y 坐标（如重音符号的顶端）。' }),
        F(r, { offset: 44, type: 'uint16', name: 'macStyle', label: 'Mac 样式', editable: true, bits: U.MACSTYLE_BITS,
          description: 'Mac 系统使用的样式位：粗体、斜体、下划线等。应与 OS/2.fsSelection 保持一致。' }),
        F(r, { offset: 46, type: 'uint16', name: 'lowestRecPPEM', label: '最小可读像素尺寸', editable: true, unit: 'px',
          description: '建议使用该字体的最小像素高度（ppem），小于此值笔画可能粘连。常见值为 8~12。' }),
        F(r, { offset: 48, type: 'int16', name: 'fontDirectionHint', label: '字体方向提示（已废弃）', editable: true, enumMap: U.FONT_DIRECTION_HINT,
          description: '旧版用于提示字形方向（左右/上下）。新版规范已废弃，通常写 2 或 0。' }),
        F(r, { offset: 50, type: 'int16', name: 'indexToLocFormat', label: 'loca 表格式', editable: true, enumMap: U.INDEX_TO_LOC_FORMAT,
          description: 'loca（字形位置表）的偏移量存储方式：0 为 short（值×2），1 为 long。字形数据总长超过 128KB 时必须为 long。修改字形轮廓后本工具会自动校正。' }),
        F(r, { offset: 52, type: 'int16', name: 'glyphDataFormat', label: '字形数据格式', editable: true,
          description: '字形数据格式，目前固定为 0，保留给未来扩展。' })
      ];

      const upm = fields[5].value;
      const derived = H.sec('派生信息', '由上述字段推导出的信息。', [
        { label: 'em 方形尺寸', name: '—', offset: null, size: 0, type: 'text', value: upm + ' units/em', display: upm + ' units/em',
          description: '1 em = ' + upm + ' 设计单位；若字号为 16px，则 1 设计单位 ≈ ' + (16 / upm).toFixed(4) + ' px。' },
        { label: '全局边界框', name: '—', offset: null, size: 0, type: 'text',
          value: '', display: (() => {
            const xMin = fields[9].value, yMin = fields[10].value, xMax = fields[11].value, yMax = fields[12].value;
            return '[' + xMin + ', ' + yMin + '] → [' + xMax + ', ' + yMax + ']  (' +
              (xMax - xMin) + ' × ' + (yMax - yMin) + ' units)';
          })(),
          description: '包含所有字形的整体矩形范围，排版软件用它预留空间。' },
        { label: '字形数量', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(font.numGlyphs || '?'),
          description: '来自 maxp 表的 numGlyphs。' }
      ]);
      return {
        sections: [derived, H.sec('head 表字段', 'head 表共 54 字节，描述字体的全局属性。', fields)],
        model: { fields: fields }
      };
    }
  };

  /* =====================================================================
   * hhea / vhea —— 水平/垂直头表
   * =================================================================== */
  function makeHhea(tag, isVertical) {
    return {
      parse(font, table) {
        H.need(table, 36, tag);
        const r = new FL.Reader(table.bytes);
        const hor = !isVertical;
        const fields = [
          F(r, { offset: 0, type: 'fixed', name: 'version', label: '表版本', editable: true,
            description: hor ? 'hhea 表版本，通常为 1.0（0x00010000）。' : 'vhea 表版本，可能为 1.0 或 1.1。' }),
          F(r, { offset: 4, type: 'int16', name: hor ? 'ascender' : 'vertTypoAscender', label: hor ? '上升部（Ascender）' : '垂直上升部', editable: true, unit: 'units',
            description: hor
              ? '拉丁字母（如 h、b）顶端到基线的高度。应与 OS/2.sTypoAscender 一致；用于计算默认行高。'
              : '垂直排版时基线左侧的距离。' }),
          F(r, { offset: 6, type: 'int16', name: hor ? 'descender' : 'vertTypoDescender', label: hor ? '下降部（Descender）' : '垂直下降部', editable: true, unit: 'units',
            description: hor
              ? '基线以下的部分深度（p、g 等降部），通常为负值。'
              : '垂直排版时基线右侧的距离（通常为负）。' }),
          F(r, { offset: 8, type: 'int16', name: hor ? 'lineGap' : 'vertTypoLineGap', label: hor ? '行距（Line Gap）' : '垂直行距', editable: true, unit: 'units',
            description: hor
              ? '两行文本之间额外增加的空隙。默认行高 = ascender - descender + lineGap。'
              : '垂直排版时相邻列之间的额外空隙。' }),
          F(r, { offset: 10, type: hor ? 'uint16' : 'int16', name: hor ? 'advanceWidthMax' : 'advanceHeightMax', label: hor ? '最大前进宽度' : '最大前进高度', editable: true, unit: 'units',
            description: '所有字形的最大 advance（前进宽度/高度），排版引擎据此分配最大的字符单元。' }),
          F(r, { offset: 12, type: 'int16', name: hor ? 'minLeftSideBearing' : 'minTopSideBearing', label: hor ? '最小左侧承托' : '最小顶部承托', editable: true, unit: 'units',
            description: '所有字形中最小的 LSB（可为负），用于判断是否需要裁剪。' }),
          F(r, { offset: 14, type: 'int16', name: hor ? 'minRightSideBearing' : 'minBottomSideBearing', label: hor ? '最小右侧承托' : '最小底部承托', editable: true, unit: 'units',
            description: '所有字形中最小的 RSB = advance - LSB - (xMax - xMin)，可为负。' }),
          F(r, { offset: 16, type: 'int16', name: 'xMaxExtent', label: hor ? '最大 X 延伸' : '最大 Y 延伸', editable: true, unit: 'units',
            description: hor ? '最大的 (LSB + xMax - xMin) 值，即字形最右侧可能达到的位置。' : '最大的 (TSB + yMax - yMin) 值。' }),
          F(r, { offset: 18, type: 'int16', name: hor ? 'caretSlopeRise' : 'vertTypoAscender2', label: hor ? '卡雷特斜率分子' : '保留字段 1', editable: true,
            description: hor
              ? '插入符号（光标）倾斜度的垂直分量。竖直光标 = 1（rise）/0（run）；斜体约 1/0.2。'
              : '（vhea 1.0 中此处为保留字段，写 1）' }),
          F(r, { offset: 20, type: 'int16', name: hor ? 'caretSlopeRun' : 'vertTypoDescender2', label: hor ? '卡雷特斜率分母' : '保留字段 2', editable: true,
            description: hor ? '插入符号倾斜度的水平分量，直立体为 0，斜体为负值（如 -0.21 对应 rise 1）。' : '（vhea 1.0 中为保留字段）' }),
          F(r, { offset: 22, type: 'int16', name: 'caretOffset', label: '卡雷特偏移', editable: true, unit: 'units',
            description: '插入符号相对于默认位置的额外偏移，用于斜体字校正光标位置，一般为 0。' }),
          { label: '保留字段 1~4', name: 'reserved', offset: 24, size: 8, type: 'text', value: '', display: '（4 × int16，必须为 0）', editable: false,
            description: '规范要求这 8 个字节为 0，不可使用。' },
          F(r, { offset: 32, type: 'int16', name: 'metricDataFormat', label: '度量数据格式', editable: true,
            description: '当前固定为 0，保留给未来扩展。' }),
          F(r, {
            offset: 34, type: 'uint16', name: hor ? 'numberOfHMetrics' : 'numberOfVMetrics',
            label: hor ? '水平度量条数（numberOfHMetrics）' : '垂直度量条数', editable: true,
            description: hor
              ? 'hmtx 表中实际存储 advanceWidth 的字形数量。其后字形的宽度继承最后一个值（等宽尾部优化）。修改后本工具会自动重建 hmtx 表。'
              : 'vmtx 表中实际存储 advanceHeight 的字形数量。'
          })
        ];
        return {
          sections: [H.sec(tag + ' 表字段', tag + ' 表共 36 字节，定义' + (hor ? '水平' : '垂直') + '排版的全局度量。', fields)],
          model: { fields: fields }
        };
      }
    };
  }
  T['hhea'] = makeHhea('hhea', false);
  T['vhea'] = makeHhea('vhea', true);

  /* =====================================================================
   * maxp —— 最大需求表
   * =================================================================== */
  T['maxp'] = {
    parse(font, table) {
      H.need(table, 6, 'maxp');
      const r = new FL.Reader(table.bytes);
      const version = FL.TYPES.fixed.r(r.view, 0);
      const ct = (v, d) => ({ offset: v, type: 'uint16', name: 'x', label: '', editable: false, size: 2, value: 0, description: d, display: '' });
      const fields = [
        F(r, { offset: 0, type: 'fixed', name: 'version', label: '表版本',
          description: version === 0.5
            ? '0.5 —— CFF（PostScript 轮廓）字体使用，仅包含 numGlyphs。'
            : '1.0 —— TrueType 轮廓字体使用，包含完整的资源上限信息。' }),
        F(r, { offset: 4, type: 'uint16', name: 'numGlyphs', label: '字形总数', editable: true,
          description: '字体中字形的数量，包含 .notdef（索引 0）。修改它必须同时调整 loca/hmtx/post/cmap 等表，请谨慎操作。' })
      ];
      if (version === 1) {
        const max = [
          [6, 'maxPoints', '单轮廓字形最大点数', '简单字形中单个轮廓允许的最大点数（所有点，含曲线控制点）。'],
          [8, 'maxContours', '单字形最大轮廓数', '简单字形允许的最大轮廓（闭合路径）数量。'],
          [10, 'maxCompositePoints', '复合字形最大点数', '复合字形展开后允许的最大点数。'],
          [12, 'maxCompositeContours', '复合字形最大轮廓数', '复合字形展开后允许的最大轮廓数。'],
          [14, 'maxZones', '最大区域数', '解释器使用的区域（zone）数量，通常为 1（无 twilight zone）或 2。'],
          [16, 'maxTwilightPoints', '最大 twilight 点数', '提示程序在 twilight zone 中可临时使用的点数。'],
          [18, 'maxStorage', '最大存储区', '提示程序可用的存储区（storage area）单元数。'],
          [20, 'maxFunctionDefs', '最大函数定义数', '字体可定义的函数（FDEF）数量上限。'],
          [22, 'maxInstructionDefs', '最大指令定义数', '字体可定义的指令（IDEF）数量上限。'],
          [24, 'maxStackElements', '最大栈深度', '解释器栈的最大元素数量。'],
          [26, 'maxSizeOfInstructions', '最大指令字节数', '单个字形提示指令的最大字节长度。'],
          [28, 'maxComponentElements', '最大组件数', '复合字形直接引用的组件数量上限。'],
          [30, 'maxComponentDepth', '最大嵌套深度', '复合字形递归引用的最大层数。']
        ];
        max.forEach((m) => {
          fields.push(F(r, { offset: m[0], type: 'uint16', name: m[1], label: m[2], editable: true, unit: '个', description: m[3] }));
        });
      } else {
        const o = ct(6, '');
        fields.push({ label: '（版本 0.5 无更多字段）', name: '—', offset: 6, size: 0, type: 'text', value: '', display: 'maxp 表长度 = 6 字节', editable: false,
          description: 'CFF 字体的轮廓信息存放在 CFF 表中，因此 maxp 只需给出字形数量。' });
      }
      return { sections: [H.sec('maxp 表字段', '声明字体规模上限，供渲染器/解释器预先分配内存。修改轮廓后本工具会自动重算部分数值。', fields)],
        model: { fields: fields, version: version } };
    }
  };

  /* =====================================================================
   * post —— PostScript 表
   * =================================================================== */
  T['post'] = {
    parse(font, table) {
      H.need(table, 32, 'post');
      const r = new FL.Reader(table.bytes);
      const ver = FL.TYPES.fixed.r(r.view, 0);
      const fields = [
        F(r, { offset: 0, type: 'fixed', name: 'version', label: '表版本', editable: true,
          description: 'post 表版本：1.0（标准 Mac 名称）、2.0（自定义名称，最常见）、2.5（已废弃）、3.0（无名称）。版本说明：' + (U.POST_FORMATS[ver] || '未知版本 ' + ver) }),
        F(r, { offset: 4, type: 'fixed', name: 'italicAngle', label: '斜体角度', editable: true, unit: '度',
          description: '字形倾斜角度（逆时针为正，直立体为 0）。斜体字通常为负值，例如 -12 表示向右倾斜 12°。' }),
        F(r, { offset: 8, type: 'int16', name: 'underlinePosition', label: '下划线位置', editable: true, unit: 'units',
          description: '下划线相对基线的 y 坐标，通常为负值（在基线下方）。例如 -75。' }),
        F(r, { offset: 10, type: 'int16', name: 'underlineThickness', label: '下划线粗细', editable: true, unit: 'units',
          description: '下划线的笔画粗细，例如 50。' }),
        F(r, { offset: 12, type: 'uint32', name: 'isFixedPitch', label: '是否等宽字体', editable: true,
          description: '0 = 比例字体（非等宽）；非 0 = 等宽字体（所有字形 advance 相同）。注意：实际是否等宽还要看 hmtx。',
          enumMap: { 0: '比例字体（非等宽）' } }),
        F(r, { offset: 16, type: 'uint32', name: 'minMemType42', label: 'Type42 最小内存', editable: true,
          description: '当字体以 Type42 形式下载时的最小内存占用（字节），保留字段，一般为 0。' }),
        F(r, { offset: 20, type: 'uint32', name: 'maxMemType42', label: 'Type42 最大内存', editable: true,
          description: 'Type42 形式下载时的最大内存占用，保留字段，一般为 0。' }),
        F(r, { offset: 24, type: 'uint32', name: 'minMemType1', label: 'Type1 最小内存', editable: true, description: 'Type1 形式的最小内存占用（保留字段）。' }),
        F(r, { offset: 28, type: 'uint32', name: 'maxMemType1', label: 'Type1 最大内存', editable: true, description: 'Type1 形式的最大内存占用（保留字段）。' })
      ];

      const sections = [H.sec('post 表头字段', 'post 表描述 PostScript 所需的字体信息。', fields)];
      let names = null;

      if (ver === 2 && table.bytes.length >= 34) {
        const numGlyphs = FL.TYPES.uint16.r(r.view, 32);
        const indices = [];
        let p = 34;
        for (let i = 0; i < numGlyphs && p + 2 <= table.bytes.length; i++, p += 2) indices.push(r.view.getUint16(p));
        // 自定义名称（Pascal 字符串）池
        const custom = [];
        let q = p;
        while (q < table.bytes.length) {
          const len = table.bytes[q];
          custom.push(U.macRomanDecode(table.bytes.subarray(q + 1, q + 1 + len)));
          q += 1 + len;
        }
        names = indices.map((idx, i) => {
          if (idx < 258) return U.STANDARD_MAC_GLYPH_NAMES[idx];
          const ci = idx - 258;
          return custom[ci] !== undefined ? custom[ci] : '名称缺失(' + idx + ')';
        });
        const rows = [];
        const maxShow = 20000;
        for (let i = 0; i < names.length && i < maxShow; i++) {
          rows.push({ __index: i, glyph: i, name: names[i], src: indices[i] < 258 ? '标准名称 #' + indices[i] : '自定义名称 #' + (indices[i] - 258),
            __edit: { name: { kind: 'postName', gid: i } } });
        }
        sections.push(H.matrix('字形名称表（Glyph Names）',
          '共 ' + numGlyphs + ' 个字形名称。版本 2.0 用「标准索引 + 自定义名称池」存储：索引 0~257 对应 258 个标准 Macintosh 字形名，258 以上表示指向名称池中的第 (索引-258) 个 Pascal 字符串。' +
          '可直接修改名称，保存时会重建 post 表。',
          [
            H.col('glyph', '字形索引', { align: 'right' }),
            H.col('name', '字形名称', { align: 'left', editable: true, editKind: 'postName', width: '30%' }),
            H.col('src', '存储方式', { align: 'left' })
          ], rows, { pageSize: 300, stickyFirst: true }));
      } else if (ver === 1 && font.numGlyphs) {
        const rows = [];
        for (let i = 0; i < Math.min(font.numGlyphs, 20000); i++)
          rows.push({ __index: i, glyph: i, name: U.STANDARD_MAC_GLYPH_NAMES[i] || '（超出标准名称范围）' });
        sections.push(H.matrix('字形名称表（标准 Mac 名称）',
          '版本 1.0 按序号依次使用 258 个标准 Macintosh 字形名，因此字体字形数不应超过 258。',
          [H.col('glyph', '字形索引'), H.col('name', '字形名称', { align: 'left' })], rows, { pageSize: 300 }));
      } else {
        sections.push(H.note('字形名称', '该字体 post 版本为 ' + ver + '，' +
          (ver === 3 ? '不包含字形名称（这是新字体的推荐做法，可减小体积）。字形名称可由 cmap 反查得到。'
            : '本工具未解析该版本的名称数据。')));
      }
      return { sections: sections, model: { version: ver, fields: fields, glyphNames: names } };
    },

    /** 修改字形名称 → 需要重建 post 表 */
    edit(font, table, ctx, value) {
      const model = table._model;
      if (!model || !model.glyphNames) return false;
      const gid = ctx.row.__edit.name.gid;
      model.glyphNames[gid] = String(value);
      model.dirty = true;
      return true;
    },

    /** 重建 post 2.0 表 */
    rebuild(font, table) {
      const model = table._model;
      if (!model || !model.glyphNames) return null;
      const names = model.glyphNames;
      const std = U.STANDARD_MAC_GLYPH_NAMES;
      const stdIndex = {};
      std.forEach((n, i) => { if (stdIndex[n] === undefined) stdIndex[n] = i; });
      const custom = [];
      const customIndex = {};
      const indices = names.map((n) => {
        if (stdIndex[n] !== undefined) return stdIndex[n];
        if (customIndex[n] === undefined) {
          customIndex[n] = custom.length;
          custom.push(n);
        }
        return 258 + customIndex[n];
      });
      const b = new FL.Builder(64 + names.length * 2 + custom.length * 20);
      b.u32(0x00020000);
      const src = new FL.Reader(table.bytes);
      b.i32(src.i32(4));                       // italicAngle
      b.i16(src.i16(8));
      b.i16(src.i16(10));
      b.u32(src.u32(12));
      b.u32(src.u32(16));
      b.u32(src.u32(20));
      b.u32(src.u32(24));
      b.u32(src.u32(28));
      b.u16(names.length);
      indices.forEach((i) => b.u16(i));
      custom.forEach((n) => {
        const bytes = U.macRomanEncode(n);
        b.u8(Math.min(bytes.length, 255));
        b.bytes(bytes.slice(0, 255));
      });
      return b.toBytes();
    }
  };

  /* =====================================================================
   * hmtx / vmtx —— 水平/垂直度量表
   * =================================================================== */
  function makeMetrics(tag, isVertical) {
    const hor = !isVertical;
    return {
      parse(font, table) {
        const numGlyphs = font.numGlyphs || 0;
        const hhea = font.tableMap[hor ? 'hhea' : 'vhea'];
        let numLong = numGlyphs;
        if (hhea && hhea.bytes.length >= 36) {
          const v = new DataView(hhea.bytes.buffer, hhea.bytes.byteOffset);
          numLong = v.getUint16(34);
        }
        if (!numGlyphs) throw new Error('缺少 maxp 表，无法解析 ' + tag);
        const r = new FL.Reader(table.bytes);
        const advanceName = hor ? 'advanceWidth' : 'advanceHeight';
        const sideName = hor ? 'lsb' : 'tsb';
        const rows = [];
        const advances = [];
        const sides = [];
        let last = 0;
        for (let i = 0; i < numGlyphs; i++) {
          let adv, sb, edit;
          if (i < numLong) {
            const off = i * 4;
            adv = FL.TYPES.uint16.r(r.view, off);
            sb = FL.TYPES.int16.r(r.view, off + 2);
            last = adv;
            edit = { advance: { kind: 'patch', offset: off, type: 'uint16' }, side: { kind: 'patch', offset: off + 2, type: 'int16' } };
          } else {
            const off = numLong * 4 + (i - numLong) * 2;
            adv = last;
            sb = FL.TYPES.int16.r(r.view, off);
            edit = { advance: { kind: 'inherit' }, side: { kind: 'patch', offset: off, type: 'int16' } };
          }
          advances.push(adv);
          sides.push(sb);
          rows.push({
            __index: i, __edit: edit,
            glyph: i,
            name: FL.font ? FL.font.glyphName(font, i) : '',
            advance: adv,
            side: sb,
            rsb: adv - sb - 0
          });
        }
        // 计算右侧承托（需要字形边界框）
        const gd = FL.glyfCache && FL.glyfCache.get(font);
        if (gd) {
          for (const row of rows) {
            const g = gd.glyphs[row.__index];
            row.rsb = g && !g.empty ? row.advance - row.side - (g.xMax - g.xMin) : 0;
          }
        }
        const cols = [
          H.col('glyph', '字形索引', { align: 'right', width: '70px' }),
          H.col('name', '字形名 / 字符', { align: 'left', width: '130px' }),
          H.col('advance', hor ? '水平前进宽度' : '垂直前进高度', { editable: true, editKind: 'metric', width: '130px', description: '字形排版时占用的前进宽度，单位为设计单位。' }),
          H.col('side', hor ? '左侧承托 LSB' : '顶部承托 TSB', { editable: true, editKind: 'metric', width: '130px', description: hor ? '字形原点（x=0）到轮廓最左端的距离，可为负。' : '字形顶部到原点的距离。' }),
          H.col('rsb', hor ? '右侧承托 RSB' : '底部承托 BSB', { width: '110px', description: 'advance - lsb - (xMax - xMin)，自动推导，不可直接编辑。' })
        ];
        const zero = rows.filter((x) => x.advance === 0).length;
        const mono = new Set(advances).size === 1;
        let minA = Infinity, maxA = -Infinity;
        for (const a of advances) { if (a < minA) minA = a; if (a > maxA) maxA = a; }
        const stats = H.sec('统计与提示', '基于本表内容计算的概览信息。', [
          { label: '度量条目数', name: '—', offset: null, size: 0, type: 'text', value: '', display: numLong + ' 条独立 advance + ' + Math.max(0, numGlyphs - numLong) + ' 条仅 LSB', description: '来自 hhea.numberOfHMetrics。表中前 numberOfHMetrics 个字形各占 4 字节，其余字形共用最后一个 advance，仅存 2 字节 LSB。' },
          { label: 'advance 取值范围', name: '—', offset: null, size: 0, type: 'text', value: '', display: minA + ' ~ ' + maxA + ' units', description: '所有字形前进宽度的最小/最大值。' },
          { label: '是否等宽', name: '—', offset: null, size: 0, type: 'text', value: '', display: mono ? '是（所有 advance 相同）' : '否（比例字体）', description: '等宽字体常见于编程字体。' },
          { label: 'advance = 0 的字形数', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(zero), description: '宽度为 0 的字形多为组合标记（combining marks），它们不占据前进宽度。' }
        ]);
        return { sections: [stats, H.matrix(tag + ' 表数据', '每个字形的' + (hor ? '水平' : '垂直') + '度量。修改后保存时会写回字体（如条数改变会自动重建整表）。', cols, rows,
          { pageSize: 300, filterable: true })], model: { numGlyphs: numGlyphs, numLong: numLong, advances: advances, sides: sides } };
      },

      edit(font, table, ctx, value) {
        const model = table._model;
        const e = ctx.row.__edit[ctx.col.key === 'advance' ? 'advance' : 'side'];
        if (e.kind === 'inherit') {
          if (ctx.col.key === 'advance') return false;
          return { patch: { offset: e.offset, type: e.type, value: value } };
        }
        model.dirty = true;
        if (ctx.col.key === 'advance') model.advances[ctx.row.__index] = value;
        else model.sides[ctx.row.__index] = value;
        return { patch: { offset: e.offset, type: e.type, value: value } };
      },

      /** 重建 hmtx（当 numberOfHMetrics 变化时必须重建） */
      rebuild(font, table, opts) {
        const model = table._model;
        if (!model) return null;
        const hhea = font.tableMap[hor ? 'hhea' : 'vhea'];
        const numLong = hhea ? new DataView(hhea.bytes.buffer, hhea.bytes.byteOffset).getUint16(34) : model.numLong;
        const n = model.numGlyphs;
        const b = new FL.Builder(numLong * 4 + Math.max(0, n - numLong) * 2);
        let last = 0;
        for (let i = 0; i < n; i++) {
          if (i < numLong) {
            const a = FL.util.clamp(model.advances[i] | 0, 0, 65535);
            last = a;
            b.u16(a);
            b.i16(model.sides[i] | 0);
          } else {
            b.i16(model.sides[i] | 0);
          }
        }
        return b.toBytes();
      }
    };
  }
  T['hmtx'] = makeMetrics('hmtx', false);
  T['vmtx'] = makeMetrics('vmtx', true);
})(typeof window !== 'undefined' ? window : globalThis);
