/* =========================================================================
 * binary.js —— 二进制读取器 / 写入器 / 字段描述 / 字节补丁
 * ========================================================================= */
(function (g) {
  'use strict';
  const FL = (g.FL = g.FL || {});

  /* ---------------------------------------------------------------------
   * 数据类型表：type -> { size, read(view, off), write(view, off, value), fmt }
   * ------------------------------------------------------------------- */
  const TYPES = {
    uint8: { size: 1, r: (d, o) => d.getUint8(o), w: (d, o, v) => d.setUint8(o, v & 0xff) },
    int8: { size: 1, r: (d, o) => d.getInt8(o), w: (d, o, v) => d.setInt8(o, v | 0) },
    uint16: { size: 2, r: (d, o) => d.getUint16(o), w: (d, o, v) => d.setUint16(o, v & 0xffff) },
    int16: { size: 2, r: (d, o) => d.getInt16(o), w: (d, o, v) => d.setInt16(o, v | 0) },
    uint24: { size: 3, r: (d, o) => (d.getUint8(o) << 16) | d.getUint16(o + 1) },
    uint32: { size: 4, r: (d, o) => d.getUint32(o), w: (d, o, v) => d.setUint32(o, v >>> 0) },
    int32: { size: 4, r: (d, o) => d.getInt32(o), w: (d, o, v) => d.setInt32(o, v | 0) },
    fixed: { size: 4, r: (d, o) => d.getInt32(o) / 65536, w: (d, o, v) => d.setInt32(o, Math.round(v * 65536)) },
    ufixed: { size: 4, r: (d, o) => d.getUint32(o) / 65536, w: (d, o, v) => d.setUint32(o, Math.round(v * 65536)) },
    f2dot14: { size: 2, r: (d, o) => d.getInt16(o) / 16384, w: (d, o, v) => d.setInt16(o, Math.round(v * 16384)) },
    longdatetime: { size: 8, r: (d, o) => Number(d.getBigInt64(o)) },
    tag: { size: 4, r: (d, o) => FL.util.tag(d.getUint32(o)) },
    uint64: { size: 8, r: (d, o) => Number(d.getBigUint64(o)) }
  };
  FL.TYPES = TYPES;

  /* ---------------------------------------------------------------------
   * 读取器
   * ------------------------------------------------------------------- */
  class Reader {
    constructor(bytes, offset) {
      this.bytes = bytes;                  // Uint8Array
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.base = offset || 0;             // 逻辑 0 位置对应的字节下标
      this.pos = 0;
    }
    seek(p) { this.pos = p; return this; }
    skip(n) { this.pos += n; return this; }
    get length() { return this.bytes.length - this.base; }
    u8() { return this.view.getUint8(this.base + this.pos++); }
    i8() { return this.view.getInt8(this.base + this.pos++); }
    u16() { const v = this.view.getUint16(this.base + this.pos); this.pos += 2; return v; }
    i16() { const v = this.view.getInt16(this.base + this.pos); this.pos += 2; return v; }
    u24() { const v = (this.u8() << 16) | this.u16(); return v; }
    u32() { const v = this.view.getUint32(this.base + this.pos); this.pos += 4; return v; }
    i32() { const v = this.view.getInt32(this.base + this.pos); this.pos += 4; return v; }
    u64() { const v = this.view.getBigUint64(this.base + this.pos); this.pos += 8; return v; }
    i64() { const v = this.view.getBigInt64(this.base + this.pos); this.pos += 8; return v; }
    fixed() { return this.i32() / 65536; }
    f2dot14() { return this.i16() / 16384; }
    tag() { return FL.util.tag(this.u32()); }
    bytesAt(off, len) { return this.bytes.subarray(this.base + off, this.base + off + len); }
    raw(len) { const a = this.bytesAt(this.pos, len); this.pos += len; return a; }
    /** 按类型读取 */
    read(type) { return TYPES[type].r(this.view, this.base + ((this.pos += TYPES[type].size), this.pos - TYPES[type].size)); }
    at(off) { return new Reader(this.bytes, this.base + off); }
  }
  FL.Reader = Reader;

  /* ---------------------------------------------------------------------
   * 写入器（可增长缓冲区，用于重建表）
   * ------------------------------------------------------------------- */
  class Builder {
    constructor(cap) {
      this.buf = new Uint8Array(cap || 4096);
      this.len = 0;
    }
    _need(n) {
      if (this.len + n <= this.buf.length) return;
      let cap = this.buf.length * 2;
      while (cap < this.len + n) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
    }
    get view() { return new DataView(this.buf.buffer); }
    u8(v) { this._need(1); this.buf[this.len++] = v & 0xff; return this; }
    i8(v) { return this.u8(v & 0xff); }
    u16(v) { this._need(2); this.view.setUint16(this.len, v & 0xffff); this.len += 2; return this; }
    i16(v) { this._need(2); this.view.setInt16(this.len, v | 0); this.len += 2; return this; }
    u32(v) { this._need(4); this.view.setUint32(this.len, v >>> 0); this.len += 4; return this; }
    i32(v) { this._need(4); this.view.setInt32(this.len, v | 0); this.len += 4; return this; }
    tag(s) { return this.u32(FL.util.tagToInt(s)); }
    bytes(b) { this._need(b.length); this.buf.set(b, this.len); this.len += b.length; return this; }
    zeros(n) { this._need(n); this.buf.fill(0, this.len, this.len + n); this.len += n; return this; }
    pad4() { while (this.len & 3) this.u8(0); return this; }
    get offset() { return this.len; }
    setUint16At(off, v) { new DataView(this.buf.buffer).setUint16(off, v & 0xffff); return this; }
    setUint32At(off, v) { new DataView(this.buf.buffer).setUint32(off, v >>> 0); return this; }
    setInt16At(off, v) { new DataView(this.buf.buffer).setInt16(off, v | 0); return this; }
    toBytes() { return this.buf.slice(0, this.len); }
  }
  FL.Builder = Builder;

  /* ---------------------------------------------------------------------
   * 字段工厂
   * ------------------------------------------------------------------- */
  /**
   * 创建一个"字段描述"对象，供 UI 渲染与编辑。
   *  r          : Reader（已定位到该表起点）
   *  o.offset   : 表内偏移
   */
  FL.field = function (r, o) {
    const type = o.type || 'uint16';
    const size = o.size != null ? o.size : TYPES[type] ? TYPES[type].size : 0;
    const f = Object.assign(
      {
        name: '', label: '', offset: o.offset, size: size, type: type,
        value: null, display: '', description: '', editable: false,
        bits: null, enumMap: null, raw: null, unit: '', note: ''
      },
      o
    );
    if (f.value === null && TYPES[type] && size && o.offset + size <= r.length) {
      f.value = TYPES[type].r(r.view, r.base + o.offset);
    }
    return f;
  };

  /** 写回表字节（就地补丁，不改变表长度） */
  FL.patchBytes = function (bytes, offset, type, value) {
    const t = TYPES[type];
    if (!t || !t.w) throw new Error('该数据类型不可写: ' + type);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    t.w(view, offset, value);
    return bytes;
  };

  /** 把数组按 big-endian 写入字节 */
  FL.writeBytesAt = function (bytes, offset, src) {
    for (let i = 0; i < src.length; i++) bytes[offset + i] = src[i];
    return bytes;
  };
})(typeof window !== 'undefined' ? window : globalThis);
