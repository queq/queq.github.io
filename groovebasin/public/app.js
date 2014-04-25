(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `Buffer._useTypedArrays`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
Buffer._useTypedArrays = (function () {
  // Detect if browser supports Typed Arrays. Supported browsers are IE 10+, Firefox 4+,
  // Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+. If the browser does not support adding
  // properties to `Uint8Array` instances, then that's the same as no `Uint8Array` support
  // because we need to be able to add all the node Buffer API methods. This is an issue
  // in Firefox 4-29. Now fixed: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() &&
        typeof arr.subarray === 'function' // Chrome 9-10 lack `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // assume that object is array-like
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (Buffer._useTypedArrays) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer._useTypedArrays && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer._useTypedArrays && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b !== null && b !== undefined && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list, [totalLength])\n' +
      'list should be an Array.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function _asciiWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function _utf16leWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = _asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = _binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = _base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = _asciiSlice(self, start, end)
      break
    case 'binary':
      ret = _binarySlice(self, start, end)
      break
    case 'base64':
      ret = _base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer._useTypedArrays) {
    for (var i = 0; i < len; i++)
      target[i + target_start] = this[i + start]
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function _utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i+1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (Buffer._useTypedArrays) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  assert(typeof value === 'number' && !isNaN(value), 'value is not a number')
  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer._useTypedArrays) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1)
        buf[i] = this[i]
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0, 'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

},{"base64-js":2,"ieee754":3}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var ZERO   = '0'.charCodeAt(0)
	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	module.exports.toByteArray = b64ToByteArray
	module.exports.fromByteArray = uint8ToBase64
}())

},{}],3:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],4:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],5:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],6:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.once = noop;
process.off = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],7:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],8:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return obj[k].map(function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],9:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":7,"./encode":8}],10:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],11:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require("/home/sergio/Code/groovebasin/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":10,"/home/sergio/Code/groovebasin/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js":6,"inherits":5}],12:[function(require,module,exports){
/**
 * Diff Match and Patch
 *
 * Copyright 2006 Google Inc.
 * http://code.google.com/p/google-diff-match-patch/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Computes the difference between two texts to create a patch.
 * Applies the patch onto another text, allowing for errors.
 * @author fraser@google.com (Neil Fraser)
 */

/**
 * Class containing the diff, match and patch methods.
 * @constructor
 */
function diff_match_patch() {

  // Defaults.
  // Redefine these in your program to override the defaults.

  // Number of seconds to map a diff before giving up (0 for infinity).
  this.Diff_Timeout = 1.0;
  // Cost of an empty edit operation in terms of edit characters.
  this.Diff_EditCost = 4;
  // At what point is no match declared (0.0 = perfection, 1.0 = very loose).
  this.Match_Threshold = 0.5;
  // How far to search for a match (0 = exact location, 1000+ = broad match).
  // A match this many characters away from the expected location will add
  // 1.0 to the score (0.0 is a perfect match).
  this.Match_Distance = 1000;
  // When deleting a large block of text (over ~64 characters), how close does
  // the contents have to match the expected contents. (0.0 = perfection,
  // 1.0 = very loose).  Note that Match_Threshold controls how closely the
  // end points of a delete need to match.
  this.Patch_DeleteThreshold = 0.5;
  // Chunk size for context length.
  this.Patch_Margin = 4;

  // The number of bits in an int.
  this.Match_MaxBits = 32;
}


//  DIFF FUNCTIONS


/**
 * The data structure representing a diff is an array of tuples:
 * [[DIFF_DELETE, 'Hello'], [DIFF_INSERT, 'Goodbye'], [DIFF_EQUAL, ' world.']]
 * which means: delete 'Hello', add 'Goodbye' and keep ' world.'
 */
var DIFF_DELETE = -1;
var DIFF_INSERT = 1;
var DIFF_EQUAL = 0;

/** @typedef {!Array.<number|string>} */
diff_match_patch.Diff;


/**
 * Find the differences between two texts.  Simplifies the problem by stripping
 * any common prefix or suffix off the texts before diffing.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {boolean=} opt_checklines Optional speedup flag. If present and false,
 *     then don't run a line-level diff first to identify the changed areas.
 *     Defaults to true, which does a faster, slightly less optimal diff.
 * @param {number} opt_deadline Optional time when the diff should be complete
 *     by.  Used internally for recursive calls.  Users should set DiffTimeout
 *     instead.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 */
diff_match_patch.prototype.diff_main = function(text1, text2, opt_checklines,
    opt_deadline) {
  // Set a deadline by which time the diff must be complete.
  if (typeof opt_deadline == 'undefined') {
    if (this.Diff_Timeout <= 0) {
      opt_deadline = Number.MAX_VALUE;
    } else {
      opt_deadline = (new Date).getTime() + this.Diff_Timeout * 1000;
    }
  }
  var deadline = opt_deadline;

  // Check for null inputs.
  if (text1 == null || text2 == null) {
    throw new Error('Null input. (diff_main)');
  }

  // Check for equality (speedup).
  if (text1 == text2) {
    if (text1) {
      return [[DIFF_EQUAL, text1]];
    }
    return [];
  }

  if (typeof opt_checklines == 'undefined') {
    opt_checklines = true;
  }
  var checklines = opt_checklines;

  // Trim off common prefix (speedup).
  var commonlength = this.diff_commonPrefix(text1, text2);
  var commonprefix = text1.substring(0, commonlength);
  text1 = text1.substring(commonlength);
  text2 = text2.substring(commonlength);

  // Trim off common suffix (speedup).
  commonlength = this.diff_commonSuffix(text1, text2);
  var commonsuffix = text1.substring(text1.length - commonlength);
  text1 = text1.substring(0, text1.length - commonlength);
  text2 = text2.substring(0, text2.length - commonlength);

  // Compute the diff on the middle block.
  var diffs = this.diff_compute_(text1, text2, checklines, deadline);

  // Restore the prefix and suffix.
  if (commonprefix) {
    diffs.unshift([DIFF_EQUAL, commonprefix]);
  }
  if (commonsuffix) {
    diffs.push([DIFF_EQUAL, commonsuffix]);
  }
  this.diff_cleanupMerge(diffs);
  return diffs;
};


/**
 * Find the differences between two texts.  Assumes that the texts do not
 * have any common prefix or suffix.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {boolean} checklines Speedup flag.  If false, then don't run a
 *     line-level diff first to identify the changed areas.
 *     If true, then run a faster, slightly less optimal diff.
 * @param {number} deadline Time when the diff should be complete by.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_compute_ = function(text1, text2, checklines,
    deadline) {
  var diffs;

  if (!text1) {
    // Just add some text (speedup).
    return [[DIFF_INSERT, text2]];
  }

  if (!text2) {
    // Just delete some text (speedup).
    return [[DIFF_DELETE, text1]];
  }

  var longtext = text1.length > text2.length ? text1 : text2;
  var shorttext = text1.length > text2.length ? text2 : text1;
  var i = longtext.indexOf(shorttext);
  if (i != -1) {
    // Shorter text is inside the longer text (speedup).
    diffs = [[DIFF_INSERT, longtext.substring(0, i)],
             [DIFF_EQUAL, shorttext],
             [DIFF_INSERT, longtext.substring(i + shorttext.length)]];
    // Swap insertions for deletions if diff is reversed.
    if (text1.length > text2.length) {
      diffs[0][0] = diffs[2][0] = DIFF_DELETE;
    }
    return diffs;
  }

  if (shorttext.length == 1) {
    // Single character string.
    // After the previous speedup, the character can't be an equality.
    return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
  }
  longtext = shorttext = null;  // Garbage collect.

  // Check to see if the problem can be split in two.
  var hm = this.diff_halfMatch_(text1, text2);
  if (hm) {
    // A half-match was found, sort out the return data.
    var text1_a = hm[0];
    var text1_b = hm[1];
    var text2_a = hm[2];
    var text2_b = hm[3];
    var mid_common = hm[4];
    // Send both pairs off for separate processing.
    var diffs_a = this.diff_main(text1_a, text2_a, checklines, deadline);
    var diffs_b = this.diff_main(text1_b, text2_b, checklines, deadline);
    // Merge the results.
    return diffs_a.concat([[DIFF_EQUAL, mid_common]], diffs_b);
  }

  if (checklines && text1.length > 100 && text2.length > 100) {
    return this.diff_lineMode_(text1, text2, deadline);
  }

  return this.diff_bisect_(text1, text2, deadline);
};


/**
 * Do a quick line-level diff on both strings, then rediff the parts for
 * greater accuracy.
 * This speedup can produce non-minimal diffs.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} deadline Time when the diff should be complete by.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_lineMode_ = function(text1, text2, deadline) {
  // Scan the text on a line-by-line basis first.
  var a = this.diff_linesToChars_(text1, text2);
  text1 = /** @type {string} */(a[0]);
  text2 = /** @type {string} */(a[1]);
  var linearray = /** @type {!Array.<string>} */(a[2]);

  var diffs = this.diff_bisect_(text1, text2, deadline);

  // Convert the diff back to original text.
  this.diff_charsToLines_(diffs, linearray);
  // Eliminate freak matches (e.g. blank lines)
  this.diff_cleanupSemantic(diffs);

  // Rediff any replacement blocks, this time character-by-character.
  // Add a dummy entry at the end.
  diffs.push([DIFF_EQUAL, '']);
  var pointer = 0;
  var count_delete = 0;
  var count_insert = 0;
  var text_delete = '';
  var text_insert = '';
  while (pointer < diffs.length) {
    switch (diffs[pointer][0]) {
      case DIFF_INSERT:
        count_insert++;
        text_insert += diffs[pointer][1];
        break;
      case DIFF_DELETE:
        count_delete++;
        text_delete += diffs[pointer][1];
        break;
      case DIFF_EQUAL:
        // Upon reaching an equality, check for prior redundancies.
        if (count_delete >= 1 && count_insert >= 1) {
          // Delete the offending records and add the merged ones.
          var a = this.diff_main(text_delete, text_insert, false, deadline);
          diffs.splice(pointer - count_delete - count_insert,
                       count_delete + count_insert);
          pointer = pointer - count_delete - count_insert;
          for (var j = a.length - 1; j >= 0; j--) {
            diffs.splice(pointer, 0, a[j]);
          }
          pointer = pointer + a.length;
        }
        count_insert = 0;
        count_delete = 0;
        text_delete = '';
        text_insert = '';
        break;
    }
    pointer++;
  }
  diffs.pop();  // Remove the dummy entry at the end.

  return diffs;
};


/**
 * Find the 'middle snake' of a diff, split the problem in two
 * and return the recursively constructed diff.
 * See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} deadline Time at which to bail if not yet complete.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_bisect_ = function(text1, text2, deadline) {
  // Cache the text lengths to prevent multiple calls.
  var text1_length = text1.length;
  var text2_length = text2.length;
  var max_d = Math.ceil((text1_length + text2_length) / 2);
  var v_offset = max_d;
  var v_length = 2 * max_d;
  var v1 = new Array(v_length);
  var v2 = new Array(v_length);
  // Setting all elements to -1 is faster in Chrome & Firefox than mixing
  // integers and undefined.
  for (var x = 0; x < v_length; x++) {
    v1[x] = -1;
    v2[x] = -1;
  }
  v1[v_offset + 1] = 0;
  v2[v_offset + 1] = 0;
  var delta = text1_length - text2_length;
  // If the total number of characters is odd, then the front path will collide
  // with the reverse path.
  var front = (delta % 2 != 0);
  // Offsets for start and end of k loop.
  // Prevents mapping of space beyond the grid.
  var k1start = 0;
  var k1end = 0;
  var k2start = 0;
  var k2end = 0;
  for (var d = 0; d < max_d; d++) {
    // Bail out if deadline is reached.
    if ((new Date()).getTime() > deadline) {
      break;
    }

    // Walk the front path one step.
    for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      var k1_offset = v_offset + k1;
      var x1;
      if (k1 == -d || k1 != d && v1[k1_offset - 1] < v1[k1_offset + 1]) {
        x1 = v1[k1_offset + 1];
      } else {
        x1 = v1[k1_offset - 1] + 1;
      }
      var y1 = x1 - k1;
      while (x1 < text1_length && y1 < text2_length &&
             text1.charAt(x1) == text2.charAt(y1)) {
        x1++;
        y1++;
      }
      v1[k1_offset] = x1;
      if (x1 > text1_length) {
        // Ran off the right of the graph.
        k1end += 2;
      } else if (y1 > text2_length) {
        // Ran off the bottom of the graph.
        k1start += 2;
      } else if (front) {
        var k2_offset = v_offset + delta - k1;
        if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] != -1) {
          // Mirror x2 onto top-left coordinate system.
          var x2 = text1_length - v2[k2_offset];
          if (x1 >= x2) {
            // Overlap detected.
            return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
          }
        }
      }
    }

    // Walk the reverse path one step.
    for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      var k2_offset = v_offset + k2;
      var x2;
      if (k2 == -d || k2 != d && v2[k2_offset - 1] < v2[k2_offset + 1]) {
        x2 = v2[k2_offset + 1];
      } else {
        x2 = v2[k2_offset - 1] + 1;
      }
      var y2 = x2 - k2;
      while (x2 < text1_length && y2 < text2_length &&
             text1.charAt(text1_length - x2 - 1) ==
             text2.charAt(text2_length - y2 - 1)) {
        x2++;
        y2++;
      }
      v2[k2_offset] = x2;
      if (x2 > text1_length) {
        // Ran off the left of the graph.
        k2end += 2;
      } else if (y2 > text2_length) {
        // Ran off the top of the graph.
        k2start += 2;
      } else if (!front) {
        var k1_offset = v_offset + delta - k2;
        if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] != -1) {
          var x1 = v1[k1_offset];
          var y1 = v_offset + x1 - k1_offset;
          // Mirror x2 onto top-left coordinate system.
          x2 = text1_length - x2;
          if (x1 >= x2) {
            // Overlap detected.
            return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
          }
        }
      }
    }
  }
  // Diff took too long and hit the deadline or
  // number of diffs equals number of characters, no commonality at all.
  return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
};


/**
 * Given the location of the 'middle snake', split the diff in two parts
 * and recurse.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} x Index of split point in text1.
 * @param {number} y Index of split point in text2.
 * @param {number} deadline Time at which to bail if not yet complete.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_bisectSplit_ = function(text1, text2, x, y,
    deadline) {
  var text1a = text1.substring(0, x);
  var text2a = text2.substring(0, y);
  var text1b = text1.substring(x);
  var text2b = text2.substring(y);

  // Compute both diffs serially.
  var diffs = this.diff_main(text1a, text2a, false, deadline);
  var diffsb = this.diff_main(text1b, text2b, false, deadline);

  return diffs.concat(diffsb);
};


/**
 * Split two texts into an array of strings.  Reduce the texts to a string of
 * hashes where each Unicode character represents one line.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {!Array.<string|!Array.<string>>} Three element Array, containing the
 *     encoded text1, the encoded text2 and the array of unique strings.  The
 *     zeroth element of the array of unique strings is intentionally blank.
 * @private
 */
diff_match_patch.prototype.diff_linesToChars_ = function(text1, text2) {
  var lineArray = [];  // e.g. lineArray[4] == 'Hello\n'
  var lineHash = {};   // e.g. lineHash['Hello\n'] == 4

  // '\x00' is a valid character, but various debuggers don't like it.
  // So we'll insert a junk entry to avoid generating a null character.
  lineArray[0] = '';

  /**
   * Split a text into an array of strings.  Reduce the texts to a string of
   * hashes where each Unicode character represents one line.
   * Modifies linearray and linehash through being a closure.
   * @param {string} text String to encode.
   * @return {string} Encoded string.
   * @private
   */
  function diff_linesToCharsMunge_(text) {
    var chars = '';
    // Walk the text, pulling out a substring for each line.
    // text.split('\n') would would temporarily double our memory footprint.
    // Modifying text would create many large strings to garbage collect.
    var lineStart = 0;
    var lineEnd = -1;
    // Keeping our own length variable is faster than looking it up.
    var lineArrayLength = lineArray.length;
    while (lineEnd < text.length - 1) {
      lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd == -1) {
        lineEnd = text.length - 1;
      }
      var line = text.substring(lineStart, lineEnd + 1);
      lineStart = lineEnd + 1;

      if (lineHash.hasOwnProperty ? lineHash.hasOwnProperty(line) :
          (lineHash[line] !== undefined)) {
        chars += String.fromCharCode(lineHash[line]);
      } else {
        chars += String.fromCharCode(lineArrayLength);
        lineHash[line] = lineArrayLength;
        lineArray[lineArrayLength++] = line;
      }
    }
    return chars;
  }

  var chars1 = diff_linesToCharsMunge_(text1);
  var chars2 = diff_linesToCharsMunge_(text2);
  return [chars1, chars2, lineArray];
};


/**
 * Rehydrate the text in a diff from a string of line hashes to real lines of
 * text.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @param {!Array.<string>} lineArray Array of unique strings.
 * @private
 */
diff_match_patch.prototype.diff_charsToLines_ = function(diffs, lineArray) {
  for (var x = 0; x < diffs.length; x++) {
    var chars = diffs[x][1];
    var text = [];
    for (var y = 0; y < chars.length; y++) {
      text[y] = lineArray[chars.charCodeAt(y)];
    }
    diffs[x][1] = text.join('');
  }
};


/**
 * Determine the common prefix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the start of each
 *     string.
 */
diff_match_patch.prototype.diff_commonPrefix = function(text1, text2) {
  // Quick check for common null cases.
  if (!text1 || !text2 || text1.charAt(0) != text2.charAt(0)) {
    return 0;
  }
  // Binary search.
  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
  var pointermin = 0;
  var pointermax = Math.min(text1.length, text2.length);
  var pointermid = pointermax;
  var pointerstart = 0;
  while (pointermin < pointermid) {
    if (text1.substring(pointerstart, pointermid) ==
        text2.substring(pointerstart, pointermid)) {
      pointermin = pointermid;
      pointerstart = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
};


/**
 * Determine the common suffix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the end of each string.
 */
diff_match_patch.prototype.diff_commonSuffix = function(text1, text2) {
  // Quick check for common null cases.
  if (!text1 || !text2 ||
      text1.charAt(text1.length - 1) != text2.charAt(text2.length - 1)) {
    return 0;
  }
  // Binary search.
  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
  var pointermin = 0;
  var pointermax = Math.min(text1.length, text2.length);
  var pointermid = pointermax;
  var pointerend = 0;
  while (pointermin < pointermid) {
    if (text1.substring(text1.length - pointermid, text1.length - pointerend) ==
        text2.substring(text2.length - pointermid, text2.length - pointerend)) {
      pointermin = pointermid;
      pointerend = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
};


/**
 * Determine if the suffix of one string is the prefix of another.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the end of the first
 *     string and the start of the second string.
 * @private
 */
diff_match_patch.prototype.diff_commonOverlap_ = function(text1, text2) {
  // Cache the text lengths to prevent multiple calls.
  var text1_length = text1.length;
  var text2_length = text2.length;
  // Eliminate the null case.
  if (text1_length == 0 || text2_length == 0) {
    return 0;
  }
  // Truncate the longer string.
  if (text1_length > text2_length) {
    text1 = text1.substring(text1_length - text2_length);
  } else if (text1_length < text2_length) {
    text2 = text2.substring(0, text1_length);
  }
  var text_length = Math.min(text1_length, text2_length);
  // Quick check for the worst case.
  if (text1 == text2) {
    return text_length;
  }

  // Start by looking for a single character match
  // and increase length until no match is found.
  // Performance analysis: http://neil.fraser.name/news/2010/11/04/
  var best = 0;
  var length = 1;
  while (true) {
    var pattern = text1.substring(text_length - length);
    var found = text2.indexOf(pattern);
    if (found == -1) {
      return best;
    }
    length += found;
    if (found == 0 || text1.substring(text_length - length) ==
        text2.substring(0, length)) {
      best = length;
      length++;
    }
  }
};


/**
 * Do the two texts share a substring which is at least half the length of the
 * longer text?
 * This speedup can produce non-minimal diffs.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {Array.<string>} Five element Array, containing the prefix of
 *     text1, the suffix of text1, the prefix of text2, the suffix of
 *     text2 and the common middle.  Or null if there was no match.
 * @private
 */
diff_match_patch.prototype.diff_halfMatch_ = function(text1, text2) {
  if (this.Diff_Timeout <= 0) {
    // Don't risk returning a non-optimal diff if we have unlimited time.
    return null;
  }
  var longtext = text1.length > text2.length ? text1 : text2;
  var shorttext = text1.length > text2.length ? text2 : text1;
  if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
    return null;  // Pointless.
  }
  var dmp = this;  // 'this' becomes 'window' in a closure.

  /**
   * Does a substring of shorttext exist within longtext such that the substring
   * is at least half the length of longtext?
   * Closure, but does not reference any external variables.
   * @param {string} longtext Longer string.
   * @param {string} shorttext Shorter string.
   * @param {number} i Start index of quarter length substring within longtext.
   * @return {Array.<string>} Five element Array, containing the prefix of
   *     longtext, the suffix of longtext, the prefix of shorttext, the suffix
   *     of shorttext and the common middle.  Or null if there was no match.
   * @private
   */
  function diff_halfMatchI_(longtext, shorttext, i) {
    // Start with a 1/4 length substring at position i as a seed.
    var seed = longtext.substring(i, i + Math.floor(longtext.length / 4));
    var j = -1;
    var best_common = '';
    var best_longtext_a, best_longtext_b, best_shorttext_a, best_shorttext_b;
    while ((j = shorttext.indexOf(seed, j + 1)) != -1) {
      var prefixLength = dmp.diff_commonPrefix(longtext.substring(i),
                                               shorttext.substring(j));
      var suffixLength = dmp.diff_commonSuffix(longtext.substring(0, i),
                                               shorttext.substring(0, j));
      if (best_common.length < suffixLength + prefixLength) {
        best_common = shorttext.substring(j - suffixLength, j) +
            shorttext.substring(j, j + prefixLength);
        best_longtext_a = longtext.substring(0, i - suffixLength);
        best_longtext_b = longtext.substring(i + prefixLength);
        best_shorttext_a = shorttext.substring(0, j - suffixLength);
        best_shorttext_b = shorttext.substring(j + prefixLength);
      }
    }
    if (best_common.length * 2 >= longtext.length) {
      return [best_longtext_a, best_longtext_b,
              best_shorttext_a, best_shorttext_b, best_common];
    } else {
      return null;
    }
  }

  // First check if the second quarter is the seed for a half-match.
  var hm1 = diff_halfMatchI_(longtext, shorttext,
                             Math.ceil(longtext.length / 4));
  // Check again based on the third quarter.
  var hm2 = diff_halfMatchI_(longtext, shorttext,
                             Math.ceil(longtext.length / 2));
  var hm;
  if (!hm1 && !hm2) {
    return null;
  } else if (!hm2) {
    hm = hm1;
  } else if (!hm1) {
    hm = hm2;
  } else {
    // Both matched.  Select the longest.
    hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
  }

  // A half-match was found, sort out the return data.
  var text1_a, text1_b, text2_a, text2_b;
  if (text1.length > text2.length) {
    text1_a = hm[0];
    text1_b = hm[1];
    text2_a = hm[2];
    text2_b = hm[3];
  } else {
    text2_a = hm[0];
    text2_b = hm[1];
    text1_a = hm[2];
    text1_b = hm[3];
  }
  var mid_common = hm[4];
  return [text1_a, text1_b, text2_a, text2_b, mid_common];
};


/**
 * Reduce the number of edits by eliminating semantically trivial equalities.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupSemantic = function(diffs) {
  var changes = false;
  var equalities = [];  // Stack of indices where equalities are found.
  var equalitiesLength = 0;  // Keeping our own length var is faster in JS.
  /** @type {?string} */
  var lastequality = null;  // Always equal to equalities[equalitiesLength-1][1]
  var pointer = 0;  // Index of current position.
  // Number of characters that changed prior to the equality.
  var length_insertions1 = 0;
  var length_deletions1 = 0;
  // Number of characters that changed after the equality.
  var length_insertions2 = 0;
  var length_deletions2 = 0;
  while (pointer < diffs.length) {
    if (diffs[pointer][0] == DIFF_EQUAL) {  // Equality found.
      equalities[equalitiesLength++] = pointer;
      length_insertions1 = length_insertions2;
      length_deletions1 = length_deletions2;
      length_insertions2 = 0;
      length_deletions2 = 0;
      lastequality = /** @type {string} */(diffs[pointer][1]);
    } else {  // An insertion or deletion.
      if (diffs[pointer][0] == DIFF_INSERT) {
        length_insertions2 += diffs[pointer][1].length;
      } else {
        length_deletions2 += diffs[pointer][1].length;
      }
      // Eliminate an equality that is smaller or equal to the edits on both
      // sides of it.
      if (lastequality !== null && (lastequality.length <=
          Math.max(length_insertions1, length_deletions1)) &&
          (lastequality.length <= Math.max(length_insertions2,
                                           length_deletions2))) {
        // Duplicate record.
        diffs.splice(equalities[equalitiesLength - 1], 0,
                     [DIFF_DELETE, lastequality]);
        // Change second copy to insert.
        diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
        // Throw away the equality we just deleted.
        equalitiesLength--;
        // Throw away the previous equality (it needs to be reevaluated).
        equalitiesLength--;
        pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
        length_insertions1 = 0;  // Reset the counters.
        length_deletions1 = 0;
        length_insertions2 = 0;
        length_deletions2 = 0;
        lastequality = null;
        changes = true;
      }
    }
    pointer++;
  }

  // Normalize the diff.
  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
  this.diff_cleanupSemanticLossless(diffs);

  // Find any overlaps between deletions and insertions.
  // e.g: <del>abcxxx</del><ins>xxxdef</ins>
  //   -> <del>abc</del>xxx<ins>def</ins>
  // Only extract an overlap if it is as big as the edit ahead or behind it.
  pointer = 1;
  while (pointer < diffs.length) {
    if (diffs[pointer - 1][0] == DIFF_DELETE &&
        diffs[pointer][0] == DIFF_INSERT) {
      var deletion = /** @type {string} */(diffs[pointer - 1][1]);
      var insertion = /** @type {string} */(diffs[pointer][1]);
      var overlap_length = this.diff_commonOverlap_(deletion, insertion);
      if (overlap_length >= deletion.length / 2 ||
          overlap_length >= insertion.length / 2) {
        // Overlap found.  Insert an equality and trim the surrounding edits.
        diffs.splice(pointer, 0,
            [DIFF_EQUAL, insertion.substring(0, overlap_length)]);
        diffs[pointer - 1][1] =
            deletion.substring(0, deletion.length - overlap_length);
        diffs[pointer + 1][1] = insertion.substring(overlap_length);
        pointer++;
      }
      pointer++;
    }
    pointer++;
  }
};


/**
 * Look for single edits surrounded on both sides by equalities
 * which can be shifted sideways to align the edit to a word boundary.
 * e.g: The c<ins>at c</ins>ame. -> The <ins>cat </ins>came.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupSemanticLossless = function(diffs) {
  // Define some regex patterns for matching boundaries.
  var punctuation = /[^a-zA-Z0-9]/;
  var whitespace = /\s/;
  var linebreak = /[\r\n]/;
  var blanklineEnd = /\n\r?\n$/;
  var blanklineStart = /^\r?\n\r?\n/;

  /**
   * Given two strings, compute a score representing whether the internal
   * boundary falls on logical boundaries.
   * Scores range from 5 (best) to 0 (worst).
   * Closure, makes reference to regex patterns defined above.
   * @param {string} one First string.
   * @param {string} two Second string.
   * @return {number} The score.
   * @private
   */
  function diff_cleanupSemanticScore_(one, two) {
    if (!one || !two) {
      // Edges are the best.
      return 5;
    }

    // Each port of this function behaves slightly differently due to
    // subtle differences in each language's definition of things like
    // 'whitespace'.  Since this function's purpose is largely cosmetic,
    // the choice has been made to use each language's native features
    // rather than force total conformity.
    var score = 0;
    // One point for non-alphanumeric.
    if (one.charAt(one.length - 1).match(punctuation) ||
        two.charAt(0).match(punctuation)) {
      score++;
      // Two points for whitespace.
      if (one.charAt(one.length - 1).match(whitespace) ||
          two.charAt(0).match(whitespace)) {
        score++;
        // Three points for line breaks.
        if (one.charAt(one.length - 1).match(linebreak) ||
            two.charAt(0).match(linebreak)) {
          score++;
          // Four points for blank lines.
          if (one.match(blanklineEnd) || two.match(blanklineStart)) {
            score++;
          }
        }
      }
    }
    return score;
  }

  var pointer = 1;
  // Intentionally ignore the first and last element (don't need checking).
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] == DIFF_EQUAL &&
        diffs[pointer + 1][0] == DIFF_EQUAL) {
      // This is a single edit surrounded by equalities.
      var equality1 = /** @type {string} */(diffs[pointer - 1][1]);
      var edit = /** @type {string} */(diffs[pointer][1]);
      var equality2 = /** @type {string} */(diffs[pointer + 1][1]);

      // First, shift the edit as far left as possible.
      var commonOffset = this.diff_commonSuffix(equality1, edit);
      if (commonOffset) {
        var commonString = edit.substring(edit.length - commonOffset);
        equality1 = equality1.substring(0, equality1.length - commonOffset);
        edit = commonString + edit.substring(0, edit.length - commonOffset);
        equality2 = commonString + equality2;
      }

      // Second, step character by character right, looking for the best fit.
      var bestEquality1 = equality1;
      var bestEdit = edit;
      var bestEquality2 = equality2;
      var bestScore = diff_cleanupSemanticScore_(equality1, edit) +
          diff_cleanupSemanticScore_(edit, equality2);
      while (edit.charAt(0) === equality2.charAt(0)) {
        equality1 += edit.charAt(0);
        edit = edit.substring(1) + equality2.charAt(0);
        equality2 = equality2.substring(1);
        var score = diff_cleanupSemanticScore_(equality1, edit) +
            diff_cleanupSemanticScore_(edit, equality2);
        // The >= encourages trailing rather than leading whitespace on edits.
        if (score >= bestScore) {
          bestScore = score;
          bestEquality1 = equality1;
          bestEdit = edit;
          bestEquality2 = equality2;
        }
      }

      if (diffs[pointer - 1][1] != bestEquality1) {
        // We have an improvement, save it back to the diff.
        if (bestEquality1) {
          diffs[pointer - 1][1] = bestEquality1;
        } else {
          diffs.splice(pointer - 1, 1);
          pointer--;
        }
        diffs[pointer][1] = bestEdit;
        if (bestEquality2) {
          diffs[pointer + 1][1] = bestEquality2;
        } else {
          diffs.splice(pointer + 1, 1);
          pointer--;
        }
      }
    }
    pointer++;
  }
};


/**
 * Reduce the number of edits by eliminating operationally trivial equalities.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupEfficiency = function(diffs) {
  var changes = false;
  var equalities = [];  // Stack of indices where equalities are found.
  var equalitiesLength = 0;  // Keeping our own length var is faster in JS.
  var lastequality = '';  // Always equal to equalities[equalitiesLength-1][1]
  var pointer = 0;  // Index of current position.
  // Is there an insertion operation before the last equality.
  var pre_ins = false;
  // Is there a deletion operation before the last equality.
  var pre_del = false;
  // Is there an insertion operation after the last equality.
  var post_ins = false;
  // Is there a deletion operation after the last equality.
  var post_del = false;
  while (pointer < diffs.length) {
    if (diffs[pointer][0] == DIFF_EQUAL) {  // Equality found.
      if (diffs[pointer][1].length < this.Diff_EditCost &&
          (post_ins || post_del)) {
        // Candidate found.
        equalities[equalitiesLength++] = pointer;
        pre_ins = post_ins;
        pre_del = post_del;
        lastequality = diffs[pointer][1];
      } else {
        // Not a candidate, and can never become one.
        equalitiesLength = 0;
        lastequality = '';
      }
      post_ins = post_del = false;
    } else {  // An insertion or deletion.
      if (diffs[pointer][0] == DIFF_DELETE) {
        post_del = true;
      } else {
        post_ins = true;
      }
      /*
       * Five types to be split:
       * <ins>A</ins><del>B</del>XY<ins>C</ins><del>D</del>
       * <ins>A</ins>X<ins>C</ins><del>D</del>
       * <ins>A</ins><del>B</del>X<ins>C</ins>
       * <ins>A</del>X<ins>C</ins><del>D</del>
       * <ins>A</ins><del>B</del>X<del>C</del>
       */
      if (lastequality && ((pre_ins && pre_del && post_ins && post_del) ||
                           ((lastequality.length < this.Diff_EditCost / 2) &&
                            (pre_ins + pre_del + post_ins + post_del) == 3))) {
        // Duplicate record.
        diffs.splice(equalities[equalitiesLength - 1], 0,
                     [DIFF_DELETE, lastequality]);
        // Change second copy to insert.
        diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
        equalitiesLength--;  // Throw away the equality we just deleted;
        lastequality = '';
        if (pre_ins && pre_del) {
          // No changes made which could affect previous entry, keep going.
          post_ins = post_del = true;
          equalitiesLength = 0;
        } else {
          equalitiesLength--;  // Throw away the previous equality.
          pointer = equalitiesLength > 0 ?
              equalities[equalitiesLength - 1] : -1;
          post_ins = post_del = false;
        }
        changes = true;
      }
    }
    pointer++;
  }

  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
};


/**
 * Reorder and merge like edit sections.  Merge equalities.
 * Any edit section can move as long as it doesn't cross an equality.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupMerge = function(diffs) {
  diffs.push([DIFF_EQUAL, '']);  // Add a dummy entry at the end.
  var pointer = 0;
  var count_delete = 0;
  var count_insert = 0;
  var text_delete = '';
  var text_insert = '';
  var commonlength;
  while (pointer < diffs.length) {
    switch (diffs[pointer][0]) {
      case DIFF_INSERT:
        count_insert++;
        text_insert += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_DELETE:
        count_delete++;
        text_delete += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_EQUAL:
        // Upon reaching an equality, check for prior redundancies.
        if (count_delete + count_insert > 1) {
          if (count_delete !== 0 && count_insert !== 0) {
            // Factor out any common prefixies.
            commonlength = this.diff_commonPrefix(text_insert, text_delete);
            if (commonlength !== 0) {
              if ((pointer - count_delete - count_insert) > 0 &&
                  diffs[pointer - count_delete - count_insert - 1][0] ==
                  DIFF_EQUAL) {
                diffs[pointer - count_delete - count_insert - 1][1] +=
                    text_insert.substring(0, commonlength);
              } else {
                diffs.splice(0, 0, [DIFF_EQUAL,
                                    text_insert.substring(0, commonlength)]);
                pointer++;
              }
              text_insert = text_insert.substring(commonlength);
              text_delete = text_delete.substring(commonlength);
            }
            // Factor out any common suffixies.
            commonlength = this.diff_commonSuffix(text_insert, text_delete);
            if (commonlength !== 0) {
              diffs[pointer][1] = text_insert.substring(text_insert.length -
                  commonlength) + diffs[pointer][1];
              text_insert = text_insert.substring(0, text_insert.length -
                  commonlength);
              text_delete = text_delete.substring(0, text_delete.length -
                  commonlength);
            }
          }
          // Delete the offending records and add the merged ones.
          if (count_delete === 0) {
            diffs.splice(pointer - count_delete - count_insert,
                count_delete + count_insert, [DIFF_INSERT, text_insert]);
          } else if (count_insert === 0) {
            diffs.splice(pointer - count_delete - count_insert,
                count_delete + count_insert, [DIFF_DELETE, text_delete]);
          } else {
            diffs.splice(pointer - count_delete - count_insert,
                count_delete + count_insert, [DIFF_DELETE, text_delete],
                [DIFF_INSERT, text_insert]);
          }
          pointer = pointer - count_delete - count_insert +
                    (count_delete ? 1 : 0) + (count_insert ? 1 : 0) + 1;
        } else if (pointer !== 0 && diffs[pointer - 1][0] == DIFF_EQUAL) {
          // Merge this equality with the previous one.
          diffs[pointer - 1][1] += diffs[pointer][1];
          diffs.splice(pointer, 1);
        } else {
          pointer++;
        }
        count_insert = 0;
        count_delete = 0;
        text_delete = '';
        text_insert = '';
        break;
    }
  }
  if (diffs[diffs.length - 1][1] === '') {
    diffs.pop();  // Remove the dummy entry at the end.
  }

  // Second pass: look for single edits surrounded on both sides by equalities
  // which can be shifted sideways to eliminate an equality.
  // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
  var changes = false;
  pointer = 1;
  // Intentionally ignore the first and last element (don't need checking).
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] == DIFF_EQUAL &&
        diffs[pointer + 1][0] == DIFF_EQUAL) {
      // This is a single edit surrounded by equalities.
      if (diffs[pointer][1].substring(diffs[pointer][1].length -
          diffs[pointer - 1][1].length) == diffs[pointer - 1][1]) {
        // Shift the edit over the previous equality.
        diffs[pointer][1] = diffs[pointer - 1][1] +
            diffs[pointer][1].substring(0, diffs[pointer][1].length -
                                        diffs[pointer - 1][1].length);
        diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1];
        diffs.splice(pointer - 1, 1);
        changes = true;
      } else if (diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) ==
          diffs[pointer + 1][1]) {
        // Shift the edit over the next equality.
        diffs[pointer - 1][1] += diffs[pointer + 1][1];
        diffs[pointer][1] =
            diffs[pointer][1].substring(diffs[pointer + 1][1].length) +
            diffs[pointer + 1][1];
        diffs.splice(pointer + 1, 1);
        changes = true;
      }
    }
    pointer++;
  }
  // If shifts were made, the diff needs reordering and another shift sweep.
  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
};


/**
 * loc is a location in text1, compute and return the equivalent location in
 * text2.
 * e.g. 'The cat' vs 'The big cat', 1->1, 5->8
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @param {number} loc Location within text1.
 * @return {number} Location within text2.
 */
diff_match_patch.prototype.diff_xIndex = function(diffs, loc) {
  var chars1 = 0;
  var chars2 = 0;
  var last_chars1 = 0;
  var last_chars2 = 0;
  var x;
  for (x = 0; x < diffs.length; x++) {
    if (diffs[x][0] !== DIFF_INSERT) {  // Equality or deletion.
      chars1 += diffs[x][1].length;
    }
    if (diffs[x][0] !== DIFF_DELETE) {  // Equality or insertion.
      chars2 += diffs[x][1].length;
    }
    if (chars1 > loc) {  // Overshot the location.
      break;
    }
    last_chars1 = chars1;
    last_chars2 = chars2;
  }
  // Was the location was deleted?
  if (diffs.length != x && diffs[x][0] === DIFF_DELETE) {
    return last_chars2;
  }
  // Add the remaining character length.
  return last_chars2 + (loc - last_chars1);
};


/**
 * Convert a diff array into a pretty HTML report.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} HTML representation.
 */
diff_match_patch.prototype.diff_prettyHtml = function(diffs) {
  var html = [];
  var i = 0;
  var pattern_amp = /&/g;
  var pattern_lt = /</g;
  var pattern_gt = />/g;
  var pattern_para = /\n/g;
  for (var x = 0; x < diffs.length; x++) {
    var op = diffs[x][0];    // Operation (insert, delete, equal)
    var data = diffs[x][1];  // Text of change.
    var text = data.replace(pattern_amp, '&amp;').replace(pattern_lt, '&lt;')
        .replace(pattern_gt, '&gt;').replace(pattern_para, '&para;<br>');
    switch (op) {
      case DIFF_INSERT:
        html[x] = '<ins style="background:#e6ffe6;">' + text + '</ins>';
        break;
      case DIFF_DELETE:
        html[x] = '<del style="background:#ffe6e6;">' + text + '</del>';
        break;
      case DIFF_EQUAL:
        html[x] = '<span>' + text + '</span>';
        break;
    }
    if (op !== DIFF_DELETE) {
      i += data.length;
    }
  }
  return html.join('');
};


/**
 * Compute and return the source text (all equalities and deletions).
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} Source text.
 */
diff_match_patch.prototype.diff_text1 = function(diffs) {
  var text = [];
  for (var x = 0; x < diffs.length; x++) {
    if (diffs[x][0] !== DIFF_INSERT) {
      text[x] = diffs[x][1];
    }
  }
  return text.join('');
};


/**
 * Compute and return the destination text (all equalities and insertions).
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} Destination text.
 */
diff_match_patch.prototype.diff_text2 = function(diffs) {
  var text = [];
  for (var x = 0; x < diffs.length; x++) {
    if (diffs[x][0] !== DIFF_DELETE) {
      text[x] = diffs[x][1];
    }
  }
  return text.join('');
};


/**
 * Compute the Levenshtein distance; the number of inserted, deleted or
 * substituted characters.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {number} Number of changes.
 */
diff_match_patch.prototype.diff_levenshtein = function(diffs) {
  var levenshtein = 0;
  var insertions = 0;
  var deletions = 0;
  for (var x = 0; x < diffs.length; x++) {
    var op = diffs[x][0];
    var data = diffs[x][1];
    switch (op) {
      case DIFF_INSERT:
        insertions += data.length;
        break;
      case DIFF_DELETE:
        deletions += data.length;
        break;
      case DIFF_EQUAL:
        // A deletion and an insertion is one substitution.
        levenshtein += Math.max(insertions, deletions);
        insertions = 0;
        deletions = 0;
        break;
    }
  }
  levenshtein += Math.max(insertions, deletions);
  return levenshtein;
};


/**
 * Crush the diff into an encoded string which describes the operations
 * required to transform text1 into text2.
 * E.g. =3\t-2\t+ing  -> Keep 3 chars, delete 2 chars, insert 'ing'.
 * Operations are tab-separated.  Inserted text is escaped using %xx notation.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} Delta text.
 */
diff_match_patch.prototype.diff_toDelta = function(diffs) {
  var text = [];
  for (var x = 0; x < diffs.length; x++) {
    switch (diffs[x][0]) {
      case DIFF_INSERT:
        text[x] = '+' + encodeURI(diffs[x][1]);
        break;
      case DIFF_DELETE:
        text[x] = '-' + diffs[x][1].length;
        break;
      case DIFF_EQUAL:
        text[x] = '=' + diffs[x][1].length;
        break;
    }
  }
  return text.join('\t').replace(/%20/g, ' ');
};


/**
 * Given the original text1, and an encoded string which describes the
 * operations required to transform text1 into text2, compute the full diff.
 * @param {string} text1 Source string for the diff.
 * @param {string} delta Delta text.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @throws {!Error} If invalid input.
 */
diff_match_patch.prototype.diff_fromDelta = function(text1, delta) {
  var diffs = [];
  var diffsLength = 0;  // Keeping our own length var is faster in JS.
  var pointer = 0;  // Cursor in text1
  var tokens = delta.split(/\t/g);
  for (var x = 0; x < tokens.length; x++) {
    // Each token begins with a one character parameter which specifies the
    // operation of this token (delete, insert, equality).
    var param = tokens[x].substring(1);
    switch (tokens[x].charAt(0)) {
      case '+':
        try {
          diffs[diffsLength++] = [DIFF_INSERT, decodeURI(param)];
        } catch (ex) {
          // Malformed URI sequence.
          throw new Error('Illegal escape in diff_fromDelta: ' + param);
        }
        break;
      case '-':
        // Fall through.
      case '=':
        var n = parseInt(param, 10);
        if (isNaN(n) || n < 0) {
          throw new Error('Invalid number in diff_fromDelta: ' + param);
        }
        var text = text1.substring(pointer, pointer += n);
        if (tokens[x].charAt(0) == '=') {
          diffs[diffsLength++] = [DIFF_EQUAL, text];
        } else {
          diffs[diffsLength++] = [DIFF_DELETE, text];
        }
        break;
      default:
        // Blank tokens are ok (from a trailing \t).
        // Anything else is an error.
        if (tokens[x]) {
          throw new Error('Invalid diff operation in diff_fromDelta: ' +
                          tokens[x]);
        }
    }
  }
  if (pointer != text1.length) {
    throw new Error('Delta length (' + pointer +
        ') does not equal source text length (' + text1.length + ').');
  }
  return diffs;
};


//  MATCH FUNCTIONS


/**
 * Locate the best instance of 'pattern' in 'text' near 'loc'.
 * @param {string} text The text to search.
 * @param {string} pattern The pattern to search for.
 * @param {number} loc The location to search around.
 * @return {number} Best match index or -1.
 */
diff_match_patch.prototype.match_main = function(text, pattern, loc) {
  // Check for null inputs.
  if (text == null || pattern == null || loc == null) {
    throw new Error('Null input. (match_main)');
  }

  loc = Math.max(0, Math.min(loc, text.length));
  if (text == pattern) {
    // Shortcut (potentially not guaranteed by the algorithm)
    return 0;
  } else if (!text.length) {
    // Nothing to match.
    return -1;
  } else if (text.substring(loc, loc + pattern.length) == pattern) {
    // Perfect match at the perfect spot!  (Includes case of null pattern)
    return loc;
  } else {
    // Do a fuzzy compare.
    return this.match_bitap_(text, pattern, loc);
  }
};


/**
 * Locate the best instance of 'pattern' in 'text' near 'loc' using the
 * Bitap algorithm.
 * @param {string} text The text to search.
 * @param {string} pattern The pattern to search for.
 * @param {number} loc The location to search around.
 * @return {number} Best match index or -1.
 * @private
 */
diff_match_patch.prototype.match_bitap_ = function(text, pattern, loc) {
  if (pattern.length > this.Match_MaxBits) {
    throw new Error('Pattern too long for this browser.');
  }

  // Initialise the alphabet.
  var s = this.match_alphabet_(pattern);

  var dmp = this;  // 'this' becomes 'window' in a closure.

  /**
   * Compute and return the score for a match with e errors and x location.
   * Accesses loc and pattern through being a closure.
   * @param {number} e Number of errors in match.
   * @param {number} x Location of match.
   * @return {number} Overall score for match (0.0 = good, 1.0 = bad).
   * @private
   */
  function match_bitapScore_(e, x) {
    var accuracy = e / pattern.length;
    var proximity = Math.abs(loc - x);
    if (!dmp.Match_Distance) {
      // Dodge divide by zero error.
      return proximity ? 1.0 : accuracy;
    }
    return accuracy + (proximity / dmp.Match_Distance);
  }

  // Highest score beyond which we give up.
  var score_threshold = this.Match_Threshold;
  // Is there a nearby exact match? (speedup)
  var best_loc = text.indexOf(pattern, loc);
  if (best_loc != -1) {
    score_threshold = Math.min(match_bitapScore_(0, best_loc), score_threshold);
    // What about in the other direction? (speedup)
    best_loc = text.lastIndexOf(pattern, loc + pattern.length);
    if (best_loc != -1) {
      score_threshold =
          Math.min(match_bitapScore_(0, best_loc), score_threshold);
    }
  }

  // Initialise the bit arrays.
  var matchmask = 1 << (pattern.length - 1);
  best_loc = -1;

  var bin_min, bin_mid;
  var bin_max = pattern.length + text.length;
  var last_rd;
  for (var d = 0; d < pattern.length; d++) {
    // Scan for the best match; each iteration allows for one more error.
    // Run a binary search to determine how far from 'loc' we can stray at this
    // error level.
    bin_min = 0;
    bin_mid = bin_max;
    while (bin_min < bin_mid) {
      if (match_bitapScore_(d, loc + bin_mid) <= score_threshold) {
        bin_min = bin_mid;
      } else {
        bin_max = bin_mid;
      }
      bin_mid = Math.floor((bin_max - bin_min) / 2 + bin_min);
    }
    // Use the result from this iteration as the maximum for the next.
    bin_max = bin_mid;
    var start = Math.max(1, loc - bin_mid + 1);
    var finish = Math.min(loc + bin_mid, text.length) + pattern.length;

    var rd = Array(finish + 2);
    rd[finish + 1] = (1 << d) - 1;
    for (var j = finish; j >= start; j--) {
      // The alphabet (s) is a sparse hash, so the following line generates
      // warnings.
      var charMatch = s[text.charAt(j - 1)];
      if (d === 0) {  // First pass: exact match.
        rd[j] = ((rd[j + 1] << 1) | 1) & charMatch;
      } else {  // Subsequent passes: fuzzy match.
        rd[j] = ((rd[j + 1] << 1) | 1) & charMatch |
                (((last_rd[j + 1] | last_rd[j]) << 1) | 1) |
                last_rd[j + 1];
      }
      if (rd[j] & matchmask) {
        var score = match_bitapScore_(d, j - 1);
        // This match will almost certainly be better than any existing match.
        // But check anyway.
        if (score <= score_threshold) {
          // Told you so.
          score_threshold = score;
          best_loc = j - 1;
          if (best_loc > loc) {
            // When passing loc, don't exceed our current distance from loc.
            start = Math.max(1, 2 * loc - best_loc);
          } else {
            // Already passed loc, downhill from here on in.
            break;
          }
        }
      }
    }
    // No hope for a (better) match at greater error levels.
    if (match_bitapScore_(d + 1, loc) > score_threshold) {
      break;
    }
    last_rd = rd;
  }
  return best_loc;
};


/**
 * Initialise the alphabet for the Bitap algorithm.
 * @param {string} pattern The text to encode.
 * @return {!Object} Hash of character locations.
 * @private
 */
diff_match_patch.prototype.match_alphabet_ = function(pattern) {
  var s = {};
  for (var i = 0; i < pattern.length; i++) {
    s[pattern.charAt(i)] = 0;
  }
  for (var i = 0; i < pattern.length; i++) {
    s[pattern.charAt(i)] |= 1 << (pattern.length - i - 1);
  }
  return s;
};


//  PATCH FUNCTIONS


/**
 * Increase the context until it is unique,
 * but don't let the pattern expand beyond Match_MaxBits.
 * @param {!diff_match_patch.patch_obj} patch The patch to grow.
 * @param {string} text Source text.
 * @private
 */
diff_match_patch.prototype.patch_addContext_ = function(patch, text) {
  if (text.length == 0) {
    return;
  }
  var pattern = text.substring(patch.start2, patch.start2 + patch.length1);
  var padding = 0;

  // Look for the first and last matches of pattern in text.  If two different
  // matches are found, increase the pattern length.
  while (text.indexOf(pattern) != text.lastIndexOf(pattern) &&
         pattern.length < this.Match_MaxBits - this.Patch_Margin -
         this.Patch_Margin) {
    padding += this.Patch_Margin;
    pattern = text.substring(patch.start2 - padding,
                             patch.start2 + patch.length1 + padding);
  }
  // Add one chunk for good luck.
  padding += this.Patch_Margin;

  // Add the prefix.
  var prefix = text.substring(patch.start2 - padding, patch.start2);
  if (prefix) {
    patch.diffs.unshift([DIFF_EQUAL, prefix]);
  }
  // Add the suffix.
  var suffix = text.substring(patch.start2 + patch.length1,
                              patch.start2 + patch.length1 + padding);
  if (suffix) {
    patch.diffs.push([DIFF_EQUAL, suffix]);
  }

  // Roll back the start points.
  patch.start1 -= prefix.length;
  patch.start2 -= prefix.length;
  // Extend the lengths.
  patch.length1 += prefix.length + suffix.length;
  patch.length2 += prefix.length + suffix.length;
};


/**
 * Compute a list of patches to turn text1 into text2.
 * Use diffs if provided, otherwise compute it ourselves.
 * There are four ways to call this function, depending on what data is
 * available to the caller:
 * Method 1:
 * a = text1, b = text2
 * Method 2:
 * a = diffs
 * Method 3 (optimal):
 * a = text1, b = diffs
 * Method 4 (deprecated, use method 3):
 * a = text1, b = text2, c = diffs
 *
 * @param {string|!Array.<!diff_match_patch.Diff>} a text1 (methods 1,3,4) or
 * Array of diff tuples for text1 to text2 (method 2).
 * @param {string|!Array.<!diff_match_patch.Diff>} opt_b text2 (methods 1,4) or
 * Array of diff tuples for text1 to text2 (method 3) or undefined (method 2).
 * @param {string|!Array.<!diff_match_patch.Diff>} opt_c Array of diff tuples
 * for text1 to text2 (method 4) or undefined (methods 1,2,3).
 * @return {!Array.<!diff_match_patch.patch_obj>} Array of patch objects.
 */
diff_match_patch.prototype.patch_make = function(a, opt_b, opt_c) {
  var text1, diffs;
  if (typeof a == 'string' && typeof opt_b == 'string' &&
      typeof opt_c == 'undefined') {
    // Method 1: text1, text2
    // Compute diffs from text1 and text2.
    text1 = /** @type {string} */(a);
    diffs = this.diff_main(text1, /** @type {string} */(opt_b), true);
    if (diffs.length > 2) {
      this.diff_cleanupSemantic(diffs);
      this.diff_cleanupEfficiency(diffs);
    }
  } else if (a && typeof a == 'object' && typeof opt_b == 'undefined' &&
      typeof opt_c == 'undefined') {
    // Method 2: diffs
    // Compute text1 from diffs.
    diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(a);
    text1 = this.diff_text1(diffs);
  } else if (typeof a == 'string' && opt_b && typeof opt_b == 'object' &&
      typeof opt_c == 'undefined') {
    // Method 3: text1, diffs
    text1 = /** @type {string} */(a);
    diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(opt_b);
  } else if (typeof a == 'string' && typeof opt_b == 'string' &&
      opt_c && typeof opt_c == 'object') {
    // Method 4: text1, text2, diffs
    // text2 is not used.
    text1 = /** @type {string} */(a);
    diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(opt_c);
  } else {
    throw new Error('Unknown call format to patch_make.');
  }

  if (diffs.length === 0) {
    return [];  // Get rid of the null case.
  }
  var patches = [];
  var patch = new diff_match_patch.patch_obj();
  var patchDiffLength = 0;  // Keeping our own length var is faster in JS.
  var char_count1 = 0;  // Number of characters into the text1 string.
  var char_count2 = 0;  // Number of characters into the text2 string.
  // Start with text1 (prepatch_text) and apply the diffs until we arrive at
  // text2 (postpatch_text).  We recreate the patches one by one to determine
  // context info.
  var prepatch_text = text1;
  var postpatch_text = text1;
  for (var x = 0; x < diffs.length; x++) {
    var diff_type = diffs[x][0];
    var diff_text = diffs[x][1];

    if (!patchDiffLength && diff_type !== DIFF_EQUAL) {
      // A new patch starts here.
      patch.start1 = char_count1;
      patch.start2 = char_count2;
    }

    switch (diff_type) {
      case DIFF_INSERT:
        patch.diffs[patchDiffLength++] = diffs[x];
        patch.length2 += diff_text.length;
        postpatch_text = postpatch_text.substring(0, char_count2) + diff_text +
                         postpatch_text.substring(char_count2);
        break;
      case DIFF_DELETE:
        patch.length1 += diff_text.length;
        patch.diffs[patchDiffLength++] = diffs[x];
        postpatch_text = postpatch_text.substring(0, char_count2) +
                         postpatch_text.substring(char_count2 +
                             diff_text.length);
        break;
      case DIFF_EQUAL:
        if (diff_text.length <= 2 * this.Patch_Margin &&
            patchDiffLength && diffs.length != x + 1) {
          // Small equality inside a patch.
          patch.diffs[patchDiffLength++] = diffs[x];
          patch.length1 += diff_text.length;
          patch.length2 += diff_text.length;
        } else if (diff_text.length >= 2 * this.Patch_Margin) {
          // Time for a new patch.
          if (patchDiffLength) {
            this.patch_addContext_(patch, prepatch_text);
            patches.push(patch);
            patch = new diff_match_patch.patch_obj();
            patchDiffLength = 0;
            // Unlike Unidiff, our patch lists have a rolling context.
            // http://code.google.com/p/google-diff-match-patch/wiki/Unidiff
            // Update prepatch text & pos to reflect the application of the
            // just completed patch.
            prepatch_text = postpatch_text;
            char_count1 = char_count2;
          }
        }
        break;
    }

    // Update the current character count.
    if (diff_type !== DIFF_INSERT) {
      char_count1 += diff_text.length;
    }
    if (diff_type !== DIFF_DELETE) {
      char_count2 += diff_text.length;
    }
  }
  // Pick up the leftover patch if not empty.
  if (patchDiffLength) {
    this.patch_addContext_(patch, prepatch_text);
    patches.push(patch);
  }

  return patches;
};


/**
 * Given an array of patches, return another array that is identical.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of patch objects.
 * @return {!Array.<!diff_match_patch.patch_obj>} Array of patch objects.
 */
diff_match_patch.prototype.patch_deepCopy = function(patches) {
  // Making deep copies is hard in JavaScript.
  var patchesCopy = [];
  for (var x = 0; x < patches.length; x++) {
    var patch = patches[x];
    var patchCopy = new diff_match_patch.patch_obj();
    patchCopy.diffs = [];
    for (var y = 0; y < patch.diffs.length; y++) {
      patchCopy.diffs[y] = patch.diffs[y].slice();
    }
    patchCopy.start1 = patch.start1;
    patchCopy.start2 = patch.start2;
    patchCopy.length1 = patch.length1;
    patchCopy.length2 = patch.length2;
    patchesCopy[x] = patchCopy;
  }
  return patchesCopy;
};


/**
 * Merge a set of patches onto the text.  Return a patched text, as well
 * as a list of true/false values indicating which patches were applied.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of patch objects.
 * @param {string} text Old text.
 * @return {!Array.<string|!Array.<boolean>>} Two element Array, containing the
 *      new text and an array of boolean values.
 */
diff_match_patch.prototype.patch_apply = function(patches, text) {
  if (patches.length == 0) {
    return [text, []];
  }

  // Deep copy the patches so that no changes are made to originals.
  patches = this.patch_deepCopy(patches);

  var nullPadding = this.patch_addPadding(patches);
  text = nullPadding + text + nullPadding;

  this.patch_splitMax(patches);
  // delta keeps track of the offset between the expected and actual location
  // of the previous patch.  If there are patches expected at positions 10 and
  // 20, but the first patch was found at 12, delta is 2 and the second patch
  // has an effective expected position of 22.
  var delta = 0;
  var results = [];
  for (var x = 0; x < patches.length; x++) {
    var expected_loc = patches[x].start2 + delta;
    var text1 = this.diff_text1(patches[x].diffs);
    var start_loc;
    var end_loc = -1;
    if (text1.length > this.Match_MaxBits) {
      // patch_splitMax will only provide an oversized pattern in the case of
      // a monster delete.
      start_loc = this.match_main(text, text1.substring(0, this.Match_MaxBits),
                                  expected_loc);
      if (start_loc != -1) {
        end_loc = this.match_main(text,
            text1.substring(text1.length - this.Match_MaxBits),
            expected_loc + text1.length - this.Match_MaxBits);
        if (end_loc == -1 || start_loc >= end_loc) {
          // Can't find valid trailing context.  Drop this patch.
          start_loc = -1;
        }
      }
    } else {
      start_loc = this.match_main(text, text1, expected_loc);
    }
    if (start_loc == -1) {
      // No match found.  :(
      results[x] = false;
      // Subtract the delta for this failed patch from subsequent patches.
      delta -= patches[x].length2 - patches[x].length1;
    } else {
      // Found a match.  :)
      results[x] = true;
      delta = start_loc - expected_loc;
      var text2;
      if (end_loc == -1) {
        text2 = text.substring(start_loc, start_loc + text1.length);
      } else {
        text2 = text.substring(start_loc, end_loc + this.Match_MaxBits);
      }
      if (text1 == text2) {
        // Perfect match, just shove the replacement text in.
        text = text.substring(0, start_loc) +
               this.diff_text2(patches[x].diffs) +
               text.substring(start_loc + text1.length);
      } else {
        // Imperfect match.  Run a diff to get a framework of equivalent
        // indices.
        var diffs = this.diff_main(text1, text2, false);
        if (text1.length > this.Match_MaxBits &&
            this.diff_levenshtein(diffs) / text1.length >
            this.Patch_DeleteThreshold) {
          // The end points match, but the content is unacceptably bad.
          results[x] = false;
        } else {
          this.diff_cleanupSemanticLossless(diffs);
          var index1 = 0;
          var index2;
          for (var y = 0; y < patches[x].diffs.length; y++) {
            var mod = patches[x].diffs[y];
            if (mod[0] !== DIFF_EQUAL) {
              index2 = this.diff_xIndex(diffs, index1);
            }
            if (mod[0] === DIFF_INSERT) {  // Insertion
              text = text.substring(0, start_loc + index2) + mod[1] +
                     text.substring(start_loc + index2);
            } else if (mod[0] === DIFF_DELETE) {  // Deletion
              text = text.substring(0, start_loc + index2) +
                     text.substring(start_loc + this.diff_xIndex(diffs,
                         index1 + mod[1].length));
            }
            if (mod[0] !== DIFF_DELETE) {
              index1 += mod[1].length;
            }
          }
        }
      }
    }
  }
  // Strip the padding off.
  text = text.substring(nullPadding.length, text.length - nullPadding.length);
  return [text, results];
};


/**
 * Add some padding on text start and end so that edges can match something.
 * Intended to be called only from within patch_apply.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of patch objects.
 * @return {string} The padding string added to each side.
 */
diff_match_patch.prototype.patch_addPadding = function(patches) {
  var paddingLength = this.Patch_Margin;
  var nullPadding = '';
  for (var x = 1; x <= paddingLength; x++) {
    nullPadding += String.fromCharCode(x);
  }

  // Bump all the patches forward.
  for (var x = 0; x < patches.length; x++) {
    patches[x].start1 += paddingLength;
    patches[x].start2 += paddingLength;
  }

  // Add some padding on start of first diff.
  var patch = patches[0];
  var diffs = patch.diffs;
  if (diffs.length == 0 || diffs[0][0] != DIFF_EQUAL) {
    // Add nullPadding equality.
    diffs.unshift([DIFF_EQUAL, nullPadding]);
    patch.start1 -= paddingLength;  // Should be 0.
    patch.start2 -= paddingLength;  // Should be 0.
    patch.length1 += paddingLength;
    patch.length2 += paddingLength;
  } else if (paddingLength > diffs[0][1].length) {
    // Grow first equality.
    var extraLength = paddingLength - diffs[0][1].length;
    diffs[0][1] = nullPadding.substring(diffs[0][1].length) + diffs[0][1];
    patch.start1 -= extraLength;
    patch.start2 -= extraLength;
    patch.length1 += extraLength;
    patch.length2 += extraLength;
  }

  // Add some padding on end of last diff.
  patch = patches[patches.length - 1];
  diffs = patch.diffs;
  if (diffs.length == 0 || diffs[diffs.length - 1][0] != DIFF_EQUAL) {
    // Add nullPadding equality.
    diffs.push([DIFF_EQUAL, nullPadding]);
    patch.length1 += paddingLength;
    patch.length2 += paddingLength;
  } else if (paddingLength > diffs[diffs.length - 1][1].length) {
    // Grow last equality.
    var extraLength = paddingLength - diffs[diffs.length - 1][1].length;
    diffs[diffs.length - 1][1] += nullPadding.substring(0, extraLength);
    patch.length1 += extraLength;
    patch.length2 += extraLength;
  }

  return nullPadding;
};


/**
 * Look through the patches and break up any which are longer than the maximum
 * limit of the match algorithm.
 * Intended to be called only from within patch_apply.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of patch objects.
 */
diff_match_patch.prototype.patch_splitMax = function(patches) {
  var patch_size = this.Match_MaxBits;
  for (var x = 0; x < patches.length; x++) {
    if (patches[x].length1 > patch_size) {
      var bigpatch = patches[x];
      // Remove the big old patch.
      patches.splice(x--, 1);
      var start1 = bigpatch.start1;
      var start2 = bigpatch.start2;
      var precontext = '';
      while (bigpatch.diffs.length !== 0) {
        // Create one of several smaller patches.
        var patch = new diff_match_patch.patch_obj();
        var empty = true;
        patch.start1 = start1 - precontext.length;
        patch.start2 = start2 - precontext.length;
        if (precontext !== '') {
          patch.length1 = patch.length2 = precontext.length;
          patch.diffs.push([DIFF_EQUAL, precontext]);
        }
        while (bigpatch.diffs.length !== 0 &&
               patch.length1 < patch_size - this.Patch_Margin) {
          var diff_type = bigpatch.diffs[0][0];
          var diff_text = bigpatch.diffs[0][1];
          if (diff_type === DIFF_INSERT) {
            // Insertions are harmless.
            patch.length2 += diff_text.length;
            start2 += diff_text.length;
            patch.diffs.push(bigpatch.diffs.shift());
            empty = false;
          } else if (diff_type === DIFF_DELETE && patch.diffs.length == 1 &&
                     patch.diffs[0][0] == DIFF_EQUAL &&
                     diff_text.length > 2 * patch_size) {
            // This is a large deletion.  Let it pass in one chunk.
            patch.length1 += diff_text.length;
            start1 += diff_text.length;
            empty = false;
            patch.diffs.push([diff_type, diff_text]);
            bigpatch.diffs.shift();
          } else {
            // Deletion or equality.  Only take as much as we can stomach.
            diff_text = diff_text.substring(0,
                patch_size - patch.length1 - this.Patch_Margin);
            patch.length1 += diff_text.length;
            start1 += diff_text.length;
            if (diff_type === DIFF_EQUAL) {
              patch.length2 += diff_text.length;
              start2 += diff_text.length;
            } else {
              empty = false;
            }
            patch.diffs.push([diff_type, diff_text]);
            if (diff_text == bigpatch.diffs[0][1]) {
              bigpatch.diffs.shift();
            } else {
              bigpatch.diffs[0][1] =
                  bigpatch.diffs[0][1].substring(diff_text.length);
            }
          }
        }
        // Compute the head context for the next patch.
        precontext = this.diff_text2(patch.diffs);
        precontext =
            precontext.substring(precontext.length - this.Patch_Margin);
        // Append the end context for this patch.
        var postcontext = this.diff_text1(bigpatch.diffs)
                              .substring(0, this.Patch_Margin);
        if (postcontext !== '') {
          patch.length1 += postcontext.length;
          patch.length2 += postcontext.length;
          if (patch.diffs.length !== 0 &&
              patch.diffs[patch.diffs.length - 1][0] === DIFF_EQUAL) {
            patch.diffs[patch.diffs.length - 1][1] += postcontext;
          } else {
            patch.diffs.push([DIFF_EQUAL, postcontext]);
          }
        }
        if (!empty) {
          patches.splice(++x, 0, patch);
        }
      }
    }
  }
};


/**
 * Take a list of patches and return a textual representation.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of patch objects.
 * @return {string} Text representation of patches.
 */
diff_match_patch.prototype.patch_toText = function(patches) {
  var text = [];
  for (var x = 0; x < patches.length; x++) {
    text[x] = patches[x];
  }
  return text.join('');
};


/**
 * Parse a textual representation of patches and return a list of patch objects.
 * @param {string} textline Text representation of patches.
 * @return {!Array.<!diff_match_patch.patch_obj>} Array of patch objects.
 * @throws {!Error} If invalid input.
 */
diff_match_patch.prototype.patch_fromText = function(textline) {
  var patches = [];
  if (!textline) {
    return patches;
  }
  var text = textline.split('\n');
  var textPointer = 0;
  var patchHeader = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@$/;
  while (textPointer < text.length) {
    var m = text[textPointer].match(patchHeader);
    if (!m) {
      throw new Error('Invalid patch string: ' + text[textPointer]);
    }
    var patch = new diff_match_patch.patch_obj();
    patches.push(patch);
    patch.start1 = parseInt(m[1], 10);
    if (m[2] === '') {
      patch.start1--;
      patch.length1 = 1;
    } else if (m[2] == '0') {
      patch.length1 = 0;
    } else {
      patch.start1--;
      patch.length1 = parseInt(m[2], 10);
    }

    patch.start2 = parseInt(m[3], 10);
    if (m[4] === '') {
      patch.start2--;
      patch.length2 = 1;
    } else if (m[4] == '0') {
      patch.length2 = 0;
    } else {
      patch.start2--;
      patch.length2 = parseInt(m[4], 10);
    }
    textPointer++;

    while (textPointer < text.length) {
      var sign = text[textPointer].charAt(0);
      try {
        var line = decodeURI(text[textPointer].substring(1));
      } catch (ex) {
        // Malformed URI sequence.
        throw new Error('Illegal escape in patch_fromText: ' + line);
      }
      if (sign == '-') {
        // Deletion.
        patch.diffs.push([DIFF_DELETE, line]);
      } else if (sign == '+') {
        // Insertion.
        patch.diffs.push([DIFF_INSERT, line]);
      } else if (sign == ' ') {
        // Minor equality.
        patch.diffs.push([DIFF_EQUAL, line]);
      } else if (sign == '@') {
        // Start of next patch.
        break;
      } else if (sign === '') {
        // Blank line?  Whatever.
      } else {
        // WTF?
        throw new Error('Invalid patch mode "' + sign + '" in: ' + line);
      }
      textPointer++;
    }
  }
  return patches;
};


/**
 * Class representing one patch operation.
 * @constructor
 */
diff_match_patch.patch_obj = function() {
  /** @type {!Array.<!diff_match_patch.Diff>} */
  this.diffs = [];
  /** @type {?number} */
  this.start1 = null;
  /** @type {?number} */
  this.start2 = null;
  /** @type {number} */
  this.length1 = 0;
  /** @type {number} */
  this.length2 = 0;
};


/**
 * Emmulate GNU diff's format.
 * Header: @@ -382,8 +481,9 @@
 * Indicies are printed as 1-based, not 0-based.
 * @return {string} The GNU diff string.
 */
diff_match_patch.patch_obj.prototype.toString = function() {
  var coords1, coords2;
  if (this.length1 === 0) {
    coords1 = this.start1 + ',0';
  } else if (this.length1 == 1) {
    coords1 = this.start1 + 1;
  } else {
    coords1 = (this.start1 + 1) + ',' + this.length1;
  }
  if (this.length2 === 0) {
    coords2 = this.start2 + ',0';
  } else if (this.length2 == 1) {
    coords2 = this.start2 + 1;
  } else {
    coords2 = (this.start2 + 1) + ',' + this.length2;
  }
  var text = ['@@ -' + coords1 + ' +' + coords2 + ' @@\n'];
  var op;
  // Escape the body of the patch with %xx notation.
  for (var x = 0; x < this.diffs.length; x++) {
    switch (this.diffs[x][0]) {
      case DIFF_INSERT:
        op = '+';
        break;
      case DIFF_DELETE:
        op = '-';
        break;
      case DIFF_EQUAL:
        op = ' ';
        break;
    }
    text[x + 1] = op + encodeURI(this.diffs[x][1]) + '\n';
  }
  return text.join('').replace(/%20/g, ' ');
};


// Export these global variables so that they survive Google's JS compiler.
// In a browser, 'this' will be 'window'.
// In node.js 'this' will be a global object.
this['diff_match_patch'] = diff_match_patch;
this['DIFF_DELETE'] = DIFF_DELETE;
this['DIFF_INSERT'] = DIFF_INSERT;
this['DIFF_EQUAL'] = DIFF_EQUAL;


},{}],13:[function(require,module,exports){

var Pipe = require('../pipe').Pipe;

var Context = function Context(){
};

Context.prototype.setResult = function(result) {
	this.result = result;
	this.hasResult = true;
	return this;
};

Context.prototype.exit = function() {
	this.exiting = true;
	return this;
};

Context.prototype.switchTo = function(next, pipe) {
	if (typeof next === 'string' || next instanceof Pipe) {
		this.nextPipe = next;
	} else {
		this.next = next;
		if (pipe) {
			this.nextPipe = pipe;
		}
	}
	return this;
};

Context.prototype.push = function(child, name) {
	child.parent = this;
	if (typeof name !== 'undefined') {
		child.childName = name;
	}
	child.root = this.root || this;
	child.options = child.options || this.options;
	if (!this.children) {
		this.children = [child];
		this.nextAfterChildren = this.next || null;
		this.next = child;
	} else {
		this.children[this.children.length - 1].next = child;
		this.children.push(child);
	}
	child.next = this;
	return this;
};

exports.Context = Context;
},{"../pipe":26}],14:[function(require,module,exports){

var Context = require('./context').Context;

var DiffContext = function DiffContext(left, right){
    this.left = left;
    this.right = right;
    this.pipe = 'diff';
};

DiffContext.prototype = new Context();

exports.DiffContext = DiffContext;
},{"./context":13}],15:[function(require,module,exports){

var Context = require('./context').Context;

var PatchContext = function PatchContext(left, delta){
    this.left = left;
    this.delta = delta;
    this.pipe = 'patch';
};

PatchContext.prototype = new Context();

exports.PatchContext = PatchContext;
},{"./context":13}],16:[function(require,module,exports){

var Context = require('./context').Context;

var ReverseContext = function ReverseContext(delta){
    this.delta = delta;
    this.pipe = 'reverse';
};

ReverseContext.prototype = new Context();

exports.ReverseContext = ReverseContext;
},{"./context":13}],17:[function(require,module,exports){

// use as 2nd parameter for JSON.parse to revive Date instances
module.exports = function dateReviver(key, value) {
    var a;
    if (typeof value === 'string') {
        a = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)(Z|([+\-])(\d{2}):(\d{2}))$/.exec(value);
        if (a) {
            return new Date(Date.UTC(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], +a[6]));
        }
    }
    return value;
};
},{}],18:[function(require,module,exports){

var Processor = require('./processor').Processor;
var Pipe = require('./pipe').Pipe;
var DiffContext = require('./contexts/diff').DiffContext;
var PatchContext = require('./contexts/patch').PatchContext;
var ReverseContext = require('./contexts/reverse').ReverseContext;

var trivial = require('./filters/trivial');
var nested = require('./filters/nested');
var arrays = require('./filters/arrays');
var dates = require('./filters/dates');
var texts = require('./filters/texts');

var DiffPatcher = function DiffPatcher(options){
    this.processor = new Processor(options);
    this.processor.pipe(new Pipe('diff').append(
        nested.collectChildrenDiffFilter,
        trivial.diffFilter,
        dates.diffFilter,
        texts.diffFilter,
        nested.objectsDiffFilter,
        arrays.diffFilter
        ).shouldHaveResult());
    this.processor.pipe(new Pipe('patch').append(
        nested.collectChildrenPatchFilter,
        arrays.collectChildrenPatchFilter,
        trivial.patchFilter,
        texts.patchFilter,
        nested.patchFilter,
        arrays.patchFilter
        ).shouldHaveResult());
    this.processor.pipe(new Pipe('reverse').append(
        nested.collectChildrenReverseFilter,
        arrays.collectChildrenReverseFilter,
        trivial.reverseFilter,
        texts.reverseFilter,
        nested.reverseFilter,
        arrays.reverseFilter
        ).shouldHaveResult());
};

DiffPatcher.prototype.options = function() {
    return this.processor.options.apply(this.processor, arguments);
};

DiffPatcher.prototype.diff = function(left, right) {
    return this.processor.process(new DiffContext(left, right));
};

DiffPatcher.prototype.patch = function(left, delta) {
    return this.processor.process(new PatchContext(left, delta));
};

DiffPatcher.prototype.reverse = function(delta) {
    return this.processor.process(new ReverseContext(delta));
};

DiffPatcher.prototype.unpatch = function(right, delta) {
    return this.patch(right, this.reverse(delta));
};

exports.DiffPatcher = DiffPatcher;

},{"./contexts/diff":14,"./contexts/patch":15,"./contexts/reverse":16,"./filters/arrays":19,"./filters/dates":20,"./filters/nested":22,"./filters/texts":23,"./filters/trivial":24,"./pipe":26,"./processor":27}],19:[function(require,module,exports){

var DiffContext = require('../contexts/diff').DiffContext;
var PatchContext = require('../contexts/patch').PatchContext;
var ReverseContext = require('../contexts/reverse').ReverseContext;

var lcs = require('./lcs');

var ARRAY_MOVE = 3;

var isArray = (typeof Array.isArray === 'function') ?
    // use native function
    Array.isArray :
    // use instanceof operator
    function(a) {
        return a instanceof Array;
    };

var arrayIndexOf = typeof Array.prototype.indexOf === 'function' ?
    function(array, item) {
        return array.indexOf(item);
    } : function(array, item) {
        var length = array.length;
        for (var i = 0; i < length; i++) {
            if (array[i] === item) {
                return i;
            }
        }
        return -1;
    };

var diffFilter = function arraysDiffFilter(context){
    if (!context.leftIsArray) { return; }

    var objectHash = context.options && context.options.objectHash;

    var match = function(array1, array2, index1, index2, context) {
        var value1 = array1[index1];
        var value2 = array2[index2];
        if (value1 === value2) {
            return true;
        }
        if (typeof value1 !== 'object' || typeof value2 !== 'object') {
            return false;
        }
        if (!objectHash) { return false; }
        var hash1, hash2;
        if (typeof index1 === 'number') {
            context.hashCache1 = context.hashCache1 || [];
            hash1 = context.hashCache1[index1];
            if (typeof hash1 === 'undefined') {
                context.hashCache1[index1] = hash1 = objectHash(value1, index1);
            }
        } else {
            hash1 = objectHash(value1);
        }
        if (typeof hash1 === 'undefined') {
            return false;
        }
        if (typeof index2 === 'number') {
            context.hashCache2 = context.hashCache2 || [];
            hash2 = context.hashCache2[index2];
            if (typeof hash2 === 'undefined') {
                context.hashCache2[index2] = hash2 = objectHash(value2, index2);
            }
        } else {
            hash2 = objectHash(value2);
        }
        if (typeof hash2 === 'undefined') {
            return false;
        }
        return hash1 === hash2;
    };

    var matchContext = {};
    var commonHead = 0, commonTail = 0, index, index1, index2;
    var array1 = context.left;
    var array2 = context.right;
    var len1 = array1.length;
    var len2 = array2.length;

    var child;

    // separate common head
    while (commonHead < len1 && commonHead < len2 &&
        match(array1, array2, commonHead, commonHead, matchContext)) {
        index = commonHead;
        child = new DiffContext(context.left[index], context.right[index]);
        context.push(child, index);
        commonHead++;
    }
    // separate common tail
    while (commonTail + commonHead < len1 && commonTail + commonHead < len2 &&
        match(array1, array2, len1 - 1 - commonTail, len2 - 1 - commonTail, matchContext)) {
        index1 = len1 - 1 - commonTail;
        index2 = len2 - 1 - commonTail;
        child = new DiffContext(context.left[index1], context.right[index2]);
        context.push(child, index2);
        commonTail++;
    }
    var result;
    if (commonHead + commonTail === len1) {
        if (len1 === len2) {
            // arrays are identical
            context.setResult(undefined).exit();
            return;
        }
        // trivial case, a block (1 or more consecutive items) was added
        result = result || { _t: 'a' };
        for (index = commonHead; index < len2 - commonTail; index++) {
            result[index] = [array2[index]];
        }
        context.setResult(result).exit();
        return;
    }
    if (commonHead + commonTail === len2) {
        // trivial case, a block (1 or more consecutive items) was removed
        result = result || { _t: 'a' };
        for (index = commonHead; index < len1 - commonTail; index++) {
            result['_'+index] = [array1[index], 0, 0];
        }
        context.setResult(result).exit();
        return;
    }
    // reset hash cache
    matchContext = {};
    // diff is not trivial, find the LCS (Longest Common Subsequence)
    var trimmed1 = array1.slice(commonHead, len1 - commonTail);
    var trimmed2 = array2.slice(commonHead, len2 - commonTail);
    var seq = lcs.get(
        trimmed1, trimmed2,
        match,
        matchContext
    );
    var removedItems = [];
    result = result || { _t: 'a' };
    for (index = commonHead; index < len1 - commonTail; index++) {
        if (arrayIndexOf(seq.indices1, index - commonHead) < 0) {
            // removed
            result['_'+index] = [array1[index], 0, 0];
            removedItems.push(index);
        }
    }

    var detectMove = true;
    if (context.options && context.options.arrays && context.options.arrays.detectMove === false) {
        detectMove = false;
    }
    var includeValueOnMove = false;
    if (context.options && context.options.arrays && context.options.arrays.includeValueOnMove) {
        includeValueOnMove = true;
    }

    var removedItemsLength = removedItems.length;
    for (index = commonHead; index < len2 - commonTail; index++) {
        var indexOnArray2 = arrayIndexOf(seq.indices2, index - commonHead);
        if (indexOnArray2 < 0) {
            // added, try to match with a removed item and register as position move
            var isMove = false;
            if (detectMove && removedItemsLength > 0) {
                for (index1 = 0; index1 < removedItemsLength; index1++) {
                    if (match(trimmed1, trimmed2, removedItems[index1] - commonHead,
                        index - commonHead, matchContext)) {
                        // store position move as: [originalValue, newPosition, ARRAY_MOVE]
                        result['_' + removedItems[index1]].splice(1, 2, index, ARRAY_MOVE);
                        if (!includeValueOnMove) {
                            // don't include moved value on diff, to save bytes
                            result['_' + removedItems[index1]][0] = '';
                        }

                        index1 = removedItems[index1];
                        index2 = index;
                        child = new DiffContext(context.left[index1], context.right[index2]);
                        context.push(child, index2);
                        removedItems.splice(index1, 1);
                        isMove = true;
                        break;
                    }
                }
            }
            if (!isMove) {
                // added
                result[index] = [array2[index]];
            }
        } else {
            // match, do inner diff
            index1 = seq.indices1[indexOnArray2] + commonHead;
            index2 = seq.indices2[indexOnArray2] + commonHead;
            child = new DiffContext(context.left[index1], context.right[index2]);
            context.push(child, index2);
        }
    }

    context.setResult(result).exit();

};
diffFilter.filterName = 'arrays';

var compare = {
    numerically: function(a, b) {
        return a - b;
    },
    numericallyBy: function(name) {
        return function(a, b) {
            return a[name] - b[name];
        };
    }
};

var patchFilter = function nestedPatchFilter(context) {
    if (!context.nested) { return; }
    if (context.delta._t !== 'a') { return; }
    var index, index1;

    var delta = context.delta;
    var array = context.left;

    // first, separate removals, insertions and modifications
    var toRemove = [];
    var toInsert = [];
    var toModify = [];
    for (index in delta) {
        if (index !== '_t') {
            if (index[0] === '_') {
                // removed item from original array
                if (delta[index][2] === 0 || delta[index][2] === ARRAY_MOVE) {
                    toRemove.push(parseInt(index.slice(1), 10));
                } else {
                    throw new Error('only removal or move can be applied at original array indices' +
                        ', invalid diff type: ' + delta[index][2]);
                }
            } else {
                if (delta[index].length === 1) {
                    // added item at new array
                    toInsert.push({
                        index: parseInt(index, 10),
                        value: delta[index][0]
                    });
                } else {
                    // modified item at new array
                    toModify.push({
                        index: parseInt(index, 10),
                        delta: delta[index]
                    });
                }
            }
        }
    }

    // remove items, in reverse order to avoid sawing our own floor
    toRemove = toRemove.sort(compare.numerically);
    for (index = toRemove.length - 1; index >= 0; index--) {
        index1 = toRemove[index];
        var indexDiff = delta['_' + index1];
        var removedValue = array.splice(index1, 1)[0];
        if (indexDiff[2] === ARRAY_MOVE) {
            // reinsert later
            toInsert.push({
                index: indexDiff[1],
                value: removedValue
            });
        }
    }

    // insert items, in reverse order to avoid moving our own floor
    toInsert = toInsert.sort(compare.numericallyBy('index'));
    var toInsertLength = toInsert.length;
    for (index = 0; index < toInsertLength; index++) {
        var insertion = toInsert[index];
        array.splice(insertion.index, 0, insertion.value);
    }

    // apply modifications
    var toModifyLength = toModify.length;
    var child;
    if (toModifyLength > 0) {
        for (index = 0; index < toModifyLength; index++) {
            var modification = toModify[index];
            child = new PatchContext(context.left[modification.index], modification.delta);
            context.push(child, modification.index);
        }
    }

    if (!context.children) {
        context.setResult(context.left).exit();
        return;
    }
    context.exit();
};
patchFilter.filterName = 'arrays';

var collectChildrenPatchFilter = function collectChildrenPatchFilter(context) {
    if (!context || !context.children) { return; }
    if (context.delta._t !== 'a') { return; }
    var length = context.children.length;
    var child;
    for (var index = 0; index < length; index++) {
        child = context.children[index];
        context.left[child.childName] = child.result;
    }
    context.setResult(context.left).exit();
};
collectChildrenPatchFilter.filterName = 'arraysCollectChildren';

var reverseFilter = function arraysReverseFilter(context) {
    if (!context.nested) {
        if (context.delta[2] === ARRAY_MOVE) {
            context.newName = '_' + context.delta[1];
            context.setResult([context.delta[0], parseInt(context.childName.substr(1), 10), ARRAY_MOVE]).exit();
        }
        return;
    }
    if (context.delta._t !== 'a') { return; }
    var name, child;
    for (name in context.delta) {
        if (name === '_t') { continue; }
        child = new ReverseContext(context.delta[name]);
        context.push(child, name);
    }
    context.exit();
};
reverseFilter.filterName = 'arrays';

var reverseArrayDeltaIndex = function(delta, index, itemDelta) {
    var newIndex = index;
    if (typeof index === 'string' && index[0] === '_') {
        newIndex = parseInt(index.substr(1), 10);
    } else {
        var uindex = '_' + index;
        if (isArray(itemDelta) && itemDelta[2] === 0) {
            newIndex = uindex;
        } else {
            for (var index2 in delta) {
                var itemDelta2 = delta[index2];
                if (isArray(itemDelta2) && itemDelta2[2] === ARRAY_MOVE && itemDelta2[1].toString() === index) {
                    newIndex = index2.substr(1);
                }
            }
        }
    }
    return newIndex;
};

var collectChildrenReverseFilter = function collectChildrenReverseFilter(context) {
    if (!context || !context.children) { return; }
    if (context.delta._t !== 'a') { return; }
    var length = context.children.length;
    var child;
    var delta = { _t: 'a' };
    for (var index = 0; index < length; index++) {
        child = context.children[index];
        var name = child.newName;
        if (typeof name === 'undefined') {
            name = reverseArrayDeltaIndex(context.delta, child.childName, child.result);
        }
        if (delta[name] !== child.result) {
            delta[name] = child.result;
        }
    }
    context.setResult(delta).exit();
};
collectChildrenReverseFilter.filterName = 'arraysCollectChildren';

exports.diffFilter = diffFilter;
exports.patchFilter = patchFilter;
exports.collectChildrenPatchFilter = collectChildrenPatchFilter;
exports.reverseFilter = reverseFilter;
exports.collectChildrenReverseFilter = collectChildrenReverseFilter;
},{"../contexts/diff":14,"../contexts/patch":15,"../contexts/reverse":16,"./lcs":21}],20:[function(require,module,exports){
var diffFilter = function datesDiffFilter(context) {
    if (context.left instanceof Date) {
        if (context.right instanceof Date) {
            if (context.left.getTime() !== context.right.getTime()) {
                context.setResult([context.left, context.right]);
            } else {
                context.setResult(undefined);
            }
        } else {
            context.setResult([context.left, context.right]);
        }
        context.exit();
    } else if (context.right instanceof Date) {
        context.setResult([context.left, context.right]).exit();
    }
};
diffFilter.filterName = 'dates';

exports.diffFilter = diffFilter;
},{}],21:[function(require,module,exports){
/*

LCS implementation that supports arrays or strings

reference: http://en.wikipedia.org/wiki/Longest_common_subsequence_problem

*/

var defaultMatch = function(array1, array2, index1, index2) {
    return array1[index1] === array2[index2];
};

var lengthMatrix = function(array1, array2, match, context) {
    var len1 = array1.length;
    var len2 = array2.length;
    var x, y;

    // initialize empty matrix of len1+1 x len2+1
    var matrix = [len1 + 1];
    for (x = 0; x < len1 + 1; x++) {
        matrix[x] = [len2 + 1];
        for (y = 0; y < len2 + 1; y++) {
            matrix[x][y] = 0;
        }
    }
    matrix.match = match;
    // save sequence lengths for each coordinate
    for (x = 1; x < len1 + 1; x++) {
        for (y = 1; y < len2 + 1; y++) {
            if (match(array1, array2, x - 1, y - 1, context)) {
                matrix[x][y] = matrix[x - 1][y - 1] + 1;
            } else {
                matrix[x][y] = Math.max(matrix[x - 1][y], matrix[x][y - 1]);
            }
        }
    }
    return matrix;
};

var backtrack = function(matrix, array1, array2, index1, index2, context) {
    if (index1 === 0 || index2 === 0) {
        return {
            sequence: [],
            indices1: [],
            indices2: []
        };
    }

    if (matrix.match(array1, array2, index1 - 1, index2 - 1, context)) {
        var subsequence = backtrack(matrix, array1, array2, index1 - 1, index2 - 1, context);
        subsequence.sequence.push(array1[index1 - 1]);
        subsequence.indices1.push(index1 - 1);
        subsequence.indices2.push(index2 - 1);
        return subsequence;
    }

    if (matrix[index1][index2 - 1] > matrix[index1 - 1][index2]) {
        return backtrack(matrix, array1, array2, index1, index2 - 1, context);
    } else {
        return backtrack(matrix, array1, array2, index1 - 1, index2, context);
    }
};

var get = function(array1, array2, match, context) {
    context = context || {};
    var matrix = lengthMatrix(array1, array2, match || defaultMatch, context);
    var result = backtrack(matrix, array1, array2, array1.length, array2.length, context);
    if (typeof array1 === 'string' && typeof array2 === 'string') {
        result.sequence = result.sequence.join('');
    }
    return result;
};

exports.get = get;

},{}],22:[function(require,module,exports){

var DiffContext = require('../contexts/diff').DiffContext;
var PatchContext = require('../contexts/patch').PatchContext;
var ReverseContext = require('../contexts/reverse').ReverseContext;

var collectChildrenDiffFilter = function collectChildrenDiffFilter(context) {
    if (!context || !context.children) { return; }
    var length = context.children.length;
    var child;
    var result = context.result;
    for (var index = 0; index < length; index++) {
        child = context.children[index];
        if (typeof child.result === 'undefined') {
            continue;
        }
        result = result || {};
        result[child.childName] = child.result;
    }
    if (result && context.leftIsArray) {
        result._t = 'a';
    }
    context.setResult(result).exit();
};
collectChildrenDiffFilter.filterName = 'collectChildren';

var objectsDiffFilter = function objectsDiffFilter(context) {
    if (context.leftIsArray || context.leftType !== 'object') { return; }

    var name, child;
    for (name in context.left) {
        child = new DiffContext(context.left[name], context.right[name]);
        context.push(child, name);
    }
    for (name in context.right) {
        if (typeof context.left[name] === 'undefined') {
            child = new DiffContext(undefined, context.right[name]);
            context.push(child, name);
        }
    }

    if (!context.children || context.children.length === 0) {
        context.setResult(undefined).exit();
        return;
    }
    context.exit();
};
objectsDiffFilter.filterName = 'objects';

var patchFilter = function nestedPatchFilter(context) {
    if (!context.nested) { return; }
    if (context.delta._t) { return; }
    var name, child;
    for (name in context.delta) {
        child = new PatchContext(context.left[name], context.delta[name]);
        context.push(child, name);
    }
    context.exit();
};
patchFilter.filterName = 'objects';

var collectChildrenPatchFilter = function collectChildrenPatchFilter(context) {
    if (!context || !context.children) { return; }
    if (context.delta._t) { return; }
    var length = context.children.length;
    var child;
    for (var index = 0; index < length; index++) {
        child = context.children[index];
        if (context.left[child.childName] !== child.result) {
            context.left[child.childName] = child.result;
        }
    }
    context.setResult(context.left).exit();
};
collectChildrenPatchFilter.filterName = 'collectChildren';

var reverseFilter = function nestedReverseFilter(context) {
    if (!context.nested) { return; }
    if (context.delta._t) { return; }
    var name, child;
    for (name in context.delta) {
        child = new ReverseContext(context.delta[name]);
        context.push(child, name);
    }
    context.exit();
};
reverseFilter.filterName = 'objects';

var collectChildrenReverseFilter = function collectChildrenReverseFilter(context) {
    if (!context || !context.children) { return; }
    if (context.delta._t) { return; }
    var length = context.children.length;
    var child;
    var delta = {};
    for (var index = 0; index < length; index++) {
        child = context.children[index];
        if (delta[child.childName] !== child.result) {
            delta[child.childName] = child.result;
        }
    }
    context.setResult(delta).exit();
};
collectChildrenReverseFilter.filterName = 'collectChildren';

exports.collectChildrenDiffFilter = collectChildrenDiffFilter;
exports.objectsDiffFilter = objectsDiffFilter;
exports.patchFilter = patchFilter;
exports.collectChildrenPatchFilter = collectChildrenPatchFilter;
exports.reverseFilter = reverseFilter;
exports.collectChildrenReverseFilter = collectChildrenReverseFilter;
},{"../contexts/diff":14,"../contexts/patch":15,"../contexts/reverse":16}],23:[function(require,module,exports){
/* global diff_match_patch */
var TEXT_DIFF = 2;
var DEFAULT_MIN_LENGTH = 60;
var cachedDiffPatch = null;

var getDiffMatchPatch = function(){
    /*jshint camelcase: false */

    if (!cachedDiffPatch) {
        var instance;
        if (typeof diff_match_patch !== 'undefined') {
            // already loaded, probably a browser
            instance = new diff_match_patch();
        } else if (typeof require === 'function') {
            var dmp = require('../../external/diff_match_patch_uncompressed');
            instance = new dmp.diff_match_patch();
        }
        if (!instance) {
            var error = new Error('text diff_match_patch library not found');
            error.diff_match_patch_not_found = true;
            throw error;
        }
        cachedDiffPatch = {
            diff: function(txt1, txt2){
                return instance.patch_toText(instance.patch_make(txt1, txt2));
            },
            patch: function(txt1, patch){
                var results = instance.patch_apply(instance.patch_fromText(patch), txt1);
                for (var i = 0; i < results[1].length; i++) {
                    if (!results[1][i]) {
                        var error = new Error('text patch failed');
                        error.textPatchFailed = true;
                    }
                }
                return results[0];
            }
        };
    }
    return cachedDiffPatch;
};

var diffFilter = function textsDiffFilter(context) {
    if (context.leftType !== 'string') { return; }
    var minLength = (context.options && context.options.textDiff &&
        context.options.textDiff.minLength) || DEFAULT_MIN_LENGTH;
    if (context.left.length < minLength ||
        context.right.length < minLength) {
        context.setResult([context.left, context.right]).exit();
        return;
    }
    // large text, use a text-diff algorithm
    var diff = getDiffMatchPatch().diff;
    context.setResult([diff(context.left, context.right), 0, TEXT_DIFF]).exit();
};
diffFilter.filterName = 'texts';

var patchFilter = function textsPatchFilter(context) {
    if (context.nested) { return; }
    if (context.delta[2] !== TEXT_DIFF) { return; }

    // text-diff, use a text-patch algorithm
    var patch = getDiffMatchPatch().patch;
    context.setResult(patch(context.left, context.delta[0])).exit();
};
patchFilter.filterName = 'texts';

var textDeltaReverse = function(delta){
    var i, l, lines, line, lineTmp, header = null,
    headerRegex = /^@@ +\-(\d+),(\d+) +\+(\d+),(\d+) +@@$/,
    lineHeader, lineAdd, lineRemove;
    lines = delta.split('\n');
    for (i = 0, l = lines.length; i<l; i++) {
        line = lines[i];
        var lineStart = line.slice(0,1);
        if (lineStart==='@'){
            header = headerRegex.exec(line);
            lineHeader = i;
            lineAdd = null;
            lineRemove = null;

            // fix header
            lines[lineHeader] = '@@ -' + header[3] + ',' + header[4] + ' +' + header[1] + ',' + header[2] + ' @@';
        } else if (lineStart === '+'){
            lineAdd = i;
            lines[i] = '-' + lines[i].slice(1);
            if (lines[i-1].slice(0,1)==='+') {
                // swap lines to keep default order (-+)
                lineTmp = lines[i];
                lines[i] = lines[i-1];
                lines[i-1] = lineTmp;
            }
        } else if (lineStart === '-'){
            lineRemove = i;
            lines[i] = '+' + lines[i].slice(1);
        }
    }
    return lines.join('\n');
};

var reverseFilter = function textsReverseFilter(context) {
    if (context.nested) { return; }
    if (context.delta[2] !== TEXT_DIFF) { return; }

    // text-diff, use a text-diff algorithm
    context.setResult([textDeltaReverse(context.delta[0]), 0, TEXT_DIFF]).exit();
};
reverseFilter.filterName = 'texts';

exports.diffFilter = diffFilter;
exports.patchFilter = patchFilter;
exports.reverseFilter = reverseFilter;
},{"../../external/diff_match_patch_uncompressed":12}],24:[function(require,module,exports){

var isArray = (typeof Array.isArray === 'function') ?
    // use native function
    Array.isArray :
    // use instanceof operator
    function(a) {
        return a instanceof Array;
    };

var diffFilter = function trivialMatchesDiffFilter(context) {
    if (context.left === context.right) {
        context.setResult(undefined).exit();
        return;
    }
    if (typeof context.left === 'undefined') {
        if (typeof context.right === 'function') {
            throw new Error('functions are not supported');
        }
        context.setResult([context.right]).exit();
        return;
    }
    if (typeof context.right === 'undefined') {
        context.setResult([context.left, 0, 0]).exit();
        return;
    }
    if (typeof context.left === 'function' || typeof context.right === 'function' ) {
        throw new Error('functions are not supported');
    }
    context.leftType = context.left === null ? 'null' : typeof context.left;
    context.rightType = context.right === null ? 'null' : typeof context.right;
    if (context.leftType !== context.rightType) {
        context.setResult([context.left, context.right]).exit();
        return;
    }
    if (context.leftType === 'boolean' || context.leftType === 'number') {
        context.setResult([context.left, context.right]).exit();
        return;
    }
    if (context.leftType === 'object') {
        context.leftIsArray = isArray(context.left);
    }
    if (context.rightType === 'object') {
        context.rightIsArray = isArray(context.right);
    }
    if (context.leftIsArray !== context.rightIsArray) {
        context.setResult([context.left, context.right]).exit();
        return;
    }
};
diffFilter.filterName = 'trivial';

var patchFilter = function trivialMatchesPatchFilter(context) {
    if (typeof context.delta === 'undefined') {
        context.setResult(context.left).exit();
        return;
    }
    context.nested = !isArray(context.delta);
    if (context.nested) { return; }
    if (context.delta.length === 1) {
        context.setResult(context.delta[0]).exit();
        return;
    }
    if (context.delta.length === 2) {
        context.setResult(context.delta[1]).exit();
        return;
    }
    if (context.delta.length === 3 && context.delta[2] === 0) {
        context.setResult(undefined).exit();
        return;
    }
};
patchFilter.filterName = 'trivial';

var reverseFilter = function trivialReferseFilter(context) {
    if (typeof context.delta === 'undefined') {
        context.setResult(context.delta).exit();
        return;
    }
    context.nested = !isArray(context.delta);
    if (context.nested) { return; }
    if (context.delta.length === 1) {
        context.setResult([context.delta[0], 0, 0]).exit();
        return;
    }
    if (context.delta.length === 2) {
        context.setResult([context.delta[1], context.delta[0]]).exit();
        return;
    }
    if (context.delta.length === 3 && context.delta[2] === 0) {
        context.setResult([context.delta[0]]).exit();
        return;
    }
};
reverseFilter.filterName = 'trivial';

exports.diffFilter = diffFilter;
exports.patchFilter = patchFilter;
exports.reverseFilter = reverseFilter;

},{}],25:[function(require,module,exports){
(function (process){

var DiffPatcher = require('./diffpatcher').DiffPatcher;
exports.DiffPatcher = DiffPatcher;

exports.create = function(options){
	return new DiffPatcher(options);
};

exports.dateReviver = require('./date-reviver');

var defaultInstance;

exports.diff = function() {
	if (!defaultInstance) {
		defaultInstance = new DiffPatcher();
	}
	return defaultInstance.diff.apply(defaultInstance, arguments);
};

exports.patch = function() {
	if (!defaultInstance) {
		defaultInstance = new DiffPatcher();
	}
	return defaultInstance.patch.apply(defaultInstance, arguments);
};

exports.unpatch = function() {
	if (!defaultInstance) {
		defaultInstance = new DiffPatcher();
	}
	return defaultInstance.unpatch.apply(defaultInstance, arguments);
};

exports.reverse = function() {
	if (!defaultInstance) {
		defaultInstance = new DiffPatcher();
	}
	return defaultInstance.reverse.apply(defaultInstance, arguments);
};

var inNode = typeof process !== 'undefined' && typeof process.execPath === 'string';
if (inNode) {
	var formatters = require('./formatters' + '/index');
	exports.formatters = formatters;
	// shortcut for console
	exports.console = formatters.console;
} else {
	exports.homepage = '{{package-homepage}}';
	exports.version = '{{package-version}}';
}

}).call(this,require("/home/sergio/Code/groovebasin/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js"))
},{"./date-reviver":17,"./diffpatcher":18,"/home/sergio/Code/groovebasin/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js":6}],26:[function(require,module,exports){

var Pipe = function Pipe(name){
    this.name = name;
    this.filters = [];
};

Pipe.prototype.process = function(input) {
    if (!this.processor) {
        throw new Error('add this pipe to a processor before using it');
    }
    var debug = this.debug;
    var length = this.filters.length;
    var context = input;
    for (var index = 0; index < length; index++) {
        var filter = this.filters[index];
        if (debug) {
            this.log('filter: ' + filter.filterName);
        }
        filter(context);
        if (typeof context === 'object' && context.exiting) {
            context.exiting = false;
            break;
        }
    }
    if (!context.next && this.resultCheck) {
        this.resultCheck(context);
    }
};

Pipe.prototype.log = function(msg) {
    console.log('[jsondiffpatch] ' + this.name + ' pipe, ' + msg);
};

Pipe.prototype.append = function() {
    this.filters.push.apply(this.filters, arguments);
    return this;
};

Pipe.prototype.prepend = function() {
    this.filters.unshift.apply(this.filters, arguments);
    return this;
};

Pipe.prototype.indexOf = function(filterName) {
    if (!filterName) {
        throw new Error('a filter name is required');
    }
    for (var index = 0; index < this.filters.length; index++) {
        var filter = this.filters[index];
        if (filter.filterName === filterName) {
            return index;
        }
    }
    throw new Error('filter not found: ' + filterName);
};

Pipe.prototype.list = function() {
    var names = [];
    for (var index = 0; index < this.filters.length; index++) {
        var filter = this.filters[index];
        names.push(filter.filterName);
    }
    return names;
};

Pipe.prototype.after = function(filterName) {
    var index = this.indexOf(filterName);
    var params = Array.prototype.slice.call(arguments, 1);
    if (!params.length) {
        throw new Error('a filter is required');
    }
    params.unshift(index + 1, 0);
    Array.prototype.splice.apply(this.filters, params);
    return this;
};

Pipe.prototype.before = function(filterName) {
    var index = this.indexOf(filterName);
    var params = Array.prototype.slice.call(arguments, 1);
    if (!params.length) {
        throw new Error('a filter is required');
    }
    params.unshift(index, 0);
    Array.prototype.splice.apply(this.filters, params);
    return this;
};

Pipe.prototype.clear = function() {
    this.filters.length = 0;
    return this;
};

Pipe.prototype.shouldHaveResult = function(should) {
    if (should === false) {
        this.resultCheck = null;
        return;
    }
    if (this.resultCheck) { return; }
    var pipe = this;
    this.resultCheck = function(context) {
        if (!context.hasResult) {
            console.log(context);
            var error = new Error(pipe.name + ' failed');
            error.noResult = true;
            throw error;
        }
    };
    return this;
};

exports.Pipe = Pipe;
},{}],27:[function(require,module,exports){

var Processor = function Processor(options){
	this.selfOptions = options;
	this.pipes = {};
};

Processor.prototype.options = function(options) {
	if (options) {
		this.selfOptions = options;
	}
	return this.selfOptions;
};

Processor.prototype.pipe = function(name, pipe) {
	if (typeof name === 'string') {
		if (typeof pipe === 'undefined') {
			return this.pipes[name];
		} else {
			this.pipes[name] = pipe;
		}
	}
	if (name && name.name) {
		pipe = name;
		if (pipe.processor === this) { return pipe; }
		this.pipes[pipe.name] = pipe;
	}
	pipe.processor = this;
	return pipe;
};

Processor.prototype.process = function(input, pipe) {
	var context = input;
	context.options = this.options();
	var nextPipe = pipe || input.pipe || 'default';
	var lastPipe, lastContext;
	while (nextPipe) {
		if (typeof context.nextAfterChildren !== 'undefined') {
			// children processed and coming back to parent
			context.next = context.nextAfterChildren;
			context.nextAfterChildren = null;
		}

		if (typeof nextPipe === 'string') {
			nextPipe = this.pipe(nextPipe);
		}
		nextPipe.process(context);
		lastContext = context;
		lastPipe = nextPipe;
		nextPipe = null;
		if (context) {
			if (context.next) {
				context = context.next;
				nextPipe = lastContext.nextPipe || context.pipe || lastPipe;
			}
		}
	}
	return context.hasResult ? context.result : undefined;
};

exports.Processor = Processor;

},{}],28:[function(require,module,exports){

// the basic characters in sorted order
var alphabet = "0123456789?@ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var radix = alphabet.length;
// bigger than all the basic characters
var order_specifier = "~";

// character to numerical value aka index of the character
// "0": 0, "z": 63, etc.
var values = (function() {
  var values = {};
  for (var i = 0; i < alphabet.length; i++) values[alphabet[i]] = i;
  return values;
})();

module.exports = keese;
function keese(low, high) {
  if (low == null) {
    if (high == null) {
      // return anything above 0
      return "1";
    } else {
      // go smaller
      return average("0", high);
    }
  } else {
    if (high == null) {
      // go bigger
      return increment(low);
    } else {
      // go in between
      return average(low, high);
    }
  }
}

function increment(value) {
  var n = parse(value);
  // drop the fraction
  n.digits = n.digits.substr(0, n.order_length + 1);
  return add(n, parse("1"));
}

function average(low, high) {
  if (!(low < high)) {
    throw new Error("assertion failed: " + JSON.stringify(low) + " < " + JSON.stringify(high));
  }
  var a = parse(low);
  var b = parse(high);
  pad_to_equal_order(a, b);
  var b_carry = 0;
  var max_digit_length = Math.max(a.digits.length, b.digits.length);
  for (var i = 0; i < max_digit_length || b_carry > 0; i++) {
    var a_value =            values[a.digits[i]] || 0;
    var b_value = b_carry + (values[b.digits[i]] || 0);
    if (a_value === b_value) continue;
    if (a_value === b_value - 1) {
      // we need more digits, but remember that b is ahead
      b_carry = radix;
      continue;
    }
    // we have a distance of at least 2 between the values.
    // half the distance floored is sure to be a positive single digit.
    var half_distance_value = Math.floor((b_value - a_value) / 2);
    var half_distance_digits = "";
    for (var j = 0; j < i; j++)
      half_distance_digits += "0";
    half_distance_digits += alphabet[half_distance_value];
    var half_distance = parse(construct(a.order_length, half_distance_digits));
    // truncate insignificant digits of a
    a.digits = a.digits.substr(0, i + 1);
    return add(a, half_distance);
  }
  throw new Error; // unreachable
}

function add(a, b) {
  pad_to_equal_order(a, b);
  var result_digits = "";
  var order_length = a.order_length;
  var value = 0;
  for (var i = Math.max(a.digits.length, b.digits.length) - 1; i >= 0; i--) {
    value += values[a.digits[i]] || 0;
    value += values[b.digits[i]] || 0;
    result_digits = alphabet[value % radix] + result_digits;
    value = Math.floor(value / radix);
  }
  // overflow up to moar digits
  while (value > 0) {
    result_digits = alphabet[value % radix] + result_digits;
    value = Math.floor(value / radix);
    order_length++;
  }
  return construct(order_length, result_digits);
}

function parse(value) {
  var order_length = value.lastIndexOf(order_specifier) + 1;
  return {
    order_length: order_length,
    digits: value.substr(order_length)
  };
}
function construct(order_length, digits) {
  // strip unnecessary leading zeros
  while (order_length > 0 && digits.charAt(0) == "0") {
    digits = digits.substr(1);
    order_length--;
  }
  var result = "";
  for (var i = 0; i < order_length; i++)
    result += order_specifier;
  return result + digits;
}

function pad_to_equal_order(a, b) {
  pad_in_place(a, b.order_length);
  pad_in_place(b, a.order_length);
}
function pad_in_place(n, order_length) {
  while (n.order_length < order_length) {
    n.digits = "0" + n.digits;
    n.order_length++;
  }
}

},{}],29:[function(require,module,exports){
(function(module) {
    // see https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
    // and http://stackoverflow.com/questions/6274339/how-can-i-shuffle-an-array-in-javascript#6274398
    module.exports = function shuffle(array) {
        var counter = array.length,
            temp,
            index;

        while (counter) {
            index = Math.floor(Math.random() * counter--);

            temp = array[counter];
            array[counter] = array[index];
            array[index] = temp;
        }

        return array;
    }
})(module);

},{}],30:[function(require,module,exports){
var removeDiacritics = require('diacritics').remove;

module.exports = MusicLibraryIndex;

MusicLibraryIndex.defaultPrefixesToStrip = [/^\s*the\s+/, /^\s*a\s+/,
  /^\s*an\s+/];
MusicLibraryIndex.defaultVariousArtistsKey = "VariousArtists";
MusicLibraryIndex.defaultVariousArtistsName = "Various Artists";
MusicLibraryIndex.defaultSearchFields = ['artistName', 'albumArtistName',
  'albumName', 'name'];

function MusicLibraryIndex(options) {
  options = options || {};
  this.searchFields = options.searchFields ||
    MusicLibraryIndex.defaultSearchFields;
  this.variousArtistsKey = options.variousArtistsKey ||
    MusicLibraryIndex.defaultVariousArtistsKey;
  this.variousArtistsName = options.variousArtistsName ||
    MusicLibraryIndex.defaultVariousArtistsName;
  this.prefixesToStrip = options.prefixesToStrip ||
    MusicLibraryIndex.defaultPrefixesToStrip;

  this.artistComparator = this.artistComparator.bind(this);
  this.albumComparator = this.albumComparator.bind(this);
  this.trackComparator = this.trackComparator.bind(this);
  this.clear();
}

MusicLibraryIndex.prototype.stripPrefixes = function(str) {
  for (var i = 0; i < this.prefixesToStrip.length; i += 1) {
    var regex = this.prefixesToStrip[i];
    str = str.replace(regex, '');
    break;
  }
  return str;
};

MusicLibraryIndex.prototype.sortableTitle = function(title) {
  return this.stripPrefixes(formatSearchable(title));
};

MusicLibraryIndex.prototype.titleCompare = function(a, b) {
  var _a = this.sortableTitle(a);
  var _b = this.sortableTitle(b);
  if (_a < _b) {
    return -1;
  } else if (_a > _b) {
    return 1;
  } else {
    if (a < b) {
      return -1;
    } else if (a > b) {
      return 1;
    } else {
      return 0;
    }
  }
};

MusicLibraryIndex.prototype.trackComparator = function(a, b) {
  if (a.disc < b.disc) {
    return -1;
  } else if (a.disc > b.disc) {
    return 1;
  } else if (a.track < b.track) {
    return -1;
  } else if (a.track > b.track) {
    return 1;
  } else {
    return this.titleCompare(a.name, b.name);
  }
}

MusicLibraryIndex.prototype.albumComparator = function(a, b) {
  if (a.year < b.year) {
    return -1;
  } else if (a.year > b.year) {
    return 1;
  } else {
    return this.titleCompare(a.name, b.name);
  }
}

MusicLibraryIndex.prototype.artistComparator = function(a, b) {
  return this.titleCompare(a.name, b.name);
}

MusicLibraryIndex.prototype.getAlbumKey = function(track) {
  var artistName = track.albumArtistName ||
    (track.compilation ? this.variousArtistsName : track.artistName);
  return formatSearchable(track.albumName + "\n" + artistName);
};

MusicLibraryIndex.prototype.getArtistKey = function(artistName) {
  return formatSearchable(artistName);
};

MusicLibraryIndex.prototype.clear = function() {
  this.trackTable = {};
  this.artistTable = {};
  this.artistList = [];
  this.albumTable = {};
  this.albumList = [];
  this.dirty = false;
  this.dirtyAlbumTable = false;
};

MusicLibraryIndex.prototype.rebuildAlbumTable = function() {
  if (!this.dirtyAlbumTable) return;

  // builds everything from trackTable
  this.artistTable = {};
  this.artistList = [];
  this.albumTable = {};
  this.albumList = [];
  var thisAlbumList = this.albumList;
  for (var trackKey in this.trackTable) {
    var track = this.trackTable[trackKey];
    this.trackTable[track.key] = track;

    var searchTags = "";
    for (var i = 0; i < this.searchFields.length; i += 1) {
      searchTags += track[this.searchFields[i]] + "\n";
    }
    track.searchTags = formatSearchable(searchTags);

    if (!track.albumName) {
      // ignore album artist if there's no album
      track.albumArtistName = track.artistName;
    }
    track.albumArtistName = track.albumArtistName || "";

    var albumKey = this.getAlbumKey(track);
    var album = getOrCreate(albumKey, this.albumTable, createAlbum);
    track.album = album;
    album.trackList.push(track);
    if (album.year == null) {
      album.year = track.year;
    }
  }

  this.dirtyAlbumTable = false;

  function createAlbum() {
    var album = {
      name: track.albumName,
      year: track.year,
      trackList: [],
      key: albumKey,
    };
    thisAlbumList.push(album);
    return album;
  }
};

MusicLibraryIndex.prototype.rebuild = function() {
  if (!this.dirty) return;
  this.rebuildAlbumTable();
  this.albumList.sort(this.albumComparator);

  var albumArtistName, artistKey, artist;
  var albumKey, track, album;
  var i;
  for (albumKey in this.albumTable) {
    album = this.albumTable[albumKey];
    var albumArtistSet = {};
    album.trackList.sort(this.trackComparator);
    albumArtistName = "";
    for (i = 0; i < album.trackList.length; i += 1) {
      track = album.trackList[i];
      track.index = i;
      if (track.albumArtistName) {
        albumArtistName = track.albumArtistName;
        albumArtistSet[this.getArtistKey(albumArtistName)] = true;
      }
      if (!albumArtistName) albumArtistName = track.artistName;
      albumArtistSet[this.getArtistKey(track.artistName)] = true;
    }
    if (moreThanOneKey(albumArtistSet)) {
      albumArtistName = this.variousArtistsName;
      artistKey = this.variousArtistsKey;
      for (i = 0; i < album.trackList.length; i += 1) {
        track = album.trackList[i];
        track.compilation = true;
        track.albumArtistName = this.variousArtistsName;
      }
    } else {
      artistKey = this.getArtistKey(albumArtistName);
    }
    artist = getOrCreate(artistKey, this.artistTable, createArtist);
    album.artist = artist;
    artist.albumList.push(album);
  }

  this.artistList = [];
  var variousArtist = null;
  for (artistKey in this.artistTable) {
    artist = this.artistTable[artistKey];
    artist.albumList.sort(this.albumComparator);
    for (i = 0; i < artist.albumList.length; i += 1) {
      album = artist.albumList[i];
      album.index = i;
    }
    if (artist.key === this.variousArtistsKey) {
      variousArtist = artist;
    } else {
      this.artistList.push(artist);
    }
  }
  this.artistList.sort(this.artistComparator);
  if (variousArtist) {
    this.artistList.splice(0, 0, variousArtist);
  }
  for (i = 0; i < this.artistList.length; i += 1) {
    artist = this.artistList[i];
    artist.index = i;
  }

  this.dirty = false;

  function createArtist() {
    return {
      name: albumArtistName,
      albumList: [],
      key: artistKey,
    };
  }
}

MusicLibraryIndex.prototype.addTrack = function(track) {
  var oldTrack = this.trackTable[track.key];
  this.dirty = this.dirty ||
      oldTrack == null ||
      oldTrack.artistName !== track.artistName ||
      oldTrack.albumArtistName !== track.albumArtistName ||
      oldTrack.albumName !== track.albumName ||
      oldTrack.track !== track.track ||
      oldTrack.disc !== track.disc ||
      oldTrack.year !== track.year;
  this.dirtyAlbumTable = this.dirty;
  this.trackTable[track.key] = track;
}

MusicLibraryIndex.prototype.removeTrack = function(key) {
  delete this.trackTable[key];
  this.dirty = true;
  this.dirtyAlbumTable = true;
}

MusicLibraryIndex.prototype.search = function(query) {
  query = query.trim();

  var searchResults = new MusicLibraryIndex({
    searchFields: this.searchFields,
    variousArtistsKey: this.variousArtistsKey,
    variousArtistsName: this.variousArtistsName,
    prefixesToStrip: this.prefixesToStrip,
  });

  var words = formatSearchable(query).split(/\s+/);

  var track;
  for (var trackKey in this.trackTable) {
    track = this.trackTable[trackKey];
    if (testMatch()) {
      searchResults.trackTable[track.key] = track;
    }
  }
  searchResults.dirty = true;
  searchResults.dirtyAlbumTable = true;
  searchResults.rebuild();

  return searchResults;

  function testMatch() {
    for (var i = 0; i < words.length; i += 1) {
      var word = words[i];
      if (track.searchTags.indexOf(word) === -1) {
        return false;
      }
    }
    return true;
  }
};

function getOrCreate(key, table, initObjFunc) {
  var result = table[key];
  if (result == null) {
    result = initObjFunc();
    table[key] = result;
  }
  return result;
}

function moreThanOneKey(object){
  var count = -2;
  for (var k in object) {
    if (!++count) {
      return true;
    }
  }
  return false;
}

function formatSearchable(str) {
  return removeDiacritics(str).toLowerCase();
}

},{"diacritics":31}],31:[function(require,module,exports){
var DIACRITICS_REMOVAL_MAP = [
  {
    base: ' ',
    regex: /[\u00A0]/g
  }, {
    base: '0',
    regex: /[\u07C0]/g
  }, {
    base: 'A',
    regex: /[\u0041\u24B6\uFF21\u00C0\u00C1\u00C2\u1EA6\u1EA4\u1EAA\u1EA8\u00C3\u0100\u0102\u1EB0\u1EAE\u1EB4\u1EB2\u0226\u01E0\u00C4\u01DE\u1EA2\u00C5\u01FA\u01CD\u0200\u0202\u1EA0\u1EAC\u1EB6\u1E00\u0104\u023A\u2C6F]/g
  }, {
    base: 'AA',
    regex: /[\uA732]/g
  }, {
    base: 'AE',
    regex: /[\u00C6\u01FC\u01E2]/g
  }, {
    base: 'AO',
    regex: /[\uA734]/g
  }, {
    base: 'AU',
    regex: /[\uA736]/g
  }, {
    base: 'AV',
    regex: /[\uA738\uA73A]/g
  }, {
    base: 'AY',
    regex: /[\uA73C]/g
  }, {
    base: 'B',
    regex: /[\u0042\u24B7\uFF22\u1E02\u1E04\u1E06\u0243\u0181]/g
  }, {
    base: 'C',
    regex: /[\uFF43\u24b8\uff23\uA73E\u1E08]/g
  }, {
    base: 'D',
    regex: /[\u0044\u24B9\uFF24\u1E0A\u010E\u1E0C\u1E10\u1E12\u1E0E\u0110\u018A\u0189\u1D05\uA779]/g
  }, {
    base: 'Dh',
    regex: /[\u00D0]/g
  }, {
    base: 'DZ',
    regex: /[\u01F1\u01C4]/g
  }, {
    base: 'Dz',
    regex: /[\u01F2\u01C5]/g
  }, {
    base: 'E',
    regex: /[\u025B\u0045\u24BA\uFF25\u00C8\u00C9\u00CA\u1EC0\u1EBE\u1EC4\u1EC2\u1EBC\u0112\u1E14\u1E16\u0114\u0116\u00CB\u1EBA\u011A\u0204\u0206\u1EB8\u1EC6\u0228\u1E1C\u0118\u1E18\u1E1A\u0190\u018E\u1D07]/g
  }, {
    base: 'F',
    regex: /[\uA77C\u0046\u24BB\uFF26\u1E1E\u0191\uA77B]/g
  }, {
    base: 'G',
    regex: /[\u0047\u24BC\uFF27\u01F4\u011C\u1E20\u011E\u0120\u01E6\u0122\u01E4\u0193\uA7A0\uA77D\uA77E\u0262]/g
  }, {
    base: 'H',
    regex: /[\u0048\u24BD\uFF28\u0124\u1E22\u1E26\u021E\u1E24\u1E28\u1E2A\u0126\u2C67\u2C75\uA78D]/g
  }, {
    base: 'I',
    regex: /[\x49\u24BE\uFF29\xCC\xCD\xCE\u0128\u012A\u012C\u0130\xCF\u1E2E\u1EC8\u01CF\u0208\u020A\u1ECA\u012E\u1E2C\u0197]/g
  }, {
    base: 'J',
    regex: /[\x4A\u24BF\uFF2A\u0134\u0248\u0237]/g
  }, {
    base: 'K',
    regex: /[\x4B\u24C0\uFF2B\u1E30\u01E8\u1E32\u0136\u1E34\u0198\u2C69\uA740\uA742\uA744\uA7A2]/g
  }, {
    base: 'L',
    regex: /[\x4C\u24C1\uFF2C\u013F\u0139\u013D\u1E36\u1E38\u013B\u1E3C\u1E3A\u0141\u023D\u2C62\u2C60\uA748\uA746\uA780]/g
  }, {
    base: 'LJ',
    regex: /[\u01C7]/g
  }, {
    base: 'Lj',
    regex: /[\u01C8]/g
  }, {
    base: 'M',
    regex: /[\x4D\u24C2\uFF2D\u1E3E\u1E40\u1E42\u2C6E\u019C\u03FB]/g
  }, {
    base: 'N',
    regex: /[\uA7A4\u0220\x4E\u24C3\uFF2E\u01F8\u0143\xD1\u1E44\u0147\u1E46\u0145\u1E4A\u1E48\u019D\uA790\u1D0E]/g
  }, {
    base: 'NJ',
    regex: /[\u01CA]/g
  }, {
    base: 'Nj',
    regex: /[\u01CB]/g
  }, {
    base: 'O',
    regex: /[\u24C4\uFF2F\xD2\xD3\xD4\u1ED2\u1ED0\u1ED6\u1ED4\xD5\u1E4C\u022C\u1E4E\u014C\u1E50\u1E52\u014E\u022E\u0230\xD6\u022A\u1ECE\u0150\u01D1\u020C\u020E\u01A0\u1EDC\u1EDA\u1EE0\u1EDE\u1EE2\u1ECC\u1ED8\u01EA\u01EC\xD8\u01FE\u0186\x4F\u019F\uA74A\uA74C]/g
  }, {
    base: 'OE',
    regex: /[\u0152]/g
  }, {
    base: 'OI',
    regex: /[\u01A2]/g
  }, {
    base: 'OO',
    regex: /[\uA74E]/g
  }, {
    base: 'OU',
    regex: /[\u0222]/g
  }, {
    base: 'P',
    regex: /[\x50\u24C5\uFF30\u1E54\u1E56\u01A4\u2C63\uA750\uA752\uA754]/g
  }, {
    base: 'Q',
    regex: /[\x51\u24C6\uFF31\uA756\uA758\u024A]/g
  }, {
    base: 'R',
    regex: /[\x52\u24C7\uFF32\u0154\u1E58\u0158\u0210\u0212\u1E5A\u1E5C\u0156\u1E5E\u024C\u2C64\uA75A\uA7A6\uA782]/g
  }, {
    base: 'S',
    regex: /[\x53\u24C8\uFF33\u1E9E\u015A\u1E64\u015C\u1E60\u0160\u1E66\u1E62\u1E68\u0218\u015E\u2C7E\uA7A8\uA784]/g
  }, {
    base: 'T',
    regex: /[\x54\u24C9\uFF34\u1E6A\u0164\u1E6C\u021A\u0162\u1E70\u1E6E\u0166\u01AC\u01AE\u023E\uA786]/g
  }, {
    base: 'Th',
    regex: /[\u00DE]/g
  }, {
    base: 'TZ',
    regex: /[\uA728]/g
  }, {
    base: 'U',
    regex: /[\x55\u24CA\uFF35\xD9\xDA\xDB\u0168\u1E78\u016A\u1E7A\u016C\xDC\u01DB\u01D7\u01D5\u01D9\u1EE6\u016E\u0170\u01D3\u0214\u0216\u01AF\u1EEA\u1EE8\u1EEE\u1EEC\u1EF0\u1EE4\u1E72\u0172\u1E76\u1E74\u0244]/g
  }, {
    base: 'V',
    regex: /[\x56\u24CB\uFF36\u1E7C\u1E7E\u01B2\uA75E\u0245]/g
  }, {
    base: 'VY',
    regex: /[\uA760]/g
  }, {
    base: 'W',
    regex: /[\x57\u24CC\uFF37\u1E80\u1E82\u0174\u1E86\u1E84\u1E88\u2C72]/g
  }, {
    base: 'X',
    regex: /[\x58\u24CD\uFF38\u1E8A\u1E8C]/g
  }, {
    base: 'Y',
    regex: /[\x59\u24CE\uFF39\u1EF2\xDD\u0176\u1EF8\u0232\u1E8E\u0178\u1EF6\u1EF4\u01B3\u024E\u1EFE]/g
  }, {
    base: 'Z',
    regex: /[\x5A\u24CF\uFF3A\u0179\u1E90\u017B\u017D\u1E92\u1E94\u01B5\u0224\u2C7F\u2C6B\uA762]/g
  }, {
    base: 'a',
    regex: /[\u0061\u24D0\uFF41\u1E9A\u00E0\u00E1\u00E2\u1EA7\u1EA5\u1EAB\u1EA9\u00E3\u0101\u0103\u1EB1\u1EAF\u1EB5\u1EB3\u0227\u01E1\u00E4\u01DF\u1EA3\u00E5\u01FB\u01CE\u0201\u0203\u1EA1\u1EAD\u1EB7\u1E01\u0105\u2C65\u0250\u0251]/g
  }, {
    base: 'aa',
    regex: /[\uA733]/g
  }, {
    base: 'ae',
    regex: /[\u00E6\u01FD\u01E3]/g
  }, {
    base: 'ao',
    regex: /[\uA735]/g
  }, {
    base: 'au',
    regex: /[\uA737]/g
  }, {
    base: 'av',
    regex: /[\uA739\uA73B]/g
  }, {
    base: 'ay',
    regex: /[\uA73D]/g
  }, {
    base: 'b',
    regex: /[\u0062\u24D1\uFF42\u1E03\u1E05\u1E07\u0180\u0183\u0253\u0182]/g
  }, {
    base: 'c',
    regex: /[\u0063\u24D2\u0107\u0109\u010B\u010D\u00E7\u1E09\u0188\u023C\uA73F\u2184\u0043\u0106\u0108\u010A\u010C\u00C7\u0187\u023B]/g
  }, {
    base: 'd',
    regex: /[\u0064\u24D3\uFF44\u1E0B\u010F\u1E0D\u1E11\u1E13\u1E0F\u0111\u018C\u0256\u0257\u018B\u13E7\u0501\uA7AA]/g
  }, {
    base: 'dh',
    regex: /[\u00F0]/g
  }, {
    base: 'dz',
    regex: /[\u01F3\u01C6]/g
  }, {
    base: 'e',
    regex: /[\u0065\u24D4\uFF45\u00E8\u00E9\u00EA\u1EC1\u1EBF\u1EC5\u1EC3\u1EBD\u0113\u1E15\u1E17\u0115\u0117\u00EB\u1EBB\u011B\u0205\u0207\u1EB9\u1EC7\u0229\u1E1D\u0119\u1E19\u1E1B\u0247\u01DD]/g
  }, {
    base: 'f',
    regex: /[\u0066\u24D5\uFF46\u1E1F\u0192]/g
  }, {
    base: 'ff',
    regex: /[\uFB00]/g
  }, {
    base: 'fi',
    regex: /[\uFB01]/g
  }, {
    base: 'fl',
    regex: /[\uFB02]/g
  }, {
    base: 'ffi',
    regex: /[\uFB03]/g
  }, {
    base: 'ffl',
    regex: /[\uFB04]/g
  }, {
    base: 'g',
    regex: /[\u0067\u24D6\uFF47\u01F5\u011D\u1E21\u011F\u0121\u01E7\u0123\u01E5\u0260\uA7A1\uA77F\u1D79]/g
  }, {
    base: 'h',
    regex: /[\u0068\u24D7\uFF48\u0125\u1E23\u1E27\u021F\u1E25\u1E29\u1E2B\u1E96\u0127\u2C68\u2C76\u0265]/g
  }, {
    base: 'hv',
    regex: /[\u0195]/g
  }, {
    base: 'i',
    regex: /[\x69\u24D8\uFF49\xEC\xED\xEE\u0129\u012B\u012D\xEF\u1E2F\u1EC9\u01D0\u0209\u020B\u1ECB\u012F\u1E2D\u0268\u0131]/g
  }, {
    base: 'j',
    regex: /[\x6A\u24D9\uFF4A\u0135\u01F0\u0249]/g
  }, {
    base: 'k',
    regex: /[\x6B\u24DA\uFF4B\u1E31\u01E9\u1E33\u0137\u1E35\u0199\u2C6A\uA741\uA743\uA745\uA7A3]/g
  }, {
    base: 'l',
    regex: /[\x6C\u24DB\uFF4C\u0140\u013A\u013E\u1E37\u1E39\u013C\u1E3D\u1E3B\u017F\u0142\u019A\u026B\u2C61\uA749\uA781\uA747\u026D]/g
  }, {
    base: 'lj',
    regex: /[\u01C9]/g
  }, {
    base: 'm',
    regex: /[\x6D\u24DC\uFF4D\u1E3F\u1E41\u1E43\u0271\u026F]/g
  }, {
    base: 'n',
    regex: /[\x6E\u24DD\uFF4E\u01F9\u0144\xF1\u1E45\u0148\u1E47\u0146\u1E4B\u1E49\u019E\u0272\u0149\uA791\uA7A5\u043B\u0509]/g
  }, {
    base: 'nj',
    regex: /[\u01CC]/g
  }, {
    base: 'o',
    regex: /[\x6F\u24DE\uFF4F\xF2\xF3\xF4\u1ED3\u1ED1\u1ED7\u1ED5\xF5\u1E4D\u022D\u1E4F\u014D\u1E51\u1E53\u014F\u022F\u0231\xF6\u022B\u1ECF\u0151\u01D2\u020D\u020F\u01A1\u1EDD\u1EDB\u1EE1\u1EDF\u1EE3\u1ECD\u1ED9\u01EB\u01ED\xF8\u01FF\uA74B\uA74D\u0275\u0254\u1D11]/g
  }, {
    base: 'oe',
    regex: /[\u0153]/g
  }, {
    base: 'oi',
    regex: /[\u01A3]/g
  }, {
    base: 'oo',
    regex: /[\uA74F]/g
  }, {
    base: 'ou',
    regex: /[\u0223]/g
  }, {
    base: 'p',
    regex: /[\x70\u24DF\uFF50\u1E55\u1E57\u01A5\u1D7D\uA751\uA753\uA755\u03C1]/g
  }, {
    base: 'q',
    regex: /[\x71\u24E0\uFF51\u024B\uA757\uA759]/g
  }, {
    base: 'r',
    regex: /[\x72\u24E1\uFF52\u0155\u1E59\u0159\u0211\u0213\u1E5B\u1E5D\u0157\u1E5F\u024D\u027D\uA75B\uA7A7\uA783]/g
  }, {
    base: 's',
    regex: /[\x73\u24E2\uFF53\u015B\u1E65\u015D\u1E61\u0161\u1E67\u1E63\u1E69\u0219\u015F\u023F\uA7A9\uA785\u1E9B\u0282]/g
  }, {
    base: 'ss',
    regex: /[\xDF]/g
  }, {
    base: 't',
    regex: /[\x74\u24E3\uFF54\u1E6B\u1E97\u0165\u1E6D\u021B\u0163\u1E71\u1E6F\u0167\u01AD\u0288\u2C66\uA787]/g
  }, {
    base: 'th',
    regex: /[\u00FE]/g
  }, {
    base: 'tz',
    regex: /[\uA729]/g
  }, {
    base: 'u',
    regex: /[\x75\u24E4\uFF55\xF9\xFA\xFB\u0169\u1E79\u016B\u1E7B\u016D\xFC\u01DC\u01D8\u01D6\u01DA\u1EE7\u016F\u0171\u01D4\u0215\u0217\u01B0\u1EEB\u1EE9\u1EEF\u1EED\u1EF1\u1EE5\u1E73\u0173\u1E77\u1E75\u0289]/g
  }, {
    base: 'v',
    regex: /[\x76\u24E5\uFF56\u1E7D\u1E7F\u028B\uA75F\u028C]/g
  }, {
    base: 'vy',
    regex: /[\uA761]/g
  }, {
    base: 'w',
    regex: /[\x77\u24E6\uFF57\u1E81\u1E83\u0175\u1E87\u1E85\u1E98\u1E89\u2C73]/g
  }, {
    base: 'x',
    regex: /[\x78\u24E7\uFF58\u1E8B\u1E8D]/g
  }, {
    base: 'y',
    regex: /[\x79\u24E8\uFF59\u1EF3\xFD\u0177\u1EF9\u0233\u1E8F\xFF\u1EF7\u1E99\u1EF5\u01B4\u024F\u1EFF]/g
  }, {
    base: 'z',
    regex: /[\x7A\u24E9\uFF5A\u017A\u1E91\u017C\u017E\u1E93\u1E95\u01B6\u0225\u0240\u2C6C\uA763]/g
  }
], MAP_LENGTH = DIACRITICS_REMOVAL_MAP.length;

var ALL_ASCII_REGEX = /^[\x00-\x7f]*$/;

exports.remove = function (str) {
  if (ALL_ASCII_REGEX.test(str)) {
    // this code path is roughly 15x faster (at the time of writing),
    // and it is the common case.
    return str;
  }
  for (var i = 0; i < MAP_LENGTH; ++i) {
    var removal = DIACRITICS_REMOVAL_MAP[i];
    str = str.replace(removal.regex, removal.base);
  }
  return str;
}

},{}],32:[function(require,module,exports){
(function (global){

var rng;

if (global.crypto && crypto.getRandomValues) {
  // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
  // Moderately fast, high quality
  var _rnds8 = new Uint8Array(16);
  rng = function whatwgRNG() {
    crypto.getRandomValues(_rnds8);
    return _rnds8;
  };
}

if (!rng) {
  // Math.random()-based (RNG)
  //
  // If all else fails, use Math.random().  It's fast, but is of unspecified
  // quality.
  var  _rnds = new Array(16);
  rng = function() {
    for (var i = 0, r; i < 16; i++) {
      if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
      _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
    }

    return _rnds;
  };
}

module.exports = rng;


}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],33:[function(require,module,exports){
(function (Buffer){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

// Unique ID creation requires a high quality random # generator.  We feature
// detect to determine the best RNG source, normalizing to a function that
// returns 128-bits of randomness, since that's what's usually required
var _rng = require('./rng');

// Buffer class to use
var BufferClass = typeof(Buffer) == 'function' ? Buffer : Array;

// Maps for number <-> hex string conversion
var _byteToHex = [];
var _hexToByte = {};
for (var i = 0; i < 256; i++) {
  _byteToHex[i] = (i + 0x100).toString(16).substr(1);
  _hexToByte[_byteToHex[i]] = i;
}

// **`parse()` - Parse a UUID into it's component bytes**
function parse(s, buf, offset) {
  var i = (buf && offset) || 0, ii = 0;

  buf = buf || [];
  s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
    if (ii < 16) { // Don't overflow!
      buf[i + ii++] = _hexToByte[oct];
    }
  });

  // Zero out remaining bytes if string was short
  while (ii < 16) {
    buf[i + ii++] = 0;
  }

  return buf;
}

// **`unparse()` - Convert UUID byte array (ala parse()) into a string**
function unparse(buf, offset) {
  var i = offset || 0, bth = _byteToHex;
  return  bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]];
}

// **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html

// random #'s we need to init node and clockseq
var _seedBytes = _rng();

// Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
var _nodeId = [
  _seedBytes[0] | 0x01,
  _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
];

// Per 4.2.2, randomize (14 bit) clockseq
var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

// Previous uuid creation time
var _lastMSecs = 0, _lastNSecs = 0;

// See https://github.com/broofa/node-uuid for API details
function v1(options, buf, offset) {
  var i = buf && offset || 0;
  var b = buf || [];

  options = options || {};

  var clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq;

  // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
  var msecs = options.msecs !== undefined ? options.msecs : new Date().getTime();

  // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock
  var nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1;

  // Time since last uuid creation (in msecs)
  var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

  // Per 4.2.1.2, Bump clockseq on clock regression
  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  }

  // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval
  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  }

  // Per 4.2.1.2 Throw error if too many uuids are requested
  if (nsecs >= 10000) {
    throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq;

  // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
  msecs += 12219292800000;

  // `time_low`
  var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff;

  // `time_mid`
  var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff;

  // `time_high_and_version`
  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
  b[i++] = tmh >>> 16 & 0xff;

  // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
  b[i++] = clockseq >>> 8 | 0x80;

  // `clock_seq_low`
  b[i++] = clockseq & 0xff;

  // `node`
  var node = options.node || _nodeId;
  for (var n = 0; n < 6; n++) {
    b[i + n] = node[n];
  }

  return buf ? buf : unparse(b);
}

// **`v4()` - Generate random UUID**

// See https://github.com/broofa/node-uuid for API details
function v4(options, buf, offset) {
  // Deprecated - 'format' argument, as supported in v1.2
  var i = buf && offset || 0;

  if (typeof(options) == 'string') {
    buf = options == 'binary' ? new BufferClass(16) : null;
    options = null;
  }
  options = options || {};

  var rnds = options.random || (options.rng || _rng)();

  // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
  rnds[6] = (rnds[6] & 0x0f) | 0x40;
  rnds[8] = (rnds[8] & 0x3f) | 0x80;

  // Copy bytes to buffer, if provided
  if (buf) {
    for (var ii = 0; ii < 16; ii++) {
      buf[i + ii] = rnds[ii];
    }
  }

  return buf || unparse(rnds);
}

// Export public API
var uuid = v4;
uuid.v1 = v1;
uuid.v4 = v4;
uuid.parse = parse;
uuid.unparse = unparse;
uuid.BufferClass = BufferClass;

module.exports = uuid;

}).call(this,require("buffer").Buffer)
},{"./rng":32,"buffer":1}],34:[function(require,module,exports){
module.exports = zfill;

function zfill(number, size) {
  number = number.toString();
  while (number.length < size) number = "0" + number;
  return number;
}

},{}],35:[function(require,module,exports){
var $ = window.$;

var shuffle = require('mess');
var querystring = require('querystring');
var zfill = require('zfill');
var PlayerClient = require('./playerclient');
var streaming = require('./streaming');
var Socket = require('./socket');
var uuid = require('uuid');

var dynamicModeOn = false;

var selection = {
  ids: {
    playlist: {},
    artist: {},
    album: {},
    track: {},
    stored_playlist: {},
    stored_playlist_item: {}
  },
  cursor: null,
  rangeSelectAnchor: null,
  rangeSelectAnchorType: null,
  type: null,
  isLibrary: function(){
    return this.type === 'artist' || this.type === 'album' || this.type === 'track';
  },
  isPlaylist: function(){
    return this.type === 'playlist';
  },
  isStoredPlaylist: function(){
    return this.type === 'stored_playlist' || this.type === 'stored_playlist_item';
  },
  clear: function(){
    this.ids.artist = {};
    this.ids.album = {};
    this.ids.track = {};
    this.ids.playlist = {};
    this.ids.stored_playlist = {};
    this.ids.stored_playlist_item = {};
  },
  fullClear: function(){
    this.clear();
    this.type = null;
    this.cursor = null;
    this.rangeSelectAnchor = null;
    this.rangeSelectAnchorType = null;
  },
  selectOnly: function(selName, key){
    this.clear();
    this.type = selName;
    this.ids[selName][key] = true;
    this.cursor = key;
    this.rangeSelectAnchor = key;
    this.rangeSelectAnchorType = selName;
  },
  isMulti: function(){
    var result, k;
    if (this.isLibrary()) {
      result = 2;
      for (k in this.ids.artist) {
        if (!--result) return true;
      }
      for (k in this.ids.album) {
        if (!--result) return true;
      }
      for (k in this.ids.track) {
        if (!--result) return true;
      }
      return false;
    } else if (this.isPlaylist()) {
      result = 2;
      for (k in this.ids.playlist) {
        if (!--result) return true;
      }
      return false;
    } else if (this.isStoredPlaylist()) {
      result = 2;
      for (k in this.ids.stored_playlist) {
        if (!--result) return true;
      }
      for (k in this.ids.stored_playlist_item) {
        if (!--result) return true;
      }
      return false;
    } else {
      return false;
    }
  },
  getPos: function(type, key){
    if (type == null) type = this.type;
    if (key == null) key = this.cursor;
    var val;
    if (this.isLibrary()) {
      val = {
        type: 'library',
        artist: null,
        album: null,
        track: null
      };
      if (key != null) {
        switch (type) {
          case 'track':
            val.track = player.searchResults.trackTable[key];
            val.album = val.track.album;
            val.artist = val.album.artist;
            break;
          case 'album':
            val.album = player.searchResults.albumTable[key];
            val.artist = val.album.artist;
            break;
          case 'artist':
            val.artist = player.searchResults.artistTable[key];
            break;
        }
      } else {
        val.artist = player.searchResults.artistList[0];
      }
    } else if (this.isStoredPlaylist()) {
      val = {
        type: 'stored_playlist',
        stored_playlist: null,
        stored_playlist_item: null
      };
      if (key != null) {
        switch (type) {
          case 'stored_playlist_item':
            val.stored_playlist_item = player.stored_playlist_item_table[key];
            val.stored_playlist = val.stored_playlist_item.playlist;
            break;
          case 'stored_playlist':
            val.stored_playlist = player.stored_playlist_table[key];
            break;
        }
      } else {
        val.stored_playlist = player.stored_playlists[0];
      }
    } else {
      throw new Error("NothingSelected");
    }
    return val;
  },
  posToArr: function(pos){
    var ref$;
    if (pos.type === 'library') {
      return [(ref$ = pos.artist) != null ? ref$.index : void 8, (ref$ = pos.album) != null ? ref$.index : void 8, (ref$ = pos.track) != null ? ref$.index : void 8];
    } else if (pos.type === 'stored_playlist') {
      return [(ref$ = pos.stored_playlist) != null ? ref$.index : void 8, (ref$ = pos.stored_playlist_item) != null ? ref$.index : void 8];
    } else {
      throw new Error("NothingSelected");
    }
  },
  posEqual: function(pos1, pos2){
    var arr1 = this.posToArr(pos1);
    var arr2 = this.posToArr(pos2);
    return compareArrays(arr1, arr2) === 0;
  },
  posInBounds: function(pos){
    if (pos.type === 'library') {
      return pos.artist != null;
    } else if (pos.type === 'stored_playlist') {
      return pos.stored_playlist != null;
    } else {
      throw new Error("NothingSelected");
    }
  },
  selectPos: function(pos){
    if (pos.type === 'library') {
      if (pos.track != null) {
        selection.ids.track[pos.track.key] = true;
      } else if (pos.album != null) {
        selection.ids.album[pos.album.key] = true;
      } else if (pos.artist != null) {
        selection.ids.artist[pos.artist.key] = true;
      }
    } else if (pos.type === 'stored_playlist') {
      if (pos.stored_playlist_item != null) {
        selection.ids.stored_playlist_item[pos.stored_playlist_item] = true;
      } else if (pos.stored_playlist != null) {
        selection.ids.stored_playlist[pos.stored_playlist] = true;
      }
    } else {
      throw new Error("NothingSelected");
    }
  },
  incrementPos: function(pos){
    if (pos.type === 'library') {
      if (pos.track != null) {
        pos.track = pos.track.album.trackList[pos.track.index + 1];
        if (pos.track == null) {
          pos.album = pos.artist.albumList[pos.album.index + 1];
          if (pos.album == null) {
            pos.artist = player.searchResults.artistList[pos.artist.index + 1];
          }
        }
      } else if (pos.album != null) {
        if (isAlbumExpanded(pos.album)) {
          pos.track = pos.album.trackList[0];
        } else {
          var nextAlbum = pos.artist.albumList[pos.album.index + 1];
          if (nextAlbum) {
            pos.album = nextAlbum;
          } else {
            pos.artist = player.searchResults.artistList[pos.artist.index + 1];
            pos.album = null;
          }
        }
      } else if (pos.artist != null) {
        if (isArtistExpanded(pos.artist)) {
          pos.album = pos.artist.albumList[0];
        } else {
          pos.artist = player.searchResults.artistList[pos.artist.index + 1];
        }
      }
    } else if (pos.type === 'stored_playlist') {
      if (pos.stored_playlist_item != null) {
        pos.stored_playlist_item = pos.stored_playlist_item.playlist.itemList[pos.stored_playlist_item.index + 1];
        if (pos.stored_playlist_item == null) {
          pos.stored_playlist = player.stored_playlists[pos.stored_playlist.index + 1];
        }
      } else if (pos.stored_playlist != null) {
        if (isStoredPlaylistExpanded(pos.stored_playlist)) {
          pos.stored_playlist_item = pos.stored_playlist.itemList[0];
          if (pos.stored_playlist_item == null) {
            pos.stored_playlist = player.stored_playlists[pos.stored_playlist.index + 1];
          }
        } else {
          pos.stored_playlist = player.stored_playlists[pos.stored_playlist.index + 1];
        }
      }
    } else {
      throw new Error("NothingSelected");
    }
  },
  toTrackKeys: function(random){
    var this$ = this;
    if (random == null) random = false;
    if (this.isLibrary()) {
      return libraryToTrackKeys();
    } else if (this.isPlaylist()) {
      return playlistToTrackKeys();
    } else if (this.isStoredPlaylist()) {
      return storedPlaylistToTrackKeys();
    } else {
      throw new Error("NothingSelected");
    }

    function libraryToTrackKeys() {
      var key;
      var track_set = {};
      function selRenderArtist(artist){
        var i, ref$, len$, album;
        for (i = 0, len$ = (ref$ = artist.albumList).length; i < len$; ++i) {
          album = ref$[i];
          selRenderAlbum(album);
        }
      }
      function selRenderAlbum(album){
        var i, ref$, len$, track;
        for (i = 0, len$ = (ref$ = album.trackList).length; i < len$; ++i) {
          track = ref$[i];
          selRenderTrack(track);
        }
      }
      function selRenderTrack(track){
        track_set[track.key] = this$.posToArr(getTrackSelPos(track));
      }
      function getTrackSelPos(track){
        return {
          type: 'library',
          artist: track.album.artist,
          album: track.album,
          track: track
        };
      }
      for (key in selection.ids.artist) {
        selRenderArtist(player.searchResults.artistTable[key]);
      }
      for (key in selection.ids.album) {
        selRenderAlbum(player.searchResults.albumTable[key]);
      }
      for (key in selection.ids.track) {
        selRenderTrack(player.searchResults.trackTable[key]);
      }
      return trackSetToKeys(track_set);
    }
    function playlistToTrackKeys(){
      var keys = [];
      for (var key in selection.ids.playlist) {
        keys.push(player.playlist.itemTable[key].track.key);
      }
      if (random) shuffle(keys);
      return keys;
    }
    function storedPlaylistToTrackKeys(){
      var track_set = {};
      function renderPlaylist(playlist){
        var i, ref$, len$, item;
        for (i = 0, len$ = (ref$ = playlist.itemList).length; i < len$; ++i) {
          item = ref$[i];
          renderPlaylistItem(item);
        }
      }
      function renderPlaylistItem(item){
        track_set[item.track.key] = this$.posToArr(getItemSelPos(item));
      }
      function getItemSelPos(item){
        return {
          type: 'stored_playlist',
          stored_playlist: item.playlist,
          stored_playlist_item: item
        };
      }
      for (var key in selection.ids.stored_playlist) {
        renderPlaylist(player.stored_playlist_table[key]);
      }
      for (key in selection.ids.stored_playlist_item) {
        renderPlaylistItem(player.stored_playlist_item_table[key]);
      }
      return trackSetToKeys(track_set);
    }

    function trackSetToKeys(track_set){
      var key;
      var keys = [];
      if (random) {
        for (key in track_set) {
          keys.push(key);
        }
        shuffle(keys);
        return keys;
      }
      var track_arr = [];
      for (key in track_set) {
        track_arr.push({
          key: key,
          pos: track_set[key],
        });
      }
      track_arr.sort(function(a, b) {
        return compareArrays(a.pos, b.pos);
      });
      for (var i = 0; i < track_arr.length; i += 1) {
        var track = track_arr[i];
        keys.push(track.key);
      }
      return keys;
    }
  }
};
var BASE_TITLE = document.title;
var MARGIN = 10;
var AUTO_EXPAND_LIMIT = 20;
var ICON_COLLAPSED = 'ui-icon-triangle-1-e';
var ICON_EXPANDED = 'ui-icon-triangle-1-se';
var permissions = {};
var socket = null;
var player = null;
var userIsSeeking = false;
var userIsVolumeSliding = false;
var started_drag = false;
var abortDrag = function(){};
var clickTab = null;
var myUserId = null;
var lastFmApiKey = null;
var LoadStatus = {
  Init: 'Loading...',
  NoServer: 'Server is down.',
  GoodToGo: '[good to go]'
};
var repeatModeNames = ["Off", "One", "All"];
var load_status = LoadStatus.Init;
var settings_ui = {
  auth: {
    show_edit: false,
    password: ""
  }
};
var localState = {
  myUserIds: {},
  userName: null,
  lastfm: {
    username: null,
    session_key: null,
    scrobbling_on: false
  },
  authPassword: null,
  autoQueueUploads: true,
};
var $document = $(document);
var $window = $(window);
var $pl_window = $('#playlist-window');
var $left_window = $('#left-window');
var $playlistItems = $('#playlist-items');
var $dynamicMode = $('#dynamic-mode');
var $pl_btn_repeat = $('#pl-btn-repeat');
var $tabs = $('#tabs');
var $upload_tab = $tabs.find('.upload-tab');
var $library = $('#library');
var $lib_filter = $('#lib-filter');
var $trackSlider = $('#track-slider');
var $nowplaying = $('#nowplaying');
var $nowplaying_elapsed = $nowplaying.find('.elapsed');
var $nowplaying_left = $nowplaying.find('.left');
var $volSlider = $('#vol-slider');
var $settings = $('#settings');
var $uploadByUrl = $('#upload-by-url');
var $main_err_msg = $('#main-err-msg');
var $main_err_msg_text = $('#main-err-msg-text');
var $stored_playlists = $('#stored-playlists');
var $upload = $('#upload');
var $track_display = $('#track-display');
var $lib_header = $('#library-pane .window-header');
var $pl_header = $pl_window.find('#playlist .header');
var $autoQueueUploads = $('#auto-queue-uploads');
var uploadInput = document.getElementById("upload-input");
var $uploadWidget = $("#upload-widget");
var $settingsEditPassword = $('#settings-edit-password');
var $settingsShowPassword = $('#settings-show-password');
var $settingsAuthCancel = $('#settings-auth-cancel');
var $settingsAuthSave = $('#settings-auth-save');
var $settingsAuthEdit = $('#settings-auth-edit');
var $settingsAuthClear = $('#settings-auth-clear');
var passwordDisplayDom = document.getElementById('password-display');
var streamUrlDom = document.getElementById('settings-stream-url');
var $authPermRead = $('#auth-perm-read');
var $authPermAdd = $('#auth-perm-add');
var $authPermControl = $('#auth-perm-control');
var $authPermAdmin = $('#auth-perm-admin');
var $lastFmSignOut = $('#lastfm-sign-out');
var $authPassword = $('#auth-password');
var lastFmAuthUrlDom = document.getElementById('lastfm-auth-url');
var $settingsLastFmIn = $('#settings-lastfm-in');
var $settingsLastFmOut = $('#settings-lastfm-out');
var settingsLastFmUserDom = document.getElementById('settings-lastfm-user');
var $toggleScrobble = $('#toggle-scrobble');
var $shortcuts = $('#shortcuts');
var $editTagsDialog = $('#edit-tags');
var $playlistMenu = $('#menu-playlist');
var $libraryMenu = $('#menu-library');

function saveLocalState(){
  localStorage.setItem('state', JSON.stringify(localState));
}

function loadLocalState() {
  var stateString = localStorage.getItem('state');
  if (!stateString) return;
  var obj;
  try {
    obj = JSON.parse(stateString);
  } catch (err) {
    return;
  }
  // this makes sure it still works when we change the format of localState
  for (var key in localState) {
    if (obj[key] !== undefined) {
      localState[key] = obj[key];
    }
  }
}

function scrollLibraryToSelection(){
  var helpers = getSelectionHelpers();
  if (helpers == null) return;
  delete helpers.playlist;
  scrollThingToSelection($library, helpers);
}

function scrollPlaylistToSelection(){
  var helpers = getSelectionHelpers();
  if (helpers == null) return;
  delete helpers.track;
  delete helpers.artist;
  delete helpers.album;
  scrollThingToSelection($playlistItems, helpers);
}

function scrollThingToSelection($scroll_area, helpers){
  var topPos = null;
  var bottomPos = null;
  for (var selName in helpers) {
    var helper = helpers[selName];
    for (var id in helper.ids) {
      var $div = helper.$getDiv(id);
      var itemTop = $div.offset().top;
      var itemBottom = itemTop + $div.height();
      if (topPos == null || itemTop < topPos) {
        topPos = itemTop;
      }
      if (bottomPos == null || itemBottom > bottomPos) {
        bottomPos = itemBottom;
      }
    }
  }
  if (topPos != null) {
    var scroll_area_top = $scroll_area.offset().top;
    var selection_top = topPos - scroll_area_top;
    var selection_bottom = bottomPos - scroll_area_top - $scroll_area.height();
    var scroll_amt = $scroll_area.scrollTop();
    if (selection_top < 0) {
      return $scroll_area.scrollTop(scroll_amt + selection_top);
    } else if (selection_bottom > 0) {
      return $scroll_area.scrollTop(scroll_amt + selection_bottom);
    }
  }
}

function downloadKeys(keys) {
  var $form = $(document.createElement('form'));
  $form.attr('action', "/download/custom");
  $form.attr('method', "post");
  $form.attr('target', "_blank");
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    var $input = $(document.createElement('input'));
    $input.attr('type', 'hidden');
    $input.attr('name', 'key');
    $input.attr('value', key);
    $form.append($input);
  }
  $form.submit();
}

function getDragPosition(x, y){
  var ref$;
  var result = {};
  for (var i = 0, len$ = (ref$ = $playlistItems.find(".pl-item").get()).length; i < len$; ++i) {
    var item = ref$[i];
    var $item = $(item);
    var middle = $item.offset().top + $item.height() / 2;
    var track = player.playlist.itemTable[$item.attr('data-id')];
    if (middle < y) {
      if (result.previous_key == null || track.sortKey > result.previous_key) {
        result.$previous = $item;
        result.previous_key = track.sortKey;
      }
    } else {
      if (result.next_key == null || track.sortKey < result.next_key) {
        result.$next = $item;
        result.next_key = track.sortKey;
      }
    }
  }
  return result;
}

function renderPlaylistButtons(){
  $dynamicMode
    .prop("checked", dynamicModeOn)
    .button("refresh");
  var repeatModeName = repeatModeNames[player.repeat];
  $pl_btn_repeat
    .button("option", "label", "Repeat: " + repeatModeName)
    .prop("checked", player.repeat !== PlayerClient.REPEAT_OFF)
    .button("refresh");
}

function renderPlaylist(){
  var itemList = player.playlist.itemList || [];
  var scrollTop = $playlistItems.scrollTop();

  // add the missing dom entries
  var i;
  var playlistItemsDom = $playlistItems.get(0);
  for (i = playlistItemsDom.childElementCount; i < itemList.length; i += 1) {
    $playlistItems.append(
      '<div class="pl-item">' +
        '<span class="track"></span>' +
        '<span class="title"></span>' +
        '<span class="artist"></span>' +
        '<span class="album"></span>' +
        '<span class="time"></span>' +
      '</div>');
  }
  // remove the extra dom entries
  var domItem;
  while (itemList.length < playlistItemsDom.childElementCount) {
    playlistItemsDom.removeChild(playlistItemsDom.lastChild);
  }

  // overwrite existing dom entries
  var $domItems = $playlistItems.children();
  var item, track;
  for (i = 0; i < itemList.length; i += 1) {
    var $domItem = $($domItems[i]);
    item = itemList[i];
    $domItem.attr('id', 'playlist-track-' + item.id);
    $domItem.attr('data-id', item.id);
    track = item.track;
    $domItem.find('.track').text(track.track || "");
    $domItem.find('.title').text(track.name || "");
    $domItem.find('.artist').text(track.artistName || "");
    $domItem.find('.album').text(track.albumName || "");
    $domItem.find('.time').text(formatTime(track.duration));
  }

  refreshSelection();
  labelPlaylistItems();
  $playlistItems.scrollTop(scrollTop);
}

function labelPlaylistItems() {
  var item;
  var curItem = player.currentItem;
  $playlistItems.find(".pl-item")
    .removeClass('current')
    .removeClass('old')
    .removeClass('random');
  if (curItem != null && dynamicModeOn) {
    for (var index = 0; index < curItem.index; ++index) {
      item = player.playlist.itemList[index];
      var itemId = item && item.id;
      if (itemId != null) {
        $("#playlist-track-" + itemId).addClass('old');
      }
    }
  }
  for (var i = 0; i < player.playlist.itemList.length; i += 1) {
    item = player.playlist.itemList[i];
    if (item.isRandom) {
      $("#playlist-track-" + item.id).addClass('random');
    }
  }
  if (curItem != null) {
    $("#playlist-track-" + curItem.id).addClass('current');
  }
}

function getSelectionHelpers(){
  if (player == null) return null;
  if (player.playlist == null) return null;
  if (player.playlist.itemTable == null) return null;
  if (player.searchResults == null) return null;
  if (player.searchResults.artistTable == null) return null;
  return {
    playlist: {
      ids: selection.ids.playlist,
      table: player.playlist.itemTable,
      $getDiv: function(id){
        return $("#playlist-track-" + id);
      },
    },
    artist: {
      ids: selection.ids.artist,
      table: player.searchResults.artistTable,
      $getDiv: function(id){
        return $("#lib-artist-" + toHtmlId(id));
      },
    },
    album: {
      ids: selection.ids.album,
      table: player.searchResults.albumTable,
      $getDiv: function(id){
        return $("#lib-album-" + toHtmlId(id));
      },
    },
    track: {
      ids: selection.ids.track,
      table: player.searchResults.trackTable,
      $getDiv: function(id){
        return $("#lib-track-" + toHtmlId(id));
      },
    },
    stored_playlist: {
      ids: selection.ids.stored_playlist,
      table: player.stored_playlist_table,
      $getDiv: function(id){
        return $("#stored-pl-pl-" + toHtmlId(id));
      },
    },
    stored_playlist_item: {
      ids: selection.ids.stored_playlist_item,
      table: player.stored_playlist_item_table,
      $getDiv: function(id){
        return $("#stored-pl-item-" + toHtmlId(id));
      },
    },
  };
}

function refreshSelection() {
  var helpers = getSelectionHelpers();
  if (helpers == null) return;
  $playlistItems  .find(".pl-item"  ).removeClass('selected').removeClass('cursor');
  $library         .find(".clickable").removeClass('selected').removeClass('cursor');
  $stored_playlists.find(".clickable").removeClass('selected').removeClass('cursor');
  if (selection.type == null) return;
  for (var selection_type in helpers) {
    var helper = helpers[selection_type];
    var id;
    // clean out stale ids
    for (id in helper.ids) {
      if (helper.table[id] == null) {
        delete helper.ids[id];
      }
    }
    for (id in helper.ids) {
      helper.$getDiv(id).addClass('selected');
    }
    if (selection.cursor != null && selection_type === selection.type) {
      var validIds = getValidIds(selection_type);
      if (validIds[selection.cursor] == null) {
        // server just deleted our current cursor item.
        // select another of our ids randomly, if we have any.
        selection.cursor = Object.keys(helper.ids)[0];
        selection.rangeSelectAnchor = selection.cursor;
        selection.rangeSelectAnchorType = selection_type;
        if (selection.cursor == null) {
          // no selected items
          selection.fullClear();
        }
      }
      if (selection.cursor != null) {
        helper.$getDiv(selection.cursor).addClass('cursor');
      }
    }
  }
}

function getValidIds(selection_type) {
  switch (selection_type) {
    case 'playlist': return player.playlist.itemTable;
    case 'artist':   return player.library.artistTable;
    case 'album':    return player.library.albumTable;
    case 'track':    return player.library.trackTable;
  }
  throw new Error("BadSelectionType");
}

var $emptyLibraryMessage = $('#empty-library-message');
var $libraryNoItems = $('#library-no-items');
var $libraryArtists = $('#library-artists');

function artistId(s) {
  return "lib-artist-" + toHtmlId(s);
}

function artistDisplayName(name) {
  return name || '[Unknown Artist]';
}

function renderLibrary() {
  var artistList = player.searchResults.artistList || [];
  var scrollTop = $library.scrollTop();

  $emptyLibraryMessage.text(player.haveFileListCache ? "No Results" : "loading...");
  $libraryNoItems.toggle(!artistList.length);

  // add the missing dom entries
  var i;
  var artistListDom = $libraryArtists.get(0);
  for (i = artistListDom.childElementCount; i < artistList.length; i += 1) {
    $libraryArtists.append(
      '<li>' +
        '<div class="clickable expandable" data-type="artist">' +
          '<div class="ui-icon"></div>' +
          '<span></span>' +
        '</div>' +
        '<ul></ul>' +
      '</li>');
  }
  // remove the extra dom entries
  var domItem;
  while (artistList.length < artistListDom.childElementCount) {
    artistListDom.removeChild(artistListDom.lastChild);
  }

  // overwrite existing dom entries
  var artist;
  var $domItems = $libraryArtists.children();
  for (i = 0; i < artistList.length; i += 1) {
    domItem = $domItems[i];
    artist = artistList[i];
    $(domItem).data('cached', false);
    var divDom = domItem.children[0];
    divDom.setAttribute('id', artistId(artist.key));
    divDom.setAttribute('data-key', artist.key);
    var iconDom = divDom.children[0];
    $(iconDom)
      .addClass(ICON_COLLAPSED)
      .removeClass(ICON_EXPANDED);
    var spanDom = divDom.children[1];
    spanDom.textContent = artistDisplayName(artist.name);
    var ulDom = domItem.children[1];
    ulDom.style.display = 'block';
    while (ulDom.firstChild) {
      ulDom.removeChild(ulDom.firstChild);
    }
  }

  var $artists = $library.children("ul").children("li");
  var nodeCount = $artists.length;
  expandStuff($artists);
  $library.scrollTop(scrollTop);
  refreshSelection();

  function expandStuff($li_set) {
    for (var i = 0; i < $li_set.length; i += 1) {
      var li = $li_set[i];
      var $li = $(li);
      if (nodeCount >= AUTO_EXPAND_LIMIT) return;
      var $ul = $li.children("ul");
      var $sub_li_set = $ul.children("li");
      var proposedNodeCount = nodeCount + $sub_li_set.length;
      if (proposedNodeCount <= AUTO_EXPAND_LIMIT) {
        toggleLibraryExpansion($li);
        $ul = $li.children("ul");
        $sub_li_set = $ul.children("li");
        nodeCount = proposedNodeCount;
        expandStuff($sub_li_set);
      }
    }
  }
}

function getCurrentTrackPosition(){
  if (player.trackStartDate != null && player.isPlaying === true) {
    return (new Date() - player.trackStartDate) / 1000;
  } else {
    return player.pausedTime;
  }
}

function updateSliderPos() {
  if (userIsSeeking) return;

  var duration, disabled, elapsed, sliderPos;
  if (player.currentItem && player.isPlaying != null && player.currentItem.track) {
    disabled = false;
    elapsed = getCurrentTrackPosition();
    duration = player.currentItem.track.duration;
    sliderPos = elapsed / duration;
  } else {
    disabled = true;
    elapsed = duration = sliderPos = 0;
  }
  $trackSlider.slider("option", "disabled", disabled).slider("option", "value", sliderPos);
  $nowplaying_elapsed.html(formatTime(elapsed));
  $nowplaying_left.html(formatTime(duration));
}

function renderVolumeSlider() {
  if (userIsVolumeSliding) return;

  var enabled = player.volume != null;
  if (enabled) {
    $volSlider.slider('option', 'value', player.volume);
  }
  $volSlider.slider('option', 'disabled', !enabled);
}

function renderNowPlaying(){
  var track = null;
  if (player.currentItem != null) {
    track = player.currentItem.track;
  }
  var track_display;
  if (track != null) {
    track_display = track.name + " - " + track.artistName;
    if (track.albumName.length) {
      track_display += " - " + track.albumName;
    }
    document.title = track_display + " - " + BASE_TITLE;
    if (track.name.indexOf("Groove Basin") === 0) {
      $("html").addClass('groovebasin');
    } else {
      $("html").removeClass('groovebasin');
    }
    if (track.name.indexOf("Never Gonna Give You Up") === 0 && track.artistName.indexOf("Rick Astley") === 0) {
      $("html").addClass('nggyu');
    } else {
      $("html").removeClass('nggyu');
    }
  } else {
    track_display = "&nbsp;";
    document.title = BASE_TITLE;
  }
  $track_display.html(track_display);
  var old_class;
  var new_class;
  if (player.isPlaying === true) {
    old_class = 'ui-icon-play';
    new_class = 'ui-icon-pause';
  } else {
    old_class = 'ui-icon-pause';
    new_class = 'ui-icon-play';
  }
  $nowplaying.find(".toggle span").removeClass(old_class).addClass(new_class);
  $trackSlider.slider("option", "disabled", player.isPlaying == null);
  updateSliderPos();
  renderVolumeSlider();
}

function render(){
  var hide_main_err = load_status === LoadStatus.GoodToGo;
  $pl_window.toggle(hide_main_err);
  $left_window.toggle(hide_main_err);
  $nowplaying.toggle(hide_main_err);
  $main_err_msg.toggle(!hide_main_err);
  if (!hide_main_err) {
    document.title = BASE_TITLE;
    $main_err_msg_text.text(load_status);
    return;
  }
  renderPlaylist();
  renderPlaylistButtons();
  renderLibrary();
  renderNowPlaying();
  updateSettingsAuthUi();
  updateLastFmSettingsUi();
  handleResize();
}

function renderArtist($ul, albumList) {
  albumList.forEach(function(album) {
    $ul.append(
      '<li>' +
        '<div class="clickable expandable" data-type="album">' +
          '<div class="ui-icon ui-icon-triangle-1-e"></div>' +
          '<span></span>' +
        '</div>' +
        '<ul style="display: none;"></ul>' +
      '</li>');
    var liDom = $ul.get(0).lastChild;
    var divDom = liDom.children[0];
    divDom.setAttribute('id', toAlbumId(album.key));
    divDom.setAttribute('data-key', album.key);
    var spanDom = divDom.children[1];
    spanDom.textContent = album.name || '[Unknown Album]';

    var artistUlDom = liDom.children[1];
    var $artistUlDom = $(artistUlDom);
    album.trackList.forEach(function(track) {
      $artistUlDom.append(
        '<li>' +
          '<div class="clickable" data-type="track">' +
            '<span></span>' +
          '</div>' +
        '</li>');
      var trackLiDom = artistUlDom.lastChild;
      var trackDivDom = trackLiDom.children[0];
      trackDivDom.setAttribute('id', toTrackId(track.key));
      trackDivDom.setAttribute('data-key', track.key);
      var trackSpanDom = trackDivDom.children[0];
      var caption = "";
      if (track.track) {
        caption += track.track + ". ";
      }
      if (track.compilation) {
        caption += track.artistName + " - ";
      }
      caption += track.name;
      trackSpanDom.textContent = caption;
    });
  });
}

function toggleLibraryExpansion($li){
  var $div = $li.find("> div");
  var $ul = $li.find("> ul");
  if ($div.attr('data-type') === 'artist') {
    if (!$li.data('cached')) {
      $li.data('cached', true);
      var artistKey = $div.attr('data-key');
      var albumList = player.searchResults.artistTable[artistKey].albumList;

      renderArtist($ul, albumList);

      $ul.toggle();
      refreshSelection();
    }
  }
  $ul.toggle();
  var old_class = ICON_EXPANDED;
  var new_class = ICON_COLLAPSED;
  if ($ul.is(":visible")) {
    var tmp = old_class;
    old_class = new_class;
    new_class = tmp;
  }
  $div.find("div").removeClass(old_class).addClass(new_class);
}

function confirmDelete(keysList) {
  var fileList = keysList.map(function(key) {
    return player.library.trackTable[key].file;
  });
  var listText = fileList.slice(0, 7).join("\n  ");
  if (fileList.length > 7) {
    listText += "\n  ...";
  }
  var songText = fileList.length === 1 ? "song" : "songs";
  return confirm("You are about to delete " + fileList.length + " " + songText + " permanently:\n\n  " + listText);
}

function handleDeletePressed(shift) {
  var keysList;
  if (selection.isLibrary()) {
    keysList = selection.toTrackKeys();
    if (!confirmDelete(keysList)) {
      return;
    }
    socket.send('deleteTracks', keysList);
  } else if (selection.isPlaylist()) {
    if (shift) {
      keysList = [];
      for (var id in selection.ids.playlist) {
        keysList.push(player.playlist.itemTable[id].track.key);
      }
      if (!confirmDelete(keysList)) return;
      socket.send('deleteTracks', keysList);
    }
    var sortKey = player.playlist.itemTable[selection.cursor].sortKey;
    player.removeIds(Object.keys(selection.ids.playlist));
    var item = null;
    for (var i = 0; i < player.playlist.itemList.length; i++) {
      item = player.playlist.itemList[i];
      if (item.sortKey > sortKey) {
        // select the very next one
        break;
      }
      // if we deleted the last item, select the new last item.
    }
    // if there's no items, select nothing.
    if (item != null) {
      selection.selectOnly('playlist', item.id);
    }
    refreshSelection();
  }
}

function togglePlayback(){
  if (player.isPlaying === true) {
    player.pause();
  } else if (player.isPlaying === false) {
    player.play();
  }
  // else we haven't received state from server yet
}

function setDynamicMode(value) {
  dynamicModeOn = value;
  player.sendCommand('dynamicModeOn', dynamicModeOn);
}

function toggleDynamicMode(){
  setDynamicMode(!dynamicModeOn);
}

function nextRepeatState(){
  player.setRepeatMode((player.repeat + 1) % repeatModeNames.length);
}

var keyboardHandlers = (function(){
  function upDownHandler(event){
    var defaultIndex, dir, nextPos;
    if (event.which === 38) {
      // up
      defaultIndex = player.currentItem ? player.currentItem.index - 1 : player.playlist.itemList.length - 1;
      dir = -1;
    } else {
      // down
      defaultIndex = player.currentItem ? player.currentItem.index + 1 : 0;
      dir = 1;
    }
    if (defaultIndex >= player.playlist.itemList.length) {
      defaultIndex = player.playlist.itemList.length - 1;
    } else if (defaultIndex < 0) {
      defaultIndex = 0;
    }
    if (event.altKey) {
      if (selection.isPlaylist()) {
        player.shiftIds(selection.ids.playlist, dir);
      }
    } else {
      if (selection.isPlaylist()) {
        nextPos = player.playlist.itemTable[selection.cursor].index + dir;
        if (nextPos < 0 || nextPos >= player.playlist.itemList.length) {
          return;
        }
        selection.cursor = player.playlist.itemList[nextPos].id;
        if (!event.ctrlKey && !event.shiftKey) {
          // single select
          selection.clear();
          selection.ids.playlist[selection.cursor] = true;
          selection.rangeSelectAnchor = selection.cursor;
          selection.rangeSelectAnchorType = selection.type;
        } else if (!event.ctrlKey && event.shiftKey) {
          // range select
          selectPlaylistRange();
        } else {
          // ghost selection
          selection.rangeSelectAnchor = selection.cursor;
          selection.rangeSelectAnchorType = selection.type;
        }
      } else if (selection.isLibrary()) {
        nextPos = selection.getPos();
        if (dir > 0) {
          selection.incrementPos(nextPos);
        } else {
          prevLibPos(nextPos);
        }
        if (nextPos.artist == null) return;
        if (nextPos.track != null) {
          selection.type = 'track';
          selection.cursor = nextPos.track.key;
        } else if (nextPos.album != null) {
          selection.type = 'album';
          selection.cursor = nextPos.album.key;
        } else {
          selection.type = 'artist';
          selection.cursor = nextPos.artist.key;
        }
        if (!event.ctrlKey && !event.shiftKey) {
          // single select
          selection.selectOnly(selection.type, selection.cursor);
        } else if (!event.ctrlKey && event.shiftKey) {
          // range select
          selectTreeRange();
        } else {
          // ghost selection
          selection.rangeSelectAnchor = selection.cursor;
          selection.rangeSelectAnchorType = selection.type;
        }
      } else {
        if (player.playlist.itemList.length === 0) return;
        selection.selectOnly('playlist', player.playlist.itemList[defaultIndex].id);
      }
      refreshSelection();
    }
    if (selection.isPlaylist()) scrollPlaylistToSelection();
    if (selection.isLibrary()) scrollLibraryToSelection();
  }
  function leftRightHandler(event){
    var dir = event.which === 37 ? -1 : 1;
    if (selection.isLibrary()) {
      var helpers = getSelectionHelpers();
      if (helpers == null) return;
      var helper = helpers[selection.type];
      var selected_item = helper.table[selection.cursor];
      var is_expanded_funcs = {
        artist: isArtistExpanded,
        album: isAlbumExpanded,
        track: function(){
          return true;
        }
      };
      var is_expanded = is_expanded_funcs[selection.type](selected_item);
      var $li = helper.$getDiv(selection.cursor).closest("li");
      if (dir > 0) {
        if (!is_expanded) {
          toggleLibraryExpansion($li);
        }
      } else {
        if (is_expanded) {
          toggleLibraryExpansion($li);
        }
      }
    } else {
      if (event.ctrlKey) {
        if (dir > 0) {
          player.next();
        } else {
          player.prev();
        }
      } else if (event.shiftKey) {
        if (!player.currentItem) return;
        player.seek(null, getCurrentTrackPosition() + dir * player.currentItem.track.duration * 0.10);
      } else {
        player.seek(null, getCurrentTrackPosition() + dir * 10);
      }
    }
  }
  var volumeDownHandler = {
      ctrl: false,
      alt: false,
      shift: null,
      handler: function(){
        player.setVolume(player.volume - 0.10);
      }
  };
  var volumeUpHandler = {
      ctrl: false,
      alt: false,
      shift: null,
      handler: function(){
        player.setVolume(player.volume + 0.10);
      }
  };
  return {
    // Enter
    13: {
      ctrl: false,
      alt: null,
      shift: null,
      handler: function(event){
        if (selection.isPlaylist()) {
          player.seek(selection.cursor, 0);
        } else if (selection.isLibrary()) {
          queueSelection(event);
        }
        return false;
      },
    },
    // Escape
    27: {
      ctrl: false,
      alt: false,
      shift: false,
      handler: function(){
        if (started_drag) {
          abortDrag();
          return;
        }
        if (removeContextMenu()) return;
        selection.fullClear();
        refreshSelection();
      },
    },
    // Space
    32: {
      ctrl: null,
      alt: false,
      shift: false,
      handler: function() {
        if (event.ctrlKey) {
          toggleSelectionUnderCursor();
          refreshSelection();
        } else {
          togglePlayback();
        }
      },
    },
    // Left
    37: {
      ctrl: null,
      alt: false,
      shift: null,
      handler: leftRightHandler,
    },
    // Up
    38: {
      ctrl: null,
      alt: null,
      shift: null,
      handler: upDownHandler,
    },
    // Right
    39: {
      ctrl: null,
      alt: false,
      shift: null,
      handler: leftRightHandler,
    },
    // Down
    40: {
      ctrl: null,
      alt: null,
      shift: null,
      handler: upDownHandler,
    },
    // Delete
    46: {
      ctrl: false,
      alt: false,
      shift: null,
      handler: function(event){
        handleDeletePressed(event.shiftKey);
      },
    },
    // =
    61: volumeUpHandler,
    // C
    67: {
      ctrl: false,
      alt: false,
      shift: true,
      handler: function(){
        player.clear();
      },
    },
    // d
    68: {
      ctrl: false,
      alt: false,
      shift: false,
      handler: toggleDynamicMode,
    },
    // S
    72: {
      ctrl: false,
      alt: false,
      shift: true,
      handler: function(){
        player.shuffle();
      },
    },
    // l
    76: {
      ctrl: false,
      alt: false,
      shift: false,
      handler: function(){
        clickTab('library');
      },
    },
    // r
    82: {
      ctrl: false,
      alt: false,
      shift: false,
      handler: nextRepeatState
    },
    // s
    83: {
      ctrl: false,
      alt: false,
      shift: false,
      handler: streaming.toggleStatus
    },
    // u
    85: {
      ctrl: false,
      alt: false,
      shift: false,
      handler: function(){
        clickTab('upload');
        $uploadByUrl.focus().select();
      },
    },
    // - maybe?
    173: volumeDownHandler,
    // +
    187: volumeUpHandler,
    // , <
    188: {
      ctrl: false,
      alt: false,
      shift: null,
      handler: function(){
        player.prev();
      },
    },
    // _ maybe?
    189: volumeDownHandler,
    // . >
    190: {
      ctrl: false,
      alt: false,
      shift: null,
      handler: function(){
        player.next();
      },
    },
    // ?
    191: {
      ctrl: false,
      alt: false,
      shift: null,
      handler: function(event){
        if (event.shiftKey) {
          $shortcuts.dialog({
            modal: true,
            title: "Keyboard Shortcuts",
            minWidth: 600,
            height: $document.height() - 40,
          });
          $shortcuts.focus();
        } else {
          clickTab('library');
          $lib_filter.focus().select();
        }
      },
    },
  };
})();

function removeContextMenu() {
  if ($playlistMenu.is(":visible")) {
    $playlistMenu.hide();
    return true;
  }
  if ($libraryMenu.is(":visible")) {
    $libraryMenu.hide();
    return true;
  }
  return false;
}

function isArtistExpanded(artist){
  var $li;
  $li = $("#lib-artist-" + toHtmlId(artist.key)).closest("li");
  if (!$li.data('cached')) {
    return false;
  }
  return $li.find("> ul").is(":visible");
}
function isAlbumExpanded(album){
  var $li = $("#lib-album-" + toHtmlId(album.key)).closest("li");
  return $li.find("> ul").is(":visible");
}
function isStoredPlaylistExpanded(stored_playlist){
  var $li = $("#stored-pl-pl-" + toHtmlId(stored_playlist.name)).closest("li");
  return $li.find("> ul").is(":visible");
}

function prevLibPos(libPos){
  if (libPos.track != null) {
    libPos.track = libPos.track.album.trackList[libPos.track.index - 1];
  } else if (libPos.album != null) {
    libPos.album = libPos.artist.albumList[libPos.album.index - 1];
    if (libPos.album != null && isAlbumExpanded(libPos.album)) {
      libPos.track = libPos.album.trackList[libPos.album.trackList.length - 1];
    }
  } else if (libPos.artist != null) {
    libPos.artist = player.searchResults.artistList[libPos.artist.index - 1];
    if (libPos.artist != null && isArtistExpanded(libPos.artist)) {
      libPos.album = libPos.artist.albumList[libPos.artist.albumList.length - 1];
      if (libPos.album != null && isAlbumExpanded(libPos.album)) {
        libPos.track = libPos.album.trackList[libPos.album.trackList.length - 1];
      }
    }
  }
}
function queueSelection(event){
  var keys = selection.toTrackKeys(event.altKey);
  if (event.shiftKey) {
    player.queueTracksNext(keys);
  } else {
    player.queueTracks(keys);
  }
  return false;
}

function toggleSelectionUnderCursor() {
  var key = selection.cursor;
  var type = selection.type;
  if (selection.ids[type][key] != null) {
    delete selection.ids[type][key];
  } else {
    selection.ids[type][key] = true;
  }
}

function selectPlaylistRange() {
  selection.clear();
  var anchor = selection.rangeSelectAnchor;
  if (anchor == null) anchor = selection.cursor;
  var min_pos = player.playlist.itemTable[anchor].index;
  var max_pos = player.playlist.itemTable[selection.cursor].index;
  if (max_pos < min_pos) {
    var tmp = min_pos;
    min_pos = max_pos;
    max_pos = tmp;
  }
  for (var i = min_pos; i <= max_pos; i++) {
    selection.ids.playlist[player.playlist.itemList[i].id] = true;
  }
}
function selectTreeRange() {
  selection.clear();
  var old_pos = selection.getPos(selection.rangeSelectAnchorType, selection.rangeSelectAnchor);
  var new_pos = selection.getPos(selection.type, selection.cursor);
  if (compareArrays(selection.posToArr(old_pos), selection.posToArr(new_pos)) > 0) {
    var tmp = old_pos;
    old_pos = new_pos;
    new_pos = tmp;
  }
  while (selection.posInBounds(old_pos)) {
    selection.selectPos(old_pos);
    if (selection.posEqual(old_pos, new_pos)) {
      break;
    }
    selection.incrementPos(old_pos);
  }
}

function sendAuth() {
  var pass = localState.authPassword;
  if (!pass) return;
  socket.send('password', pass);
}

function settingsAuthSave(){
  settings_ui.auth.show_edit = false;
  localState.authPassword = $authPassword.val();
  saveLocalState();
  updateSettingsAuthUi();
  sendAuth();
}

function settingsAuthCancel(){
  settings_ui.auth.show_edit = false;
  updateSettingsAuthUi();
}

function performDrag(event, callbacks){
  abortDrag();
  var start_drag_x = event.pageX;
  var start_drag_y = event.pageY;
  abortDrag = function(){
    $document.off('mousemove', onDragMove).off('mouseup', onDragEnd);
    if (started_drag) {
      $playlistItems.find(".pl-item").removeClass('border-top').removeClass('border-bottom');
      started_drag = false;
    }
    abortDrag = function(){};
  };
  function onDragMove(event){
    var dist, result;
    if (!started_drag) {
      dist = Math.pow(event.pageX - start_drag_x, 2) + Math.pow(event.pageY - start_drag_y, 2);
      if (dist > 64) {
        started_drag = true;
      }
      if (!started_drag) {
        return;
      }
    }
    result = getDragPosition(event.pageX, event.pageY);
    $playlistItems.find(".pl-item").removeClass('border-top').removeClass('border-bottom');
    if (result.$next != null) {
      result.$next.addClass("border-top");
    } else if (result.$previous != null) {
      result.$previous.addClass("border-bottom");
    }
  }
  function onDragEnd(event){
    if (event.which !== 1) {
      return false;
    }
    if (started_drag) {
      callbacks.complete(getDragPosition(event.pageX, event.pageY), event);
    } else {
      callbacks.cancel();
    }
    abortDrag();
  }
  $document.on('mousemove', onDragMove).on('mouseup', onDragEnd);
  onDragMove(event);
}

function setUpGenericUi(){
  $document.on('mouseover', '.hoverable', function(event){
    $(this).addClass("ui-state-hover");
  });
  $document.on('mouseout', '.hoverable', function(event){
    $(this).removeClass("ui-state-hover");
  });
  $(".jquery-button").button().on('click', blur);
  $document.on('mousedown', function(){
    removeContextMenu();
    selection.fullClear();
    refreshSelection();
  });
  $document.on('keydown', function(event){
    var handler = keyboardHandlers[event.which];
    if (handler == null) return true;
    if (handler.ctrl  != null && handler.ctrl  !== event.ctrlKey)  return true;
    if (handler.alt   != null && handler.alt   !== event.altKey)   return true;
    if (handler.shift != null && handler.shift !== event.shiftKey) return true;
    handler.handler(event);
    return false;
  });
  $shortcuts.on('keydown', function(event) {
    event.stopPropagation();
    if (event.which === 27) {
      $shortcuts.dialog('close');
    }
  });
}

function blur() {
  $(this).blur();
}

var dynamicModeLabel = document.getElementById('dynamic-mode-label');
var plBtnRepeatLabel = document.getElementById('pl-btn-repeat-label');
function setUpPlaylistUi(){
  $pl_window.on('click', 'button.clear', function(event){
    player.clear();
  });
  $pl_window.on('mousedown', 'button.clear', stopPropagation);

  $pl_window.on('click', 'button.shuffle', function(){
    player.shuffle();
  });
  $pl_window.on('mousedown', 'button.shuffle', stopPropagation);

  $pl_btn_repeat.on('click', nextRepeatState);
  plBtnRepeatLabel.addEventListener('mousedown', stopPropagation, false);

  $dynamicMode.on('click', function(){
    var value = $(this).prop("checked");
    setDynamicMode(value);
    return false;
  });
  dynamicModeLabel.addEventListener('mousedown', stopPropagation, false);

  $playlistItems.on('dblclick', '.pl-item', function(event){
    var trackId = $(this).attr('data-id');
    player.seek(trackId, 0);
  });
  $playlistItems.on('contextmenu', function(event){
    return event.altKey;
  });
  $playlistItems.on('mousedown', '.pl-item', function(event){
    var trackId, skipDrag;
    if (started_drag) return true;
    $(document.activeElement).blur();
    if (event.which === 1) {
      event.preventDefault();
      removeContextMenu();
      trackId = $(this).attr('data-id');
      skipDrag = false;
      if (!selection.isPlaylist()) {
        selection.selectOnly('playlist', trackId);
      } else if (event.ctrlKey || event.shiftKey) {
        skipDrag = true;
        if (event.shiftKey && !event.ctrlKey) {
          // range select click
          selection.cursor = trackId;
          selectPlaylistRange();
        } else if (!event.shiftKey && event.ctrlKey) {
          // individual item selection toggle
          selection.cursor = trackId;
          selection.rangeSelectAnchor = trackId;
          selection.rangeSelectAnchorType = selection.type;
          toggleSelectionUnderCursor();
        }
      } else if (selection.ids.playlist[trackId] == null) {
        selection.selectOnly('playlist', trackId);
      }
      refreshSelection();
      if (!skipDrag) {
        return performDrag(event, {
          complete: function(result, event){
            var delta, id;
            delta = {
              top: 0,
              bottom: 1
            };
            player.moveIds((function(){
              var results$ = [];
              for (var id in selection.ids.playlist) {
                results$.push(id);
              }
              return results$;
            })(), result.previous_key, result.next_key);
          },
          cancel: function(){
            selection.selectOnly('playlist', trackId);
            refreshSelection();
          }
        });
      }
    } else if (event.which === 3) {
      if (event.altKey) return;
      event.preventDefault();
      removeContextMenu();
      trackId = $(this).attr('data-id');
      if (!selection.isPlaylist() || selection.ids.playlist[trackId] == null) {
        selection.selectOnly('playlist', trackId);
        refreshSelection();
      }
      if (!selection.isMulti()) {
        var item = player.playlist.itemTable[trackId];
        $playlistMenu.find('.download').attr('href', 'library/' + encodeURI(item.track.file));
      } else {
        $playlistMenu.find('.download').attr('href', '#');
      }
      $playlistMenu.show().offset({
        left: event.pageX + 1,
        top: event.pageY + 1
      });
      updateAdminActions($playlistMenu);
    }
  });
  $playlistItems.on('mousedown', function(){
    return false;
  });
  $playlistMenu.menu();
  $playlistMenu.on('mousedown', function(){
    return false;
  });
  $playlistMenu.on('click', '.remove', function(){
    handleDeletePressed(false);
    removeContextMenu();
    return false;
  });
  $playlistMenu.on('click', '.download', onDownloadContextMenu);
  $playlistMenu.on('click', '.delete', onDeleteContextMenu);
  $playlistMenu.on('click', '.edit-tags', onEditTagsContextMenu);
}

function stopPropagation(event) {
  event.stopPropagation();
}

function onDownloadContextMenu() {
  removeContextMenu();

  if (selection.isMulti()) {
    downloadKeys(selection.toTrackKeys());
    return false;
  }

  return true;
}
function onDeleteContextMenu() {
  if (!permissions.admin) return false;
  removeContextMenu();
  handleDeletePressed(true);
  return false;
}
var editTagsTrackKeys = null;
var editTagsTrackIndex = null;
function onEditTagsContextMenu() {
  if (!permissions.admin) return false;
  removeContextMenu();
  editTagsTrackKeys = selection.toTrackKeys();
  editTagsTrackIndex = 0;
  showEditTags();
  return false;
}
var EDITABLE_PROPS = {
  name: {
    type: 'string',
    write: true,
  },
  artistName: {
    type: 'string',
    write: true,
  },
  albumArtistName: {
    type: 'string',
    write: true,
  },
  albumName: {
    type: 'string',
    write: true,
  },
  compilation: {
    type: 'boolean',
    write: true,
  },
  track: {
    type: 'integer',
    write: true,
  },
  trackCount: {
    type: 'integer',
    write: true,
  },
  disc: {
    type: 'integer',
    write: true,
  },
  discCount: {
    type: 'integer',
    write: true,
  },
  year: {
    type: 'integer',
    write: true,
  },
  genre: {
    type: 'string',
    write: true,
  },
  composerName: {
    type: 'string',
    write: true,
  },
  performerName: {
    type: 'string',
    write: true,
  },
  file: {
    type: 'string',
    write: false,
  },
};
var EDIT_TAG_TYPES = {
  'string': {
    get: function(domItem) {
      return domItem.value;
    },
    set: function(domItem, value) {
      domItem.value = value || "";
    },
  },
  'integer': {
    get: function(domItem) {
      var n = parseInt(domItem.value, 10);
      if (isNaN(n)) return null;
      return n;
    },
    set: function(domItem, value) {
      domItem.value = value == null ? "" : value;
    },
  },
  'boolean': {
    get: function(domItem) {
      return domItem.checked;
    },
    set: function(domItem, value) {
      domItem.checked = !!value;
    },
  },
};
var perDom = document.getElementById('edit-tags-per');
var perLabelDom = document.getElementById('edit-tags-per-label');
var prevDom = document.getElementById('edit-tags-prev');
var nextDom = document.getElementById('edit-tags-next');
var editTagsFocusDom = document.getElementById('edit-tag-name');
function updateEditTagsUi() {
  var multiple = editTagsTrackKeys.length > 1;
  prevDom.disabled = !perDom.checked || editTagsTrackIndex === 0;
  nextDom.disabled = !perDom.checked || (editTagsTrackIndex === editTagsTrackKeys.length - 1);
  prevDom.style.visibility = multiple ? 'visible' : 'hidden';
  nextDom.style.visibility = multiple ? 'visible' : 'hidden';
  perLabelDom.style.visibility = multiple ? 'visible' : 'hidden';
  var multiCheckBoxVisible = multiple && !perDom.checked;
  var trackKeysToUse = perDom.checked ? [editTagsTrackKeys[editTagsTrackIndex]] : editTagsTrackKeys;

  for (var propName in EDITABLE_PROPS) {
    var propInfo = EDITABLE_PROPS[propName];
    var type = propInfo.type;
    var setter = EDIT_TAG_TYPES[type].set;
    var domItem = document.getElementById('edit-tag-' + propName);
    domItem.disabled = !propInfo.write;
    var multiCheckBoxDom = document.getElementById('edit-tag-multi-' + propName);
    multiCheckBoxDom.style.visibility = (multiCheckBoxVisible && propInfo.write) ? 'visible' : 'hidden';
    var commonValue = null;
    var consistent = true;
    for (var i = 0; i < trackKeysToUse.length; i += 1) {
      var key = trackKeysToUse[i];
      var track = player.library.trackTable[key];
      var value = track[propName];
      if (commonValue == null) {
        commonValue = value;
      } else if (commonValue !== value) {
        consistent = false;
        break;
      }
    }
    multiCheckBoxDom.checked = consistent;
    setter(domItem, consistent ? commonValue : null);
  }
}
function showEditTags() {
  $editTagsDialog.dialog({
    modal: true,
    title: "Edit Tags",
    minWidth: 800,
    height: $document.height() - 40,
  });
  perDom.checked = false;
  updateEditTagsUi();
  editTagsFocusDom.focus();
}

function setUpEditTagsUi() {
  $editTagsDialog.find("input").on("keydown", function(event) {
    event.stopPropagation();
    if (event.which === 27) {
      $editTagsDialog.dialog('close');
    } else if (event.which === 13) {
      saveAndClose();
    }
  });
  for (var propName in EDITABLE_PROPS) {
    var domItem = document.getElementById('edit-tag-' + propName);
    var multiCheckBoxDom = document.getElementById('edit-tag-multi-' + propName);
    var listener = createChangeListener(multiCheckBoxDom);
    domItem.addEventListener('change', listener, false);
    domItem.addEventListener('keypress', listener, false);
    domItem.addEventListener('focus', onFocus, false);
  }

  function onFocus(event) {
    editTagsFocusDom = event.target;
  }

  function createChangeListener(multiCheckBoxDom) {
    return function() {
      multiCheckBoxDom.checked = true;
    };
  }
  $("#edit-tags-ok").on('click', saveAndClose);
  $("#edit-tags-cancel").on('click', closeDialog);
  perDom.addEventListener('click', updateEditTagsUi, false);
  nextDom.addEventListener('click', saveAndNext, false);
  prevDom.addEventListener('click', saveAndPrev, false);

  function saveAndMoveOn(dir) {
    save();
    editTagsTrackIndex += dir;
    updateEditTagsUi();
    editTagsFocusDom.focus();
    editTagsFocusDom.select();
  }

  function saveAndNext() {
    saveAndMoveOn(1);
  }

  function saveAndPrev() {
    saveAndMoveOn(-1);
  }

  function save() {
    var trackKeysToUse = perDom.checked ? [editTagsTrackKeys[editTagsTrackIndex]] : editTagsTrackKeys;
    var cmd = {};
    for (var i = 0; i < trackKeysToUse.length; i += 1) {
      var key = trackKeysToUse[i];
      var track = player.library.trackTable[key];
      var props = cmd[track.key] = {};
      for (var propName in EDITABLE_PROPS) {
        var propInfo = EDITABLE_PROPS[propName];
        var type = propInfo.type;
        var getter = EDIT_TAG_TYPES[type].get;
        var domItem = document.getElementById('edit-tag-' + propName);
        var multiCheckBoxDom = document.getElementById('edit-tag-multi-' + propName);
        if (multiCheckBoxDom.checked && propInfo.write) {
          props[propName] = getter(domItem);
        }
      }
    }
    player.sendCommand('updateTags', cmd);
  }

  function saveAndClose() {
    save();
    closeDialog();
  }

  function closeDialog() {
    $editTagsDialog.dialog('close');
  }
}

function updateSliderUi(value){
  var percent = value * 100;
  $trackSlider.css('background-size', percent + "% 100%");
}

function setUpNowPlayingUi(){
  var actions = {
    toggle: togglePlayback,
    prev: function(){
      player.prev();
    },
    next: function(){
      player.next();
    },
    stop: function(){
      player.stop();
    }
  };
  for (var cls in actions) {
    var action = actions[cls];
    setUpMouseDownListener(cls, action);
  }
  $trackSlider.slider({
    step: 0.0001,
    min: 0,
    max: 1,
    change: function(event, ui){
      updateSliderUi(ui.value);
      if (event.originalEvent == null) {
        return;
      }
      if (!player.currentItem) return;
      player.seek(null, ui.value * player.currentItem.track.duration);
    },
    slide: function(event, ui){
      updateSliderUi(ui.value);
      if (!player.currentItem) return;
      $nowplaying_elapsed.html(formatTime(ui.value * player.currentItem.track.duration));
    },
    start: function(event, ui){
      userIsSeeking = true;
    },
    stop: function(event, ui){
      userIsSeeking = false;
    }
  });
  function setVol(event, ui){
    if (event.originalEvent == null) return;
    player.setVolume(ui.value);
  }
  $volSlider.slider({
    step: 0.01,
    min: 0,
    max: 1,
    change: setVol,
    start: function(event, ui){
      userIsVolumeSliding = true;
    },
    stop: function(event, ui){
      userIsVolumeSliding = false;
    }
  });
  setInterval(updateSliderPos, 100);
  function setUpMouseDownListener(cls, action){
    $nowplaying.on('mousedown', "li." + cls, function(event){
      action();
      return false;
    });
  }
}

function setUpTabsUi(){
  var tabs, i, len$, tab;
  $tabs.on('mouseover', 'li', function(event){
    $(this).addClass('ui-state-hover');
  });
  $tabs.on('mouseout', 'li', function(event){
    $(this).removeClass('ui-state-hover');
  });
  tabs = ['library', 'upload', 'settings'];
  function tabSelector(tab_name){
    return "li." + tab_name + "-tab";
  }
  function $pane(tab_name){
    return $("#" + tab_name + "-pane");
  }
  function $tab(tab_name){
    return $tabs.find(tabSelector(tab_name));
  }
  function unselectTabs(){
    var i, ref$, len$, tab;
    $tabs.find('li').removeClass('ui-state-active');
    for (i = 0, len$ = (ref$ = tabs).length; i < len$; ++i) {
      tab = ref$[i];
      $pane(tab).hide();
    }
  }
  clickTab = function(name){
    unselectTabs();
    $tab(name).addClass('ui-state-active');
    $pane(name).show();
    handleResize();
  };
  for (i = 0, len$ = tabs.length; i < len$; ++i) {
    tab = tabs[i];
    (fn$.call(this, tab));
  }
  function fn$(tab){
    $tabs.on('click', tabSelector(tab), function(event){
      clickTab(tab);
    });
  }
}

function uploadFiles(files) {
  if (files.length === 0) return;

  var formData = new FormData();

  for (var i = 0; i < files.length; i += 1) {
    var file = files[i];
    formData.append("file", file);
  }

  var $progressBar = $('<div></div>');
  $progressBar.progressbar();
  var $cancelBtn = $('<button>Cancel</button>');
  $cancelBtn.on('click', onCancel);

  $uploadWidget.append($progressBar);
  $uploadWidget.append($cancelBtn);

  var req = new XMLHttpRequest();
  req.upload.addEventListener('progress', onProgress, false);
  req.addEventListener('load', onLoad, false);
  req.open('POST', '/upload');
  req.send(formData);
  uploadInput.value = null;

  function onProgress(e) {
    if (!e.lengthComputable) return;
    var progress = e.loaded / e.total;
    $progressBar.progressbar("option", "value", progress * 100);
  }

  function onLoad(e) {
    if (localState.autoQueueUploads) {
      var keys = JSON.parse(this.response);
      // sort them the same way the library is sorted
      player.queueTracks(player.sortKeys(keys));
    }
    cleanup();
  }

  function onCancel() {
    req.abort();
    cleanup();
  }

  function cleanup() {
    $progressBar.remove();
    $cancelBtn.remove();
  }
}

function setAutoUploadBtnState() {
  $autoQueueUploads
    .button('option', 'label', localState.autoQueueUploads ? 'On' : 'Off')
    .prop('checked', localState.autoQueueUploads)
    .button('refresh');
}

function setUpUploadUi(){
  $autoQueueUploads.button({ label: "..." });
  setAutoUploadBtnState();
  $autoQueueUploads.on('click', function(event) {
    var value = $(this).prop('checked');
    localState.autoQueueUploads = value;
    saveLocalState();
    setAutoUploadBtnState();
  });
  uploadInput.addEventListener('change', onChange, false);

  function onChange(e) {
    uploadFiles(this.files);
  }

  $uploadByUrl.on('keydown', function(event){
    event.stopPropagation();
    if (event.which === 27) {
      $uploadByUrl.val("").blur();
    } else if (event.which === 13) {
      importUrl();
    }
  });

  function importUrl() {
    var url = $uploadByUrl.val();
    var id = uuid();
    $uploadByUrl.val("").blur();
    socket.on('importUrl', onImportUrl);
    socket.send('importUrl', {
      url: url,
      id: id,
    });

    function onImportUrl(args) {
      if (args.id !== id) return;
      socket.removeListener('importUrl', onImportUrl);
      if (!args.key) return;
      if (localState.autoQueueUploads) {
        player.queueTracks([args.key]);
      }
    }
  }
}

function updateLastFmApiKey(key) {
  lastFmApiKey = key;
  updateLastFmSettingsUi();
}

function updateLastFmSettingsUi() {
  if (localState.lastfm.username) {
    $settingsLastFmIn.show();
    $settingsLastFmOut.hide();
  } else {
    $settingsLastFmIn.hide();
    $settingsLastFmOut.show();
  }
  settingsLastFmUserDom.setAttribute('href', "http://last.fm/user/" +
      encodeURIComponent(localState.lastfm.username));
  settingsLastFmUserDom.textContent = localState.lastfm.username;
  var authUrl = "http://www.last.fm/api/auth/?api_key=" +
        encodeURIComponent(lastFmApiKey) + "&cb=" +
        encodeURIComponent(location.protocol + "//" + location.host + "/");
  lastFmAuthUrlDom.setAttribute('href', authUrl);
  $toggleScrobble
    .button('option', 'label', localState.lastfm.scrobbling_on ? 'On' : 'Off')
    .prop('checked', localState.lastfm.scrobbling_on)
    .button('refresh');
}

function updateSettingsAuthUi() {
  var showEdit = !!(localState.authPassword == null || settings_ui.auth.show_edit);
  $settingsEditPassword.toggle(showEdit);
  $settingsShowPassword.toggle(!showEdit);
  $settingsAuthCancel.toggle(!!localState.authPassword);
  $authPassword.val(localState.authPassword);
  passwordDisplayDom.textContent = localState.authPassword;
  $authPermRead.toggle(!!permissions.read);
  $authPermAdd.toggle(!!permissions.add);
  $authPermControl.toggle(!!permissions.control);
  $authPermAdmin.toggle(!!permissions.admin);
  streamUrlDom.setAttribute('href', streaming.getUrl());
}

function setUpSettingsUi(){
  $toggleScrobble.button();
  $lastFmSignOut.button();
  $settingsAuthCancel.button();
  $settingsAuthSave.button();
  $settingsAuthEdit.button();
  $settingsAuthClear.button();

  $lastFmSignOut.on('click', function(event) {
    localState.lastfm.username = null;
    localState.lastfm.session_key = null;
    localState.lastfm.scrobbling_on = false;
    saveLocalState();
    updateLastFmSettingsUi();
    return false;
  });
  $toggleScrobble.on('click', function(event) {
    var msg;
    var value = $(this).prop("checked");
    if (value) {
      msg = 'LastFmScrobblersAdd';
      localState.lastfm.scrobbling_on = true;
    } else {
      msg = 'LastFmScrobblersRemove';
      localState.lastfm.scrobbling_on = false;
    }
    saveLocalState();
    var params = {
      username: localState.lastfm.username,
      session_key: localState.lastfm.session_key
    };
    socket.send(msg, params);
    updateLastFmSettingsUi();
  });
  $settingsAuthEdit.on('click', function(event) {
    settings_ui.auth.show_edit = true;
    updateSettingsAuthUi();
    $authPassword
      .focus()
      .val(localState.authPassword || "")
      .select();
  });
  $settingsAuthClear.on('click', function(event) {
    localState.authPassword = null;
    saveLocalState();
    settings_ui.auth.password = "";
    updateSettingsAuthUi();
  });
  $settingsAuthSave.on('click', function(event){
    settingsAuthSave();
  });
  $settingsAuthCancel.on('click', function(event) {
    settingsAuthCancel();
  });
  $authPassword.on('keydown', function(event) {
    event.stopPropagation();
    settings_ui.auth.password = $authPassword.val();
    if (event.which === 27) {
      settingsAuthCancel();
    } else if (event.which === 13) {
      settingsAuthSave();
    }
  });
  $authPassword.on('keyup', function(event) {
    settings_ui.auth.password = $authPassword.val();
  });
}

function setUpLibraryUi(){
  $lib_filter.on('keydown', function(event){
    var keys, i, ref$, len$, artist, j$, ref1$, len1$, album, k$, ref2$, len2$, track;
    event.stopPropagation();
    switch (event.which) {
    case 27:
      if ($(event.target).val().length === 0) {
        $(event.target).blur();
      } else {
        setTimeout(function(){
          $(event.target).val("");
          player.search("");
        }, 0);
      }
      return false;
    case 13:
      keys = [];
      for (i = 0, len$ = (ref$ = player.searchResults.artistList).length; i < len$; ++i) {
        artist = ref$[i];
        for (j$ = 0, len1$ = (ref1$ = artist.albumList).length; j$ < len1$; ++j$) {
          album = ref1$[j$];
          for (k$ = 0, len2$ = (ref2$ = album.trackList).length; k$ < len2$; ++k$) {
            track = ref2$[k$];
            keys.push(track.key);
          }
        }
      }
      if (event.altKey) shuffle(keys);
      if (keys.length > 2000) {
        if (!confirm("You are about to queue " + keys.length + " songs.")) {
          return false;
        }
      }
      if (event.shiftKey) {
        player.queueTracksNext(keys);
      } else {
        player.queueTracks(keys);
      }
      return false;
    case 40:
      selection.selectOnly('artist', player.searchResults.artistList[0].key);
      refreshSelection();
      $lib_filter.blur();
      return false;
    case 38:
      selection.selectOnly('artist', player.searchResults.artistList[player.searchResults.artistList.length - 1].key);
      refreshSelection();
      $lib_filter.blur();
      return false;
    }
  });
  $lib_filter.on('keyup', function(event){
    player.search($(event.target).val());
  });
  genericTreeUi($library, {
    toggleExpansion: toggleLibraryExpansion,
    isSelectionOwner: function(){
      return selection.isLibrary();
    }
  });
  $libraryMenu.menu();
  $libraryMenu.on('mousedown', function(){
    return false;
  });
  $libraryMenu.on('click', '.queue', function(){
    player.queueTracks(selection.toTrackKeys());
    removeContextMenu();
    return false;
  });
  $libraryMenu.on('click', '.queue-next', function(){
    player.queueTracksNext(selection.toTrackKeys());
    removeContextMenu();
    return false;
  });
  $libraryMenu.on('click', '.queue-random', function(){
    player.queueTracks(selection.toTrackKeys(true));
    removeContextMenu();
    return false;
  });
  $libraryMenu.on('click', '.queue-next-random', function(){
    player.queueTracksNext(selection.toTrackKeys(true));
    removeContextMenu();
    return false;
  });
  $libraryMenu.on('click', '.download', onDownloadContextMenu);
  $libraryMenu.on('click', '.delete', onDeleteContextMenu);
  $libraryMenu.on('click', '.edit-tags', onEditTagsContextMenu);
}

function genericTreeUi($elem, options){
  $elem.on('mousedown', 'div.expandable > div.ui-icon', function(event){
    options.toggleExpansion($(this).closest('li'));
    return false;
  });
  $elem.on('dblclick', 'div.expandable > div.ui-icon', function(){
    return false;
  });
  $elem.on('dblclick', 'div.clickable', queueSelection);
  $elem.on('contextmenu', function(event){
    return event.altKey;
  });
  $elem.on('mousedown', '.clickable', function(event){
    $(document.activeElement).blur();
    var $this = $(this);
    var type = $this.attr('data-type');
    var key = $this.attr('data-key');
    if (event.which === 1) {
      leftMouseDown(event);
    } else if (event.which === 3) {
      if (event.altKey) {
        return;
      }
      rightMouseDown(event);
    }
    function leftMouseDown(event){
      event.preventDefault();
      removeContextMenu();
      var skipDrag = false;
      if (!options.isSelectionOwner()) {
        selection.selectOnly(type, key);
      } else if (event.ctrlKey || event.shiftKey) {
        skipDrag = true;
        selection.cursor = key;
        selection.type = type;
        if (!event.shiftKey && !event.ctrlKey) {
          selection.selectOnly(type, key);
        } else if (event.shiftKey) {
          selectTreeRange();
        } else if (event.ctrlKey) {
          toggleSelectionUnderCursor();
        }
      } else if (selection.ids[type][key] == null) {
        selection.selectOnly(type, key);
      }
      refreshSelection();
      if (!skipDrag) {
        performDrag(event, {
          complete: function(result, event){
            var delta = {
              top: 0,
              bottom: 1
            };
            var keys = selection.toTrackKeys(event.altKey);
            player.queueTracks(keys, result.previous_key, result.next_key);
          },
          cancel: function(){
            selection.selectOnly(type, key);
            refreshSelection();
          }
        });
      }
    }
    function rightMouseDown(event){
      event.preventDefault();
      removeContextMenu();
      if (!options.isSelectionOwner() || selection.ids[type][key] == null) {
        selection.selectOnly(type, key);
        refreshSelection();
      }
      var track = null;
      if (!selection.isMulti()) {
        if (type === 'track') {
          track = player.searchResults.trackTable[key];
        } else if (type === 'stored_playlist_item') {
          track = player.stored_playlist_item_table[key].track;
        }
      }
      if (track) {
        $libraryMenu.find('.download').attr('href', 'library/' + encodeURI(track.file));
      } else {
        $libraryMenu.find('.download').attr('href', '#');
      }
      $libraryMenu.show().offset({
        left: event.pageX + 1,
        top: event.pageY + 1
      });
      updateAdminActions($libraryMenu);
    }
  });
  $elem.on('mousedown', function(){
    return false;
  });
}
function updateAdminActions($menu) {
  if (!permissions.admin) {
    $menu.find('.delete,.edit-tags')
      .addClass('ui-state-disabled')
      .attr('title', "Insufficient privileges. See Settings.");
  } else {
    $menu.find('.delete,.edit-tags')
      .removeClass('ui-state-disabled')
      .attr('title', '');
  }
}
function setUpUi(){
  setUpGenericUi();
  setUpPlaylistUi();
  setUpLibraryUi();
  setUpNowPlayingUi();
  setUpTabsUi();
  setUpUploadUi();
  setUpSettingsUi();
  setUpEditTagsUi();
}

function toAlbumId(s) {
  return "lib-album-" + toHtmlId(s);
}

function toTrackId(s) {
  return "lib-track-" + toHtmlId(s);
}

function handleResize(){
  $nowplaying.width(MARGIN);
  $pl_window.height(MARGIN);
  $left_window.height(MARGIN);
  $library.height(MARGIN);
  $upload.height(MARGIN);
  $playlistItems.height(MARGIN);
  $nowplaying.width($document.width() - MARGIN * 2);
  var second_layer_top = $nowplaying.offset().top + $nowplaying.height() + MARGIN;
  $left_window.offset({
    left: MARGIN,
    top: second_layer_top
  });
  $pl_window.offset({
    left: $left_window.offset().left + $left_window.width() + MARGIN,
    top: second_layer_top
  });
  $pl_window.width($window.width() - $pl_window.offset().left - MARGIN);
  $left_window.height($window.height() - $left_window.offset().top);
  $pl_window.height($left_window.height() - MARGIN);
  var tab_contents_height = $left_window.height() - $tabs.height() - MARGIN;
  $library.height(tab_contents_height - $lib_header.height());
  $upload.height(tab_contents_height);
  $playlistItems.height($pl_window.height() - $pl_header.position().top - $pl_header.height());
}
function refreshPage(){
  location.href = location.protocol + "//" + location.host + "/";
}

$document.ready(function(){
  loadLocalState();
  socket = new Socket();
  var queryObj = querystring.parse(location.search.substring(1));
  if (queryObj.token) {
    socket.on('connect', function() {
      socket.send('LastFmGetSession', queryObj.token);
    });
    socket.on('LastFmGetSessionSuccess', function(params){
      localState.lastfm.username = params.session.name;
      localState.lastfm.session_key = params.session.key;
      localState.lastfm.scrobbling_on = false;
      saveLocalState();
      refreshPage();
    });
    socket.on('LastFmGetSessionError', function(message){
      alert("Error authenticating: " + message);
      refreshPage();
    });
    return;
  }
  socket.on('LastFmApiKey', updateLastFmApiKey);
  socket.on('permissions', function(data){
    permissions = data;
    updateSettingsAuthUi();
  });
  socket.on('volumeUpdate', function(vol) {
    player.volume = vol;
    renderVolumeSlider();
  });
  socket.on('dynamicModeOn', function(data) {
    dynamicModeOn = data;
    renderPlaylistButtons();
    renderPlaylist();
  });
  player = new PlayerClient(socket);
  player.on('libraryupdate', renderLibrary);
  player.on('playlistupdate', renderPlaylist);
  player.on('statusupdate', function(){
    renderNowPlaying();
    renderPlaylistButtons();
    labelPlaylistItems();
  });
  socket.on('connect', function(){
    socket.send('subscribe', {name: 'dynamicModeOn'});
    sendAuth();
    load_status = LoadStatus.GoodToGo;
    render();
  });
  socket.on('disconnect', function(){
    load_status = LoadStatus.NoServer;
    render();
  });
  setUpUi();
  streaming.init(player, socket);
  render();
  $window.resize(handleResize);
  window._debug_player = player;
});

function compareArrays(arr1, arr2) {
  for (var i1 = 0; i1 < arr1.length; i1 += 1) {
    var val1 = arr1[i1];
    var val2 = arr2[i1];
    var diff = (val1 != null ? val1 : -1) - (val2 != null ? val2 : -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

function formatTime(seconds) {
  if (seconds == null) return "";
  var sign = "";
  if (seconds < 0) {
    sign = "-";
    seconds = -seconds;
  }
  seconds = Math.floor(seconds);
  var minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  var hours = Math.floor(minutes / 60);
  minutes -= hours * 60;
  if (hours !== 0) {
    return sign + hours + ":" + zfill(minutes, 2) + ":" + zfill(seconds, 2);
  } else {
    return sign + minutes + ":" + zfill(seconds, 2);
  }
}

var badCharRe = new RegExp('[^a-zA-Z0-9-]', 'gm');
function toHtmlId(string) {
  return string.replace(badCharRe, function(c) {
    return "_" + c.charCodeAt(0) + "_";
  });
}

},{"./playerclient":36,"./socket":37,"./streaming":38,"mess":29,"querystring":9,"uuid":33,"zfill":34}],36:[function(require,module,exports){
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var uuid = require('uuid');
var MusicLibraryIndex = require('music-library-index');
var keese = require('keese');
var jsondiffpatch = require('jsondiffpatch');

module.exports = PlayerClient;

var compareSortKeyAndId = makeCompareProps(['sortKey', 'id']);

PlayerClient.REPEAT_OFF = 0;
PlayerClient.REPEAT_ONE = 1;
PlayerClient.REPEAT_ALL = 2;

util.inherits(PlayerClient, EventEmitter);
function PlayerClient(socket) {
  EventEmitter.call(this);

  window.__debug_PlayerClient = this;

  var self = this;
  self.socket = socket;
  self.serverTimeOffset = 0;
  self.serverTrackStartDate = null;
  self.playlistFromServer = undefined;
  self.playlistFromServerVersion = null;
  self.libraryFromServer = undefined;
  self.libraryFromServerVersion = null;
  self.resetServerState();
  self.socket.on('disconnect', function() {
    self.resetServerState();
  });
  if (self.socket.isConnected) {
    self.handleConnectionStart();
  } else {
    self.socket.on('connect', self.handleConnectionStart.bind(self));
  }
  self.socket.on('time', function(o) {
    self.serverTimeOffset = new Date(o) - new Date();
    self.updateTrackStartDate();
    self.emit('statusupdate');
  });
  self.socket.on('volume', function(volume) {
    self.volume = volume;
    self.emit('statusupdate');
  });
  self.socket.on('repeat', function(repeat) {
    self.repeat = repeat;
    self.emit('statusupdate');
  });

  self.socket.on('currentTrack', function(o) {
    self.isPlaying = o.isPlaying;
    self.serverTrackStartDate = o.trackStartDate && new Date(o.trackStartDate);
    self.pausedTime = o.pausedTime;
    self.currentItemId = o.currentItemId;
    self.updateTrackStartDate();
    self.updateCurrentItem();
    self.emit('statusupdate');
    self.emit('currentTrack');
  });

  self.socket.on('playlist', function(o) {
    if (o.reset) self.playlistFromServer = undefined;
    self.playlistFromServer = jsondiffpatch.patch(self.playlistFromServer, o.delta);
    deleteUndefineds(self.playlistFromServer);
    self.playlistFromServerVersion = o.version;
    self.updatePlaylistIndex();
    self.emit('statusupdate');
    self.emit('playlistupdate');
  });

  self.socket.on('library', function(o) {
    if (o.reset) self.libraryFromServer = undefined;
    self.libraryFromServer = jsondiffpatch.patch(self.libraryFromServer, o.delta);
    deleteUndefineds(self.libraryFromServer);
    self.libraryFromServerVersion = o.version;
    self.library.clear();
    for (var key in self.libraryFromServer) {
      var track = self.libraryFromServer[key];
      self.library.addTrack(track);
    }
    self.library.rebuild();
    self.updatePlaylistIndex();
    self.haveFileListCache = true;
    var lastQuery = self.lastQuery;
    self.lastQuery = null;
    self.search(lastQuery);
  });

  function deleteUndefineds(o) {
    for (var key in o) {
      if (o[key] === undefined) delete o[key];
    }
  }
}

PlayerClient.prototype.handleConnectionStart = function(){
  this.sendCommand('subscribe', { name: 'library', delta: true, });
  this.sendCommand('subscribe', {name: 'volume'});
  this.sendCommand('subscribe', {name: 'repeat'});
  this.sendCommand('subscribe', {name: 'currentTrack'});
  this.sendCommand('subscribe', {
    name: 'playlist',
    delta: true,
    version: this.playlistFromServerVersion,
  });
};

PlayerClient.prototype.updateTrackStartDate = function() {
  this.trackStartDate = (this.serverTrackStartDate != null) ?
    new Date(new Date(this.serverTrackStartDate) - this.serverTimeOffset) : null;
};

PlayerClient.prototype.updateCurrentItem = function() {
  this.currentItem = (this.currentItemId != null) ?
    this.playlist.itemTable[this.currentItemId] : null;
};

PlayerClient.prototype.updatePlaylistIndex = function() {
  this.clearPlaylist();
  if (!this.playlistFromServer) return;
  for (var id in this.playlistFromServer) {
    var item = this.playlistFromServer[id];
    var track = this.library.trackTable[item.key];
    this.playlist.itemTable[id] = {
      id: id,
      sortKey: item.sortKey,
      isRandom: item.isRandom,
      track: track,
      playlist: this.playlist,
    };
  }
  this.refreshPlaylistList();
  this.updateCurrentItem();
};

PlayerClient.prototype.search = function(query) {
  query = query.trim();

  var words = query.split(/\s+/);
  query = words.join(" ");
  if (query === this.lastQuery) return;

  this.lastQuery = query;
  this.searchResults = this.library.search(query);
  this.emit('libraryupdate');
  this.emit('playlistupdate');
  this.emit('statusupdate');
};

PlayerClient.prototype.getDefaultQueuePosition = function() {
  var previousKey = this.currentItem && this.currentItem.sortKey;
  var nextKey = null;
  var startPos = this.currentItem ? this.currentItem.index + 1 : 0;
  for (var i = startPos; i < this.playlist.itemList.length; i += 1) {
    var track = this.playlist.itemList[i];
    var sortKey = track.sortKey;
    if (track.isRandom) {
      nextKey = sortKey;
      break;
    }
    previousKey = sortKey;
  }
  return {
    previousKey: previousKey,
    nextKey: nextKey
  };
};

PlayerClient.prototype.queueTracks = function(keys, previousKey, nextKey) {
  if (!keys.length) return;

  if (previousKey == null && nextKey == null) {
    var defaultPos = this.getDefaultQueuePosition();
    previousKey = defaultPos.previousKey;
    nextKey = defaultPos.nextKey;
  }

  var items = {};
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    var sortKey = keese(previousKey, nextKey);
    var id = uuid();
    items[id] = {
      key: key,
      sortKey: sortKey,
    };
    this.playlist.itemTable[id] = {
      id: id,
      key: key,
      sortKey: sortKey,
      isRandom: false,
      track: this.library.trackTable[key],
    };
    previousKey = sortKey;
  }
  this.refreshPlaylistList();
  this.sendCommand('addid', items);
  this.emit('playlistupdate');
};

PlayerClient.prototype.queueTracksNext = function(keys) {
  var prevKey = this.currentItem && this.currentItem.sortKey;
  var nextKey = null;
  var itemList = this.playlist.itemList;
  for (var i = 0; i < itemList.length; ++i) {
    var track = itemList[i];
    if (prevKey == null || track.sortKey > prevKey) {
      if (nextKey == null || track.sortKey < nextKey) {
        nextKey = track.sortKey;
      }
    }
  }
  this.queueTracks(keys, prevKey, nextKey);
};

PlayerClient.prototype.clear = function(){
  this.sendCommand('clear');
  this.clearPlaylist();
  this.emit('playlistupdate');
};

PlayerClient.prototype.shuffle = function(){
  this.sendCommand('shuffle');
};

PlayerClient.prototype.play = function(){
  this.sendCommand('play');
  if (this.isPlaying === false) {
    this.trackStartDate = elapsedToDate(this.pausedTime);
    this.isPlaying = true;
    this.emit('statusupdate');
  }
};

PlayerClient.prototype.stop = function(){
  this.sendCommand('stop');
  if (this.isPlaying === true) {
    this.pausedTime = 0;
    this.isPlaying = false;
    this.emit('statusupdate');
  }
};

PlayerClient.prototype.pause = function(){
  this.sendCommand('pause');
  if (this.isPlaying === true) {
    this.pausedTime = dateToElapsed(this.trackStartDate);
    this.isPlaying = false;
    this.emit('statusupdate');
  }
};

PlayerClient.prototype.next = function(){
  var index = this.currentItem ? this.currentItem.index + 1 : 0;

  // handle the case of Repeat All
  if (index >= this.playlist.itemList.length &&
      this.repeat === PlayerClient.REPEAT_ALL)
  {
    index = 0;
  }

  var item = this.playlist.itemList[index];
  var id = item && item.id;

  this.seek(id, 0);
};

PlayerClient.prototype.prev = function(){
  var index = this.currentItem ? this.currentItem.index - 1 : this.playlist.itemList.length - 1;

  // handle case of Repeat All
  if (index < 0 && this.repeat === PlayerClient.REPEAT_ALL) {
    index = this.playlist.itemList.length - 1;
  }

  var item = this.playlist.itemList[index];
  var id = item && item.id;

  this.seek(id, 0);
};

PlayerClient.prototype.moveIds = function(trackIds, previousKey, nextKey){
  var track, i;
  var tracks = [];
  for (i = 0; i < trackIds.length; i += 1) {
    var id = trackIds[i];
    track = this.playlist.itemTable[id];
    if (track) tracks.push(track);
  }
  tracks.sort(compareSortKeyAndId);
  var items = {};
  for (i = 0; i < tracks.length; i += 1) {
    track = tracks[i];
    var sortKey = keese(previousKey, nextKey);
    items[track.id] = {
      sortKey: sortKey,
    };
    track.sortKey = sortKey;
    previousKey = sortKey;
  }
  this.refreshPlaylistList();
  this.sendCommand('move', items);
  this.emit('playlistupdate');
};

PlayerClient.prototype.shiftIds = function(trackIdSet, offset) {
  // an example of shifting 5 items (a,c,f,g,i) "down":
  // offset: +1, reverse: false, this -> way
  // selection: *     *        *  *     *
  //    before: a, b, c, d, e, f, g, h, i
  //             \     \        \  \    |
  //              \     \        \  \   |
  //     after: b, a, d, c, e, h, f, g, i
  // selection:    *     *        *  *  *
  // (note that "i" does not move because it has no futher to go.)
  //
  // an alternate way to think about it: some items "leapfrog" backwards over the selected items.
  // this ends up being much simpler to compute, and even more compact to communicate.
  // selection: *     *        *  *     *
  //    before: a, b, c, d, e, f, g, h, i
  //              /     /        ___/
  //             /     /        /
  //     after: b, a, d, c, e, h, f, g, i
  // selection:    *     *        *  *  *
  // (note that the moved items are not the selected items)
  var itemList = this.playlist.itemList;
  var movedItems = {};
  var reverse = offset === -1;
  function getKeeseBetween(itemA, itemB) {
    if (reverse) {
      var tmp = itemA;
      itemA = itemB;
      itemB = tmp;
    }
    var keyA = itemA == null ? null : itemA.sortKey;
    var keyB = itemB == null ? null : itemB.sortKey;
    return keese(keyA, keyB);
  }
  if (reverse) {
    // to make this easier, just reverse the item list in place so we can write one iteration routine.
    // note that we are editing our data model live! so don't forget to refresh it later.
    itemList.reverse();
  }
  for (var i = itemList.length - 1; i >= 1; i--) {
    var track = itemList[i];
    if (!(track.id in trackIdSet) && (itemList[i - 1].id in trackIdSet)) {
      // this one needs to move backwards (e.g. found "h" is not selected, and "g" is selected)
      i--; // e.g. g
      i--; // e.g. f
      while (true) {
        if (i < 0) {
          // fell off the end (or beginning) of the list
          track.sortKey = getKeeseBetween(null, itemList[0]);
          break;
        }
        if (!(itemList[i].id in trackIdSet)) {
          // this is where it goes (e.g. found "d" is not selected)
          track.sortKey = getKeeseBetween(itemList[i], itemList[i + 1]);
          break;
        }
        i--;
      }
      movedItems[track.id] = {sortKey: track.sortKey};
      i++;
    }
  }
  // we may have reversed the table and adjusted all the sort keys, so we need to refresh this.
  this.refreshPlaylistList();

  this.sendCommand('move', movedItems);
  this.emit('playlistupdate');
};

PlayerClient.prototype.removeIds = function(trackIds){
  if (trackIds.length === 0) return;
  var ids = [];
  for (var i = 0; i < trackIds.length; i += 1) {
    var trackId = trackIds[i];
    var currentId = this.currentItem && this.currentItem.id;
    if (currentId === trackId) {
      this.currentItemId = null;
      this.currentItem = null;
    }
    ids.push(trackId);
    var item = this.playlist.itemTable[trackId];
    delete this.playlist.itemTable[item.id];
    this.refreshPlaylistList();
  }
  this.sendCommand('deleteid', ids);
  this.emit('playlistupdate');
};

PlayerClient.prototype.seek = function(id, pos) {
  pos = parseFloat(pos || 0, 10);
  var item = id ? this.playlist.itemTable[id] : this.currentItem;
  if (pos < 0) pos = 0;
  if (pos > item.duration) pos = item.duration;
  this.sendCommand('seek', {
    id: item.id,
    pos: pos,
  });
  this.currentItem = item;
  this.currentItemId = item.id;
  this.isPlaying = true;
  this.duration = item.track.duration;
  this.trackStartDate = elapsedToDate(pos);
  this.emit('statusupdate');
};

PlayerClient.prototype.setVolume = function(vol){
  if (vol > 1.0) vol = 1.0;
  if (vol < 0.0) vol = 0.0;
  this.volume = vol;
  this.sendCommand('setvol', this.volume);
  this.emit('statusupdate');
};

PlayerClient.prototype.setRepeatMode = function(mode) {
  this.repeat = mode;
  this.sendCommand('repeat', mode);
  this.emit('statusupdate');
};

PlayerClient.prototype.sendCommand = function(name, args) {
  this.socket.send(name, args);
};

PlayerClient.prototype.clearPlaylist = function(){
  this.playlist = {
    itemList: [],
    itemTable: {},
    index: null,
    name: null
  };
};

PlayerClient.prototype.anticipatePlayId = function(trackId){
  var item = this.playlist.itemTable[trackId];
  this.currentItem = item;
  this.currentItemId = item.id;
  this.isPlaying = true;
  this.duration = item.track.duration;
  this.trackStartDate = new Date();
  this.emit('statusupdate');
};

PlayerClient.prototype.anticipateSkip = function(direction) {
  if (this.currentItem) {
    var nextItem = this.playlist.itemList[this.currentItem.index + direction];
    if (nextItem) this.anticipatePlayId(nextItem.id);
  }
};

PlayerClient.prototype.refreshPlaylistList = function(){
  this.playlist.itemList = [];
  var item;
  for (var id in this.playlist.itemTable) {
    item = this.playlist.itemTable[id];
    item.playlist = this.playlist;
    this.playlist.itemList.push(item);
  }
  this.playlist.itemList.sort(compareSortKeyAndId);
  for (var i = 0; i < this.playlist.itemList.length; i += 1) {
    item = this.playlist.itemList[i];
    item.index = i;
  }
};

// sort keys according to how they appear in the library
PlayerClient.prototype.sortKeys = function(keys) {
  var realLib = this.library;
  var lib = new MusicLibraryIndex();
  keys.forEach(function(key) {
    var track = realLib.trackTable[key];
    if (track) lib.addTrack(track);
  });
  lib.rebuild();
  var results = [];
  lib.artistList.forEach(function(artist) {
    artist.albumList.forEach(function(album) {
      album.trackList.forEach(function(track) {
        results.push(track.key);
      });
    });
  });
  return results;
};

PlayerClient.prototype.resetServerState = function(){
  this.haveFileListCache = false;
  this.library = new MusicLibraryIndex({
    searchFields: MusicLibraryIndex.defaultSearchFields.concat('file'),
  });
  this.searchResults = this.library;
  this.lastQuery = "";
  this.clearPlaylist();
  this.repeat = 0;
  this.currentItem = null;
  this.currentItemId = null;

  this.stored_playlist_table = {};
  this.stored_playlist_item_table = {};
  this.stored_playlists = [];
};

function elapsedToDate(elapsed){
  return new Date(new Date() - elapsed * 1000);
}

function dateToElapsed(date){
  return (new Date() - date) / 1000;
}

function noop(err){
  if (err) throw err;
}

function operatorCompare(a, b){
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  } else {
    return 1;
  }
}

function makeCompareProps(props){
  return function(a, b) {
    for (var i = 0; i < props.length; i += 1) {
      var prop = props[i];
      var result = operatorCompare(a[prop], b[prop]);
      if (result) return result;
    }
    return 0;
  };
}

},{"events":4,"jsondiffpatch":25,"keese":28,"music-library-index":30,"util":11,"uuid":33}],37:[function(require,module,exports){
var EventEmitter = require('events').EventEmitter;
var util = require('util');

module.exports = Socket;

util.inherits(Socket, EventEmitter);
function Socket() {
  var self = this;
  EventEmitter.call(self);
  self.isConnected = false;
  createWs();

  function createWs() {
    var host = window.document.location.host;
    var pathname = window.document.location.pathname;
    var match = host.match(/^(.+):(\d+)$/);
    var port = match ? parseInt(match[2], 10) : 80;
    var hostName = match ? match[1] : host;
    var wsUrl = 'ws://' + hostName + ':' + port + pathname;
    self.ws = new WebSocket(wsUrl);

    self.ws.addEventListener('message', onMessage, false);
    self.ws.addEventListener('error', timeoutThenCreateNew, false);
    self.ws.addEventListener('close', timeoutThenCreateNew, false);
    self.ws.addEventListener('open', onOpen, false);

    function onOpen() {
      self.isConnected = true;
      self.emit('connect');
    }

    function onMessage(event) {
      var msg = JSON.parse(event.data);
      self.emit(msg.name, msg.args);
    }

    function timeoutThenCreateNew() {
      self.ws.removeEventListener('error', timeoutThenCreateNew, false);
      self.ws.removeEventListener('close', timeoutThenCreateNew, false);
      self.ws.removeEventListener('open', onOpen, false);
      if (self.isConnected) {
        self.isConnected = false;
        self.emit('disconnect');
      }
      setTimeout(createWs, 1000);
    }
  }
}

Socket.prototype.send = function(name, args) {
  this.ws.send(JSON.stringify({
    name: name,
    args: args,
  }));
}

},{"events":4,"util":11}],38:[function(require,module,exports){
exports.getUrl = getUrl;
exports.toggleStatus = toggleStatus;
exports.init = init;

var tryingToStream = false;
var actuallyStreaming = false;
var stillBuffering = false;
var player = null;
var audio = new Audio();
audio.addEventListener('playing', onPlaying, false);

var $ = window.$;
var $streamBtn = $('#stream-btn');

document.getElementById('stream-btn-label').addEventListener('mousedown', onLabelDown, false);

function onLabelDown(event) {
  event.stopPropagation();
}

function getButtonLabel() {
  if (tryingToStream) {
    if (actuallyStreaming) {
      if (stillBuffering) {
        return "Stream: Buffering";
      } else {
        return "Stream: On";
      }
    } else {
      return "Stream: Paused";
    }
  } else {
    return "Stream: Off";
  }
}

function renderStreamButton(){
  var label = getButtonLabel();
  $streamBtn
    .button("option", "label", label)
    .prop("checked", tryingToStream)
    .button("refresh");
}

function toggleStatus() {
  tryingToStream = !tryingToStream;
  renderStreamButton();
  updatePlayer();
  return false;
}

function getUrl(){
  return "/stream.mp3";
}

function onPlaying() {
  stillBuffering = false;
  renderStreamButton();
}

function clearBuffer() {
  if (tryingToStream) {
    tryingToStream = !tryingToStream;
    updatePlayer();
    tryingToStream = !tryingToStream;
    updatePlayer();
  }
}

function updatePlayer() {
  var shouldStream = tryingToStream && player.isPlaying === true;
  if (actuallyStreaming === shouldStream) return;
  if (shouldStream) {
    audio.src = getUrl();
    audio.load();
    audio.play();
    stillBuffering = true;
  } else {
    audio.pause();
    stillBuffering = false;
  }
  actuallyStreaming = shouldStream;
  renderStreamButton();
}

function setUpUi() {
  $streamBtn.button({
    icons: {
      primary: "ui-icon-signal-diag"
    }
  });
  $streamBtn.on('click', toggleStatus);
}

function init(playerInstance, socket) {
  player = playerInstance;

  player.on('currentTrack', updatePlayer);
  socket.on('seek', clearBuffer);
  setUpUi();
}

},{}]},{},[35])