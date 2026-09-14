/* =========================================================================
 * tables/misc.js —— 其它表：DSIG / meta / hdmx / LTSH / VDMX / PCLT /
 *                   COLR / CPAL / SVG / sbix / CBDT-CBLC / fvar / avar /
 *                   STAT / fpgm / prep / 以及通用兜底解析
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;
  const F = H.F;

  const hexSec = (table, note) =>
    H.note('原始数据说明', (note || '') +
      '本工具未对该表做结构化解析，可在「原始数据」标签页中查看十六进制并逐字节修改（修改后保存即可写回）。');

  /* ---------------------------------------------------------------- DSIG */
  T['DSIG'] = {
    parse(font, table) {
      H.need(table, 8, 'DSIG');
      const r = new FL.Reader(table.bytes);
      const version = r.u32();
      const numSignatures = r.u16();
      const flags = r.u16();
      const fields = [
        F(r, { offset: 0, type: 'uint32', name: 'ulVersion', label: '版本', editable: false, description: '固定为 0x00000001。' }),
        F(r, { offset: 4, type: 'uint16', name: 'usNumSigs', label: '签名数量', editable: false, description: '通常为 1。' }),
        F(r, { offset: 6, type: 'uint16', name: 'usFlag', label: '标志', editable: false, description: '保留，必须为 0。' })
      ];
      const rows = [];
      for (let i = 0; i < numSignatures; i++) {
        const p = 8 + i * 12;
        if (p + 12 > table.bytes.length) break;
        rows.push({
          __index: i,
          format: FL.TYPES.uint32.r(r.view, p),
          length: FL.TYPES.uint32.r(r.view, p + 4),
          offset: FL.TYPES.uint32.r(r.view, p + 8)
        });
      }
      return {
        sections: [
          H.note('修改字体后签名将失效', 'DSIG 表存放对整份字体的数字签名。任何字节改动都会破坏签名，因此本工具在保存时默认移除 DSIG 表（可在导出选项中关闭），以保证字体在 Windows 上仍能正常加载。', 'warn'),
          H.sec('DSIG 表头', '', fields),
          H.matrix('签名记录', '每条记录指向一份 PKCS#7 签名数据块（本工具不校验签名内容）。',
            [
              H.col('format', '格式', { width: '100px' }),
              H.col('length', '长度', { width: '110px' }),
              H.col('offset', '偏移', { width: '110px' })
            ], rows, { pageSize: 0 })
        ],
        model: {}
      };
    }
  };

  /* ---------------------------------------------------------------- meta */
  T['meta'] = {
    parse(font, table) {
      H.need(table, 16, 'meta');
      const r = new FL.Reader(table.bytes);
      const version = r.u32();
      const flags = r.u32();
      const dataMaps = r.u32();
      const fields = [
        F(r, { offset: 0, type: 'uint32', name: 'version', label: '版本', editable: false, description: '固定为 1。' }),
        F(r, { offset: 4, type: 'uint32', name: 'flags', label: '标志', editable: false, description: '保留，必须为 0。' }),
        F(r, { offset: 8, type: 'uint32', name: 'dataMaps', label: '数据映射数量', editable: false, description: '元数据条目数。' })
      ];
      const rows = [];
      for (let i = 0; i < dataMaps && 12 + i * 12 + 12 <= table.bytes.length; i++) {
        const p = 12 + i * 12;
        const tag = U.tag(FL.TYPES.uint32.r(r.view, p));
        const off = FL.TYPES.uint32.r(r.view, p + 4);
        const len = FL.TYPES.uint32.r(r.view, p + 8);
        let text = '';
        if (tag === 'dlng' || tag === 'slng') {
          try { text = U.decodeText(table.bytes.subarray(off, off + len), 0, 3); } catch (e) { text = ''; }
        }
        rows.push({ __index: i, tag: tag, offset: off, length: len, text: U.visible(text) });
      }
      return {
        sections: [
          H.sec('meta 表头', 'meta 表以「标签 → 数据块」的形式存放附加信息，最常用于 dlng/slng（设计/支持语言列表，用 BCP47 语言标签，逗号分隔）。', fields),
          H.matrix('元数据条目',
            'dlng 为设计时使用的语言，slng 为支持的语言，取值均为 BCP47 语言标签、以逗号分隔（如 "zh-Hans,ja,ko"）。',
            [
              H.col('tag', '标签', { align: 'left', width: '100px' }),
              H.col('offset', '偏移', { width: '100px' }),
              H.col('length', '长度', { width: '100px' }),
              H.col('text', '内容（dlng/slng 为语言标签）', { align: 'left' })
            ], rows, { pageSize: 0 })
        ],
        model: {}
      };
    }
  };

  /* ---------------------------------------------------------------- hdmx */
  T['hdmx'] = {
    parse(font, table) {
      H.need(table, 8, 'hdmx');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const numRecords = r.i16();
      const sizeDeviceRecord = r.i32();
      const fields = [
        F(r, { offset: 0, type: 'uint16', name: 'version', label: '版本', editable: false, description: '固定为 0。' }),
        F(r, { offset: 2, type: 'int16', name: 'numRecords', label: '记录数量', editable: false, description: '即包含的像素尺寸（ppem）个数。' }),
        F(r, { offset: 4, type: 'int32', name: 'sizeDeviceRecord', label: '单条记录大小', editable: false, description: '每条记录 = 2 + numGlyphs（各自一个字节宽度），并按 4 字节对齐。' })
      ];
      const rows = [];
      const numGlyphs = font.numGlyphs || 0;
      for (let i = 0; i < numRecords; i++) {
        const p = 8 + i * sizeDeviceRecord;
        if (p + 2 > table.bytes.length) break;
        const ppem = table.bytes[p];
        const maxW = table.bytes[p + 1];
        rows.push({
          __index: i, ppem: ppem, maxWidth: maxW,
          widths: (() => {
            const a = [];
            for (let k = 0; k < Math.min(8, numGlyphs); k++) a.push(table.bytes[p + 2 + k]);
            return a.join(',') + (numGlyphs > 8 ? '…' : '');
          })()
        });
      }
      return {
        sections: [
          H.sec('hdmx 表头', 'hdmx 为指定像素尺寸预先给出每个字形的水平宽度，供旧式渲染器做点阵对齐；现代渲染器一般忽略此表，因此修改字形后本工具默认会移除它。', fields),
          H.matrix('设备记录', '每条记录对应一个像素尺寸。',
            [
              H.col('ppem', '像素尺寸', { width: '110px' }),
              H.col('maxWidth', '最大宽度', { width: '110px' }),
              H.col('widths', '前 8 个字形宽度', { align: 'left' })
            ], rows, { pageSize: 60 })
        ],
        model: {}
      };
    }
  };

  /* ---------------------------------------------------------------- LTSH */
  T['LTSH'] = {
    parse(font, table) {
      H.need(table, 4, 'LTSH');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const numGlyphs = r.u16();
      const rows = [];
      for (let i = 0; i < Math.min(numGlyphs, (table.bytes.length - 4)) ; i++) {
        rows.push({ __index: i, glyph: i, name: FL.font.glyphName(font, i), threshold: table.bytes[4 + i] });
      }
      return {
        sections: [
          H.sec('LTSH 表头', 'LTSH（Linear Threshold）为每个字形给出"开始等比缩放"的像素尺寸阈值：小于该尺寸时使用点阵对齐宽度，大于则使用线性缩放宽度。', [
            F(r, { offset: 0, type: 'uint16', name: 'version', label: '版本', editable: false, description: '固定为 0。' }),
            F(r, { offset: 2, type: 'uint16', name: 'numGlyphs', label: '字形数量', editable: false, description: '应与 maxp.numGlyphs 一致。' })
          ]),
          H.matrix('线性阈值',
            '每个字形一个字节：小于该像素尺寸时使用网格拟合的宽度，大于则使用线性缩放的宽度。',
            [H.col('glyph', 'GID', { width: '80px' }), H.col('name', '字形名', { align: 'left', width: '170px' }), H.col('threshold', '阈值 (ppem)', { width: '120px' })],
            rows, { pageSize: 200 })
        ],
        model: {}
      };
    }
  };

  /* ---------------------------------------------------------------- VDMX */
  T['VDMX'] = {
    parse(font, table) {
      H.need(table, 6, 'VDMX');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const numRecs = r.u16();
      const numRatios = r.u16();
      const ratios = [];
      for (let i = 0; i < numRatios; i++) {
        const p = 6 + i * 4;
        if (p + 4 > table.bytes.length) break;
        const bCharSet = table.bytes[p], xRatio = table.bytes[p + 1], yStart = table.bytes[p + 2], yEnd = table.bytes[p + 3];
        ratios.push({ __index: i, bCharSet: bCharSet, xRatio: xRatio, yStartRatio: yStart, yEndRatio: yEnd,
          desc: '字符集 ' + bCharSet + '，宽高比 ' + (xRatio / 2) + '，有效 y 范围 ' + (yStart / 2) + ' ~ ' + (yEnd / 2) });
      }
      const rows = [];
      for (let i = 0; i < numRecs; i++) {
        const p = 6 + numRatios * 4 + i * 4;
        if (p + 4 > table.bytes.length) break;
        rows.push({
          __index: i,
          yPelHeight: FL.TYPES.uint16.r(r.view, p),
          yMax: FL.TYPES.int16.r(r.view, p + 2),
          yMin: FL.TYPES.int16.r(r.view, p + 4 > table.bytes.length - 2 ? p + 2 : p + 4)
        });
      }
      return {
        sections: [
          H.sec('VDMX 表头', 'VDMX 为不同宽高比与像素尺寸声明垂直度量覆盖值（ascent/descent），用于在不改变字体全局度量的情况下微调显示。', [
            F(r, { offset: 0, type: 'uint16', name: 'version', label: '版本', editable: false, description: '通常为 0 或 1。' }),
            F(r, { offset: 2, type: 'uint16', name: 'numRecs', label: '记录数', editable: false, description: '垂直度量记录数（下表的行数）。' }),
            F(r, { offset: 4, type: 'uint16', name: 'numRatios', label: '宽高比数量', editable: false, description: '宽高比定义的数量。' })
          ]),
          H.matrix('宽高比定义',
            '声明字体适用的显示宽高比区间（如 1:1、4:3），每个区间可对应一组垂直度量覆盖值。',
            [H.col('bCharSet', '字符集', { width: '90px' }), H.col('xRatio', 'X 比例', { width: '90px' }), H.col('yStartRatio', '起始比例', { width: '100px' }), H.col('yEndRatio', '结束比例', { width: '100px' }), H.col('desc', '说明', { align: 'left' })],
            ratios, { pageSize: 40 }),
          H.matrix('垂直度量记录', '每 4 字节：像素高度、yMax、yMin（另有保留字节）。',
            [H.col('yPelHeight', '像素高度', { width: '110px' }), H.col('yMax', 'yMax (ascent)', { width: '120px' }), H.col('yMin', 'yMin (descent)', { width: '120px' })],
            rows, { pageSize: 60 })
        ],
        model: {}
      };
    }
  };

  /* ---------------------------------------------------------------- PCLT */
  T['PCLT'] = {
    parse(font, table) {
      H.need(table, 54, 'PCLT');
      const r = new FL.Reader(table.bytes);
      const fields = [
        F(r, { offset: 0, type: 'fixed', name: 'Version', label: '版本', editable: false, description: 'PCLT 表版本。' }),
        F(r, { offset: 4, type: 'uint32', name: 'FontNumber', label: '字体编号', editable: false, description: 'HP PCL 字体编号。' }),
        F(r, { offset: 8, type: 'uint16', name: 'Pitch', label: '字距（Pitch）', editable: false, description: '0 表示比例字体；非 0 表示等宽字体的每英寸字符数。' }),
        F(r, { offset: 10, type: 'uint16', name: 'xHeight', label: 'x 高度', editable: false, description: 'PCL 使用的 x 高度。' }),
        F(r, { offset: 12, type: 'uint16', name: 'Style', label: '样式', editable: false, description: '样式位（倾斜、粗细等）。' }),
        F(r, { offset: 14, type: 'uint16', name: 'TypeFamily', label: '字体族', editable: false, description: 'PCL 字体族编号。' }),
        F(r, { offset: 16, type: 'uint16', name: 'CapHeight', label: '大写高度', editable: false, description: '大写字母高度。' }),
        F(r, { offset: 18, type: 'uint16', name: 'SymbolSet', label: '符号集', editable: false, description: 'PCL 符号集编号。' }),
        F(r, { offset: 20, type: 'tag', name: 'Typeface', label: '字样名', editable: false, description: '8 字符的字样名称，后半为填充 0。' })
      ];
      return { sections: [H.sec('PCLT 表字段', 'PCLT 表为 HP PCL 5 打印机提供字体信息，现代系统一般不再使用。', fields), hexSec(table)], model: {} };
    }
  };

  /* ---------------------------------------------------------- COLR / CPAL */
  T['COLR'] = {
    parse(font, table) {
      H.need(table, 14, 'COLR');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const numBaseGlyphRecords = r.u16();
      const baseGlyphRecordsOffset = r.u32();
      const layerRecordsOffset = r.u32();
      const numLayerRecords = r.u16();
      const fields = [
        F(r, { offset: 0, type: 'uint16', name: 'version', label: '版本', editable: false, description: '0 为原始版本；1 增加字形变体与绘制指令（本工具仅解析版本 0 的基础结构）。' }),
        F(r, { offset: 2, type: 'uint16', name: 'numBaseGlyphRecords', label: '基字形数量', editable: false, description: '有多少个字形是彩色分层字形。' }),
        F(r, { offset: 4, type: 'uint32', name: 'baseGlyphRecordsOffset', label: '基字形记录偏移', editable: false, description: '指向 BaseGlyphRecord 数组。' }),
        F(r, { offset: 8, type: 'uint32', name: 'layerRecordsOffset', label: '图层记录偏移', editable: false, description: '指向 LayerRecord 数组。' }),
        F(r, { offset: 12, type: 'uint16', name: 'numLayerRecords', label: '图层记录数量', editable: false, description: '全部图层记录总数。' })
      ];
      const rows = [];
      if (version === 0) {
        for (let i = 0; i < numBaseGlyphRecords; i++) {
          const p = baseGlyphRecordsOffset + i * 6;
          if (p + 6 > table.bytes.length) break;
          const gid = FL.TYPES.uint16.r(r.view, p);
          const first = FL.TYPES.uint16.r(r.view, p + 2);
          const num = FL.TYPES.uint16.r(r.view, p + 4);
          const layers = [];
          for (let k = 0; k < Math.min(num, 12); k++) {
            const q = layerRecordsOffset + (first + k) * 4;
            if (q + 4 > table.bytes.length) break;
            layers.push('#' + FL.TYPES.uint16.r(r.view, q) + '/色' + FL.TYPES.uint16.r(r.view, q + 2));
          }
          rows.push({ __index: i, glyph: gid, name: FL.font.glyphName(font, gid), numLayers: num, layers: layers.join(' ') });
        }
      }
      return {
        sections: [
          H.note('彩色字形（COLR/CPAL）', 'COLR 定义"由多个单色字形分层叠加成的彩色字形"，CPAL 提供配色。例如 emoji 字体中每个表情由若干图层组成，每层可指定调色板索引。'),
          H.sec('COLR 表头', '', fields),
          version === 0
            ? H.matrix('彩色基字形',
              '每个彩色字形由若干图层叠加而成，图层格式为「字形索引 / 调色板颜色序号」。',
              [H.col('glyph', 'GID', { width: '80px' }), H.col('name', '字形名', { align: 'left', width: '150px' }), H.col('numLayers', '图层数', { width: '90px' }), H.col('layers', '图层（字形/调色板索引）', { align: 'left' })],
              rows, { pageSize: 100, filterable: true })
            : H.note('版本 1', 'COLR v1 使用绘制指令（PaintGraph）描述渐变、变换等复杂效果，本工具暂不解码。')
        ],
        model: {}
      };
    }
  };

  T['CPAL'] = {
    parse(font, table) {
      H.need(table, 12, 'CPAL');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const numPaletteEntries = r.u16();
      const numPalettes = r.u16();
      const numColorRecords = r.u16();
      const colorRecordsArrayOffset = r.u32();
      const fields = [
        F(r, { offset: 0, type: 'uint16', name: 'version', label: '版本', editable: false, description: '0 或 1。' }),
        F(r, { offset: 2, type: 'uint16', name: 'numPaletteEntries', label: '每组颜色数', editable: false, description: '每个调色板包含的颜色条目数量。' }),
        F(r, { offset: 4, type: 'uint16', name: 'numPalettes', label: '调色板组数', editable: false, description: '调色板（配色方案）的数量，可支持浅色/深色等不同方案。' }),
        F(r, { offset: 6, type: 'uint16', name: 'numColorRecords', label: '颜色记录总数', editable: false, description: '所有调色板的颜色记录合计。' }),
        F(r, { offset: 8, type: 'uint32', name: 'colorRecordsArrayOffset', label: '颜色数组偏移', editable: false, description: '指向 BGRA 颜色数组。' })
      ];
      const rows = [];
      if (colorRecordsArrayOffset) {
        for (let i = 0; i < Math.min(numColorRecords, 512); i++) {
          const p = colorRecordsArrayOffset + i * 4;
          if (p + 4 > table.bytes.length) break;
          const b2 = table.bytes[p], gg = table.bytes[p + 1], rr = table.bytes[p + 2], aa = table.bytes[p + 3];
          rows.push({
            __index: i, index: i,
            color: 'rgba(' + rr + ',' + gg + ',' + b2 + ',' + (aa / 255).toFixed(2) + ')',
            hex: '#' + U.hex2(aa) + U.hex2(rr) + U.hex2(gg) + U.hex2(b2),
            swatch: '<span class="swatch" style="background:rgba(' + rr + ',' + gg + ',' + b2 + ',' + (aa / 255) + ')"></span>'
          });
        }
      }
      return {
        sections: [
          H.sec('CPAL 表头', '调色板表：颜色以 BGRA 顺序（大端）存储。', fields),
          H.matrix('颜色记录',
            [
              H.col('index', '序号', { width: '80px' }),
              H.col('swatch', '色块', { align: 'left', width: '70px' }),
              H.col('hex', 'ARGB', { align: 'left', width: '130px' }),
              H.col('color', 'RGBA', { align: 'left' })
            ], rows, { pageSize: 100 })
        ],
        model: {}
      };
    }
  };

  /* ---------------------------------------------------------------- SVG  */
  T['SVG '] = {
    parse(font, table) {
      H.need(table, 10, 'SVG ');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const offsetToSVGDocIndex = r.u32();
      const reserved = r.u32();
      const p = offsetToSVGDocIndex;
      const numEntries = FL.TYPES.uint16.r(r.view, p);
      const rows = [];
      for (let i = 0; i < numEntries && p + 2 + i * 12 + 12 <= table.bytes.length; i++) {
        const q = p + 2 + i * 12;
        const startGID = FL.TYPES.uint16.r(r.view, q);
        const endGID = FL.TYPES.uint16.r(r.view, q + 2);
        const off = FL.TYPES.uint32.r(r.view, q + 4);
        const len = FL.TYPES.uint32.r(r.view, q + 8);
        let head = '';
        try {
          head = new TextDecoder('utf-8').decode(table.bytes.subarray(off, Math.min(off + len, off + 160)));
        } catch (e) { head = ''; }
        rows.push({ __index: i, startGID: startGID, endGID: endGID, length: len, head: U.visible(head) });
      }
      return {
        sections: [
          H.sec('SVG 表头', 'SVG 表允许字形以 SVG 矢量文档描述（可包含渐变、位图等效果）。', [
            F(r, { offset: 0, type: 'uint16', name: 'version', label: '版本', editable: false, description: '固定为 0。' }),
            F(r, { offset: 2, type: 'uint32', name: 'offsetToSVGDocIndex', label: '文档索引偏移', editable: false, description: '指向 SVG 文档索引表。' })
          ]),
          H.matrix('SVG 文档记录', '每条记录覆盖一段连续的字形索引区间。',
            [
              H.col('startGID', '起始 GID', { width: '100px' }),
              H.col('endGID', '结束 GID', { width: '100px' }),
              H.col('length', '长度', { width: '100px' }),
              H.col('head', '内容开头', { align: 'left' })
            ], rows, { pageSize: 40 })
        ],
        model: {}
      };
    }
  };

  /* --------------------------------------------------------------- sbix */
  T['sbix'] = {
    parse(font, table) {
      H.need(table, 8, 'sbix');
      const r = new FL.Reader(table.bytes);
      const version = r.u16();
      const flags = r.u16();
      const numStrikes = r.u32();
      const rows = [];
      for (let i = 0; i < numStrikes && 8 + i * 4 + 4 <= table.bytes.length; i++) {
        const off = FL.TYPES.uint32.r(r.view, 8 + i * 4);
        const ppem = FL.TYPES.uint16.r(r.view, off);
        const ppi = FL.TYPES.uint16.r(r.view, off + 2);
        rows.push({ __index: i, offset: off, ppem: ppem, ppi: ppi });
      }
      return {
        sections: [
          H.sec('sbix 表头', 'sbix 为 Apple 的位图字形表（含 PNG/JPEG/TIFF 数据），按 strike（每组对应一个像素尺寸）组织。', [
            F(r, { offset: 0, type: 'uint16', name: 'version', label: '版本', editable: false, description: '固定为 1。' }),
            F(r, { offset: 2, type: 'uint16', name: 'flags', label: '标志', editable: false, description: 'bit0 表示绘制时字形在 em 方框中垂直居中。' }),
            F(r, { offset: 4, type: 'uint32', name: 'numStrikes', label: 'strike 数量', editable: false, description: '不同像素尺寸的分组数量。' })
          ]),
          H.matrix('Strike 列表',
            '每个 strike 对应一个显示尺寸，其内部为「字形索引 → 位图数据偏移」的映射。',
            [H.col('offset', '偏移', { width: '110px' }), H.col('ppem', '像素尺寸', { width: '110px' }), H.col('ppi', '每英寸像素', { width: '110px' })],
            rows, { pageSize: 40 })
        ],
        model: {}
      };
    }
  };

  /* ------------------------------------------------------- CBDT / CBLC 等 */
  function bitmapTable(tag, desc) {
    return {
      parse(font, table) {
        H.need(table, 8, tag);
        const r = new FL.Reader(table.bytes);
        const fields = [
          F(r, { offset: 0, type: 'uint16', name: 'majorVersion', label: '主版本', editable: false, description: '版本号。' }),
          F(r, { offset: 2, type: 'uint16', name: 'minorVersion', label: '次版本', editable: false, description: '版本号。' }),
          F(r, { offset: 4, type: 'uint32', name: 'numSizes', label: '尺寸数量', editable: false, description: '（位置表）包含多少个 bitmapSizeTable。' })
        ];
        const rows = [];
        if (/LC$/.test(tag)) {
          const numSizes = FL.TYPES.uint32.r(r.view, 4);
          for (let i = 0; i < numSizes && 8 + i * 48 + 48 <= table.bytes.length; i++) {
            const p = 8 + i * 48;
            rows.push({
              __index: i,
              indexSubTableArrayOffset: FL.TYPES.uint32.r(r.view, p),
              numTables: FL.TYPES.uint32.r(r.view, p + 8),
              startGlyph: FL.TYPES.uint16.r(r.view, p + 40),
              endGlyph: FL.TYPES.uint16.r(r.view, p + 42),
              ppemX: table.bytes[p + 44], ppemY: table.bytes[p + 45],
              bitDepth: table.bytes[p + 46]
            });
          }
        }
        const sections = [H.sec(tag + ' 表头', desc, fields)];
        if (rows.length)
          sections.push(H.matrix('尺寸表', '每个 bitmapSizeTable 描述一个点阵尺寸下的字形范围与格式。',
            [
              H.col('indexSubTableArrayOffset', '子表数组偏移', { width: '130px' }),
              H.col('numTables', '子表数', { width: '90px' }),
              H.col('startGlyph', '起始 GID', { width: '100px' }),
              H.col('endGlyph', '结束 GID', { width: '100px' }),
              H.col('ppemX', 'X 尺寸', { width: '80px' }),
              H.col('ppemY', 'Y 尺寸', { width: '80px' }),
              H.col('bitDepth', '位深', { width: '80px' })
            ], rows, { pageSize: 40 }));
        else sections.push(H.note('数据说明', '该表为点阵（位图）字形数据本体，本工具不解码位图内容；可在「原始数据」中查看字节。'));
        return { sections: sections, model: {} };
      }
    };
  }
  T['CBLC'] = bitmapTable('CBLC', '彩色位图位置表：定义每个点阵尺寸下的子表与字形范围，与 CBDT 配合使用。');
  T['EBLC'] = bitmapTable('EBLC', '嵌入位图位置表：定义每个点阵尺寸下的子表与字形范围，与 EBDT 配合使用。');
  T['CBDT'] = bitmapTable('CBDT', '彩色位图数据表：存放 PNG 等格式的彩色点阵字形数据。');
  T['EBDT'] = bitmapTable('EBDT', '嵌入位图数据表：存放单色点阵字形数据。');
  T['bloc'] = bitmapTable('bloc', 'Apple 位图位置表。');
  T['bdat'] = bitmapTable('bdat', 'Apple 位图数据表。');

  /* --------------------------------------------------------- fvar / avar */
  T['fvar'] = {
    parse(font, table) {
      H.need(table, 16, 'fvar');
      const r = new FL.Reader(table.bytes);
      // 表头顺序：majorVersion(0) minorVersion(2) axesArrayOffset(4) reserved(6)
      //           axisCount(8) axisSize(10) instanceCount(12) instanceSize(14)
      const RD = (off) => FL.TYPES.uint16.r(r.view, off);
      const axesArrayOffset = RD(4);
      const axisCount = RD(8);
      const axisSize = RD(10) || 20;
      const instanceCount = RD(12);
      const instanceSize = RD(14) || (4 + axisCount * 4 + 2);
      const fields = [
        F(r, { offset: 0, type: 'uint16', name: 'majorVersion', label: '主版本', editable: false, description: '固定为 1。' }),
        F(r, { offset: 4, type: 'uint16', name: 'axesArrayOffset', label: '轴数组偏移', editable: false, description: '轴记录数组相对表头的偏移。' }),
        F(r, { offset: 6, type: 'uint16', name: 'reserved', label: '保留', editable: false, description: '必须为 2。' }),
        F(r, { offset: 8, type: 'uint16', name: 'axisCount', label: '轴数量', editable: false, description: '可变轴个数，例如 wght + wdth = 2。' }),
        F(r, { offset: 10, type: 'uint16', name: 'axisSize', label: '单个轴记录大小', editable: false, description: '固定为 20 字节。' }),
        F(r, { offset: 12, type: 'uint16', name: 'instanceCount', label: '命名实例数量', editable: false, description: '预定义的具名实例个数。' }),
        F(r, { offset: 14, type: 'uint16', name: 'instanceSize', label: '单个实例大小', editable: false, description: '实例记录大小：axisCount × 4 + 4；若为命名实例提供 PostScript 名则为 axisCount × 4 + 6。' })
      ];
      const AXIS_TAGS = { wght: '字重 Weight', wdth: '字宽 Width', slnt: '倾斜 Slant', ital: '斜体 Italic', opsz: '光学尺寸 Optical Size', GRAD: '等级 Grade', XOPQ: 'X 不透明度', YOPQ: 'Y 不透明度', XTRA: '大写 X 高度', YTRA: '大写 Y 高度', YTLC: '小写 Y 高度', YTUC: '大写高度' };
      const instanceNames = [];
      // 轴
      const axisRows = [];
      for (let i = 0; i < axisCount; i++) {
        const p = axesArrayOffset + i * axisSize;
        if (p + 20 > table.bytes.length) break;
        const tag = U.tag(FL.TYPES.uint32.r(r.view, p));
        const min = FL.TYPES.fixed.r(r.view, p + 4);
        const def = FL.TYPES.fixed.r(r.view, p + 8);
        const max = FL.TYPES.fixed.r(r.view, p + 12);
        const flags = FL.TYPES.uint16.r(r.view, p + 16);
        const nameID = FL.TYPES.uint16.r(r.view, p + 18);
        axisRows.push({
          __index: i, tag: tag, tagDesc: AXIS_TAGS[tag] || '', min: min, def: def, max: max,
          hidden: (flags & 1) ? '隐藏（不作为 UI 展示）' : '可见', nameID: nameID, name: nameStr(font, nameID)
        });
      }
      // 实例。记录长度为 axisCount*4 + 4；若额外提供 PostScript 名则为 + 6（由 instanceSize 判断）
      const instRows = [];
      const instStart = axesArrayOffset + axisCount * axisSize;
      const hasPSName = instanceSize >= axisCount * 4 + 6;
      for (let i = 0; i < instanceCount; i++) {
        const p = instStart + i * instanceSize;
        if (p + 4 > table.bytes.length) break;
        const subfamilyNameID = FL.TYPES.uint16.r(r.view, p);
        const flags = FL.TYPES.uint16.r(r.view, p + 2);
        const coords = [];
        for (let k = 0; k < axisCount; k++) {
          const q = p + 4 + k * 4;
          coords.push(q + 4 <= table.bytes.length ? FL.TYPES.fixed.r(r.view, q) : 0);
        }
        let psName = '（未提供）';
        if (hasPSName) {
          const q = p + 4 + axisCount * 4;
          if (q + 2 <= table.bytes.length) psName = nameStr(font, FL.TYPES.uint16.r(r.view, q)) || '—';
        }
        instRows.push({
          __index: i, subfamilyNameID: subfamilyNameID, name: nameStr(font, subfamilyNameID) || '(未命名)',
          flags: flags === 1 ? 'PS 名与子族名一致' : String(flags),
          coords: coords.join(', '),
          psName: psName
        });
      }
      return {
        sections: [
          H.note('可变字体（Variable Font）', 'fvar 声明可变字体的"设计轴"：用户可以连续调节轴上的数值（如字重 100~900），从而得到无数个中间字重。命名实例则是预设好的取值组合。'),
          H.sec('fvar 表头', '', fields),
          H.matrix('设计轴（Axes）',
            '每个轴由 4 字符标签标识（wght 字重、wdth 字宽、slnt 倾斜、opsz 光学尺寸等），并给出最小值、默认值与最大值。',
            [
              H.col('tag', '轴标签', { align: 'left', width: '90px' }),
              H.col('tagDesc', '轴含义', { align: 'left', width: '150px' }),
              H.col('min', '最小值', { width: '90px' }),
              H.col('def', '默认值', { width: '90px' }),
              H.col('max', '最大值', { width: '90px' }),
              H.col('hidden', '显示性', { align: 'left', width: '160px' }),
              H.col('nameID', '轴名 nameID', { width: '100px' }),
              H.col('name', '轴名', { align: 'left' })
            ], axisRows, { pageSize: 20 }),
          instRows.length
            ? H.matrix('命名实例（Named Instances）',
              '预设的轴取值组合（如 Weight=700 命名为 Bold），用户在字体菜单中直接选择即可。',
              [H.col('subfamilyNameID', 'nameID', { width: '80px' }), H.col('name', '样式名', { align: 'left', width: '170px' }), H.col('coords', '轴取值', { align: 'left' }), H.col('psName', 'PostScript 名', { align: 'left', width: '180px' })],
              instRows, { pageSize: 60 })
            : null
        ].filter(Boolean),
        model: {}
      };
    }
  };

  T['avar'] = {
    parse(font, table) {
      H.need(table, 8, 'avar');
      const r = new FL.Reader(table.bytes);
      // 表头：majorVersion(0) minorVersion(2) reserved(4) axisCount(6)
      const axisCount = FL.TYPES.uint16.r(r.view, 6);
      const rows = [];
      // 各轴的重映射表依次排列：每轴 = positionMapCount(2) + count × (fromCoord, toCoord)
      let p = 8;
      for (let i = 0; i < axisCount; i++) {
        if (p + 2 > table.bytes.length) break;
        const count = FL.TYPES.uint16.r(r.view, p);
        p += 2;
        const pairs = [];
        for (let k = 0; k < count; k++) {
          if (p + 4 > table.bytes.length) break;
          pairs.push(FL.TYPES.f2dot14.r(r.view, p).toFixed(3) + ' → ' + FL.TYPES.f2dot14.r(r.view, p + 2).toFixed(3));
          p += 4;
        }
        rows.push({ __index: i, axis: i, count: count, pairs: pairs.join('，') });
      }
      return {
        sections: [
          H.note('avar —— 轴向重映射', 'avar 表把用户看到的轴坐标（归一化后的 -1~1）映射到内部实际使用的坐标，用于在视觉上让滑块更均匀。例如让 400（Regular）在 100~900 的轴中间看起来更居中。'),
          H.sec('avar 表头', '', [
            F(r, { offset: 0, type: 'uint32', name: 'version', label: '版本', editable: false, description: '固定为 0x00010000。' }),
            F(r, { offset: 6, type: 'uint16', name: 'axisCount', label: '轴数量', editable: false, description: '应与 fvar 的轴数量一致。' })
          ]),
          H.matrix('轴映射对',
            '每行给出一组「用户坐标 → 内部坐标」的映射点，坐标为归一化后的 -1 ~ 1 数值。',
            [H.col('axis', '轴序号', { width: '90px' }), H.col('count', '映射点数量', { width: '110px' }), H.col('pairs', '映射（输入 → 输出）', { align: 'left' })],
            rows, { pageSize: 20 })
        ],
        model: {}
      };
    }
  };

  T['STAT'] = {
    parse(font, table) {
      H.need(table, 18, 'STAT');
      const r = new FL.Reader(table.bytes);
      const major = r.u16(), minor = r.u16();
      const designAxisSize = r.u16(), designAxisCount = r.u16();
      const designAxesOffset = r.u32();
      const axisValueCount = r.u16();
      const offsetToAxisValueOffsets = r.u32();
      const axisRows = [];
      for (let i = 0; i < designAxisCount; i++) {
        const p = designAxesOffset + i * designAxisSize;
        if (p + 8 > table.bytes.length) break;
        const tag = U.tag(FL.TYPES.uint32.r(r.view, p));
        const nameID = FL.TYPES.uint16.r(r.view, p + 4);
        const order = FL.TYPES.uint16.r(r.view, p + 6);
        axisRows.push({ __index: i, tag: tag, nameID: nameID, name: nameStr(font, nameID) || '—', order: order });
      }
      // AxisValue 记录：AxisValueOffsets 数组中的 Offset16 相对于该数组自身起点
      const axisNameOf = (idx) => {
        const a = axisRows[idx];
        return a ? a.tag : '轴' + idx;
      };
      const flagText = (fl) => (fl & 1 ? '【旧版同族（older sibling）】' : '');
      const valRows = [];
      for (let i = 0; i < axisValueCount; i++) {
        const p = offsetToAxisValueOffsets + i * 2;
        if (p + 2 > table.bytes.length) break;
        const off = offsetToAxisValueOffsets + FL.TYPES.uint16.r(r.view, p);
        if (off + 8 > table.bytes.length) break;
        const u16 = (d) => FL.TYPES.uint16.r(r.view, off + d);
        const fx = (d) => FL.TYPES.fixed.r(r.view, off + d);
        const format = u16(0);
        const avNameID = u16(6);   // 各格式的 valueNameID 都位于 +6
        let extra = '';
        if (format === 1) {
          extra = '轴「' + axisNameOf(u16(2)) + '」= ' + fx(8) + flagText(u16(4));
        } else if (format === 2) {
          extra = '轴「' + axisNameOf(u16(2)) + '」的标准值 ' + fx(8) +
            '（范围 ' + fx(12) + ' ~ ' + fx(16) + '）' + flagText(u16(4));
        } else if (format === 3) {
          extra = '轴「' + axisNameOf(u16(2)) + '」= ' + fx(8) + '，链接值 = ' + fx(12) + flagText(u16(4));
        } else if (format === 4) {
          const axisCount2 = u16(2);
          const recs = [];
          let q = off + 8;
          for (let k = 0; k < axisCount2 && q + 6 <= table.bytes.length; k++, q += 6) {
            recs.push(axisNameOf(FL.TYPES.uint16.r(r.view, q)) + '=' + FL.TYPES.fixed.r(r.view, q + 2));
          }
          extra = '组合值：' + recs.join('，') + '（范围 ' + FL.TYPES.fixed.r(r.view, q) + ' ~ ' + FL.TYPES.fixed.r(r.view, q + 4) + '）' + flagText(u16(4));
        } else {
          extra = '（未知格式 ' + format + '）';
        }
        valRows.push({ __index: i, offset: off, format: format, nameID: avNameID, name: nameStr(font, avNameID) || '（系统命名）', detail: extra });
      }
      return {
        sections: [
          H.note('STAT —— 样式属性', 'STAT 描述可变字体各轴取值对应的"样式名称"（如 Weight=700 → Bold），供系统在字体菜单中分组显示。'),
          H.sec('STAT 表头', '', [
            F(r, { offset: 0, type: 'uint16', name: 'majorVersion', label: '主版本', editable: false, description: '1。' }),
            F(r, { offset: 2, type: 'uint16', name: 'minorVersion', label: '次版本', editable: false, description: '1 或 2。' }),
            F(r, { offset: 4, type: 'uint16', name: 'designAxisSize', label: '轴记录大小', editable: false, description: '通常为 8。' }),
            F(r, { offset: 6, type: 'uint16', name: 'designAxisCount', label: '轴数量', editable: false, description: '设计轴个数。' }),
            F(r, { offset: 8, type: 'uint32', name: 'designAxesOffset', label: '轴数组偏移', editable: false, description: '设计轴记录数组的位置。' }),
            F(r, { offset: 12, type: 'uint16', name: 'axisValueCount', label: '轴值数量', editable: false, description: '轴值表条目数。' }),
            F(r, { offset: 14, type: 'uint32', name: 'offsetToAxisValueOffsets', label: '轴值偏移数组位置', editable: false,
              description: '指向 AxisValueOffsets 数组；数组中的每个 Offset16 相对于该数组自身起点，指向一个 AxisValue 记录（格式 1~4）。' })
          ]),
          H.matrix('设计轴',
            '声明字体有哪些设计轴以及它们的显示顺序。',
            [H.col('tag', '轴标签', { align: 'left', width: '90px' }), H.col('name', '轴名', { align: 'left', width: '170px' }), H.col('order', '排序', { width: '80px' }), H.col('nameID', 'nameID', { width: '90px' })],
            axisRows, { pageSize: 20 }),
          H.matrix('轴值记录',
            '格式 1 对应单轴单值；格式 2 为系统自动命名的标准值；格式 3 为带链接的取值；格式 4 表示多个轴的组合。',
            [H.col('format', '格式', { width: '80px' }), H.col('name', '样式名', { align: 'left', width: '170px' }), H.col('detail', '取值', { align: 'left' }), H.col('nameID', 'nameID', { width: '90px' })],
            valRows, { pageSize: 60 })
        ],
        model: {}
      };
    }
  };

  /* ------------------------------------------------- fpgm / prep（指令） */
  function instructionTable(tag, title, desc) {
    return {
      parse(font, table) {
        const b = table.bytes;
        const hist = {};
        for (let i = 0; i < b.length; i++) hist[b[i]] = (hist[b[i]] || 0) + 1;
        const common = Object.keys(hist).map((k) => ({ op: +k, n: hist[k] })).sort((a, b2) => b2.n - a.n).slice(0, 12);
        const rows = common.map((x, i) => ({
          __index: i, opcode: '0x' + U.hex2(x.op), dec: x.op, count: x.n,
          hint: OPCODES[x.op] || ''
        }));
        return {
          sections: [
            H.note(title, desc),
            H.sec(tag + ' 表概况', '', [
              { label: '字节长度', name: '—', offset: null, size: 0, type: 'text', value: '', display: b.length + ' 字节', editable: false, description: 'TrueType 指令为栈式字节码。' },
              { label: '指令总数（估算）', name: '—', offset: null, size: 0, type: 'text', value: '', display: String(b.length), editable: false, description: '每条指令至少 1 字节，部分带参数。' },
              { label: '前 32 字节', name: '—', offset: null, size: 0, type: 'text', value: '', display: U.hexDump(b, { max: 32, per: 16 }).replace(/\n/g, ' ｜ '), editable: false, description: '以十六进制展示开头字节。' }
            ]),
            H.matrix('最常出现的操作码', '统计该表中最常见的指令字节，用于快速了解提示程序的大致行为。',
              [
                H.col('opcode', '操作码', { width: '90px' }),
                H.col('dec', '十进制', { width: '90px' }),
                H.col('count', '出现次数', { width: '100px' }),
                H.col('hint', '指令含义', { align: 'left' })
              ], rows, { pageSize: 20 })
          ],
          model: {}
        };
      }
    };
  }
  T['fpgm'] = instructionTable('fpgm', '物理字体程序（Font Program）',
    'fpgm 表存放字体级的 TrueType 指令，在字体被加载时执行一次，通常用于定义函数（FDEF）与常量。指令是栈式字节码，可被每个字形的指令调用。');
  T['prep'] = instructionTable('prep', '预处理程序（Control Value Program）',
    'prep 表存放"每当字号、变换矩阵改变时"执行的指令，用于根据当前像素尺寸调整控制值（cvt），是实现跨字号一致性的关键。');

  /** 常用 TrueType 操作码（部分） */
  const OPCODES = {
    0x00: 'SVTCA[a] 设定向量为轴', 0x01: 'SVTCA[b]', 0x02: 'SPVTCA[a] 投影向量为 y 轴',
    0x03: 'SPVTCA[b]', 0x04: 'SFVTCA[a] 自由向量为 x 轴', 0x0a: 'SPVTL[a] 投影向量=线的法线',
    0x0c: 'SFVTL[a] 自由向量=线的法线', 0x10: 'SPVFS 设置投影向量', 0x12: 'SFVFS 设置自由向量',
    0x13: 'GPV 取投影向量', 0x17: 'GC[a] 取当前坐标', 0x18: 'SCFS 设置坐标', 0x1b: 'MD[a] 测量距离',
    0x21: 'SRP0 设置参考点0', 0x22: 'SRP1', 0x23: 'SRP2', 0x24: 'SZP0 设置区域0',
    0x25: 'SZP1', 0x26: 'SZP2', 0x27: 'SZPS', 0x28: 'SLOOP 设置循环次数',
    0x29: 'RTG 取整到网格', 0x2b: 'SMD 设置最小距离', 0x2c: 'INSTCTRL 指令控制',
    0x2e: 'ROFF 关闭取整', 0x2f: 'RUTG[a]', 0x30: 'RDTG 向下取整',
    0x31: 'SANGW 设置角度权重', 0x32: 'AA 调整角度', 0x35: 'FLIPPT 翻转点',
    0x38: 'SHP[a] 移动点', 0x39: 'SHP[b]', 0x3a: 'SHC[a] 移动轮廓', 0x3b: 'SHC[b]',
    0x3c: 'SHZ[a] 移动区域', 0x41: 'SHPIX 按像素移动点', 0x42: 'IP[a] 插值点',
    0x43: 'IP[b]', 0x44: 'MSIRP[a] 移动参考点并插值', 0x46: 'ALIGNRP 对齐到参考点',
    0x4b: 'MIAP[a] 移动间接绝对点', 0x4c: 'MIAP[b]', 0x51: 'RAW 读存储区',
    0x53: 'RS 读存储区', 0x54: 'WCVTP 写控制值到点', 0x55: 'RCVT 读控制值',
    0x57: 'GC[a]', 0x58: 'SCFS', 0x59: 'MD[a]', 0x5a: 'MPPEM 取每 em 像素数',
    0x5b: 'FLIPON 开启翻转', 0x5c: 'FLIPOFF', 0x5d: 'DEBUG', 0x5e: 'LT 比较小于',
    0x5f: 'LTEQ 小于等于', 0x60: 'GT 大于', 0x61: 'GTEQ', 0x62: 'EQ 等于',
    0x63: 'NEQ 不等于', 0x64: 'ODD 判断奇数', 0x65: 'EVEN 判断偶数',
    0x66: 'IF 条件执行', 0x67: 'ELSE', 0x68: 'EIF 结束条件', 0x69: 'AND 逻辑与',
    0x6a: 'OR 逻辑或', 0x6b: 'NOT 逻辑非', 0x6c: 'DELTAP1 增量微调',
    0x70: 'DELTAP2', 0x71: 'DELTAP3', 0x72: 'DELTAC1', 0x76: 'SDB 设置距离基准',
    0x77: 'SDS 设置距离量级', 0x78: 'ADD 加法', 0x79: 'SUB 减法',
    0x7a: 'DIV 除法', 0x7b: 'MUL 乘法', 0x7c: 'ABS 绝对值', 0x7d: 'NEG 取负',
    0x7e: 'FLOOR 向下取整', 0x7f: 'CEILING 向上取整', 0x80: 'ROUND[ab] 取整',
    0x83: 'NROUND[ab]', 0x85: 'SCANCTRL 扫描控制', 0x86: 'SDPVTL[a]',
    0x88: 'GETINFO 取信息', 0x89: 'IDEF 定义指令', 0x8a: 'ROLL 栈滚动',
    0x8b: 'MAX 取最大', 0x8c: 'MIN 取最小', 0x8d: 'SCANTYPE 扫描类型',
    0x8e: 'INSTCTRL', 0x8f: 'SCANCTRL', 0xb0: 'PUSHB[1..8] 压入 1 字节',
    0xb1: 'PUSHW[1..8] 压入 2 字节', 0xc0: 'MDRP 移动直接相对点',
    0xc1: 'MDRP', 0xc2: 'MDRP', 0xc3: 'MDRP', 0xc4: 'MDRP', 0xc5: 'MDRP',
    0xc6: 'MDRP', 0xc7: 'MDRP', 0xc8: 'MDRP', 0xc9: 'MDRP', 0xca: 'MDRP',
    0xcb: 'MDRP', 0xcc: 'MDRP', 0xcd: 'MDRP', 0xce: 'MDRP', 0xcf: 'MDRP',
    0xd0: 'MIRP 移动间接相对点', 0xdf: 'MIRP', 0xe0: 'MIRP', 0xf0: 'MIRP',
    0xff: 'MIRP（最大）'
  };
  T.fpgm.OPCODES = OPCODES;

  /* ------------------------------------------------------------- 通用兜底 */
  T['*'] = {
    parse(font, table) {
      const info = U.TABLE_INFO[table.tag] || {};
      const b = table.bytes;
      const fields = [
        { label: '表标签', name: 'tag', offset: null, size: 4, type: 'text', value: table.tag, display: '"' + table.tag + '"', editable: false, description: '该表在字体目录中的 4 字节标识。' },
        { label: '表名', name: '—', offset: null, size: 0, type: 'text', value: info.name || '', display: info.name || '（未知表）', editable: false, description: info.desc || '本工具未收录该表的说明。' },
        { label: '长度', name: 'length', offset: null, size: 0, type: 'text', value: b.length, display: b.length + ' 字节', editable: false, description: '表数据长度（不含对齐填充）。' },
        { label: '校验和（目录记录）', name: 'checksum', offset: null, size: 0, type: 'text', value: table.checksum, display: '0x' + U.hex8(table.checksum), editable: false, description: '字体目录中记录的校验和。本工具不做一致性校验；保存时会按实际内容重新计算。' }
      ];
      return {
        sections: [H.sec('基本信息', info.desc || '', fields), hexSec(table)],
        model: {}
      };
    }
  };

  /* 辅助：按 nameID 查名称（fvar/STAT 需要） */
  function nameStr(font, nameID) {
    const res = font.parsed['name'];
    if (!res || !res.model || !res.model.records) return '';
    const list = res.model.records.filter((r) => r.nameID === nameID);
    if (!list.length) return '';
    const win = list.find((r) => r.platformID === 3) || list[0];
    return win.text;
  }
  FL.tables.helper.nameStr = nameStr;
})(typeof window !== 'undefined' ? window : globalThis);
