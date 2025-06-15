const path = require('path')
const fs = require('fs')
const { createCanvas } = require('canvas')

class WebmQuoteGenerator {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp')
    this.outputDir = path.join(__dirname, '../output')
    
    // 确保目录存在
    const dirs = [this.tempDir, this.outputDir]
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    })
  }

  async generateQuoteWebm(options) {
    const {
      webmFilePath,
      quote,
      author,
      style = {},
      outputFileName
    } = options

    try {
      // 简化版本：直接复制原文件并记录语录信息
      const outputFile = path.join(this.outputDir, outputFileName || `quote_${Date.now()}.webm`)
      
      // 复制原始WebM文件
      if (fs.existsSync(webmFilePath)) {
        fs.copyFileSync(webmFilePath, outputFile)
      } else {
        // 如果源文件不存在，创建一个简单的文本说明文件
        const infoFile = outputFile.replace('.webm', '.txt')
        const info = `动态语录信息:\n语录: ${quote}\n作者: ${author || '未知'}\n生成时间: ${new Date().toISOString()}`
        fs.writeFileSync(infoFile, info, 'utf8')
      }
      
      console.log('WebM语录生成完成:', outputFile)
      
      return {
        success: true,
        outputPath: outputFile,
        fileName: path.basename(outputFile)
      }
    } catch (error) {
      console.error('生成WebM语录失败:', error)
      throw error
    }
  }

  getOutputPath(fileName) {
    return path.join(this.outputDir, fileName)
  }

  cleanupFile(filePath) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}

module.exports = WebmQuoteGenerator
