/* =========================================================================
 * tables/cff.js —— CFF / CFF2（Compact Font Format，PostScript 轮廓）
 *  解析 INDEX、DICT、CharStrings、Private DICT、charset、FDArray/FDSelect
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;
  const F = H.F;

  /** CFF 标准字符串（SID 0~166，其余以 SID 编号显示） */
  const STD = ('.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright ' +
    'parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six ' +
    'seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O ' +
    'P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft ' +
    'a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde ' +
    'exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft ' +
    'guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered ' +
    'paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand ' +
    'questiondown grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla ' +
    'hungarumlaut ogonek caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi ' +
    'lslash oslash oe germandbls onesuperior logicalnot mu trademark Eth onehalf plusminus Thorn ' +
    'onequarter divide brokenbar degree thorn threequarters twosuperior registered minus eth ' +
    'multiply threesuperior copyright').split(' ');

  /** Top DICT 运算符 */
  const TOP_OPS = {
    0: ['version', '版本字符串（SID）'],
    1: ['Notice', '版权声明（SID）'],
    2: ['FullName', '完整字体名（SID）'],
    3: ['FamilyName', '家族名（SID）'],
    4: ['Weight', '字重名称（SID），如 Bold'],
    5: ['FontBBox', '字体边界框 [xMin yMin xMax yMax]'],
    13: ['UniqueID', '唯一标识号（已废弃）'],
    14: ['XUID', '扩展唯一标识数组（已废弃）'],
    15: ['charset', '字形名称集（charset）偏移：0=ISOAdobe，1=Expert，2=ExpertSubset，其它为偏移'],
    16: ['Encoding', '编码表偏移：0=标准编码，1=Expert 编码，其它为偏移'],
    17: ['CharStrings', 'CharStrings INDEX 的偏移（每个字形一段 Type2 轮廓程序）'],
    18: ['Private', '私有字典 [大小 偏移]，存放 BlueValues、Subrs 等'],
    19: ['Subrs', '（私有）局部子程序 INDEX 偏移'],
    20: ['defaultWidthX', '（私有）默认字形宽度'],
    21: ['nominalWidthX', '（私有）名义字形宽度，实际宽度 = nominal + 差值'],
    '12 0': ['Copyright', '版权（SID）'],
    '12 1': ['isFixedPitch', '是否等宽字体'],
    '12 2': ['ItalicAngle', '斜体角度'],
    '12 3': ['UnderlinePosition', '下划线位置'],
    '12 4': ['UnderlineThickness', '下划线粗细'],
    '12 5': ['PaintType', '绘制类型（1=描边/填充，2=空心）'],
    '12 6': ['CharstringType', 'CharString 类型（固定为 2）'],
    '12 7': ['FontMatrix', '字体坐标变换矩阵'],
    '12 8': ['StrokeWidth', '描边宽度'],
    '12 20': ['SyntheticBase', '合成字体基准（已废弃）'],
    '12 21': ['PostScript', 'PostScript 名称（SID）'],
    '12 22': ['BaseFontName', '基准字体名（SID）'],
    '12 23': ['BaseFontBlend', '基准字体混合（已废弃）'],
    '12 30': ['ROS', 'CID 字体：[注册机构 SID, 补充 SID, 版本] —— 该字体为 CID 字体'],
    '12 31': ['CIDFontVersion', 'CID 字体版本'],
    '12 32': ['CIDFontRevision', 'CID 字体修订号'],
    '12 33': ['CIDFontType', 'CID 字体类型（0 或 2）'],
    '12 34': ['CIDCount', 'CID 数量上限'],
    '12 35': ['UIDBase', 'UID 基准'],
    '12 36': ['FDArray', '字体字典数组（CID 字体按 FD 分组共享私有字典）'],
    '12 37': ['FDSelect', '字形 → FD 索引的映射'],
    '12 38': ['FontName', 'CID 字体 PostScript 名称（SID）']
  };

  /** Private DICT 运算符 */
  const PRIV_OPS = {
    6: ['BlueValues', '蓝色区域（对齐区），如基线、x 高度、大写高度附近需要吸附的数值'],
    7: ['OtherBlues', '其它蓝色区域（通常用于降部）'],
    8: ['FamilyBlues', '家族蓝色区域（继承自家族字体）'],
    9: ['FamilyOtherBlues', '家族其它蓝色区域'],
    10: ['StdHW', '标准横向笔画宽度'],
    11: ['StdVW', '标准纵向笔画宽度'],
    19: ['Subrs', '局部子程序（local subr）INDEX 偏移'],
    20: ['defaultWidthX', '默认宽度：CharString 未给出宽度时使用'],
    21: ['nominalWidthX', '名义宽度：CharString 中给出的宽度差值的基准'],
    '12 9': ['BlueScale', '蓝色区域吸附的容差系数'],
    '12 10': ['BlueShift', '蓝色区域在低分辨率下的收缩量'],
    '12 11': ['BlueFuzz', '蓝色区域模糊量'],
    '12 12': ['StemSnapH', '横向主干宽度集合（用于保证一致的笔画粗细）'],
    '12 13': ['StemSnapV', '纵向主干宽度集合'],
    '12 14': ['ForceBold', '是否强制粗体'],
    '12 17': ['LanguageGroup', '语言分组（影响两端对齐的端点行为）'],
    '12 18': ['ExpansionFactor', '扩展系数'],
    '12 19': ['initialRandomSeed', '初始随机种子']
  };

  /**
   * 解析 CFF INDEX：count(2) + offSize(1) + offsets[count+1] + data
   * 注意：offsets 是相对数据区起始位置的 1 基偏移。
   */
  function index(bytes, off) {
    if (off + 2 > bytes.length) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = dv.getUint16(off);
    if (count === 0) return { count: 0, offSize: 0, offsets: [off + 2], dataStart: off + 2, end: off + 2,
      item() { return bytes.subarray(0, 0); } };
    const offSize = bytes[off + 2];
    const offsets = [];
    const p = off + 3;
    for (let i = 0; i <= count; i++) {
      let v = 0;
      for (let k = 0; k < offSize; k++) v = v * 256 + (bytes[p + i * offSize + k] || 0);
      offsets.push(v);
    }
    const dataStart = p + (count + 1) * offSize;   // 数据区第一个字节的绝对位置
    const end = dataStart + offsets[count] - 1;
    return {
      count: count, offSize: offSize, offsets: offsets, dataStart: dataStart, end: end,
      item(i) { return bytes.subarray(dataStart + offsets[i] - 1, dataStart + offsets[i + 1] - 1); }
    };
  }

  /** 解析 DICT */
  function parseDict(bytes, start, end) {
    const items = [];
    const stack = [];
    let p = start;
    while (p < end && p < bytes.length) {
      const b0 = bytes[p++];
      if (b0 <= 21) {
        let op = String(b0);
        if (b0 === 12) { op = '12 ' + bytes[p++]; }
        items.push({ op: op, operands: stack.slice() });
        stack.length = 0;
      } else if (b0 === 28) {
        stack.push((bytes[p] << 24 >> 16) + (bytes[p + 1] << 8 >> 0) * 0 + ((bytes[p] << 8 | bytes[p + 1]) << 16 >> 16));
        stack[stack.length - 1] = ((bytes[p] << 8 | bytes[p + 1]) << 16) >> 16;
        p += 2;
      } else if (b0 === 29) {
        const v = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
        stack.push(v | 0);
        p += 4;
      } else if (b0 === 30) {
        let s = '';
        let done = false;
        while (p < bytes.length && !done) {
          const b = bytes[p++];
          for (const nib of [b >> 4, b & 0xf]) {
            if (nib <= 9) s += nib;
            else if (nib === 10) s += '.';
            else if (nib === 11) s += 'E';
            else if (nib === 12) s += 'E-';
            else if (nib === 14) s += '-';
            else if (nib === 15) { done = true; break; }
          }
        }
        stack.push(parseFloat(s));
      } else if (b0 >= 32 && b0 <= 246) {
        stack.push(b0 - 139);
      } else if (b0 >= 247 && b0 <= 250) {
        stack.push((b0 - 247) * 256 + bytes[p++] + 108);
      } else if (b0 >= 251 && b0 <= 254) {
        stack.push(-(b0 - 251) * 256 - bytes[p++] - 108);
      }
    }
    return items;
  }

  function dictGet(items, op) {
    const it = items.find((x) => x.op === op);
    return it ? it.operands : null;
  }

  function sid(res, sid, strings) {
    if (sid == null) return '';
    if (sid < STD.length) return STD[sid];
    const i = sid - 391;
    if (strings && strings[i] != null) return strings[i];
    return 'SID ' + sid;
  }

  function fmtOperands(ops) {
    if (!ops || !ops.length) return '—';
    return ops.map((v) => (typeof v === 'number' ? (Math.abs(v) < 0.0001 ? v.toExponential(3) : String(Math.round(v * 10000) / 10000)) : String(v))).join(' ');
  }

  T['CFF '] = {
    parse(font, table) {
      H.need(table, 4, 'CFF ');
      const b = table.bytes;
      const major = b[0], minor = b[1], hdrSize = b[2], offSize = b[3];
      const nameIndex = index(b, hdrSize);
      const topIndex = index(b, nameIndex.end);
      const stringIndex = index(b, topIndex.end);
      const gsubrIndex = index(b, stringIndex.end);

      const strings = [];
      for (let i = 0; i < stringIndex.count; i++) strings.push(U.latin1(stringIndex.item(i)));

      const sections = [];
      sections.push(H.sec('CFF 表头',
        'CFF（Compact Font Format）以紧凑的索引结构存放 PostScript Type2 三次贝塞尔轮廓，OpenType/CFF 字体（.otf）即由它提供字形。' +
        '与 TrueType 的 glyf 表相比，CFF 体积更小、曲线更平滑，但不含 TrueType 指令。',
        [
          { label: '主版本号', name: 'major', offset: 0, size: 1, type: 'uint8', value: major, display: String(major), editable: false, description: 'CFF 规范主版本，通常为 1。' },
          { label: '次版本号', name: 'minor', offset: 1, size: 1, type: 'uint8', value: minor, display: String(minor), editable: false, description: '次版本号。' },
          { label: '表头长度', name: 'hdrSize', offset: 2, size: 1, type: 'uint8', value: hdrSize, display: hdrSize + ' 字节', editable: false, description: 'CFF 表头的字节长度，Name INDEX 紧随其后。' },
          { label: '偏移量字节数', name: 'offSize', offset: 3, size: 1, type: 'uint8', value: offSize, display: String(offSize), editable: false, description: '规范要求为 1~4（本表实际索引使用各自的 offSize）。' },
          { label: '字体数量', name: '—', offset: null, size: 0, type: 'text', value: nameIndex.count, display: String(nameIndex.count), editable: false, description: 'Name INDEX 中的字体名数量（CFF 可包含多份字体）。' },
          { label: 'String INDEX 条目', name: '—', offset: null, size: 0, type: 'text', value: stringIndex.count, display: stringIndex.count + ' 条自定义字符串', editable: false, description: '除 391 个标准字符串外，字体自定义的字符串（SID ≥ 391）。' },
          { label: 'Global Subr INDEX', name: '—', offset: null, size: 0, type: 'text', value: gsubrIndex.count, display: gsubrIndex.count + ' 个子程序', editable: true, description: '全局子程序（gsubr）：被多个字形复用的 CharString 片段，可显著减小体积。' }
        ]));

      const nameRows = [];
      for (let i = 0; i < nameIndex.count; i++) {
        nameRows.push({ __index: i, i: i, name: U.latin1(nameIndex.item(i)) });
      }
      sections.push(H.matrix('Name INDEX —— 字体名',
        [H.col('i', '序号', { width: '80px' }), H.col('name', '字体名', { align: 'left' })],
        nameRows, { pageSize: 20 }));

      // Top DICT
      for (let i = 0; i < topIndex.count; i++) {
        const items = parseDict(topIndex.item(i), 0, topIndex.item(i).length);
        const rows = items.map((it, k) => {
          const info = TOP_OPS[it.op] || (TOP_OPS['12 ' + it.op] || null);
          const localOps = PRIV_OPS[it.op];
          const meta = info || localOps;
          let extra = '';
          if (['0', '1', '2', '3', '4', '12 0', '12 21', '12 22', '12 38'].indexOf(it.op) >= 0 && it.operands.length) {
            extra = ' → “' + sid(null, it.operands[it.operands.length - 1], strings) + '”';
          }
          return {
            __index: k,
            op: it.op,
            name: meta ? meta[0] : '（未知运算符）',
            values: fmtOperands(it.operands),
            extra: extra,
            desc: meta ? meta[1] : ''
          };
        });
        sections.push(H.matrix('Top DICT（字体字典 #' + (i + 1) + '）',
          'DICT 是 CFF 的键值结构：每行给出一个运算符（键）及其操作数（值）。可用下方的原始数据视图修改字节。',
          [
            H.col('op', '运算符', { width: '80px' }),
            H.col('name', '键名', { align: 'left', width: '170px' }),
            H.col('values', '值', { align: 'left', width: '170px' }),
            H.col('extra', '解析结果', { align: 'left', width: '220px' }),
            H.col('desc', '说明', { align: 'left' })
          ], rows, { pageSize: 100 }));

        const csOps = dictGet(items, '17');
        const charStringsOff = csOps ? csOps[0] : null;
        let csIndex = null;
        if (charStringsOff != null) {
          csIndex = index(b, charStringsOff);
          if (csIndex) {
            const sizes = [];
            for (let k = 0; k < Math.min(csIndex.count, 20000); k++) sizes.push(csIndex.offsets[k + 1] - csIndex.offsets[k]);
            const avg = sizes.reduce((a, x) => a + x, 0) / (sizes.length || 1);
            sections.push(H.sec('CharStrings INDEX',
              '每个字形对应一段 Type2 CharString（PostScript 程序）：它是一串"移动/画线/曲线"指令，由解释器执行后得到轮廓。', [
              { label: '偏移', name: 'offset', offset: null, size: 0, type: 'text', value: charStringsOff, display: String(charStringsOff), editable: false, description: 'CharStrings INDEX 在 CFF 表中的字节偏移。' },
              { label: '字形数量', name: '—', offset: null, size: 0, type: 'text', value: csIndex.count, display: String(csIndex.count), editable: false, description: '应与 maxp.numGlyphs 一致。' },
              { label: '平均 CharString 大小', name: '—', offset: null, size: 0, type: 'text', value: '', display: avg.toFixed(1) + ' 字节', editable: false, description: '字形程序的平均长度，越小说明子程序复用越充分。' },
              { label: '最大 / 最小', name: '—', offset: null, size: 0, type: 'text', value: '', display: Math.max.apply(null, sizes.slice(0, 5000)) + ' / ' + Math.min.apply(null, sizes.slice(0, 5000)) + ' 字节', editable: false, description: '前 5000 个字形的最大/最小 CharString 长度。' }
            ]));
          }
        }

        const privOps = dictGet(items, '18');
        if (privOps && privOps.length >= 2) {
          const size = privOps[0], off = privOps[1];
          const pitems = parseDict(b, off, off + size);
          const prows = pitems.map((it, k) => {
            const meta = PRIV_OPS[it.op] || PRIV_OPS['12 ' + it.op];
            return {
              __index: k, op: it.op, name: meta ? meta[0] : '（未知）',
              values: fmtOperands(it.operands), desc: meta ? meta[1] : ''
            };
          });
          sections.push(H.matrix('Private DICT（私有字典）',
            '私有字典影响字形的提示（hinting）与宽度计算：BlueValues 告诉光栅器哪些数值需要"吸附"到像素网格，StemSnap 保证笔画粗细一致。',
            [
              H.col('op', '运算符', { width: '80px' }),
              H.col('name', '键名', { align: 'left', width: '170px' }),
              H.col('values', '值', { align: 'left', width: '220px' }),
              H.col('desc', '说明', { align: 'left' })
            ], prows, { pageSize: 60 }));
        }

        const ros = dictGet(items, '12 30');
        if (ros) {
          sections.push(H.note('CID 字体', '该字体是 CID-keyed CFF 字体（ROS = ' + sid(null, ros[0], strings) + ' / ' + sid(null, ros[1], strings) + ' / ' + ros[2] +
            '）。CID 字体用数字 CID 而非名称标识字形，并通过 FDArray/FDSelect 让不同字形组使用不同的私有字典（常用于中日韩字体）。'));
        }
      }

      return { sections: sections, model: { nameIndex: nameIndex, topIndex: topIndex } };
    }
  };

  /* ------------------------------------------------------------ CFF2 */
  T['CFF2'] = {
    parse(font, table) {
      H.need(table, 5, 'CFF2');
      const b = table.bytes;
      const major = b[0], minor = b[1], hdrSize = b[2], topDictLength = FL.TYPES.uint16.r(new FL.Reader(b).view, 3);
      const items = parseDict(b.subarray(hdrSize, hdrSize + topDictLength), 0, topDictLength);
      const rows = items.map((it, k) => {
        const meta = TOP_OPS[it.op] || PRIV_OPS[it.op];
        return { __index: k, op: it.op, name: meta ? meta[0] : '（未知）', values: fmtOperands(it.operands), desc: meta ? meta[1] : '' };
      });
      return {
        sections: [
          H.note('CFF2 —— 可变字体轮廓', 'CFF2 是 CFF 的精简版本，专为可变字体（Variable Font）设计：它去掉了字形名称与 Encoding，并允许在 CharString 中使用 blend 指令在不同设计轴的取值间插值。'),
          H.sec('CFF2 表头', '', [
            { label: '主版本', name: 'major', offset: 0, size: 1, type: 'uint8', value: major, display: String(major), editable: false, description: '固定为 2。' },
            { label: '次版本', name: 'minor', offset: 1, size: 1, type: 'uint8', value: minor, display: String(minor), editable: false, description: '' },
            { label: '表头长度', name: 'hdrSize', offset: 2, size: 1, type: 'uint8', value: hdrSize, display: String(hdrSize), editable: false, description: '' },
            { label: 'Top DICT 长度', name: 'topDictLength', offset: 3, size: 2, type: 'uint16', value: topDictLength, display: String(topDictLength), editable: false, description: '' }
          ]),
          H.matrix('Top DICT', '', [
            H.col('op', '运算符', { width: '80px' }),
            H.col('name', '键名', { align: 'left', width: '170px' }),
            H.col('values', '值', { align: 'left', width: '200px' }),
            H.col('desc', '说明', { align: 'left' })
          ], rows, { pageSize: 60 })
        ],
        model: {}
      };
    }
  };

  T.cff = { index: index, parseDict: parseDict, STD: STD };
})(typeof window !== 'undefined' ? window : globalThis);
