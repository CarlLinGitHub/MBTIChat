function messageId() {
  return new Promise((resolve, reject) => wx.getRandomValues({
    length: 16,
    success({ randomValues }) {
      const bytes = new Uint8Array(randomValues)
      bytes[6] = (bytes[6] & 15) | 64
      bytes[8] = (bytes[8] & 63) | 128
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
      resolve(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`)
    },
    fail() { reject(new Error('无法创建消息编号，请重试')) }
  }))
}

function chooseImage() {
  return new Promise((resolve, reject) => wx.chooseMedia({
    count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
    success({ tempFiles }) { resolve(tempFiles[0]) },
    fail(error) {
      if (/cancel/i.test(error.errMsg || '')) resolve(null)
      else reject(new Error('无法选取图片，请检查相机或相册授权'))
    }
  }))
}

function readImage(path) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
    filePath: path,
    success({ data }) {
      const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 12))
      if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return resolve({ data, contentType: 'image/jpeg' })
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return resolve({ data, contentType: 'image/png' })
      if (String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') return resolve({ data, contentType: 'image/gif' })
      if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return resolve({ data, contentType: 'image/webp' })
      reject(new Error('请选择 JPEG、PNG、GIF 或 WebP 图片'))
    },
    fail() { reject(new Error('无法读取图片，请重新选择')) }
  }))
}

module.exports = { messageId, chooseImage, readImage }
