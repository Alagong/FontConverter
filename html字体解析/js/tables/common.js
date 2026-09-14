/* =========================================================================
 * tables/common.js —— 表解析器公共辅助
 * 每个解析器模块形如：
 *   FL.tables['head'] = {
 *     parse(font, table) -> { sections: [...], model: {...} },
 *     edit(font, table, ctx, value)   // 可选：自定义编辑行为
 *   }
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});
  const U = FL.util;
  const T = (FL.tables = FL.tables || {});
  const H = (T.helper = {});

  /** 创建字段（自动补充 display） */
  H.F = function (r, o) {
    const f = FL.field(r, o);
    if (!f.display) f.display = H.display(f);
    return f;
  };

  H.display = function (f) {
    switch (f.type) {
      case 'longdatetime':
        return U.fmtDate(U.longDateTimeToDate(f.value));
      case 'fixed':
      case 'ufixed':
      case 'f2dot14':
        return String(f.value);
      case 'tag':
        return f.value;
      default:
        if (f.bits) return f.value + ' ｜ ' + U.formatBits(f.value, f.bits);
        if (f.enumMap) {
          const n = f.enumMap[f.value];
          return f.value + '（' + (n != null ? n : '未知') + '）';
        }
        return String(f.value);
    }
  };

  /** 字段分区 */
  H.sec = function (title, description, fields, extra) {
    return Object.assign({ kind: 'fields', title: title, description: description, fields: fields || [] }, extra || {});
  };

  /**
   * 表格分区。
   * 支持省略说明的写法：H.matrix(title, columns, rows, extra)（会自动识别并纠正参数位置）
   * 参数类型错误时立即抛错，避免静默渲染出空表。
   */
  H.matrix = function (title, description, columns, rows, extra) {
    if (Array.isArray(description)) {
      extra = rows;
      rows = columns;
      columns = description;
      description = '';
    }
    if (!Array.isArray(columns)) {
      throw new Error('H.matrix「' + title + '」：columns 必须是数组，实际为 ' + typeof columns);
    }
    if (rows != null && !Array.isArray(rows)) {
      throw new Error('H.matrix「' + title + '」：rows 必须是数组，实际为 ' + typeof rows);
    }
    if (description != null && typeof description !== 'string') {
      throw new Error('H.matrix「' + title + '」：description 必须是字符串');
    }
    return Object.assign(
      { kind: 'matrix', title: title, description: description || '', columns: columns, rows: rows || [] },
      extra || {}
    );
  };

  /** 说明分区（纯文本 / 提示） */
  H.note = function (title, text, level) {
    return { kind: 'note', title: title, text: text, level: level || 'info' };
  };

  /** 列定义 */
  H.col = function (key, label, opts) {
    return Object.assign({ key: key, label: label, align: 'right', editable: false, width: null }, opts || {});
  };

  /** 表尺寸不足时的保护 */
  H.need = function (table, n, tag) {
    if (table.bytes.length < n)
      throw new Error('表 ' + (tag || table.tag) + ' 长度不足（需要 ' + n + ' 字节，实际 ' + table.bytes.length + ' 字节）');
  };

  /** 常用枚举：字体方向提示 */
  U.FONT_DIRECTION_HINT = {
    '-2': '强烈左右（Strong left to right）',
    '-1': '强烈左右并包含竖排文本',
    '0': '仅左右（Mixed，日常使用）',
    '1': '仅左右文本',
    '2': '仅左右（强烈，包含竖排）'
  };
  U.INDEX_TO_LOC_FORMAT = { 0: 'short（偏移量 /2，16 位，字形数据 < 128KB）', 1: 'long（32 位偏移，字形数据 > 128KB）' };

  return H;
})(typeof window !== 'undefined' ? window : globalThis);
