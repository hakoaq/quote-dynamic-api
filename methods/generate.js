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
    type: type || 'quote',
    width,
    height,
    ext: ext || null, // 明确设置ext字段
    format: format || 'webp' // 添加format字段作为备用
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
        const videoDuration = Math.min(parseFloat(metadata.format.duration) || 3.0, 3.0)

        console.log(`原始视频尺寸: ${videoWidth}x${videoHeight}`)
        console.log(`原始视频时长: ${videoDuration}秒`)

        // 使用语录canvas的实际尺寸作为基础
        let outputWidth = canvas.width
        let outputHeight = canvas.height

        // 确保符合Telegram要求：一边必须是512像素
        if (outputWidth !== 512 && outputHeight !== 512) {
          if (outputWidth >= outputHeight) {
            const ratio = 512 / outputWidth
            outputWidth = 512
            outputHeight = Math.min(Math.round(outputHeight * ratio), 512)
          } else {
            const ratio = 512 / outputHeight
            outputHeight = 512
            outputWidth = Math.min(Math.round(outputWidth * ratio), 512)
          }
        }

        console.log(`输出尺寸: ${outputWidth}x${outputHeight}`)

        // 计算媒体在最终输出中的位置和尺寸
        const scaleX = outputWidth / canvas.width
        const scaleY = outputHeight / canvas.height
        const scaledMediaPosX = Math.round(animatedMedia.mediaPosX * scaleX)
        const scaledMediaPosY = Math.round(animatedMedia.mediaPosY * scaleY)
        const scaledMediaWidth = Math.round(animatedMedia.mediaWidth * scaleX)
        const scaledMediaHeight = Math.round(animatedMedia.mediaHeight * scaleY)

        console.log(`缩放后媒体信息:`)
        console.log(`  位置: (${scaledMediaPosX}, ${scaledMediaPosY})`)
        console.log(`  尺寸: ${scaledMediaWidth}x${scaledMediaHeight}`)
        console.log(`  缩放比例: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}`)

        // 限制最大时长为3秒
        const maxDuration = 3.0
        const actualDuration = Math.min(videoDuration, maxDuration)
        
        // 限制帧率为30fps
        const targetFPS = Math.min(30, videoStream ? (videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : 30) : 30)

        // 构建优化的FFmpeg命令
        const command = ffmpeg()
          .input(animatedMediaPath)
          .inputOptions([
            '-stream_loop', '2',
            '-t', actualDuration.toString()
          ])
          .input(overlayFile)
          .complexFilter([
            // 精确缩放动态媒体到计算出的尺寸
            `[0:v]scale=${scaledMediaWidth}:${scaledMediaHeight}:flags=lanczos[scaled_media]`,
            // 创建精确尺寸的背景
            `color=c=#000000:size=${outputWidth}x${outputHeight}:duration=${actualDuration}[bg]`,
            // 精确定位动态媒体
            `[bg][scaled_media]overlay=${scaledMediaPosX}:${scaledMediaPosY}:shortest=1[with_media]`,
            // 缩放叠加层到输出尺寸
            `[1:v]scale=${outputWidth}:${outputHeight}:flags=lanczos[scaled_overlay]`,
            // 叠加语录层
            `[with_media][scaled_overlay]overlay=0:0[output]`
          ])
          .outputOptions([
            '-map', '[output]',
            '-c:v', 'libvpx-vp9',
            '-pix_fmt', 'yuva420p',
            '-crf', '35', // 稍微降低CRF以提高质量
            '-b:v', '250k', // 适度提高比特率
            '-maxrate', '500k',
            '-bufsize', '1000k',
            '-r', targetFPS.toString(),
            '-t', actualDuration.toString(),
            '-an',
            '-deadline', 'good',
            '-cpu-used', '1', // 提高编码质量
            '-row-mt', '1',
            '-threads', '4',
            '-loop', '0'
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
            const fileSizeKB = webmBuffer.length / 1024
            
            console.log(`生成文件大小: ${fileSizeKB.toFixed(2)} KB`)
            
            // 检查文件大小是否超过256KB限制
            if (fileSizeKB > 256) {
              console.warn(`⚠️ 文件大小超过256KB限制: ${fileSizeKB.toFixed(2)} KB`)
              
              // 尝试重新生成更小的文件
              const smallerCommand = ffmpeg()
                .input(animatedMediaPath)
                .inputOptions(['-stream_loop', '1', '-t', '2']) // 减少时长到2秒
                .input(overlayFile)
                .complexFilter([
                  `[0:v]scale=${scaledMediaWidth}:${scaledMediaHeight}[scaled_media]`,
                  `color=c=#000000:size=${outputWidth}x${outputHeight}:duration=2[bg]`,
                  `[bg][scaled_media]overlay=${scaledMediaPosX}:${scaledMediaPosY}:shortest=1[with_media]`,
                  `[1:v]scale=${outputWidth}:${outputHeight}[scaled_overlay]`,
                  `[with_media][scaled_overlay]overlay=0:0[output]`
                ])
                .outputOptions([
                  '-map', '[output]',
                  '-c:v', 'libvpx-vp9',
                  '-pix_fmt', 'yuva420p',
                  '-crf', '50', // 进一步提高CRF
                  '-b:v', '150k', // 进一步降低比特率
                  '-maxrate', '200k',
                  '-bufsize', '400k',
                  '-r', '24', // 降低帧率
                  '-t', '2',
                  '-an',
                  '-deadline', 'good',
                  '-cpu-used', '4',
                  '-row-mt', '1',
                  '-threads', '4',
                  '-loop', '0'
                ])
                .format('webm')
                .output(outputFile + '_small.webm')
                .on('end', () => {
                  const smallWebmBuffer = fs.readFileSync(outputFile + '_small.webm')
                  const smallFileSizeKB = smallWebmBuffer.length / 1024
                  console.log(`优化后文件大小: ${smallFileSizeKB.toFixed(2)} KB`)
                  
                  // 使用较小的文件
                  fs.renameSync(outputFile + '_small.webm', outputFile)
                  
                  finishProcessing(outputFile, smallWebmBuffer, outputWidth, outputHeight, 2)
                })
                .on('error', (err) => {
                  console.error('优化文件失败，使用原文件:', err)
                  finishProcessing(outputFile, webmBuffer, outputWidth, outputHeight, actualDuration)
                })
                .run()
            } else {
              finishProcessing(outputFile, webmBuffer, outputWidth, outputHeight, actualDuration)
            }
            
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

        function finishProcessing(outputPath, buffer, width, height, duration) {
          // 清理临时文件
          const filesToClean = [overlayFile, outputPath]
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
            result = buffer
          } else {
            result = buffer.toString('base64')
          }

          resolve({
            image: result,
            type: 'animated',
            width: width,
            height: height,
            ext: parm.ext || 'webm',
            isAnimated: true,
            duration: duration,
            fileSize: buffer.length,
            codec: 'vp9',
            fps: targetFPS
          })
        }

        command.run()
      })
    })
  } catch (error) {
    console.error('生成动态语录错误:', error)
    throw error
  }
}


