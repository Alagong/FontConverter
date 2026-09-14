/* =========================================================================
 * tables/layout.js —— OpenType 布局表：GSUB / GPOS / GDEF / BASE
 *  解析 表头 → ScriptList → FeatureList → LookupList 三级结构
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = FL.tables;
  const H = T.helper;
  const F = H.F;

  function tagOf(dv, off) {
    return U.tag(dv.getUint32(off)).replace(/ /g, '');
  }

  function parseScriptList(dv, baseLen, off) {
    if (!off || off + 2 > baseLen) return [];
    const count = dv.getUint16(off);
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = off + 2 + i * 6;
      if (p + 6 > baseLen) break;
      const tag = tagOf(dv, p);
      const so = dv.getUint16(p + 4);
      const abs = off + so;
      const s = { tag: tag, offset: abs, langs: [], defaultLang: null };
      if (abs + 4 <= baseLen) {
        const defOff = dv.getUint16(abs);
        if (defOff) s.defaultLang = parseLangSys(dv, baseLen, abs + defOff);
        const langCount = dv.getUint16(abs + 2);
        for (let k = 0; k < langCount; k++) {
          const q = abs + 4 + k * 6;
          if (q + 6 > baseLen) break;
          const ltag = tagOf(dv, q);
          const lo = dv.getUint16(q + 4);
          const ls = parseLangSys(dv, baseLen, abs + lo);
          ls.tag = ltag;
          s.langs.push(ls);
        }
      }
      out.push(s);
    }
    return out;
  }

  function parseLangSys(dv, baseLen, off) {
    if (!off || off + 6 > baseLen) return { features: [], required: -1 };
    const required = dv.getUint16(off + 2);
    const cnt = dv.getUint16(off + 4);
    const features = [];
    for (let i = 0; i < cnt; i++) {
      const p = off + 6 + i * 2;
      if (p + 2 > baseLen) break;
      features.push(dv.getUint16(p));
    }
    return { features: features, required: required === 0xffff ? -1 : required };
  }

  function parseFeatureList(dv, baseLen, off) {
    if (!off || off + 2 > baseLen) return [];
    const count = dv.getUint16(off);
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = off + 2 + i * 6;
      if (p + 6 > baseLen) break;
      const tag = tagOf(dv, p);
      const fo = dv.getUint16(p + 4);
      const abs = off + fo;
      const feat = { tag: tag, offset: abs, lookups: [], paramsOffset: 0 };
      if (abs + 4 <= baseLen) {
        feat.paramsOffset = dv.getUint16(abs);
        const cnt = dv.getUint16(abs + 2);
        for (let k = 0; k < cnt; k++) {
          const q = abs + 4 + k * 2;
          if (q + 2 > baseLen) break;
          feat.lookups.push(dv.getUint16(q));
        }
      }
      out.push(feat);
    }
    return out;
  }

  function parseLookupList(dv, baseLen, off) {
    if (!off || off + 2 > baseLen) return [];
    const count = dv.getUint16(off);
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = off + 2 + i * 2;
      if (p + 2 > baseLen) break;
      const lo = dv.getUint16(p);
      const abs = off + lo;
      const lk = { index: i, offset: abs, type: 0, flag: 0, subtables: [], markFilterSet: null };
      if (abs + 6 <= baseLen) {
        lk.type = dv.getUint16(abs);
        lk.flag = dv.getUint16(abs + 2);
        const cnt = dv.getUint16(abs + 4);
        for (let k = 0; k < cnt; k++) {
          const q = abs + 6 + k * 2;
          if (q + 2 > baseLen) break;
          const sto = dv.getUint16(q);
          const sAbs = abs + sto;
          let fmt = sAbs + 2 <= baseLen ? dv.getUint16(sAbs) : -1;
          let effType = lk.type;
          let realOffset = sAbs;
          if ((lk.type === 7 || lk.type === 9) && fmt === 1 && sAbs + 8 <= baseLen) {
            effType = dv.getUint16(sAbs + 2);
            realOffset = sAbs + dv.getUint32(sAbs + 4);
            fmt = realOffset + 2 <= baseLen ? dv.getUint16(realOffset) : -1;
          }
          lk.subtables.push({ offset: sAbs, format: fmt, extType: effType, realOffset: realOffset });
        }
        if (lk.flag & 0x10) lk.markFilterSet = dv.getUint16(abs + 6 + cnt * 2);
      }
      out.push(lk);
    }
    return out;
  }

  function buildLayoutParser(tag, isGSUB) {
    return {
      parse(font, table) {
        H.need(table, 10, tag);
        const b = table.bytes;
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const major = dv.getUint16(0), minor = dv.getUint16(2);
        const scriptOff = dv.getUint16(4);
        const featureOff = dv.getUint16(6);
        const lookupOff = dv.getUint16(8);
        let featureVarOff = null;
        if (major === 1 && minor >= 1 && b.length >= 14) featureVarOff = dv.getUint32(10);

        const scripts = parseScriptList(dv, b.length, scriptOff);
        const features = parseFeatureList(dv, b.length, featureOff);
        const lookups = parseLookupList(dv, b.length, lookupOff);

        const typeNames = isGSUB ? U.GSUB_LOOKUP_TYPES : U.GPOS_LOOKUP_TYPES;

        const sections = [];
        sections.push(H.sec(tag + ' 表头',
          (isGSUB ? 'GSUB 负责"替换字形"（如把 f+i 替换为连字 fi）。' : 'GPOS 负责"调整字形位置"（如字距、上下标定位）。') +
          '整个表由三级结构组成：ScriptList（脚本）→ FeatureList（特性）→ LookupList（查找表）。' +
          '排版引擎根据文本的语言/脚本选择相应的特性，再执行特性引用的查找表来替换或移动字形。',
          [
            F(new FL.Reader(b), { offset: 0, type: 'uint16', name: 'majorVersion', label: '主版本', editable: true, description: '1。' }),
            F(new FL.Reader(b), { offset: 2, type: 'uint16', name: 'minorVersion', label: '次版本', editable: true, description: '0 或 1（1 增加 FeatureVariations，用于可变字体）。' }),
            F(new FL.Reader(b), { offset: 4, type: 'uint16', name: 'scriptListOffset', label: '脚本列表偏移', editable: false, description: 'ScriptList 相对表头的偏移。' }),
            F(new FL.Reader(b), { offset: 6, type: 'uint16', name: 'featureListOffset', label: '特性列表偏移', editable: false, description: 'FeatureList 相对表头的偏移。' }),
            F(new FL.Reader(b), { offset: 8, type: 'uint16', name: 'lookupListOffset', label: '查找表列表偏移', editable: false, description: 'LookupList 相对表头的偏移。' }),
            featureVarOff != null
              ? { label: 'FeatureVariations 偏移', name: 'featureVariationsOffset', offset: 10, size: 4, type: 'uint32', value: featureVarOff,
                display: featureVarOff ? String(featureVarOff) : '无', editable: false, description: '可变字体中不同轴取值对应不同特性的替换集合。' }
              : { label: 'FeatureVariations', name: '—', offset: null, size: 0, type: 'text', value: '', display: '（版本 ' + major + '.' + minor + ' 不含该字段）', editable: false, description: '' }
          ]));

        sections.push(H.matrix('ScriptList —— 脚本与语言',
          '每种书写系统（脚本）可以为其下的各语言指定一套特性组合。defaultLangSys 表示该脚本的默认语言设置。',
          [
            H.col('tag', '脚本标签', { align: 'left', width: '100px', description: 'ISO 15924 脚本代码，如 latn（拉丁）、hani（汉字）、cyrl（西里尔）。' }),
            H.col('scriptName', '脚本', { align: 'left', width: '150px' }),
            H.col('default', '默认语言特性', { align: 'left' }),
            H.col('langCount', '语言数', { width: '80px' }),
            H.col('langs', '语言', { align: 'left' })
          ],
          scripts.map((s, i) => ({
            __index: i,
            tag: s.tag,
            scriptName: SCRIPT_NAMES[s.tag] || '',
            default: s.defaultLang ? fmtLangSys(s.defaultLang) : '（无）',
            langCount: s.langs.length,
            langs: s.langs.map((l) => l.tag + (l.tag === 'DFLT' ? '(默认)' : '') + '[' + l.features.length + '项]').join(' ')
          })), { pageSize: 40 }));

        sections.push(H.matrix('FeatureList —— 特性',
          '每个特性标签（4 字符）代表一类排版功能，特性通过引用一组查找表（Lookup）来实现效果。',
          [
            H.col('index', '序号', { width: '70px' }),
            H.col('tag', '特性标签', { align: 'left', width: '100px' }),
            H.col('desc', '特性说明', { align: 'left', width: '40%' }),
            H.col('lookupCount', '查找表数', { width: '100px' }),
            H.col('lookups', '查找表索引', { align: 'left' }),
            H.col('params', '参数偏移', { width: '100px' })
          ],
          features.map((f2, i) => ({
            __index: i,
            index: i,
            tag: f2.tag,
            desc: U.FEATURE_TAGS[f2.tag] || '（未收录的特性标签）',
            lookupCount: f2.lookups.length,
            lookups: f2.lookups.join(', ') + (f2.lookups.length > 40 ? ' …' : ''),
            params: f2.paramsOffset || 0
          })), { pageSize: 100, filterable: true }));

        sections.push(H.matrix('LookupList —— 查找表',
          '查找表是真正执行替换/定位的单元。每个查找表包含一个或多个子表（Subtable），每个子表有自己的格式。' +
          '标志位决定在匹配时是否忽略基字/连字/标记等字形。',
          [
            H.col('index', '序号', { width: '70px' }),
            H.col('type', '类型', { align: 'left', width: '260px' }),
            H.col('flags', '标志', { align: 'left', width: '220px' }),
            H.col('subCount', '子表数', { width: '90px' }),
            H.col('formats', '子表格式', { align: 'left', width: '140px' }),
            H.col('offset', '偏移', { width: '90px' })
          ],
          lookups.map((lk) => ({
            __index: lk.index,
            index: lk.index,
            type: lk.type + ' ' + (typeNames[lk.type] || '未知类型').split(' ')[0],
            typeText: typeNames[lk.type] || '未知类型',
            flags: U.formatBits(lk.flag, U.LOOKUP_FLAGS).replace('（未设置任何标志位）', '无'),
            subCount: lk.subtables.length,
            formats: Array.from(new Set(lk.subtables.map((s) => (s.extType !== lk.type ? '→' + s.extType + '/' : '') + 'fmt' + s.format))).join(', '),
            offset: lk.offset
          })), { pageSize: 100, filterable: true }));

        // 查找表类型统计
        const typeStat = {};
        lookups.forEach((lk) => { typeStat[lk.type] = (typeStat[lk.type] || 0) + 1; });
        sections.push(H.matrix('查找表类型统计', '',
          [H.col('type', '类型编号', { width: '100px' }), H.col('name', '含义', { align: 'left', width: '45%' }), H.col('count', '数量', { width: '90px' })],
          Object.keys(typeStat).map((k, i) => ({
            __index: i, type: k, name: (typeNames[k] || '未知类型'), count: typeStat[k]
          })), { pageSize: 0 }));

        return { sections: sections, model: { scripts: scripts, features: features, lookups: lookups } };
      }
    };
  }

  function fmtLangSys(ls) {
    const parts = [];
    if (ls.required >= 0) parts.push('必需特性 #' + ls.required);
    parts.push('特性 #' + ls.features.join(', #'));
    return parts.join('　');
  }

  const SCRIPT_NAMES = {
    DFLT: '默认（Default）', latn: '拉丁文', cyrl: '西里尔文', grek: '希腊文', arab: '阿拉伯文',
    hebr: '希伯来文', deva: '天城文', beng: '孟加拉文', guru: '古木基文', gujr: '古吉拉特文',
    orya: '奥里亚文', taml: '泰米尔文', telu: '泰卢固文', knda: '卡纳达文', mlym: '马拉雅拉姆文',
    sinh: '僧伽罗文', thai: '泰文', lao: '老挝文', tibt: '藏文', mymr: '缅甸文',
    geor: '格鲁吉亚文', armn: '亚美尼亚文', hang: '谚文', kana: '片假名', hira: '平假名',
    hani: '汉字（Han）', hans: '简体中文', hant: '繁体中文', jpan: '日文', kore: '韩文',
    copt: '科普特文', ethi: '埃塞俄比亚文', cher: '切罗基文', cans: '加拿大原住民文字',
    ogam: '欧甘文', runr: '卢恩文', khmr: '高棉文', mong: '蒙古文', brai: '盲文',
    yiii: '彝文', ital: '古意大利文', goth: '哥特文', dsrt: '德撒律文', syrc: '叙利亚文',
    thaa: '塔安那文', nkoo: '西非书面文', vaii: '瓦伊文', bali: '巴厘文', java: '爪哇文',
    bugi: '布吉文', glag: '格拉哥里文', tfng: '提非纳文', xpeo: '古波斯文', ugar: '乌加里特文',
    shaw: '萧伯纳文', osma: '奥斯曼亚文', cprt: '塞浦路斯文', khar: '佉卢文', xsux: '楔形文字',
    phnx: '腓尼基文', limb: '林布文', tale: '傣哪文', talu: '新傣仂文', sylo: '锡尔赫特文',
    lina: '线形文字A', linb: '线形文字B', cakm: '查克马文', tglg: '他加禄文', hano: '哈努诺文',
    buhd: '布希德文', tagb: '塔格巴努亚文', limf: '林布文(2)', 'lao ': '老挝文', math: '数学'
  };

  T['GSUB'] = buildLayoutParser('GSUB', true);
  T['GPOS'] = buildLayoutParser('GPOS', false);

  /* =====================================================================
   * GDEF
   * =================================================================== */
  function parseClassDef(dv, len, off) {
    const out = [];
    if (!off || off + 4 > len) return out;
    const format = dv.getUint16(off);
    if (format === 1) {
      const start = dv.getUint16(off + 2);
      const count = dv.getUint16(off + 4);
      for (let i = 0; i < count; i++) {
        const p = off + 6 + i * 2;
        if (p + 2 > len) break;
        out.push({ start: start + i, end: start + i, cls: dv.getUint16(p) });
      }
    } else if (format === 2) {
      const count = dv.getUint16(off + 2);
      for (let i = 0; i < count; i++) {
        const p = off + 4 + i * 6;
        if (p + 6 > len) break;
        out.push({ start: dv.getUint16(p), end: dv.getUint16(p + 2), cls: dv.getUint16(p + 4) });
      }
    }
    return out;
  }

  function parseCoverage(dv, len, off) {
    if (!off || off + 4 > len) return [];
    const format = dv.getUint16(off);
    const gids = [];
    if (format === 1) {
      const count = dv.getUint16(off + 2);
      for (let i = 0; i < count; i++) {
        const p = off + 4 + i * 2;
        if (p + 2 > len) break;
        gids.push(dv.getUint16(p));
      }
    } else if (format === 2) {
      const count = dv.getUint16(off + 2);
      for (let i = 0; i < count; i++) {
        const p = off + 4 + i * 6;
        if (p + 6 > len) break;
        const s = dv.getUint16(p), e = dv.getUint16(p + 2);
        for (let gid = s; gid <= e; gid++) gids.push(gid);
      }
    }
    return gids;
  }
  T.helper.parseClassDef = parseClassDef;
  T.helper.parseCoverage = parseCoverage;

  T['GDEF'] = {
    parse(font, table) {
      H.need(table, 12, 'GDEF');
      const b = table.bytes;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const major = dv.getUint16(0), minor = dv.getUint16(2);
      const glyphClassDefOffset = dv.getUint16(4);
      const attachListOffset = dv.getUint16(6);
      const ligCaretListOffset = dv.getUint16(8);
      const markAttachClassDefOffset = dv.getUint16(10);
      const markGlyphSetsDefOffset = major === 1 && minor >= 2 && b.length >= 14 ? dv.getUint16(12) : 0;

      const sections = [];
      sections.push(H.sec('GDEF 表头',
        'GDEF 为布局引擎提供"每个字形属于哪一类"的信息：基字（BASE）、连字（LIGATURE）、标记（MARK，如重音符号）、组件（COMPONENT）。' +
        '有了它，引擎才能正确忽略标记字形做字距调整，或把重音正确附着到基字上。',
        [
          F(new FL.Reader(b), { offset: 0, type: 'uint16', name: 'majorVersion', label: '主版本', editable: true, description: '1。' }),
          F(new FL.Reader(b), { offset: 2, type: 'uint16', name: 'minorVersion', label: '次版本', editable: true, description: '0、2 或 3。' }),
          F(new FL.Reader(b), { offset: 4, type: 'uint16', name: 'glyphClassDefOffset', label: '字形类别定义偏移', editable: false, description: '指向 ClassDef 表：把字形映射到类别编号。' }),
          F(new FL.Reader(b), { offset: 6, type: 'uint16', name: 'attachListOffset', label: '附着点列表偏移', editable: false, description: 'AttachList：为每个基字列出可附着点坐标（较少使用）。' }),
          F(new FL.Reader(b), { offset: 8, type: 'uint16', name: 'ligCaretListOffset', label: '连字插入符列表偏移', editable: false, description: 'LigCaretList：连字内部的插入符位置，决定光标在连字中间时停在哪。' }),
          F(new FL.Reader(b), { offset: 10, type: 'uint16', name: 'markAttachClassDefOffset', label: '标记附着类定义偏移', editable: false, description: 'MarkAttachClassDef：把标记分类，供 LookupFlag 的 markAttachmentType 过滤使用。' }),
          markGlyphSetsDefOffset
            ? { label: '标记字形集合定义偏移', name: 'markGlyphSetsDefOffset', offset: 12, size: 2, type: 'uint16', value: markGlyphSetsDefOffset, display: String(markGlyphSetsDefOffset), editable: false, description: 'MarkGlyphSetsDef：可被 LookupFlag 引用的"标记集合"。' }
            : { label: '标记字形集合定义', name: '—', offset: null, size: 0, type: 'text', value: '', display: '（版本 ' + major + '.' + minor + ' 不含该字段）', editable: false, description: '' }
        ]));

      const classes = parseClassDef(dv, b.length, glyphClassDefOffset);
      if (classes.length) {
        const byClass = {};
        classes.forEach((c) => {
          if (!byClass[c.cls]) byClass[c.cls] = [];
          byClass[c.cls].push(c);
        });
        const rows = classes.slice(0, 4000).map((c, i) => ({
          __index: i, cls: c.cls, clsName: CLASS_NAMES[c.cls] || '',
          start: c.start, end: c.end, count: c.end - c.start + 1,
          name: FL.font.glyphName(font, c.start)
        }));
        const classStat = Object.keys(byClass).map((k, i) => ({
          __index: i, cls: k, clsName: CLASS_NAMES[k] || '（自定义类别）',
          count: byClass[k].reduce((a, x) => a + (x.end - x.start + 1), 0)
        }));
        sections.push(H.matrix('字形类别定义（GlyphClassDef）',
          '把字形划分为 1=基字、2=连字、3=标记、4=组件。标为"标记"的字形在做字距调整/替换时通常会被忽略（除非特性明确要求处理标记）。',
          [
            H.col('cls', '类别', { width: '70px' }),
            H.col('clsName', '类别名', { align: 'left', width: '120px' }),
            H.col('start', '起始 GID', { width: '100px' }),
            H.col('end', '结束 GID', { width: '100px' }),
            H.col('count', '字形数', { width: '90px' }),
            H.col('name', '起始字形名', { align: 'left' })
          ], rows, { pageSize: 100, filterable: true }));
        sections.push(H.matrix('类别统计', '', [
          H.col('cls', '类别', { width: '80px' }),
          H.col('clsName', '名称', { align: 'left', width: '200px' }),
          H.col('count', '字形数', { width: '100px' })
        ], classStat, { pageSize: 0 }));
      } else {
        sections.push(H.note('字形类别定义', '该字体未提供 GlyphClassDef（glyphClassDefOffset = 0），布局引擎将无法区分基字与标记，可能导致组合符号定位异常。', 'warn'));
      }

      if (ligCaretListOffset) {
        const coverageOff = dv.getUint16(ligCaretListOffset);
        const ligGlyphCount = dv.getUint16(ligCaretListOffset + 2);
        const rows = [];
        for (let i = 0; i < ligGlyphCount; i++) {
          const p = ligCaretListOffset + 4 + i * 2;
          if (p + 2 > b.length) break;
          const lo = dv.getUint16(p);
          const abs = ligCaretListOffset + lo;
          const caretCount = abs + 2 <= b.length ? dv.getUint16(abs) : 0;
          const carets = [];
          for (let k = 0; k < caretCount; k++) {
            const q = abs + 2 + k * 2;
            if (q + 2 > b.length) break;
            const co = dv.getUint16(q);
            const cabs = abs + co;
            const fmt = cabs + 2 <= b.length ? dv.getUint16(cabs) : -1;
            let val = '';
            if (fmt === 1 && cabs + 4 <= b.length) val = '坐标 ' + dv.getInt16(cabs + 2);
            else if (fmt === 2 && cabs + 4 <= b.length) val = '插入点 ' + dv.getUint16(cabs + 2);
            else if (fmt === 3 && cabs + 6 <= b.length) val = '坐标 ' + dv.getInt16(cabs + 2) + '，设备表偏移 ' + dv.getUint16(cabs + 4);
            carets.push('fmt' + fmt + '(' + val + ')');
          }
          rows.push({ __index: i, glyph: i, name: FL.font.glyphName(font, i), caretCount: caretCount, carets: carets.join('，') });
        }
        const gids = parseCoverage(dv, b.length, coverageOff);
        sections.push(H.matrix('连字插入符（LigCaretList）',
          '连字（如 fi）内可以放多个光标位置，用户用方向键在连字中移动光标时即在这些位置之间跳转。共覆盖 ' + gids.length + ' 个连字字形。',
          [
            H.col('glyph', '序号', { width: '80px' }),
            H.col('name', '字形名', { align: 'left', width: '160px' }),
            H.col('caretCount', '插入符数量', { width: '110px' }),
            H.col('carets', '插入符详情', { align: 'left' })
          ], rows.slice(0, 100), { pageSize: 100 }));
      }

      if (markGlyphSetsDefOffset) {
        const fmt = dv.getUint16(markGlyphSetsDefOffset);
        const setCount = dv.getUint16(markGlyphSetsDefOffset + 2);
        const rows = [];
        for (let i = 0; i < setCount; i++) {
          const p = markGlyphSetsDefOffset + 4 + i * 4;
          if (p + 4 > b.length) break;
          const co = dv.getUint32(p);
          const gids = parseCoverage(dv, b.length, markGlyphSetsDefOffset + co);
          rows.push({ __index: i, set: i, count: gids.length, first: gids.slice(0, 12).map((x) => '#' + x + (FL.font.glyphName(font, x) ? '(' + FL.font.glyphName(font, x) + ')' : '')).join(' ') });
        }
        sections.push(H.matrix('标记字形集合（MarkGlyphSets）',
          '格式 ' + fmt + '。这些集合可被 LookupFlag 引用，用于"只对某些标记生效"的查找表。',
          [
            H.col('set', '集合序号', { width: '100px' }),
            H.col('count', '字形数', { width: '100px' }),
            H.col('first', '前若干字形', { align: 'left' })
          ], rows, { pageSize: 40 }));
      }

      return { sections: sections, model: {} };
    }
  };

  const CLASS_NAMES = { 1: 'Base 基字', 2: 'Ligature 连字', 3: 'Mark 标记（组合符号）', 4: 'Component 组件（复合字形部件）' };

  /* =====================================================================
   * BASE（简版）
   * =================================================================== */
  T['BASE'] = {
    parse(font, table) {
      H.need(table, 8, 'BASE');
      const b = table.bytes;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const major = dv.getUint16(0), minor = dv.getUint16(2);
      const horizAxisOffset = dv.getUint16(4);
      const vertAxisOffset = dv.getUint16(6);
      const sections = [H.sec('BASE 表头', 'BASE 声明各脚本的基线（如拉丁文的 alphabetic、汉字的 ideographic）在坐标系中的位置，以及用于两端对齐的最小/最大范围。这份信息主要被高级排版引擎（如 InDesign）使用。', [
        F(new FL.Reader(b), { offset: 0, type: 'uint16', name: 'majorVersion', label: '主版本', editable: true, description: '1。' }),
        F(new FL.Reader(b), { offset: 2, type: 'uint16', name: 'minorVersion', label: '次版本', editable: true, description: '0/1/2。' }),
        F(new FL.Reader(b), { offset: 4, type: 'uint16', name: 'horizAxisOffset', label: '水平轴偏移', editable: false, description: '水平书写方向基线的定义位置，0 表示无。' }),
        F(new FL.Reader(b), { offset: 6, type: 'uint16', name: 'vertAxisOffset', label: '垂直轴偏移', editable: false, description: '垂直书写方向基线的定义位置。' })
      ])];

      [['水平基轴', horizAxisOffset], ['垂直基轴', vertAxisOffset]].forEach(([label, off]) => {
        if (!off || off + 4 > b.length) return;
        const baseTagListOffset = dv.getUint16(off + 2);
        const baseScriptListOffset = dv.getUint16(off + 4);
        const rows = [];
        if (baseTagListOffset) {
          const count = dv.getUint16(off + baseTagListOffset);
          for (let i = 0; i < count; i++) {
            const p = off + baseTagListOffset + 2 + i * 4;
            if (p + 4 > b.length) break;
            rows.push({ __index: i, tag: U.tag(dv.getUint32(p)).replace(/ /g, ''), desc: BASELINE_TAGS[U.tag(dv.getUint32(p)).replace(/ /g, '')] || '' });
          }
        }
        if (baseScriptListOffset) {
          const count = dv.getUint16(off + baseScriptListOffset);
          for (let i = 0; i < count; i++) {
            const p = off + baseScriptListOffset + 2 + i * 6;
            if (p + 6 > b.length) break;
            const stag = U.tag(dv.getUint32(p)).replace(/ /g, '');
            rows.push({ __index: rows.length, tag: '脚本 ' + stag, desc: SCRIPT_NAMES[stag] || '' });
          }
        }
        sections.push(H.matrix(label + '（标签列表）',
          '列出了该方向下定义的基线标签与脚本（具体坐标值本工具暂不解码，可在原始数据中查看）。',
          [H.col('tag', '标签', { align: 'left', width: '160px' }), H.col('desc', '含义', { align: 'left' })],
          rows, { pageSize: 60 }));
      });
      return { sections: sections, model: {} };
    }
  };

  const BASELINE_TAGS = {
    romn: '罗马基线（alphabetic，西文）', hang: '谚文基线', ideo: '表意基线（汉字底部）',
    idtp: '表意顶部基线', math: '数学基线', icfb: '表意字符面底部', icft: '表意字符面顶部',
    init: '表意字符面起始', lao: '老挝文基线', dfLT: '默认基线'
  };
})(typeof window !== 'undefined' ? window : globalThis);
