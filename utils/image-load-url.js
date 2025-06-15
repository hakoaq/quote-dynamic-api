const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')

module.exports = (url, filter = false) => {
  return new Promise((resolve, reject) => {
    // 处理file://协议
    if (url.startsWith('file://')) {
      const filePath = url.replace('file://', '')
      try {
        const buffer = fs.readFileSync(filePath)
        resolve(buffer)
      } catch (error) {
        reject(error)
      }
      return
    }

    // 处理本地文件路径
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      try {
        const buffer = fs.readFileSync(url)
        resolve(buffer)
      } catch (error) {
        reject(error)
      }
      return
    }

    // 选择合适的协议
    const protocol = url.startsWith('https://') ? https : http

    protocol.get(url, (res) => {
      if (filter && filter(res.headers)) {
        resolve(Buffer.concat([]))
        return
      }

      const chunks = []

      res.on('error', (err) => {
        reject(err)
      })
      res.on('data', (chunk) => {
        chunks.push(chunk)
      })
      res.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
    }).on('error', (err) => {
      reject(err)
    })
  })
}
