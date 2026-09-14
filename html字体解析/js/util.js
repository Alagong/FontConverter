/* =========================================================================
 * util.js —— 通用工具层
 *  - 数值/字符串/时间格式化
 *  - MacRoman 编解码
 *  - 各表枚举与中文说明数据（表标签、nameID、平台、字重、位标志等）
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = (FL.util = {});

  /* ---------------------------------------------------------------------
   * 基础格式化
   * ------------------------------------------------------------------- */

  const HEX = [];
  for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

  U.hex2 = (v) => HEX[(v & 0xff) >>> 0];
  U.hex4 = (v) => U.hex2((v >> 8) & 0xff) + U.hex2(v & 0xff);
  U.hex8 = (v) => U.hex4((v >>> 16) & 0xffff) + U.hex4(v & 0xffff);

  /** uint32 / 4 字节 → 标签字符串，例如 0x68656164 → "head" */
  U.tag = (n) =>
    String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

  /** 标签字符串 → uint32 */
  U.tagToInt = (s) => {
    const p = (s + '    ').slice(0, 4);
    return (
      ((p.charCodeAt(0) << 24) >>> 0) +
      (p.charCodeAt(1) << 16) +
      (p.charCodeAt(2) << 8) +
      p.charCodeAt(3)
    );
  };

  /** 可打印 ASCII 化（其它字符用 . 代替） */
  U.printable = (s) => s.replace(/[^\x20-\x7e]/g, '.');

  U.fixed1616 = (n) => {
    const v = n / 65536;
    return v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '.0');
  };
  U.f2dot14 = (n) => (n / 16384).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');

  /** LONGDATETIME：自 1904-01-01 00:00:00 UTC 起的秒数（64 位）*/
  U.longDateTimeToDate = (n) => new Date(n * 1000 - 2082844800000);
  U.dateToLongDateTime = (d) => Math.round((d.getTime() + 2082844800000) / 1000);

  U.fmtDate = (d) => {
    if (!d || isNaN(d.getTime())) return '（无效）';
    const p = (x) => String(x).padStart(2, '0');
    return (
      d.getUTCFullYear() +
      '-' + p(d.getUTCMonth() + 1) +
      '-' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) +
      ':' + p(d.getUTCMinutes()) +
      ':' + p(d.getUTCSeconds()) + ' UTC'
    );
  };

  U.bytesToStr = (bytes, from, len) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[from + i] || 0);
    return s;
  };

  /** ISO-8859-1 解码（CFF 字符串、PostScript 名称等） */
  U.latin1 = (bytes) => U.bytesToStr(bytes, 0, bytes.length);

  /** 十六进制转储 */
  U.hexDump = (bytes, opts) => {
    opts = opts || {};
    const start = opts.start || 0;
    const max = opts.max == null ? 256 : opts.max;
    const per = opts.per || 16;
    const lines = [];
    const end = Math.min(bytes.length, start + max);
    for (let off = start; off < end; off += per) {
      let hex = '', asc = '';
      for (let i = 0; i < per; i++) {
        const p = off + i;
        if (p < end) {
          hex += HEX[bytes[p]] + ' ';
          const c = bytes[p];
          asc += c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
        } else hex += '   ';
      }
      lines.push(
        off.toString(16).padStart(8, '0') + '  ' + hex + ' |' + asc + '|'
      );
    }
    if (end < bytes.length) lines.push('... 共 ' + bytes.length + ' 字节');
    return lines.join('\n');
  };

  /* ---------------------------------------------------------------------
   * MacRoman 编解码（name 表 platformID=1 常用）
   * ------------------------------------------------------------------- */
  const MAC_ROMAN_HIGH =
    'ÄÅÇÉÑÖÜáàâäèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
    '¿¡¬√ƒ≈∆«»…\u00A0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ' +
    '˜¯˘˙˚¸˝˛ˇ—';
  U.macRomanDecode = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      s += b < 128 ? String.fromCharCode(b) : MAC_ROMAN_HIGH[b - 128] || '?';
    }
    return s;
  };
  const MAC_ROMAN_MAP = (() => {
    const m = {};
    for (let i = 0; i < MAC_ROMAN_HIGH.length; i++) {
      if (m[MAC_ROMAN_HIGH[i]] === undefined) m[MAC_ROMAN_HIGH[i]] = 128 + i;
    }
    return m;
  })();
  U.macRomanEncode = (str) => {
    const out = [];
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c < 128) out.push(c);
      else out.push(MAC_ROMAN_MAP[ch] !== undefined ? MAC_ROMAN_MAP[ch] : 63);
    }
    return out;
  };

  /* ---------------------------------------------------------------------
   * 文本解码 / 编码（name、post 等）
   * ------------------------------------------------------------------- */
  function tryDecode(bytes, label) {
    try {
      return new TextDecoder(label, { fatal: false }).decode(new Uint8Array(bytes));
    } catch (e) {
      return null;
    }
  }

  /** 根据平台/编码给出解码器标签（浏览器与 Node 均支持 WHATWG 编码） */
  U.encodingLabel = (platformID, encodingID) => {
    if (platformID === 0) return 'utf-16be';
    if (platformID === 3) {
      return {
        0: 'utf-16be', 1: 'utf-16be', 2: 'shift_jis', 3: 'gbk',
        4: 'big5', 5: 'euc-kr', 6: 'utf-16be', 10: 'utf-16be'
      }[encodingID] || 'utf-16be';
    }
    if (platformID === 1) {
      return { 0: 'macintosh', 1: 'shift_jis', 2: 'big5', 3: 'euc-kr', 25: 'gbk' }[encodingID] || 'macintosh';
    }
    return 'latin1';
  };

  U.decodeText = (bytes, platformID, encodingID) => {
    if (!bytes || !bytes.length) return '';
    if (platformID === 3 || platformID === 0) {
      // Windows/Unicode 平台：UTF-16BE
      if (encodingID === 2 || encodingID === 3 || encodingID === 4 || encodingID === 5) {
        const s = tryDecode(bytes, U.encodingLabel(platformID, encodingID));
        if (s != null) return s;
      }
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2)
        s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      if (bytes.length & 1) s += String.fromCharCode(bytes[bytes.length - 1]);
      return s;
    }
    if (platformID === 1) {
      if (encodingID === 0) return U.macRomanDecode(bytes);
      const s = tryDecode(bytes, U.encodingLabel(platformID, encodingID));
      return s != null ? s : U.macRomanDecode(bytes);
    }
    const s = tryDecode(bytes, 'latin1');
    return s != null ? s : U.bytesToStr(bytes, 0, bytes.length);
  };

  U.encodeText = (str, platformID, encodingID) => {
    if (platformID === 3 || platformID === 0) {
      const out = new Uint8Array(str.length * 2);
      let n = 0;
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        out[n++] = (c >> 8) & 0xff;
        out[n++] = c & 0xff;
      }
      return out;
    }
    if (platformID === 1 && encodingID === 0) return new Uint8Array(U.macRomanEncode(str));
    // 其它编码：尽力而为（回退 UTF-16BE 会破坏语义，这里用 Latin1/ASCII 保底）
    const out = [];
    for (const ch of str) {
      const c = ch.codePointAt(0);
      out.push(c < 256 ? c : 63);
    }
    return new Uint8Array(out);
  };

  /** 全角/半角无关的字符显示（如制表符） */
  U.visible = (s) =>
    String(s).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\0/g, '\\0');

  /* =====================================================================
   * 枚举与说明数据
   * =================================================================== */

  /** 表标签 → { name, desc } */
  U.TABLE_INFO = {
    head: { name: '字体头表', desc: '全局信息：em 单位、字体版本、创建/修改时间、全局边界框、loca 表格式等。每个字体必须且只能有一个。' },
    hhea: { name: '水平头表', desc: '水平排版的全局度量：上升部、下降部、行距、最大前进宽度、卡雷特斜率等。' },
    vhea: { name: '垂直头表', desc: '垂直排版的全局度量（竖排文本），字段结构与 hhea 类似。' },
    maxp: { name: '最大需求表', desc: '字形数量以及栅格化/执行指令时所需的最大资源（最大点数、最大轮廓数、栈深度等）。' },
    'OS/2': { name: 'OS/2 度量表', desc: '面向 Windows/OS/2 的度量与策略信息：字重字宽、嵌入权限、Unicode 覆盖范围、Typo/Win 度量、Panose 等。' },
    name: { name: '名称表', desc: '存放所有人类可读文本：家族名、子族名、版权、商标、许可、设计者、样例文本等。' },
    cmap: { name: '字符映射表', desc: '把字符编码（Unicode/传统编码）映射到字形索引（GID），决定输入某个字符时显示哪个字形。' },
    post: { name: 'PostScript 表', desc: 'PostScript 相关：斜体角度、下划线位置/粗细、等宽标志、字形名称。' },
    hmtx: { name: '水平度量表', desc: '每个字形的水平前进宽度（advance width）与左侧承托距离（left side bearing）。' },
    vmtx: { name: '垂直度量表', desc: '每个字形的垂直前进高度与顶部承托距离。' },
    loca: { name: '字形位置表', desc: '记录每个字形数据在 glyf 表中的偏移位置，配合 head.indexToLocFormat 使用。' },
    glyf: { name: '字形轮廓表', desc: 'TrueType 二次贝塞尔轮廓数据：控制点、轮廓、复合字形引用与提示指令。' },
    kern: { name: '字距调整表', desc: '经典 TrueType 字距调整（kerning）配对表，按字符对给出间距修正值。' },
    GPOS: { name: '字形定位表', desc: 'OpenType 布局（定位）：字距、标记附着、连字定位、CJK 间距调整等，按脚本/特性/查找表组织。' },
    GSUB: { name: '字形替换表', desc: 'OpenType 布局（替换）：连字、上下文替换、备选字形、小型大写等，按脚本/特性/查找表组织。' },
    GDEF: { name: '字形定义表', desc: '为布局引擎提供字形类别（基字/连字/标记）、标记附着类、连字插入符等信息。' },
    BASE: { name: '基线表', desc: '为不同脚本声明基线（alphabetic、ideographic 等）的位置与最小/最大范围。' },
    JSTF: { name: '两端对齐表', desc: 'OpenType 两端对齐（justification）所需的优先/延展/收缩点定义。' },
    MATH: { name: '数学排版表', desc: 'OpenType Math：数学脚本的字形属性、字距、上下标尺寸与延伸部件。' },
    'CFF ': { name: 'CFF 表', desc: 'Compact Font Format：PostScript Type2 三次曲线轮廓、字名、私有字典、子程序。' },
    CFF2: { name: 'CFF2 表', desc: 'CFF2：可变字体使用的 PostScript 轮廓（无字形名，支持 blend 插值）。' },
    'cvt ': { name: '控制值表', desc: 'TrueType 提示（hinting）用的控制值数组，通常为关键尺寸（x-height、笔画粗细等）。' },
    fpgm: { name: '字体程序表', desc: '字体级 TrueType 提示程序（字节码指令），在字体加载时执行一次。' },
    prep: { name: '控制值程序表', desc: '在每次字号/变换改变时执行的 TrueType 提示程序。' },
    gasp: { name: '栅格化参数表', desc: 'Grid-fitting and Scan-conversion Procedure：按像素大小范围声明是否网格拟合/灰度/对称平滑。' },
    hdmx: { name: '水平设备度量表', desc: '为特定像素尺寸预先计算的每字形水平宽度（供点阵对齐使用）。' },
    LTSH: { name: '线性阈值表', desc: 'Linear Threshold：每个字形开始被等比缩放的像素尺寸阈值。' },
    VDMX: { name: '垂直设备度量表', desc: '为特定像素尺寸声明的垂直度量（ascent/descent）覆盖值。' },
    DSIG: { name: '数字签名表', desc: 'OpenType 数字签名，用于校验字体未被篡改。修改字体后此签名会失效。' },
    meta: { name: '元数据表', desc: '以标签索引的元数据（如 dlng/slng 支持语言、应用自定义信息）。' },
    PCLT: { name: 'PCLT 表', desc: 'HP PCL 5 打印机所需的字体信息（字体编号、字距、字符集等）。' },
    VORG: { name: '垂直原点表', desc: 'CFF 字体的默认垂直原点 Y 坐标及每字形覆盖值。' },
    COLR: { name: '彩色字形表', desc: '定义分层彩色字形：把字形拆解为多个图层，每层指向基字形与调色板颜色。' },
    CPAL: { name: '调色板表', desc: '彩色字体的调色板（每组颜色 RGBA）及前景/背景色索引。' },
    'SVG ': { name: 'SVG 字形表', desc: '以 SVG 文档描述彩色/矢量字形，可包含位图。' },
    sbix: { name: '位图字形表', desc: 'Apple 位图字形（含 PNG/JPEG），按 strike（尺寸）组织。' },
    CBDT: { name: '彩色位图数据表', desc: '彩色位图字形数据（与 CBLC 配合），常见 PNG 压缩。' },
    CBLC: { name: '彩色位图位置表', desc: '彩色位图字形的尺寸与位置索引（与 CBDT 配合）。' },
    EBLC: { name: '嵌入位图位置表', desc: '嵌入点阵字形的尺寸与位置索引表。' },
    EBDT: { name: '嵌入位图数据表', desc: '嵌入点阵字形数据。' },
    EBSC: { name: '位图缩放表', desc: '点阵字形的缩放（bitmap scaling）关系。' },
    FFTM: { name: '字体锻造时间表', desc: 'FontForge 生成的源文件时间戳与修改信息。' },
    fvar: { name: '可变轴表', desc: '可变字体（Variable Font）的轴定义（wght/wdth 等）及命名实例。' },
    avar: { name: '轴变体表', desc: '轴坐标映射（把用户坐标映射为内部标准化坐标）。' },
    gvar: { name: '字形变体表', desc: '可变字体中每个字形的轮廓插值数据。' },
    HVAR: { name: '水平度量变体表', desc: '可变字体中水平度量（前进宽度等）的插值数据。' },
    VVAR: { name: '垂直度量变体表', desc: '可变字体中垂直度量的插值数据。' },
    MVAR: { name: '全局度量变体表', desc: '可变字体中全局度量（如 OS/2、hhea 中的值）的插值数据。' },
    STAT: { name: '样式属性表', desc: '声明轴取值对应的样式名称（如 Regular/Bold）与显示顺序。' },
    cvar: { name: 'CVT 变体表', desc: '可变字体中控制值（cvt）的插值数据。' },
    morx: { name: 'AAT 变形表(扩展)', desc: 'Apple Advanced Typography 字形变形表，支持连字、上下文替换等。' },
    mort: { name: 'AAT 变形表', desc: 'AAT 字形变形表（旧版）。' },
    kerx: { name: 'AAT 字距表(扩展)', desc: 'AAT 字距调整表，支持更多格式与状态机。' },
    trak: { name: 'AAT 字距跟踪表', desc: 'AAT 字距跟踪（tracking）表。' },
    feat: { name: 'AAT 特性名表', desc: 'AAT 特性的名称与启用状态定义。' },
    Prop: { name: 'AAT 属性表', desc: 'AAT 字形属性（方向、书写系统等）。' },
    opbd: { name: 'AAT 光学边界表', desc: 'AAT 光学边界（optical bounds），用于视觉对齐。' },
    lcar: { name: 'AAT 连字插入符表', desc: 'AAT 连字插入符位置。' },
    ankr: { name: 'AAT 锚点表', desc: 'AAT 字形锚点（附着点）定义。' },
    bsln: { name: 'AAT 基线表', desc: 'AAT 各脚本基线的位置定义。' },
    Zapf: { name: 'Zapf 表', desc: 'Zapf 字形描述（Apple 高级字形描述）。' },
    Silf: { name: 'Graphite 智能字体表', desc: 'Graphite 布局引擎的规则与动作定义。' },
    Glat: { name: 'Graphite 字形属性表', desc: 'Graphite 引擎使用的字形属性映射。' },
    Gloc: { name: 'Graphite 字形位置表', desc: 'Graphite 字形属性位置索引。' },
    Sill: { name: 'Graphite 语言表', desc: 'Graphite 支持的语言与特性。' },
    Feat: { name: 'Graphite 特性表', desc: 'Graphite 特性定义。' },
    Sidl: { name: 'Graphite 脚本表', desc: 'Graphite 脚本标识定义。' },
    TSIV: { name: 'TSI 变体表', desc: 'TSI（国际标准化组织兼容）变体信息。' },
    TSIP: { name: 'TSI 处理器表', desc: 'TSI 处理器信息。' },
    TSIS: { name: 'TSI 服务表', desc: 'TSI 服务信息。' },
    TSID: { name: 'TSI 数据表', desc: 'TSI 数据信息。' },
    TSIE: { name: 'TSI 扩展表', desc: 'TSI 扩展信息。' },
    TSI1: { name: 'TSI1 表', desc: 'TSI 类型 1 数据。' },
    TSI2: { name: 'TSI2 表', desc: 'TSI 类型 2 数据。' },
    TSI3: { name: 'TSI3 表', desc: 'TSI 类型 3 数据。' },
    TSI5: { name: 'TSI5 表', desc: 'TSI 类型 5 数据。' },
    _hdmx: {},
    gcid: { name: 'GCID 表', desc: '字形 CID 映射信息。' },
    LLE: { name: 'LLE 表', desc: '语言环境扩展（Language Environment Extension）。' },
    _gasp: {}
  };

  /** name 表 nameID → 含义 */
  U.NAME_IDS = {
    0: '版权声明（Copyright）',
    1: '字体家族名（Family Name）—— 一般用户看到的字体名',
    2: '子族名（Subfamily Name）—— 如 Regular / Bold / Italic',
    3: '唯一标识符（Unique Identifier）—— 厂商自定义的字体唯一串',
    4: '完整字体名（Full Font Name）—— 通常为家族名 + 子族名',
    5: '版本字符串（Version）—— 如 Version 1.00',
    6: 'PostScript 名称（PostScript Name）—— 无空格、仅 ASCII，供 PS 使用',
    7: '商标声明（Trademark）',
    8: '制造商（Manufacturer）',
    9: '设计者（Designer）',
    10: '描述/说明（Description）',
    11: '厂商网址（Vendor URL）',
    12: '设计者网址（Designer URL）',
    13: '许可说明（License Description）',
    14: '许可网址（License Info URL）',
    15: '保留（Reserved）',
    16: '排版家族名（Typographic Family / Preferred Family）',
    17: '排版子族名（Typographic Subfamily / Preferred Subfamily）',
    18: '兼容完整名（Compatible Full / Mac 用）',
    19: '样例文本（Sample Text）',
    20: 'PostScript CID 查找名（PostScript CID findfont name）',
    21: 'WWS 家族名（WWS Family Name）',
    22: 'WWS 子族名（WWS Subfamily Name）',
    23: '浅色背景调色板（Light Background Palette）',
    24: '深色背景调色板（Dark Background Palette）',
    25: '可变字体 PostScript 名前缀（Variations PostScript Name Prefix）',
    26: '旧版兼容名（Legacy 兼容）'
  };

  U.PLATFORM_IDS = {
    0: 'Unicode（平台无关）',
    1: 'Macintosh（苹果）',
    2: 'ISO（已废弃）',
    3: 'Microsoft（Windows）',
    4: 'Custom（自定义）'
  };
  U.WIN_ENCODINGS = {
    0: 'Symbol（符号字体）', 1: 'Unicode BMP（基本多文种平面）', 2: 'ShiftJIS（日文）',
    3: 'PRC（简体中文 GBK）', 4: 'Big5（繁体中文）', 5: 'Wansung（韩文）',
    6: 'Johab（韩文）', 7: '保留', 8: '保留', 9: '保留', 10: 'Unicode 全平面 (UCS-4)'
  };
  U.MAC_ENCODINGS = {
    0: 'Roman（MacRoman）', 1: 'Japanese', 2: 'Chinese Traditional', 3: 'Korean',
    4: 'Arabic', 5: 'Hebrew', 6: 'Greek', 7: 'Russian', 21: 'Thai', 25: 'Chinese Simplified',
    29: 'Latin 5', 35: 'Symbol'
  };
  U.UNICODE_ENCODINGS = {
    0: 'Unicode 1.0（旧）', 1: 'Unicode 1.1', 2: 'ISO/IEC 10646', 3: 'Unicode 2.0+ BMP',
    4: 'Unicode 2.0+ 全平面', 5: 'Unicode Variation Sequences', 6: 'Unicode 全平面'
  };

  /** Windows 语言 ID（LCID）常见值 */
  U.WIN_LANGS = {
    0x0401: '阿拉伯语(沙特)', 0x0402: '保加利亚语', 0x0404: '中文(繁体,台湾)',
    0x0405: '捷克语', 0x0406: '丹麦语', 0x0407: '德语(标准)', 0x0408: '希腊语',
    0x0409: '英语(美国)', 0x040a: '西班牙语(传统)', 0x040b: '芬兰语', 0x040c: '法语(标准)',
    0x040d: '希伯来语', 0x040e: '匈牙利语', 0x040f: '冰岛语', 0x0410: '意大利语(标准)',
    0x0411: '日语', 0x0412: '韩语', 0x0413: '荷兰语(荷兰)', 0x0414: '挪威语(博克马尔)',
    0x0415: '波兰语', 0x0416: '葡萄牙语(巴西)', 0x0418: '罗马尼亚语', 0x0419: '俄语',
    0x041a: '克罗地亚语', 0x041b: '斯洛伐克语', 0x041c: '阿尔巴尼亚语', 0x041d: '瑞典语',
    0x041e: '泰语', 0x041f: '土耳其语', 0x0420: '乌尔都语', 0x0421: '印尼语',
    0x0422: '乌克兰语', 0x0423: '白俄罗斯语', 0x0424: '斯洛文尼亚语', 0x0425: '爱沙尼亚语',
    0x0426: '拉脱维亚语', 0x0427: '立陶宛语', 0x0429: '波斯语', 0x042a: '越南语',
    0x042b: '亚美尼亚语', 0x042c: '阿塞拜疆语', 0x042d: '巴斯克语', 0x042f: '马其顿语',
    0x0436: '南非荷兰语', 0x0438: '法罗语', 0x0439: '印地语', 0x043e: '马来语',
    0x0441: '斯瓦希里语', 0x0444: '鞑靼语', 0x0445: '孟加拉语', 0x0446: '旁遮普语',
    0x0447: '古吉拉特语', 0x0449: '泰米尔语', 0x044a: '泰卢固语', 0x044b: '卡纳达语',
    0x044c: '马拉雅拉姆语', 0x044e: '马拉地语', 0x044f: '梵语', 0x0450: '蒙古语(西里尔)',
    0x0452: '威尔士语', 0x0453: '高棉语', 0x0454: '老挝语', 0x0456: '加利西亚语',
    0x0457: '孔卡尼语', 0x045a: '叙利亚语', 0x045b: '僧伽罗语', 0x045d: '因纽特语',
    0x045e: '阿姆哈拉语', 0x0461: '尼泊尔语', 0x0462: '弗里西语', 0x0465: '迪维希语',
    0x046b: '克丘亚语', 0x046c: '塞佩迪语', 0x046d: '巴斯克语(2)', 0x046e: '卢森堡语',
    0x046f: '格陵兰语', 0x0470: '伊博语', 0x0478: '彝语', 0x047e: '苏语',
    0x0480: '乌尔都语(2)', 0x0481: '毛利语', 0x0482: '雅库特语', 0x0483: '鞑靼语(2)',
    0x0484: '古叙利亚语', 0x0487: '萨哈语', 0x048c: '藏语', 0x048e: '萨米语',
    0x0490: '苏格兰盖尔语', 0x0491: '爱尔兰语', 0x0801: '阿拉伯语(伊拉克)',
    0x0804: '中文(简体,中国)', 0x0807: '德语(瑞士)', 0x0809: '英语(英国)',
    0x080a: '西班牙语(墨西哥)', 0x080c: '法语(比利时)', 0x0810: '意大利语(瑞士)',
    0x0811: '日语(2)', 0x0812: '韩语(2)', 0x0813: '荷兰语(比利时)', 0x0814: '挪威语(尼诺斯克)',
    0x0816: '葡萄牙语(葡萄牙)', 0x081a: '克罗地亚语/塞尔维亚语', 0x081d: '瑞典语(芬兰)',
    0x0c04: '中文(繁体,香港)', 0x0c07: '德语(奥地利)', 0x0c09: '英语(澳大利亚)',
    0x0c0a: '西班牙语(现代)', 0x0c0c: '法语(加拿大)', 0x0c1a: '塞尔维亚语(西里尔)',
    0x1004: '中文(简体,新加坡)', 0x1009: '英语(加拿大)', 0x100a: '西班牙语(危地马拉)',
    0x1404: '中文(繁体,澳门)', 0x1409: '英语(新西兰)', 0x140a: '西班牙语(哥斯达黎加)',
    0x1809: '英语(爱尔兰)', 0x180a: '西班牙语(巴拿马)', 0x1c09: '英语(南非)',
    0x2009: '英语(牙买加)', 0x200a: '西班牙语(委内瑞拉)', 0x2409: '英语(加勒比)',
    0x2809: '英语(伯利兹)', 0x2c09: '英语(特立尼达)', 0x3009: '英语(津巴布韦)',
    0x3409: '英语(菲律宾)'
  };

  /** Macintosh 语言 ID（仅常见） */
  U.MAC_LANGS = {
    0: '英语', 1: '法语', 2: '德语', 3: '意大利语', 4: '荷兰语', 5: '瑞典语',
    6: '西班牙语', 7: '丹麦语', 8: '葡萄牙语', 9: '挪威语', 10: '希伯来语', 11: '日语',
    12: '阿拉伯语', 13: '芬兰语', 14: '希腊语', 15: '冰岛语', 16: '马耳他语',
    17: '土耳其语', 18: '克罗地亚语', 19: '中文(繁体)', 20: '乌尔都语', 21: '印地语',
    22: '泰语', 23: '韩语', 24: '立陶宛语', 25: '波兰语', 26: '匈牙利语', 27: '爱沙尼亚语',
    28: '拉脱维亚语', 29: '萨米语', 30: '法罗语', 31: '波斯语', 32: '俄语',
    33: '中文(简体)', 34: '佛兰芒语', 35: '爱尔兰语', 36: '阿尔巴尼亚语', 37: '罗马尼亚语',
    38: '捷克语', 39: '斯洛伐克语', 40: '斯洛文尼亚语', 41: '意第绪语', 42: '塞尔维亚语',
    43: '马其顿语', 44: '保加利亚语', 45: '乌克兰语', 46: '白俄罗斯语', 47: '乌兹别克语',
    48: '哈萨克语', 49: '阿塞拜疆语', 50: '阿塞拜疆语(西里尔)', 51: '亚美尼亚语',
    52: '格鲁吉亚语', 53: '摩尔多瓦语', 54: '吉尔吉斯语', 55: '塔吉克语', 56: '土库曼语',
    57: '蒙古语', 58: '蒙古语(西里尔)', 59: '普什图语', 60: '库尔德语', 61: '克什米尔语',
    62: '信德语', 63: '藏语', 64: '尼泊尔语', 65: '梵语', 66: '马拉地语', 67: '孟加拉语',
    68: '阿萨姆语', 69: '古吉拉特语', 70: '旁遮普语', 71: '奥里亚语', 72: '马拉雅拉姆语',
    73: '卡纳达语', 74: '泰米尔语', 75: '泰卢固语', 76: '僧伽罗语', 77: '缅甸语',
    78: '高棉语', 79: '老挝语', 80: '越南语', 81: '印尼语', 82: '他加禄语',
    83: '马来语', 84: '马来语(罗马)', 85: '阿姆哈拉语', 86: '提格里尼亚语',
    87: '奥罗莫语', 88: '索马里语', 89: '斯瓦希里语', 90: '金扬万达语', 91: '罗语',
    92: '恩布语', 93: '梅鲁语', 94: '卡伦金语', 128: '威尔士语', 129: '巴斯克语',
    130: '加泰罗尼亚语', 131: '拉丁语', 132: '克丘亚语', 133: '瓜拉尼语', 134: '艾马拉语',
    135: '鞑靼语', 136: '维吾尔语', 137: '宗卡语', 138: '爪哇语', 140: '文达语',
    141: '祖鲁语', 142: '科萨语', 143: '索托语', 144: '茨瓦纳语', 145: '茨瓦纳语(2)',
    146: '绍纳语', 147: '卢旺达语', 148: '隆迪语', 149: '恩扬贾语', 150: '马库阿语',
    151: '埃维语', 152: '沃洛夫语', 153: '比尼语', 154: '塞佩迪语', 155: '特松加语',
    156: '索托语(2)', 157: '文达语(2)', 158: '恩德贝莱语', 159: '恩德贝莱语(2)',
    160: '斯威士语', 161: '兰巴语', 162: '安哥拉语', 163: '豪萨语', 164: '伊博语',
    165: '约鲁巴语', 166: '富拉语', 167: '卢旺达语(2)', 168: '卢旺达语(3)'
  };

  U.WEIGHT_CLASS = {
    100: 'Thin（极细）', 200: 'Extra Light / Ultra Light（特细）', 300: 'Light（细）',
    400: 'Normal / Regular（常规）', 500: 'Medium（中等）', 600: 'Semi Bold / Demi Bold（半粗）',
    700: 'Bold（粗体）', 800: 'Extra Bold / Ultra Bold（特粗）', 900: 'Black / Heavy（黑体/极粗）'
  };
  U.WIDTH_CLASS = {
    1: 'Ultra-condensed（极窄）', 2: 'Extra-condensed（特窄）', 3: 'Condensed（窄）',
    4: 'Semi-condensed（半窄）', 5: 'Medium / Normal（标准）', 6: 'Semi-expanded（半宽）',
    7: 'Expanded（宽）', 8: 'Extra-expanded（特宽）', 9: 'Ultra-expanded（极宽）'
  };

  /** head.flags 位定义 */
  U.HEAD_FLAGS = {
    0: '基线位于 y=0（Baseline at y=0）',
    1: '左侧承托位于 x=0（LSB at x=0）',
    2: '提示指令依赖点大小（Instructions may depend on point size）',
    3: '强制 ppem 为整数（Force ppem to integer values）',
    4: '提示指令会改变前进宽度（Instructions may alter advance width）',
    11: '无损压缩数据（Font data is lossless/compressed）',
    12: '由其它字体转换而来（Converted font）',
    13: '针对 ClearType 优化（Optimized for ClearType）',
    14: '最后手段字体（Last Resort font）'
  };

  U.MACSTYLE_BITS = {
    0: 'Bold 粗体', 1: 'Italic 斜体', 2: 'Underline 下划线', 3: 'Outline 空心',
    4: 'Shadow 阴影', 5: 'Condensed 窄体', 6: 'Extended 宽体'
  };

  U.FSTYPE_BITS = {
    0: '受限制许可嵌入（Restricted License Embedding，禁止嵌入）',
    1: '允许预览与打印嵌入（Preview & Print Embedding）',
    2: '允许可编辑嵌入（Editable Embedding）',
    8: '禁止子集化（No Subsetting）',
    9: '仅位图嵌入（Bitmap Embedding Only）'
  };

  U.FSSELECTION_BITS = {
    0: 'ITALIC 斜体', 1: 'UNDERSCORE 下划线', 2: 'NEGATIVE 反白',
    3: 'OUTLINED 空心', 4: 'STRIKEOUT 删除线', 5: 'BOLD 粗体',
    6: 'REGULAR 常规（若设置了 BOLD/ITALIC 则不应设置）',
    7: 'USE_TYPO_METRICS 使用 sTypo* 作为推荐行高',
    8: 'WWS 家族名与子族名符合 WWS 规则',
    9: 'OBLIQUE 倾斜'
  };

  U.GASP_BEHAVIOR_BITS = {
    0: '网格拟合（Girdfit）', 1: '灰度渲染（Grayscale）',
    2: '对称平滑（Symmetric Smoothing）', 3: '对称网格拟合（Symmetric Gridfit）'
  };

  U.PANOSE_FAMILY = {
    0: 'Any（任意）', 1: 'No Fit（不匹配）', 2: 'Latin Text（拉丁文本）',
    3: 'Latin Hand Written（拉丁手写）', 4: 'Latin Decorative（拉丁装饰）',
    5: 'Latin Symbol（拉丁符号）'
  };
  /** Panose 拉丁文本族（familyType=2）后续 9 字节的取值说明 */
  U.PANOSE_LATIN = [
    null,
    { name: '衬线风格', values: { 0: 'Any', 1: 'No Fit', 2: 'Cove', 3: 'Obtuse Cove', 4: 'Square Cove', 5: 'Obtuse Square Cove', 6: 'Square', 7: 'Thin', 8: 'Bone', 9: 'Exaggerated', 10: 'Triangle', 11: 'Normal Sans', 12: 'Obtuse Sans', 13: 'Perpendicular Sans', 14: 'Flared', 15: 'Rounded' } },
    { name: '字重', values: { 0: 'Any', 1: 'No Fit', 2: 'Very Light', 3: 'Light', 4: 'Thin', 5: 'Book', 6: 'Medium', 7: 'Demi', 8: 'Bold', 9: 'Heavy', 10: 'Black', 11: 'Extra Black' } },
    { name: '比例', values: { 0: 'Any', 1: 'No Fit', 2: 'Old Style', 3: 'Modern', 4: 'Even Width', 5: 'Extended', 6: 'Condensed', 7: 'Very Extended', 8: 'Very Condensed', 9: 'Monospaced' } },
    { name: '对比度', values: { 0: 'Any', 1: 'No Fit', 2: 'None', 3: 'Very Low', 4: 'Low', 5: 'Medium Low', 6: 'Medium', 7: 'Medium High', 8: 'High', 9: 'Very High' } },
    { name: '笔画变化', values: { 0: 'Any', 1: 'No Fit', 2: 'No Variation', 3: 'Gradual/Diagonal', 4: 'Gradual/Transitional', 5: 'Gradual/Vertical', 6: 'Gradual/Horizontal', 7: 'Rapid/Vertical', 8: 'Rapid/Horizontal', 9: 'Instant/Horizontal', 10: 'Instant/Vertical' } },
    { name: '字臂样式', values: { 0: 'Any', 1: 'No Fit', 2: 'Straight Arms/Horizontal', 3: 'Straight Arms/Wedge', 4: 'Straight Arms/Vertical', 5: 'Straight Arms/Single Serif', 6: 'Straight Arms/Double Serif', 7: 'Non-Straight Arms/Horizontal', 8: 'Non-Straight Arms/Wedge', 9: 'Non-Straight Arms/Vertical', 10: 'Non-Straight Arms/Single Serif', 11: 'Non-Straight Arms/Double Serif' } },
    { name: '字形风格', values: { 0: 'Any', 1: 'No Fit', 2: 'Normal/Contact', 3: 'Normal/Weighted', 4: 'Normal/Boxed', 5: 'Normal/Flattened', 6: 'Normal/Rounded', 7: 'Normal/Off Center', 8: 'Normal/Square', 9: 'Oblique/Contact', 10: 'Oblique/Weighted', 11: 'Oblique/Boxed', 12: 'Oblique/Flattened', 13: 'Oblique/Rounded', 14: 'Oblique/Off Center', 15: 'Oblique/Square' } },
    { name: '中线', values: { 0: 'Any', 1: 'No Fit', 2: 'Standard/Trimmed', 3: 'Standard/Pointed', 4: 'Standard/Serifed', 5: 'High/Trimmed', 6: 'High/Pointed', 7: 'High/Serifed', 8: 'Constant/Trimmed', 9: 'Constant/Pointed', 10: 'Constant/Serifed', 11: 'Low/Trimmed', 12: 'Low/Pointed', 13: 'Low/Serifed' } },
    { name: 'x 高度', values: { 0: 'Any', 1: 'No Fit', 2: 'Constant/Small', 3: 'Constant/Standard', 4: 'Constant/Large', 5: 'Ducking/Small', 6: 'Ducking/Standard', 7: 'Ducking/Large' } }
  ];

  /** OS/2 ulUnicodeRange1..4 位名称（共 128 位） */
  U.UNICODE_RANGES = [
    'Basic Latin 基本拉丁', 'Latin-1 Supplement 拉丁补充', 'Latin Extended-A 拉丁扩展A',
    'Latin Extended-B 拉丁扩展B', 'IPA Extensions 国际音标', 'Spacing Modifier Letters 修饰字母',
    'Combining Diacritical Marks 组合附加符号', 'Greek and Coptic 希腊文', 'Coptic 科普特文',
    'Cyrillic 西里尔文', 'Armenian 亚美尼亚文', 'Hebrew 希伯来文', 'Vai 瓦伊文',
    'Arabic 阿拉伯文', 'NKo 西非书面文', 'Devanagari 天城文', 'Bengali 孟加拉文',
    'Gurmukhi 古木基文', 'Gujarati 古吉拉特文', 'Oriya 奥里亚文', 'Tamil 泰米尔文',
    'Telugu 泰卢固文', 'Kannada 卡纳达文', 'Malayalam 马拉雅拉姆文', 'Thai 泰文',
    'Lao 老挝文', 'Georgian 格鲁吉亚文', 'Balinese 巴厘文', 'Hangul Jamo 谚文字母',
    'Latin Extended Additional 拉丁扩展附加', 'Greek Extended 希腊扩展',
    'General Punctuation 常用标点', 'Superscripts and Subscripts 上下标',
    'Currency Symbols 货币符号', 'Combining Diacritical Marks for Symbols 符号组合标记',
    'Letterlike Symbols 字母式符号', 'Number Forms 数字形式', 'Arrows 箭头',
    'Mathematical Operators 数学运算符', 'Miscellaneous Technical 杂项技术符号',
    'Control Pictures 控制图形', 'Optical Character Recognition 光学字符识别',
    'Enclosed Alphanumerics 带圈字母数字', 'Box Drawing 制表符', 'Block Elements 方块元素',
    'Geometric Shapes 几何图形', 'Miscellaneous Symbols 杂项符号', 'Dingbats 装饰符号',
    'CJK Symbols and Punctuation CJK 符号与标点', 'Hiragana 平假名', 'Katakana 片假名',
    'Bopomofo 注音符号', 'Hangul Compatibility Jamo 谚文兼容字母',
    'Phags-pa 八思巴文', 'Enclosed CJK Letters and Months 带圈 CJK 字母及月份',
    'CJK Compatibility CJK 兼容', 'Hangul Syllables 谚文音节', 'Non-Plane 0 非第 0 平面',
    'Phoenician 腓尼基文', 'CJK Unified Ideographs CJK 统一表意文字',
    'Private Use Area (plane 0) 私用区(第0平面)', 'CJK Strokes CJK 笔画',
    'Alphabetic Presentation Forms 字母表现形式',
    'Arabic Presentation Forms-A 阿拉伯表现形式A', 'Combining Half Marks 组合半标记',
    'CJK Compatibility Forms CJK 兼容形式', 'Small Form Variants 小写变体',
    'Arabic Presentation Forms-B 阿拉伯表现形式B',
    'Halfwidth and Fullwidth Forms 半角及全角形式', 'Specials 特殊字符', 'Tibetan 藏文',
    'Syriac 叙利亚文', 'Thaana 塔安那文', 'Sinhala 僧伽罗文', 'Myanmar 缅甸文',
    'Ethiopic 埃塞俄比亚文', 'Cherokee 切罗基文',
    'Unified Canadian Aboriginal Syllabics 加拿大原住民音节文字', 'Ogham 欧甘文',
    'Runic 卢恩文', 'Khmer 高棉文', 'Mongolian 蒙古文', 'Braille Patterns 盲文',
    'Yi Syllables 彝文音节', 'Yi Radicals 彝文部首', 'Old Italic 古意大利文',
    'Gothic 哥特文', 'Deseret 德撒律文', 'Byzantine Musical Symbols 拜占庭音乐符号',
    'Musical Symbols 音乐符号', 'Mathematical Alphanumeric Symbols 数学字母数字符号',
    'Private Use (plane 15/16) 私用区(第15/16平面)', 'Variation Selectors 变体选择符',
    'Tags 标签字符', 'Limbu 林布文', 'Tai Le 傣哪文', 'New Tai Lue 新傣仂文',
    'Buginese 布吉文', 'Glagolitic 格拉哥里文', 'Tifinagh 提非纳文',
    'Yijing Hexagram Symbols 易经六十四卦', 'Syloti Nagri 锡尔赫特文',
    'Linear B Syllabary 线形文字B音节', 'Ancient Greek Numbers 古希腊数字',
    'Ugaritic 乌加里特文', 'Old Persian 古波斯文', 'Shavian 萧伯纳文',
    'Osmanya 奥斯曼亚文', 'Cypriot Syllabary 塞浦路斯音节文字', 'Kharoshthi 佉卢文',
    'Tai Xuan Jing Symbols 太玄经符号', 'Cuneiform 楔形文字', 'Counting Rod Numerals 算筹数字'
  ];

  /** OS/2 ulCodePageRange1..2 位名称 */
  U.CODEPAGE_RANGES = {
    0: '1252 Latin 1', 1: '1250 Latin 2（中欧）', 2: '1251 Cyrillic（西里尔）',
    3: '1253 Greek（希腊）', 4: '1254 Turkish（土耳其）', 5: '1255 Hebrew（希伯来）',
    6: '1256 Arabic（阿拉伯）', 7: '1257 Baltic（波罗的海）', 8: '1258 Vietnamese（越南）',
    9: '874 Thai（泰文）', 10: '932 JIS/Japan（日文）', 11: '936 Chinese Simplified（简体中文）',
    12: '949 Korean Wansung（韩文）', 13: '950 Chinese Traditional（繁体中文）',
    14: '1361 Korean Johab（韩文 Johab）', 15: '保留', 16: '保留', 17: '保留', 18: '保留',
    19: '保留', 20: '保留', 21: '保留', 22: '保留', 23: '保留', 24: '保留', 25: '保留',
    26: '保留', 27: '保留', 28: '保留', 29: 'Macintosh Character Set (US Roman)',
    30: 'OEM Character Set', 31: 'Symbol Character Set',
    48: '869 IBM Greek', 49: '866 MS-DOS Russian', 50: '865 MS-DOS Nordic',
    51: '864 Arabic', 52: '863 MS-DOS Canadian French', 53: '862 Hebrew',
    54: '861 MS-DOS Icelandic', 55: '860 MS-DOS Portuguese', 56: '857 IBM Turkish',
    57: '855 IBM Cyrillic', 58: '852 Latin 2', 59: '775 MS-DOS Baltic',
    60: '737 Greek; former 437 G', 61: '708 Arabic; ASMO 708', 62: '850 WE/Latin 1',
    63: '437 US'
  };

  /** OpenType 特性标签说明（GSUB/GPOS FeatureList） */
  U.FEATURE_TAGS = {
    aalt: 'Access All Alternates 访问所有备选字形',
    abvf: 'Above-base Forms 基线上方形式',
    abvm: 'Above-base Mark Positioning 基线上方标记定位',
    abvs: 'Above-base Substitutions 基线上方替换',
    afrc: 'Alternative Fractions 替代分数（如 3⁄4 竖排）',
    akhn: 'Akhand 连写（印度语系不变形连写）',
    blwf: 'Below-base Forms 基线下方形式',
    blwm: 'Below-base Mark Positioning 基线下方标记定位',
    blws: 'Below-base Substitutions 基线下方替换',
    calt: 'Contextual Alternates 上下文替代（默认开启，连写字形）',
    case: 'Case-Sensitive Forms 大小写敏感形式（标点对齐）',
    ccmp: 'Glyph Composition / Decomposition 字形组合/分解（重音组合，必需）',
    cfar: 'Conjunct Form After Ro',
    clig: 'Contextual Ligatures 上下文连字',
    cpsp: 'Capital Spacing 大写字母间距',
    cswh: 'Contextual Swash 上下文花体',
    curs: 'Cursive Positioning 连写定位（草书连接）',
    cv01: 'Character Variant 1 字符变体 1',
    c2pc: 'Petite Capitals From Capitals 大写转小型大写',
    c2sc: 'Small Capitals From Capitals 大写转小号大写',
    dist: 'Distances 距离调整（印度语系）',
    dlig: 'Discretionary Ligatures 自由连字',
    dnom: 'Denominators 分母（分数）',
    dtls: 'Dotless Forms 无点形式',
    expt: 'Expert Forms 专家形式',
    falt: 'Final Alternates 末位替代字形',
    fin2: 'Terminal Forms #2 词尾形式 2',
    fin3: 'Terminal Forms #3 词尾形式 3',
    fina: 'Terminal Forms 词尾形式（阿拉伯文）',
    flac: 'Flattened Accent Forms 扁平重音形式',
    frac: 'Fractions 分数',
    fwid: 'Full Widths 全角形式',
    half: 'Half Forms 半形式（印度语系）',
    haln: 'Halant Forms 元音省略形式',
    halt: 'Alternate Half Widths 替代半角宽度',
    hist: 'Historical Forms 历史形式',
    hkna: 'Horizontal Kana Alternates 横排假名替代',
    hlig: 'Historical Ligatures 历史连字',
    hngl: 'Hangul 谚文替代',
    hojo: 'Hojo Kanji Forms 补助汉字形式',
    hwid: 'Half Widths 半角形式',
    init: 'Initial Forms 词首形式（阿拉伯文）',
    isol: 'Isolated Forms 独立形式（阿拉伯文）',
    ital: 'Italics 斜体形式',
    jalt: 'Justification Alternates 对齐替代',
    jp04: 'JIS2004 Forms JIS2004 形式',
    jp78: 'JIS78 Forms JIS78 形式',
    jp83: 'JIS83 Forms JIS83 形式',
    jp90: 'JIS90 Forms JIS90 形式',
    kern: 'Kerning 字距调整',
    lfbd: 'Left Bounds 左边界（印度语系）',
    liga: 'Standard Ligatures 标准连字（默认开启）',
    ljmo: 'Leading Jamo Forms 前导谚文字母形式',
    lnum: 'Lining Figures 等高数字',
    locl: 'Localized Forms 本地化形式（按语言替换字形）',
    ltra: 'Left-to-right Alternates 从左到右替代',
    ltrm: 'Left-to-right Mirrored Forms 从左到右镜像形式',
    mark: 'Mark Positioning 标记定位（附加符号）',
    med2: 'Medial Forms #2 词中形式 2',
    medi: 'Medial Forms 词中形式（阿拉伯文）',
    mgrk: 'Mathematical Greek 数学希腊字母',
    mkmk: 'Mark to Mark Positioning 标记与标记定位',
    mset: 'Mark Positioning via Substitution 通过替换实现标记定位',
    nalt: 'Alternate Annotation Forms 注释形式替代',
    nlck: 'NLC Kanji Forms NLC 汉字形式',
    nukt: 'Nukta Forms 附点形式（印度语系）',
    numr: 'Numerators 分子（分数）',
    onum: 'Oldstyle Figures 旧式数字',
    opbd: 'Optical Bounds 光学边界',
    ordn: 'Ordinals 序数（如 1º）',
    ornm: 'Ornaments 装饰图案',
    palt: 'Proportional Alternate Widths 比例替代宽度',
    pcap: 'Petite Capitals 小型大写（petite）',
    pkna: 'Proportional Kana 比例假名',
    pnum: 'Proportional Figures 比例数字',
    pref: 'Pre-base Forms 基字前形式',
    pres: 'Pre-base Substitutions 基字前替换',
    pstf: 'Post-base Forms 基字后形式',
    psts: 'Post-base Substitutions 基字后替换',
    pwid: 'Proportional Widths 比例宽度',
    qwid: 'Quarter Widths 四分之一宽度',
    rand: 'Randomize 随机化替代',
    rclt: 'Required Contextual Alternates 必需上下文替代',
    rkrf: 'Rakar Forms 拉卡尔形式',
    rlig: 'Required Ligatures 必需连字（不可关闭）',
    rphf: 'Reph Form 重音形式（印度语系）',
    rtbd: 'Right Bounds 右边界',
    rtla: 'Right-to-left Alternates 从右到左替代',
    rtlm: 'Right-to-left Mirrored Forms 从右到左镜像形式',
    ruby: 'Ruby Notation Forms 注音形式',
    rvrn: 'Required Variation Alternates 必需变体替代',
    salt: 'Stylistic Alternates 样式替代',
    sinf: 'Scientific Inferiors 科学下标',
    size: 'Optical Size 光学尺寸',
    smcp: 'Small Capitals 小号大写字母',
    smpl: 'Simplified Forms 简体形式',
    ssty: 'Math Script Style Alternates 数学脚本样式替代',
    stch: 'Stretching Glyph Decomposition 拉伸字形分解',
    subs: 'Subscript 下标',
    sups: 'Superscript 上标',
    swsh: 'Swash 花体',
    titl: 'Titling 标题字形',
    tjmo: 'Trailing Jamo Forms 后导谚文字母形式',
    tnam: 'Traditional Name Forms 传统名称形式',
    tnum: 'Tabular Figures 等宽数字',
    trad: 'Traditional Forms 传统形式',
    twid: 'Third Widths 三分之一宽度',
    unic: 'Unicase 单一大小写',
    valt: 'Alternate Vertical Metrics 替代垂直度量',
    vatu: 'Vattu Variants 瓦图变体',
    vert: 'Vertical Writing 竖排（旋转字形）',
    vhal: 'Alternate Vertical Half Metrics 替代垂直半角度量',
    vjmo: 'Vowel Jamo Forms 元音谚文字母形式',
    vkna: 'Vertical Kana Alternates 竖排假名替代',
    vkrn: 'Vertical Kerning 竖排字距',
    vpal: 'Proportional Alternate Vertical Metrics 比例替代垂直度量',
    vrt2: 'Vertical Alternates and Rotation 竖排替代与旋转（默认竖排）',
    vrtr: 'Vertical Alternates for Rotation 竖排旋转替代',
    zero: 'Slashed Zero 斜线零',
    ss01: 'Stylistic Set 1 样式集 1', ss02: 'Stylistic Set 2 样式集 2',
    ss03: 'Stylistic Set 3 样式集 3', ss04: 'Stylistic Set 4 样式集 4',
    ss05: 'Stylistic Set 5 样式集 5', ss06: 'Stylistic Set 6 样式集 6',
    ss07: 'Stylistic Set 7 样式集 7', ss08: 'Stylistic Set 8 样式集 8',
    ss09: 'Stylistic Set 9 样式集 9', ss10: 'Stylistic Set 10 样式集 10',
    ss11: 'Stylistic Set 11 样式集 11', ss12: 'Stylistic Set 12 样式集 12',
    ss13: 'Stylistic Set 13 样式集 13', ss14: 'Stylistic Set 14 样式集 14',
    ss15: 'Stylistic Set 15 样式集 15', ss16: 'Stylistic Set 16 样式集 16',
    ss17: 'Stylistic Set 17 样式集 17', ss18: 'Stylistic Set 18 样式集 18',
    ss19: 'Stylistic Set 19 样式集 19', ss20: 'Stylistic Set 20 样式集 20',
    cv01: 'Character Variant 01 字符变体 01', cv02: 'Character Variant 02 字符变体 02',
    cv03: 'Character Variant 03 字符变体 03', cv04: 'Character Variant 04 字符变体 04',
    cv05: 'Character Variant 05 字符变体 05', cv06: 'Character Variant 06 字符变体 06',
    cv07: 'Character Variant 07 字符变体 07', cv08: 'Character Variant 08 字符变体 08',
    cv09: 'Character Variant 09 字符变体 09', cv10: 'Character Variant 10 字符变体 10'
  };

  U.GSUB_LOOKUP_TYPES = {
    1: 'Single Substitution 单一替换（一个字形换成另一个）',
    2: 'Multiple Substitution 多重替换（一个字形拆成多个）',
    3: 'Alternate Substitution 备选替换（一个字形有多个候选）',
    4: 'Ligature Substitution 连字替换（多个字形合并为一个）',
    5: 'Contextual Substitution 上下文替换（按上下文环境替换）',
    6: 'Chained Contextual Substitution 链式上下文替换',
    7: 'Extension Substitution 扩展替换（32 位偏移包装）',
    8: 'Reverse Chaining Contextual Single Substitution 反向链式单替换'
  };
  U.GPOS_LOOKUP_TYPES = {
    1: 'Single Adjustment 单一调整（调整单个字形位置/宽度）',
    2: 'Pair Adjustment 配对调整（字距调整）',
    3: 'Cursive Attachment 连写附着',
    4: 'MarkToBase Attachment 标记附着到基字',
    5: 'MarkToLigature Attachment 标记附着到连字',
    6: 'MarkToMark Attachment 标记附着到标记',
    7: 'Contextual Positioning 上下文定位',
    8: 'Chained Contextual Positioning 链式上下文定位',
    9: 'Extension Positioning 扩展定位（32 位偏移包装）'
  };

  /** 查找表标志位（LookupFlag） */
  U.LOOKUP_FLAGS = {
    0: 'RIGHT_TO_LEFT 从右到左',
    1: 'IGNORE_BASE_GLYPHS 忽略基字',
    2: 'IGNORE_LIGATURES 忽略连字',
    3: 'IGNORE_MARKS 忽略标记',
    8: 'USE_MARK_FILTERING_SET 使用标记过滤集合',
    15: 'MARK_ATTACHMENT_TYPE_MASK 标记附着类型掩码（高字节）'
  };

  /** cmap 子表格式说明 */
  U.CMAP_FORMATS = {
    0: '格式 0：字节编码表（256 项，Mac Roman 等单字节编码）',
    2: '格式 2：高字节映射表（用于中日韩混合单/双字节编码，已罕见）',
    4: '格式 4：段映射（16 位 BMP 最常用格式）',
    6: '格式 6：修剪映射（连续字符区间）',
    8: '格式 8：混合 16/32 位映射（罕见）',
    10: '格式 10：修剪数组（32 位）',
    12: '格式 12：分段覆盖（32 位，支持全部 Unicode 平面）',
    13: '格式 13：多对一映射（如最后手段字体）',
    14: '格式 14：Unicode 变体序列'
  };

  /** post 表版本说明 */
  U.POST_FORMATS = {
    1: '1.0 —— 字形名称使用 258 个标准 Macintosh 名称（仅适用于 mac 字符集字体）',
    2: '2.0 —— 自定义字形名称（最常用）',
    2.5: '2.5 —— 已废弃（字形名称由标准名称按序移位得到）',
    3: '3.0 —— 不包含字形名称（新字体推荐）',
    4: '4.0 —— 用于 Apple 高级排版（AAT）'
  };

  /** 258 个标准 Macintosh 字形名称（post 1.0 / 2.0 索引 0..257） */
  U.STANDARD_MAC_GLYPH_NAMES = ('.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar ' +
    'percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash ' +
    'zero one two three four five six seven eight nine colon semicolon less equal greater question ' +
    'at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright ' +
    'asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft ' +
    'bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute ' +
    'agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute ' +
    'igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ' +
    'ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls ' +
    'registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal ' +
    'greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ' +
    'ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft ' +
    'guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft ' +
    'quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency ' +
    'guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase ' +
    'perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis ' +
    'Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde ' +
    'macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron ' +
    'Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior ' +
    'twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent ' +
    'Scedilla scedilla Cacute cacute Ccaron ccaron dcroat').split(' ');

  /* ---------------------------------------------------------------------
   * 小工具
   * ------------------------------------------------------------------- */
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** 生成用于说明的位标志文本 */
  U.formatBits = (value, bitsMap) => {
    const on = [];
    for (const k in bitsMap) {
      if (value & (1 << Number(k))) on.push(bitsMap[k]);
    }
    return on.length ? on.join('；') : '（未设置任何标志位）';
  };

  U.decOf = (bytes, off, size) => {
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + (bytes[off + i] || 0);
    return v;
  };

  /** 把码点转成可读形式 */
  U.charLabel = (cp) => {
    if (cp === 0x20) return '空格';
    if (cp === 0xa0) return '不换行空格';
    if (cp < 0x20) return '控制字符';
    if (cp >= 0xd800 && cp <= 0xdfff) return '代理项';
    if (cp > 0x10ffff) return '（超出 Unicode 范围）';
    let s = String.fromCodePoint(cp);
    if (/[\u0300-\u036f\u200b-\u200f\u2028-\u202f\ufeff]/.test(s)) return '格式/组合符号';
    return s;
  };

  U.U0 = (v) => (v >>> 0).toString(10);
})(typeof window !== 'undefined' ? window : globalThis);
