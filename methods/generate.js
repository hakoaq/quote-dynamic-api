const {
  QuoteGenerate
} = require('../utils')
const { createCanvas, loadImage } = require('canvas')
const sharp = require('sharp')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')

const normalizeColor = (color) => {
  const canvas = createCanvas(0, 0)
  const canvasCtx = canvas.getContext('2d')

  canvasCtx.fillStyle = color
  color = canvasCtx.fillStyle

  return color
}

const colorLuminance = (hex, lum) => {
  hex = String(hex).replace(/[^0-9a-f]/gi, '')
  if (hex.length < 6) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  lum = lum || 0

  // convert to decimal and change luminosity
  let rgb = '#'
  let c
  let i
  for (i = 0; i < 3; i++) {
    c = parseInt(hex.substr(i * 2, 2), 16)
    c = Math.round(Math.min(Math.max(0, c + (c * lum)), 255)).toString(16)
    rgb += ('00' + c).substr(c.length)
  }

  return rgb
}

const imageAlpha = (image, alpha) => {
  const canvas = createCanvas(image.width, image.height)

  const canvasCtx = canvas.getContext('2d')

  canvasCtx.globalAlpha = alpha

  canvasCtx.drawImage(image, 0, 0)

  return canvas
}

module.exports = async (parm) => {
  // console.log(JSON.stringify(parm, null, 2))
  if (!parm) return { error: 'query_empty' }
  if (!parm.messages || parm.messages.length < 1) return { error: 'messages_empty' }

  let botToken = parm.botToken || process.env.BOT_TOKEN

  const quoteGenerate = new QuoteGenerate(botToken)

  const quoteImages = []
  let hasAnimatedContent = false

  let backgroundColor = parm.backgroundColor || '//#292232'
  let backgroundColorOne
  let backgroundColorTwo

  const backgroundColorSplit = backgroundColor.split('/')

  if (backgroundColorSplit && backgroundColorSplit.length > 1 && backgroundColorSplit[0] !== '') {
    backgroundColorOne = normalizeColor(backgroundColorSplit[0])
    backgroundColorTwo = normalizeColor(backgroundColorSplit[1])
  } else if (backgroundColor.startsWith('//')) {
    backgroundColor = normalizeColor(backgroundColor.replace('//', ''))
    backgroundColorOne = colorLuminance(backgroundColor, 0.35)
    backgroundColorTwo = colorLuminance(backgroundColor, -0.15)
  } else {
    backgroundColor = normalizeColor(backgroundColor)
    backgroundColorOne = backgroundColor
    backgroundColorTwo = backgroundColor
  }

  for (const key in parm.messages) {
    const message = parm.messages[key]

    if (message) {
      // Ensure message has the required structure to prevent errors
      if (!message.from) {
        message.from = { id: 0 }
      }

      // Ensure from object has photo property
      if (!message.from.photo) {
        message.from.photo = {}
      }

      // Make sure name exists in from object
      if (!message.from.name && (message.from.first_name || message.from.last_name)) {
        message.from.name = [message.from.first_name, message.from.last_name]
          .filter(Boolean)
          .join(' ')
      }

      // Ensure reply message has required structure to prevent errors
      if (message.replyMessage) {
        // Initialize chatId if missing - required for replyNameIndex calculation
        if (!message.replyMessage.chatId) {
          message.replyMessage.chatId = message.from?.id || 0
        }

        // Ensure entities array exists
        if (!message.replyMessage.entities) {
          message.replyMessage.entities = []
        }

        // Ensure the reply message has a from property if needed
        if (!message.replyMessage.from) {
          message.replyMessage.from = {
            name: message.replyMessage.name,
            photo: {}
          }
        } else if (!message.replyMessage.from.photo) {
          message.replyMessage.from.photo = {}
        }
      }

      const canvasQuote = await quoteGenerate.generate(
        backgroundColorOne,
        backgroundColorTwo,
        message,
        parm.width,
        parm.height,
        parseFloat(parm.scale) || 2,
        parm.emojiBrand || 'apple'
      )

      quoteImages.push(canvasQuote)
      
      // 检查是否有动态内容
      if (canvasQuote.isAnimated || canvasQuote.animatedMedia) {
        hasAnimatedContent = true
      }
    }
  }

  if (quoteImages.length === 0) {
    return {
      error: 'empty_messages'
    }
  }

  // 如果有动态内容，生成动态WebM
  if (hasAnimatedContent) {
    try {
      return await generateAnimatedQuote(quoteImages, parm, backgroundColorOne, backgroundColorTwo)
    } catch (error) {
      console.error('动态语录生成失败，回退到静态:', error)
      // 继续生成静态版本
    }
  }

  let canvasQuote

  if (quoteImages.length > 1) {
    let width = 0
    let height = 0

    for (let index = 0; index < quoteImages.length; index++) {
      if (quoteImages[index].width > width) width = quoteImages[index].width
      height += quoteImages[index].height
    }

    const quoteMargin = 5 * parm.scale

    const canvas = createCanvas(width, height + (quoteMargin * quoteImages.length))
    const canvasCtx = canvas.getContext('2d')

    let imageY = 0

    for (let index = 0; index < quoteImages.length; index++) {
      canvasCtx.drawImage(quoteImages[index], 0, imageY)
      imageY += quoteImages[index].height + quoteMargin
    }
    canvasQuote = canvas
  } else {
    canvasQuote = quoteImages[0].canvas || quoteImages[0]
  }

  let quoteImage

  let { type, format, ext } = parm

  if (!type && ext) type = 'png'
  if (type !== 'image' && type !== 'stories' && canvasQuote.height > 1024 * 2) type = 'png'

  if (type === 'quote') {
    const downPadding = 75
    const maxWidth = 512
    const maxHeight = 512

    const imageQuoteSharp = sharp(canvasQuote.toBuffer())

    if (canvasQuote.height > canvasQuote.width) imageQuoteSharp.resize({ height: maxHeight })
    else imageQuoteSharp.resize({ width: maxWidth })

    const canvasImage = await loadImage(await imageQuoteSharp.toBuffer())

    const canvasPadding = createCanvas(canvasImage.width, canvasImage.height + downPadding)
    const canvasPaddingCtx = canvasPadding.getContext('2d')

    canvasPaddingCtx.drawImage(canvasImage, 0, 0)

    const imageSharp = sharp(canvasPadding.toBuffer())

    if (canvasPadding.height >= canvasPadding.width) imageSharp.resize({ height: maxHeight })
    else imageSharp.resize({ width: maxWidth })

    if (format === 'png') quoteImage = await imageSharp.png().toBuffer()
    else quoteImage = await imageSharp.webp({ lossless: true, force: true }).toBuffer()
  } else if (type === 'image') {
    const heightPadding = 75 * parm.scale
    const widthPadding = 95 * parm.scale

    const canvasImage = await loadImage(canvasQuote.toBuffer())

    const canvasPic = createCanvas(canvasImage.width + widthPadding, canvasImage.height + heightPadding)
    const canvasPicCtx = canvasPic.getContext('2d')

    // radial gradient background (top left)
    const gradient = canvasPicCtx.createRadialGradient(
      canvasPic.width / 2,
      canvasPic.height / 2,
      0,
      canvasPic.width / 2,
      canvasPic.height / 2,
      canvasPic.width / 2
    )

    const patternColorOne = colorLuminance(backgroundColorTwo, 0.15)
    const patternColorTwo = colorLuminance(backgroundColorOne, 0.15)

    gradient.addColorStop(0, patternColorOne)
    gradient.addColorStop(1, patternColorTwo)

    canvasPicCtx.fillStyle = gradient
    canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height)

    const canvasPatternImage = await loadImage('./assets/pattern_02.png')
    // const canvasPatternImage = await loadImage('./assets/pattern_ny.png');

    const pattern = canvasPicCtx.createPattern(imageAlpha(canvasPatternImage, 0.3), 'repeat')

    canvasPicCtx.fillStyle = pattern
    canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height)

    // Add shadow effect to the canvas image
    canvasPicCtx.shadowOffsetX = 8
    canvasPicCtx.shadowOffsetY = 8
    canvasPicCtx.shadowBlur = 13
    canvasPicCtx.shadowColor = 'rgba(0, 0, 0, 0.5)'

    // Draw the image to the canvas with padding centered
    canvasPicCtx.drawImage(canvasImage, widthPadding / 2, heightPadding / 2)

    canvasPicCtx.shadowOffsetX = 0
    canvasPicCtx.shadowOffsetY = 0
    canvasPicCtx.shadowBlur = 0
    canvasPicCtx.shadowColor = 'rgba(0, 0, 0, 0)'

    // write text button right
    canvasPicCtx.fillStyle = `rgba(0, 0, 0, 0.3)`
    canvasPicCtx.font = `${8 * parm.scale}px Noto Sans`
    canvasPicCtx.textAlign = 'right'
    canvasPicCtx.fillText('@QuotLyBot', canvasPic.width - 25, canvasPic.height - 25)

    quoteImage = await sharp(canvasPic.toBuffer()).png({ lossless: true, force: true }).toBuffer()
  } else if (type === 'stories') {
    const canvasPic = createCanvas(720, 1280)
    const canvasPicCtx = canvasPic.getContext('2d')

    // radial gradient background (top left)
    const gradient = canvasPicCtx.createRadialGradient(
      canvasPic.width / 2,
      canvasPic.height / 2,
      0,
      canvasPic.width / 2,
      canvasPic.height / 2,
      canvasPic.width / 2
    )

    const patternColorOne = colorLuminance(backgroundColorTwo, 0.25)
    const patternColorTwo = colorLuminance(backgroundColorOne, 0.15)

    gradient.addColorStop(0, patternColorOne)
    gradient.addColorStop(1, patternColorTwo)

    canvasPicCtx.fillStyle = gradient
    canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height)

    const canvasPatternImage = await loadImage('./assets/pattern_02.png')

    const pattern = canvasPicCtx.createPattern(imageAlpha(canvasPatternImage, 0.3), 'repeat')

    canvasPicCtx.fillStyle = pattern
    canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height)

    // Add shadow effect to the canvas image
    canvasPicCtx.shadowOffsetX = 8
    canvasPicCtx.shadowOffsetY = 8
    canvasPicCtx.shadowBlur = 13
    canvasPicCtx.shadowColor = 'rgba(0, 0, 0, 0.5)'

    let canvasImage = await loadImage(canvasQuote.toBuffer())

    // мінімальний відступ від країв картинки
    const minPadding = 110

    // resize canvasImage if it is larger than canvasPic + minPadding
    if (canvasImage.width > canvasPic.width - minPadding * 2 || canvasImage.height > canvasPic.height - minPadding * 2) {
      canvasImage = await sharp(canvasQuote.toBuffer()).resize({
        width: canvasPic.width - minPadding * 2,
        height: canvasPic.height - minPadding * 2,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }).toBuffer()

      canvasImage = await loadImage(canvasImage)
    }

    // розмістити canvasImage в центрі по горизонталі і вертикалі
    const imageX = (canvasPic.width - canvasImage.width) / 2
    const imageY = (canvasPic.height - canvasImage.height) / 2

    canvasPicCtx.drawImage(canvasImage, imageX, imageY)

    canvasPicCtx.shadowOffsetX = 0
    canvasPicCtx.shadowOffsetY = 0
    canvasPicCtx.shadowBlur = 0

    // write text vertical left center text
    canvasPicCtx.fillStyle = `rgba(0, 0, 0, 0.4)`
    canvasPicCtx.font = `${16 * parm.scale}px Noto Sans`
    canvasPicCtx.textAlign = 'center'
    canvasPicCtx.translate(70, canvasPic.height / 2)
    canvasPicCtx.rotate(-Math.PI / 2)
    canvasPicCtx.fillText('@QuotLyBot', 0, 0)

    quoteImage = await sharp(canvasPic.toBuffer()).png({ lossless: true, force: true }).toBuffer()
  } else {
    quoteImage = canvasQuote.toBuffer()
  }

  const imageMetadata = await sharp(quoteImage).metadata()

  const width = imageMetadata.width
  const height = imageMetadata.height

  let image
  if (ext) image = quoteImage
  else image = quoteImage.toString('base64')

  return {
    image,
    type,
    width,
    height,
    ext
  }
}

async function createTextOverlay(outputPath, width, height, parm) {
  const { createCanvas } = require('canvas')
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // 创建透明背景
  ctx.clearRect(0, 0, width, height)

  // 不在这里绘制文字，而是创建完全透明的叠加层
  // 文字和语录样式将在 createQuoteOverlay 中处理
  
  // 保存为PNG（透明层）
  const fs = require('fs')
  const buffer = canvas.toBuffer('image/png')
  fs.writeFileSync(outputPath, buffer)
}

async function createQuoteOverlay(outputPath, width, height, parm, quoteCanvas) {
  const { createCanvas } = require('canvas')
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // 创建透明背景
  ctx.clearRect(0, 0, width, height)

  // 绘制完整的语录到叠加层，但要为动态媒体留出透明区域
  if (quoteCanvas) {
    // 计算语录在画面中的位置
    const quoteX = (width - quoteCanvas.width) / 2
    const quoteY = height - quoteCanvas.height - 20 // 距离底部20像素
    
    // 直接绘制完整的语录canvas
    ctx.drawImage(quoteCanvas, quoteX, quoteY)
  }

  // 保存为PNG
  const fs = require('fs')
  const buffer = canvas.toBuffer('image/png')
  fs.writeFileSync(outputPath, buffer)
}

async function createQuoteOverlay(outputPath, width, height, parm, quoteCanvas, animatedMedia) {
  const { createCanvas } = require('canvas')
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // 创建透明背景
  ctx.clearRect(0, 0, width, height)

  // 绘制完整的语录到叠加层，但要为动态媒体留出透明区域
  if (quoteCanvas) {
    ctx.save()
    
    // 先绘制完整的语录
    ctx.drawImage(quoteCanvas, 0, 0)
    
    // 如果有动态媒体信息，在动态媒体位置创建透明区域（挖空效果）
    if (animatedMedia && animatedMedia.mediaPosX !== undefined) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,1)'
      ctx.fillRect(
        animatedMedia.mediaPosX, 
        animatedMedia.mediaPosY, 
        animatedMedia.mediaWidth, 
        animatedMedia.mediaHeight
      )
    }
    
    ctx.restore()
  }

  // 保存为PNG
  const fs = require('fs')
  const buffer = canvas.toBuffer('image/png')
  fs.writeFileSync(outputPath, buffer)
}

async function generateAnimatedQuote(quoteImages, parm, backgroundColorOne, backgroundColorTwo) {
  const path = require('path')
  const fs = require('fs')
  const ffmpeg = require('fluent-ffmpeg')
  
  try {
    const tempDir = path.join(__dirname, '../temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    const timestamp = Date.now()
    const outputFile = path.join(tempDir, `animated_quote_${timestamp}.webm`)
    
    // 找到包含动态媒体的语录
    const animatedQuote = quoteImages.find(quote => quote.animatedMedia)
    if (!animatedQuote || !animatedQuote.animatedMedia.localPath) {
      throw new Error('没有找到有效的动态内容')
    }

    const canvas = animatedQuote.canvas
    const animatedMedia = animatedQuote.animatedMedia
    const overlayFile = path.join(tempDir, `overlay_${timestamp}.png`)
    
    // 创建包含完整语录的叠加层，为动态媒体留出透明区域
    await createQuoteOverlay(overlayFile, canvas.width, canvas.height, parm, canvas, animatedMedia)

    const animatedMediaPath = animatedMedia.localPath

    console.log('开始合成动态语录...')
    console.log('动态媒体路径:', animatedMediaPath)
    console.log('语录叠加层:', overlayFile)
    console.log('动态媒体信息:', {
      width: animatedMedia.width,
      height: animatedMedia.height,
      duration: animatedMedia.duration,
      fps: animatedMedia.fps,
      mediaPosX: animatedMedia.mediaPosX,
      mediaPosY: animatedMedia.mediaPosY,
      mediaWidth: animatedMedia.mediaWidth,
      mediaHeight: animatedMedia.mediaHeight
    })
    
    // 获取动态媒体的实际尺寸和时长
    return new Promise((resolve, reject) => {
      // 先获取视频信息
      ffmpeg.ffprobe(animatedMediaPath, (err, metadata) => {
        if (err) {
          reject(err)
          return
        }

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video')
        const videoWidth = videoStream ? videoStream.width : 512
        const videoHeight = videoStream ? videoStream.height : 512
        const videoDuration = parseFloat(metadata.format.duration) || 3.0 // 使用实际时长

        console.log(`原始视频尺寸: ${videoWidth}x${videoHeight}`)
        console.log(`原始视频时长: ${videoDuration}秒`)
        console.log(`语录画布尺寸: ${canvas.width}x${canvas.height}`)

        // 使用语录画布的尺寸作为输出尺寸
        const outputWidth = canvas.width
        const outputHeight = canvas.height

        console.log(`输出尺寸: ${outputWidth}x${outputHeight}`)

        // 使用动态媒体对象中保存的位置信息
        const mediaPosX = animatedMedia.mediaPosX
        const mediaPosY = animatedMedia.mediaPosY
        const mediaWidth = animatedMedia.mediaWidth
        const mediaHeight = animatedMedia.mediaHeight

        console.log(`媒体显示尺寸: ${mediaWidth}x${mediaHeight}`)
        console.log(`媒体位置: ${mediaPosX}, ${mediaPosY}`)

        // 修复FFmpeg命令构建
        const command = ffmpeg()
          .input(animatedMediaPath)
          .inputOptions(['-stream_loop', '3']) // 正确的循环语法
          .input(overlayFile)
          .complexFilter([
            // 缩放动态媒体到合适尺寸
            `[0:v]scale=${Math.round(mediaWidth)}:${Math.round(mediaHeight)}[scaled_media]`,
            // 创建语录大小的背景色
            `color=c=#000000:size=${outputWidth}x${outputHeight}:duration=${Math.max(videoDuration, 3)}[bg]`,
            // 将动态媒体放置到正确位置
            `[bg][scaled_media]overlay=${Math.round(mediaPosX)}:${Math.round(mediaPosY)}:shortest=1[with_media]`,
            // 叠加语录层（包含头像、对话框、用户名等所有元素）
            `[with_media][1:v]overlay=0:0[output]`
          ])
          .outputOptions([
            '-map', '[output]',
            '-c:v', 'libvpx',
            '-crf', '23',
            '-b:v', '1M',
            '-auto-alt-ref', '0',
            `-t`, `${Math.max(videoDuration * 3, 3)}` // 确保足够的播放时长
          ])
          .format('webm')
          .output(outputFile)

        command.on('start', (commandLine) => {
          console.log('FFmpeg命令:', commandLine)
        })

        command.on('progress', (progress) => {
          console.log(`处理进度: ${Math.round(progress.percent || 0)}%`)
        })

        command.on('end', () => {
          console.log('动态语录生成完成')
          
          try {
            const webmBuffer = fs.readFileSync(outputFile)
            
            // 清理临时文件
            const filesToClean = [overlayFile, outputFile]
            if (animatedMediaPath.includes(tempDir)) {
              filesToClean.push(animatedMediaPath)
            }
            
            filesToClean.forEach(file => {
              if (fs.existsSync(file)) {
                try { fs.unlinkSync(file) } catch (e) { console.error('清理文件失败:', e) }
              }
            })

            let result
            if (parm.ext) {
              result = webmBuffer
            } else {
              result = webmBuffer.toString('base64')
            }

            resolve({
              image: result,
              type: 'animated',
              width: outputWidth,
              height: outputHeight,
              ext: parm.ext || 'webm',
              isAnimated: true,
              duration: Math.max(videoDuration * 3, 3)
            })
          } catch (error) {
            console.error('读取输出文件失败:', error)
            reject(error)
          }
        })

        command.on('error', (err) => {
          console.error('FFmpeg合成错误:', err)
          
          // 清理临时文件
          const filesToClean = [overlayFile, outputFile]
          if (animatedMediaPath.includes(tempDir)) {
            filesToClean.push(animatedMediaPath)
          }
          
          filesToClean.forEach(file => {
            if (fs.existsSync(file)) {
              try { fs.unlinkSync(file) } catch (e) { console.error('清理文件失败:', e) }
            }
          })
          
          reject(err)
        })

        command.run()
      })
    })
  } catch (error) {
    console.error('生成动态语录错误:', error)
    throw error
  }
}


