const fs = require('fs')
const { createCanvas, registerFont } = require('canvas')
const EmojiDbLib = require('emoji-db')
const { loadImage } = require('canvas')
const loadImageFromUrl = require('./image-load-url')
const sharp = require('sharp')
const { Jimp, JimpMime } = require('jimp')
const smartcrop = require('smartcrop-sharp')
const runes = require('runes')
const zlib = require('zlib')
const { Telegram } = require('telegraf')
const ffmpeg = require('fluent-ffmpeg')
const path = require('path')

const emojiDb = new EmojiDbLib({ useDefaultDb: true })

function loadFont () {
  console.log('font load start')
  const fontsDir = 'assets/fonts/'

  fs.readdir(fontsDir, (_err, files) => {
    files.forEach((file) => {
      try {
        registerFont(`${fontsDir}${file}`, { family: file.replace(/\.[^/.]+$/, '') })
      } catch (error) {
        console.error(`${fontsDir}${file} not font file`)
      }
    })
  })

  console.log('font load end')
}

loadFont()

const emojiImageByBrand = require('./emoji-image')

const LRU = require('lru-cache')

const avatarCache = new LRU({
  max: 20,
  maxAge: 1000 * 60 * 5
})

// write a nodejs function that accepts 2 colors. the first is the background color and the second is the text color. as a result, the first color should come out brighter or darker depending on the contrast. for example, if the first text is dark, then make the second brighter and return it. you need to change not the background color, but the text color

// here are all the possible colors that will be passed as the second argument. the first color can be any
class ColorContrast {
  constructor() {
    this.brightnessThreshold = 175; // A threshold to determine when a color is considered bright or dark
  }

  getBrightness(color) {
    // Calculates the brightness of a color using the formula from the WCAG 2.0
    // See: https://www.w3.org/TR/WCAG20-TECHS/G18.html#G18-tests
    const [r, g, b] = this.hexToRgb(color);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  hexToRgb(hex) {
    // Converts a hex color string to an RGB array
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    return [r, g, b];
  }

  rgbToHex([r, g, b]) {
    // Converts an RGB array to a hex color string
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  adjustBrightness(color, amount) {
    // Adjusts the brightness of a color by a specified amount
    const [r, g, b] = this.hexToRgb(color);
    const newR = Math.max(0, Math.min(255, r + amount));
    const newG = Math.max(0, Math.min(255, g + amount));
    const newB = Math.max(0, Math.min(255, b + amount));
    return this.rgbToHex([newR, newG, newB]);
  }

  getContrastRatio(background, foreground) {
    // Calculates the contrast ratio between two colors using the formula from the WCAG 2.0
    // See: https://www.w3.org/TR/WCAG20-TECHS/G18.html#G18-tests
    const brightness1 = this.getBrightness(background);
    const brightness2 = this.getBrightness(foreground);
    const lightest = Math.max(brightness1, brightness2);
    const darkest = Math.min(brightness1, brightness2);
    return (lightest + 0.05) / (darkest + 0.05);
  }

  adjustContrast(background, foreground) {
    // Adjusts the brightness of the foreground color to meet the minimum contrast ratio
    // with the background color
    const contrastRatio = this.getContrastRatio(background, foreground);
    const brightnessDiff = this.getBrightness(background) - this.getBrightness(foreground);
    if (contrastRatio >= 4.5) {
      return foreground; // The contrast ratio is already sufficient
    } else if (brightnessDiff >= 0) {
      // The background is brighter than the foreground
      const amount = Math.ceil((this.brightnessThreshold - this.getBrightness(foreground)) / 2);
      return this.adjustBrightness(foreground, amount);
    } else {
      // The background is darker than the foreground
      const amount = Math.ceil((this.getBrightness(foreground) - this.brightnessThreshold) / 2);
      return this.adjustBrightness(foreground, -amount);
    }
  }
}


class QuoteGenerate {
  constructor (botToken) {
    // 只有在提供了有效botToken时才初始化Telegram实例
    this.telegram = botToken ? new Telegram(botToken) : null
  }

  async avatarImageLatters (letters, color) {
    const size = 500
    const canvas = createCanvas(size, size)
    const context = canvas.getContext('2d')

    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)

    gradient.addColorStop(0, color[0])
    gradient.addColorStop(1, color[1])

    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)

    const drawLetters = await this.drawMultilineText(
      letters,
      null,
      size / 2,
      '#FFF',
      0,
      size,
      size * 5,
      size * 5
    )

    context.drawImage(drawLetters, (canvas.width - drawLetters.width) / 2, (canvas.height - drawLetters.height) / 1.5)

    return canvas.toBuffer()
  }

  async downloadAvatarImage (user) {
    let avatarImage

    let nameLatters
    if (user.first_name && user.last_name) nameLatters = runes(user.first_name)[0] + (runes(user.last_name || '')[0])
    else {
      let name = user.first_name || user.name || user.title
      name = name.toUpperCase()
      const nameWord = name.split(' ')

      if (nameWord.length > 1) nameLatters = runes(nameWord[0])[0] + runes(nameWord.splice(-1)[0])[0]
      else nameLatters = runes(nameWord[0])[0]
    }

    const cacheKey = user.id

    const avatarImageCache = avatarCache.get(cacheKey)

    const avatarColorArray = [
      [ '#FF885E', '#FF516A' ], // red
      [ '#FFCD6A', '#FFA85C' ], // orange
      [ '#E0A2F3', '#D669ED' ], // purple
      [ '#A0DE7E', '#54CB68' ], // green
      [ '#53EDD6', '#28C9B7' ], // sea
      [ '#72D5FD', '#2A9EF1' ], // blue
      [ '#FFA8A8', '#FF719A' ] // pink
    ]

    const nameIndex = Math.abs(user.id) % 7
    const avatarColor = avatarColorArray[nameIndex]

    if (avatarImageCache) {
      avatarImage = avatarImageCache
    } else if (user.photo && user.photo.url) {
      try {
        console.log('尝试加载头像:', user.photo.url)
        
        // 将JPEG转换为PNG以避免JPEG支持问题
        const imageBuffer = await loadImageFromUrl(user.photo.url)
        const pngBuffer = await sharp(imageBuffer).png().toBuffer()
        avatarImage = await loadImage(pngBuffer)
      } catch (error) {
        console.error('加载头像URL失败:', error)
        console.log('使用字母头像作为备用')
        avatarImage = await loadImage(await this.avatarImageLatters(nameLatters, avatarColor))
      }
    } else {
      try {
        let userPhoto, userPhotoUrl

        // 只有在有Telegram实例时才尝试获取Telegram相关数据
        if (this.telegram) {
          if (user.photo && user.photo.big_file_id) userPhotoUrl = await this.telegram.getFileLink(user.photo.big_file_id).catch(() => {})

          if (!userPhotoUrl) {
            const getChat = await this.telegram.getChat(user.id).catch(() => {})

            if (getChat && getChat.photo && getChat.photo.big_file_id) userPhoto = getChat.photo.big_file_id

            if (userPhoto) userPhotoUrl = await this.telegram.getFileLink(userPhoto).catch(() => {})
            else if (user.username) userPhotoUrl = `https://telega.one/i/userpic/320/${user.username}.jpg`
          }

          if (userPhotoUrl) avatarImage = await loadImage(userPhotoUrl).catch(() => {})
        } else {
          // 没有Telegram实例时，优先使用提供的URL或生成字母头像
          if (user.username) {
            userPhotoUrl = `https://telega.one/i/userpic/320/${user.username}.jpg`
            avatarImage = await loadImage(userPhotoUrl).catch(() => {})
          }
        }
        
        if (!avatarImage) {
          avatarImage = await loadImage(await this.avatarImageLatters(nameLatters, avatarColor))
        }

        avatarCache.set(cacheKey, avatarImage)
      } catch (error) {
        avatarImage = await loadImage(await this.avatarImageLatters(nameLatters, avatarColor))
      }
    }

    return avatarImage
  }

  ungzip (input, options) {
    return new Promise((resolve, reject) => {
      zlib.gunzip(input, options, (error, result) => {
        if (!error) resolve(result)
        else reject(Error(error))
      })
    })
  }

  async downloadMediaImage (media, mediaSize, type = 'id', crop = true, isAnimated = false) {
    let mediaUrl
    if (type === 'id' && this.telegram) {
      mediaUrl = await this.telegram.getFileLink(media).catch(console.error)
    } else {
      mediaUrl = media
    }
    
    // 检查是否为动态媒体
    const isWebm = mediaUrl && mediaUrl.match(/\.webm/i)
    const isGif = mediaUrl && mediaUrl.match(/\.gif/i)
    const isDynamic = isAnimated || isWebm || isGif
    
    if (isDynamic) {
      console.log('处理动态媒体:', mediaUrl)
      // 处理动态媒体
      return this.processAnimatedMedia(mediaUrl, mediaSize, crop)
    }
    
    try {
      const load = await loadImageFromUrl(mediaUrl)
      if (crop || (mediaUrl && mediaUrl.match(/.webp/))) {
        const imageSharp = sharp(load)
        const imageMetadata = await imageSharp.metadata()
        const sharpPng = await imageSharp.png({ lossless: true, force: true }).toBuffer()

        if (!imageMetadata || !imageMetadata.width || !imageMetadata.height || !sharpPng) {
          return loadImage(load)
        }

        let croppedImage

        if (imageMetadata.format === 'webp') {
          const jimpImage = await Jimp.read(sharpPng)
          croppedImage = await jimpImage.autocrop().getBuffer(JimpMime.png)
        } else {
          const smartcropResult = await smartcrop.crop(sharpPng, { width: mediaSize, height: imageMetadata.height })
          const crop = smartcropResult.topCrop

          croppedImage = imageSharp.extract({ width: crop.width, height: crop.height, left: crop.x, top: crop.y })
          croppedImage = await imageSharp.png({ lossless: true, force: true }).toBuffer()
        }

        return loadImage(croppedImage)
      } else {
        return loadImage(load)
      }
    } catch (error) {
      console.error('加载媒体失败:', error)
      // 返回一个占位符图片
      const canvas = createCanvas(mediaSize, mediaSize)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#cccccc'
      ctx.fillRect(0, 0, mediaSize, mediaSize)
      ctx.fillStyle = '#666666'
      ctx.font = '20px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('媒体加载失败', mediaSize/2, mediaSize/2)
      return canvas
    }
  }

  async processAnimatedMedia (mediaUrl, mediaSize, crop = true) {
    try {
      console.log('处理动态媒体以保持动态特性:', mediaUrl)
      
      // 对于动态媒体，我们返回一个特殊的对象，包含原始URL和尺寸信息
      // 而不是提取静态帧
      const tempDir = path.join(__dirname, '../temp')
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      const timestamp = Date.now()
      const inputFile = path.join(tempDir, `input_${timestamp}.webm`)

      // 下载文件到本地
      const mediaBuffer = await loadImageFromUrl(mediaUrl)
      fs.writeFileSync(inputFile, mediaBuffer)

      // 使用FFmpeg获取视频信息
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputFile, (err, metadata) => {
          if (err) {
            console.error('FFprobe错误:', err)
            // 如果无法获取metadata，使用默认值
            resolve({
              isAnimated: true,
              width: mediaSize,
              height: mediaSize,
              localPath: inputFile,
              originalUrl: mediaUrl,
              duration: 3000, // 默认3秒
              fps: 30
            })
          } else {
            const videoStream = metadata.streams.find(stream => stream.codec_type === 'video')
            const duration = parseFloat(metadata.format.duration) * 1000 || 3000 // 转换为毫秒
            
            resolve({
              isAnimated: true,
              width: videoStream ? videoStream.width : mediaSize,
              height: videoStream ? videoStream.height : mediaSize,
              localPath: inputFile,
              originalUrl: mediaUrl,
              duration: duration,
              fps: videoStream ? (videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : 30) : 30
            })
          }
        })
      })
    } catch (error) {
      console.error('动态媒体处理错误:', error)
      
      // 如果处理失败，返回占位符动态对象
      return {
        isAnimated: true,
        width: mediaSize,
        height: mediaSize,
        localPath: null,
        originalUrl: mediaUrl,
        duration: 3000,
        fps: 30,
        error: true
      }
    }
  }

  hexToRgb (hex) {
    return hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i
      , (m, r, g, b) => '#' + r + r + g + g + b + b)
      .substring(1).match(/.{2}/g)
      .map(x => parseInt(x, 16))
  }

  // https://codepen.io/andreaswik/pen/YjJqpK
  lightOrDark (color) {
    let r, g, b

    // Check the format of the color, HEX or RGB?
    if (color.match(/^rgb/)) {
      // If HEX --> store the red, green, blue values in separate variables
      color = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/)

      r = color[1]
      g = color[2]
      b = color[3]
    } else {
      // If RGB --> Convert it to HEX: http://gist.github.com/983661
      color = +('0x' + color.slice(1).replace(
        color.length < 5 && /./g, '$&$&'
      )
      )

      r = color >> 16
      g = color >> 8 & 255
      b = color & 255
    }

    // HSP (Highly Sensitive Poo) equation from http://alienryderflex.com/hsp.html
    const hsp = Math.sqrt(
      0.299 * (r * r) +
      0.587 * (g * g) +
      0.114 * (b * b)
    )

    // Using the HSP value, determine whether the color is light or dark
    if (hsp > 127.5) {
      return 'light'
    } else {
      return 'dark'
    }
  }

  async drawMultilineText (text, entities, fontSize, fontColor, textX, textY, maxWidth, maxHeight, emojiBrand = 'apple') {
    if (maxWidth > 10000) maxWidth = 10000
    if (maxHeight > 10000) maxHeight = 10000

    const emojiImageJson = emojiImageByBrand[emojiBrand]

    let fallbackEmojiBrand = 'apple'
    if (emojiBrand === 'blob') fallbackEmojiBrand = 'google'

    const fallbackEmojiImageJson = emojiImageByBrand[fallbackEmojiBrand]

    const canvas = createCanvas(maxWidth + fontSize, maxHeight + fontSize)
    const canvasCtx = canvas.getContext('2d')

    // text = text.slice(0, 4096)
    text = text.replace(/і/g, 'i') // замена украинской буквы і на английскую, так как она отсутствует в шрифтах Noto
    const chars = text.split('')

    const lineHeight = 4 * (fontSize * 0.3)

    const styledChar = []

    const emojis = emojiDb.searchFromText({ input: text, fixCodePoints: true })

    for (let charIndex = 0; charIndex < chars.length; charIndex++) {
      const char = chars[charIndex]

      styledChar[charIndex] = {
        char,
        style: []
      }

      if (entities && typeof entities === 'string') styledChar[charIndex].style.push(entities)
    }

    if (entities && typeof entities === 'object') {
      for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
        const entity = entities[entityIndex]
        const style = []

        if (['pre', 'code', 'pre_code'].includes(entity.type)) {
          style.push('monospace')
        } else if (
          ['mention', 'text_mention', 'hashtag', 'email', 'phone_number', 'bot_command', 'url', 'text_link']
            .includes(entity.type)
        ) {
          style.push('mention')
        } else {
          style.push(entity.type)
        }

        if (entity.type === 'custom_emoji') {
          styledChar[entity.offset].customEmojiId = entity.custom_emoji_id
        }

        for (let charIndex = entity.offset; charIndex < entity.offset + entity.length; charIndex++) {
          styledChar[charIndex].style = styledChar[charIndex].style.concat(style)
        }
      }
    }

    for (let emojiIndex = 0; emojiIndex < emojis.length; emojiIndex++) {
      const emoji = emojis[emojiIndex]

      for (let charIndex = emoji.offset; charIndex < emoji.offset + emoji.length; charIndex++) {
        styledChar[charIndex].emoji = {
          index: emojiIndex,
          code: emoji.found
        }
      }
    }

    const styledWords = []

    let stringNum = 0

    const breakMatch = /<br>|\n|\r/
    const spaceMatch = /[\f\n\r\t\v\u0020\u1680\u2000-\u200a\u2028\u2029\u205f\u3000]/
    const CJKMatch = /[\u1100-\u11ff\u2e80-\u2eff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3100-\u312f\u3130-\u318f\u3190-\u319f\u31a0-\u31bf\u31c0-\u31ef\u31f0-\u31ff\u3200-\u32ff\u3300-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/

    for (let index = 0; index < styledChar.length; index++) {
      const charStyle = styledChar[index]
      const lastChar = styledChar[index - 1]

      if (
        lastChar && (
          (
            (charStyle.emoji && !lastChar.emoji) ||
              (!charStyle.emoji && lastChar.emoji) ||
              (charStyle.emoji && lastChar.emoji && charStyle.emoji.index !== lastChar.emoji.index)
          ) ||
            (
              (charStyle.char.match(breakMatch)) ||
              (charStyle.char.match(spaceMatch) && !lastChar.char.match(spaceMatch)) ||
              (lastChar.char.match(spaceMatch) && !charStyle.char.match(spaceMatch)) ||
              (charStyle.style && lastChar.style && charStyle.style.toString() !== lastChar.style.toString())
            ) || (
                charStyle.char.match(CJKMatch) ||
                lastChar.char.match(CJKMatch)
            )
        )
      ) {
        stringNum++
      }

      if (!styledWords[stringNum]) {
        styledWords[stringNum] = {
          word: charStyle.char
        }

        if (charStyle.style) styledWords[stringNum].style = charStyle.style
        if (charStyle.emoji) styledWords[stringNum].emoji = charStyle.emoji
        if (charStyle.customEmojiId) styledWords[stringNum].customEmojiId = charStyle.customEmojiId
      } else styledWords[stringNum].word += charStyle.char
    }

    let lineX = textX
    let lineY = textY

    let textWidth = 0

    // load custom emoji - 只有在有Telegram实例时才加载
    const customEmojiIds = []

    for (let index = 0; index < styledWords.length; index++) {
      const word = styledWords[index]

      if (word.customEmojiId) {
        customEmojiIds.push(word.customEmojiId)
      }
    }

    let getCustomEmojiStickers
    if (this.telegram && customEmojiIds.length > 0) {
      getCustomEmojiStickers = await this.telegram.callApi('getCustomEmojiStickers', {
        custom_emoji_ids: customEmojiIds
      }).catch(() => {})
    }

    const customEmojiStickers = {}

    const loadCustomEmojiStickerPromises = []

    if (getCustomEmojiStickers && this.telegram) {
      for (let index = 0; index < getCustomEmojiStickers.length; index++) {
        const sticker = getCustomEmojiStickers[index]

        loadCustomEmojiStickerPromises.push((async () => {
          const getFileLink = await this.telegram.getFileLink(sticker.thumb.file_id).catch(() => {})

          if (getFileLink) {
            const load = await loadImageFromUrl(getFileLink).catch(() => {})
            const imageSharp = sharp(load)
            const sharpPng = await imageSharp.png({ lossless: true, force: true }).toBuffer()

            customEmojiStickers[sticker.custom_emoji_id] = await loadImage(sharpPng).catch(() => {})
          }
        })())
      }

      await Promise.all(loadCustomEmojiStickerPromises).catch(() => {})
    }

    let breakWrite = false
    let lineDirection = this.getLineDirection(styledWords, 0)
    for (let index = 0; index < styledWords.length; index++) {
      const styledWord = styledWords[index]

      let emojiImage

      if (styledWord.emoji) {
        if (styledWord.customEmojiId && customEmojiStickers[styledWord.customEmojiId]) {
          emojiImage = customEmojiStickers[styledWord.customEmojiId]
        } else {
          const emojiImageBase = emojiImageJson[styledWord.emoji.code]
          if (emojiImageBase) {
            emojiImage = await loadImage(
              Buffer.from(emojiImageBase, 'base64')
            ).catch(() => {})
          }
          if (!emojiImage) {
            emojiImage = await loadImage(
              Buffer.from(fallbackEmojiImageJson[styledWord.emoji.code], 'base64')
            ).catch(() => {})
          }
        }
      }

      let fontType = ''
      let fontName = 'Arial' // 使用Arial作为备用字体
      let fillStyle = fontColor

      if (styledWord.style.includes('bold')) {
        fontType += 'bold '
      }
      if (styledWord.style.includes('italic')) {
        fontType += 'italic '
      }
      if (styledWord.style.includes('monospace')) {
        fontName = 'monospace'
        fillStyle = '#5887a7'
      }
      if (styledWord.style.includes('mention')) {
        fillStyle = '#6ab7ec'
      }
      if (styledWord.style.includes('spoiler')) {
        const rbaColor = this.hexToRgb(this.normalizeColor(fontColor))
        fillStyle = `rgba(${rbaColor[0]}, ${rbaColor[1]}, ${rbaColor[2]}, 0.15)`
      }

      canvasCtx.font = `${fontType} ${fontSize}px ${fontName}`
      canvasCtx.fillStyle = fillStyle

      if (canvasCtx.measureText(styledWord.word).width > maxWidth - fontSize * 3) {
        while (canvasCtx.measureText(styledWord.word).width > maxWidth - fontSize * 3) {
          styledWord.word = styledWord.word.substr(0, styledWord.word.length - 1)
          if (styledWord.word.length <= 0) break
        }
        styledWord.word += '…'
      }

      let lineWidth
      const wordlWidth = canvasCtx.measureText(styledWord.word).width

      if (styledWord.emoji) lineWidth = lineX + fontSize
      else lineWidth = lineX + wordlWidth

      if (styledWord.word.match(breakMatch) || (lineWidth > maxWidth - fontSize * 2 && wordlWidth < maxWidth)) {
        if (styledWord.word.match(spaceMatch) && !styledWord.word.match(breakMatch)) styledWord.word = ''
        if ((styledWord.word.match(spaceMatch) || !styledWord.word.match(breakMatch)) && lineY + lineHeight > maxHeight) {
          while (lineWidth > maxWidth - fontSize * 2) {
            styledWord.word = styledWord.word.substr(0, styledWord.word.length - 1)
            lineWidth = lineX + canvasCtx.measureText(styledWord.word).width
            if (styledWord.word.length <= 0) break
          }

          styledWord.word += '…'
          lineWidth = lineX + canvasCtx.measureText(styledWord.word).width
          breakWrite = true
        } else {
          if (styledWord.emoji) lineWidth = textX + fontSize + (fontSize * 0.2)
          else lineWidth = textX + canvasCtx.measureText(styledWord.word).width

          lineX = textX
          lineY += lineHeight
          if (index < styledWords.length - 1) {
            let nextLineDirection = this.getLineDirection(styledWords, index+1)
            if (lineDirection != nextLineDirection) textWidth = maxWidth - fontSize * 2
            lineDirection = nextLineDirection
          }
        }
      }

      if (styledWord.emoji) lineWidth += (fontSize * 0.2)

      if (lineWidth > textWidth) textWidth = lineWidth
      if (textWidth > maxWidth) textWidth = maxWidth

      let wordX = (lineDirection == 'rtl') ? maxWidth-lineX-wordlWidth-fontSize * 2 : lineX

      if (emojiImage) {
        canvasCtx.drawImage(emojiImage, wordX, lineY - fontSize + (fontSize * 0.15), fontSize + (fontSize * 0.22), fontSize + (fontSize * 0.22))
      } else {
        canvasCtx.fillText(styledWord.word, wordX, lineY)

        if (styledWord.style.includes('strikethrough')) canvasCtx.fillRect(wordX, lineY - fontSize / 2.8, canvasCtx.measureText(styledWord.word).width, fontSize * 0.1)
        if (styledWord.style.includes('underline')) canvasCtx.fillRect(wordX, lineY + 2, canvasCtx.measureText(styledWord.word).width, fontSize * 0.1)
      }

      lineX = lineWidth

      if (breakWrite) break
    }

    const canvasResize = createCanvas(textWidth, lineY + fontSize)
    const canvasResizeCtx = canvasResize.getContext('2d')

    let dx = (lineDirection == 'rtl') ? textWidth - maxWidth + fontSize * 2 : 0
    canvasResizeCtx.drawImage(canvas, dx, 0)

    return canvasResize
  }

  // https://stackoverflow.com/a/3368118
  drawRoundRect (color, w, h, r) {
    const x = 0
    const y = 0

    const canvas = createCanvas(w, h)
    const canvasCtx = canvas.getContext('2d')

    canvasCtx.fillStyle = color

    if (w < 2 * r) r = w / 2
    if (h < 2 * r) r = h / 2
    canvasCtx.beginPath()
    canvasCtx.moveTo(x + r, y)
    canvasCtx.arcTo(x + w, y, x + w, y + h, r)
    canvasCtx.arcTo(x + w, y + h, x, y + h, r)
    canvasCtx.arcTo(x, y + h, x, y, r)
    canvasCtx.arcTo(x, y, x + w, y, r)
    canvasCtx.closePath()

    canvasCtx.fill()

    return canvas
  }

  drawGradientRoundRect (colorOne, colorTwo, w, h, r) {
    const x = 0
    const y = 0

    const canvas = createCanvas(w, h)
    const canvasCtx = canvas.getContext('2d')

    const gradient = canvasCtx.createLinearGradient(0, 0, w, h)
    gradient.addColorStop(0, colorOne)
    gradient.addColorStop(1, colorTwo)

    canvasCtx.fillStyle = gradient

    if (w < 2 * r) r = w / 2
    if (h < 2 * r) r = h / 2
    canvasCtx.beginPath()
    canvasCtx.moveTo(x + r, y)
    canvasCtx.arcTo(x + w, y, x + w, y + h, r)
    canvasCtx.arcTo(x + w, y + h, x, y + h, r)
    canvasCtx.arcTo(x, y + h, x, y, r)
    canvasCtx.arcTo(x, y, x + w, y, r)
    canvasCtx.closePath()

    canvasCtx.fill()

    return canvas
  }

  colorLuminance (hex, lum) {
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

  roundImage (image, r) {
    // 检查输入是否为有效的Image或Canvas
    if (!image || (!image.width && !image.height)) {
      console.error('roundImage: 无效的图片对象')
      // 返回一个默认的圆形图片
      const size = r * 2 || 100
      const canvas = createCanvas(size, size)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#cccccc'
      ctx.beginPath()
      ctx.arc(size/2, size/2, size/2, 0, 2 * Math.PI)
      ctx.fill()
      return canvas
    }

    const w = image.width
    const h = image.height

    // 创建正方形画布以确保圆形效果
    const size = Math.min(w, h)
    const canvas = createCanvas(size, size)
    const canvasCtx = canvas.getContext('2d')

    // 创建圆形剪切路径
    canvasCtx.beginPath()
    canvasCtx.arc(size/2, size/2, size/2, 0, 2 * Math.PI)
    canvasCtx.closePath()
    canvasCtx.clip()

    // 居中绘制图片
    const offsetX = (size - w) / 2
    const offsetY = (size - h) / 2
    canvasCtx.drawImage(image, offsetX, offsetY, w, h)

    return canvas
  }

  async drawQuote (scale = 1, backgroundColorOne, backgroundColorTwo, avatar, replyName, replyNameColor, replyText, name, text, media, mediaType, maxMediaSize, isAnimated = false) {
    const avatarPosX = 0 * scale
    const avatarPosY = 5 * scale
    const avatarSize = 50 * scale

    const blockPosX = avatarSize + 10 * scale
    const blockPosY = 0

    const indent = 14 * scale

    // 宽度保持不变
    let minWidth = 112 * scale
    let minHeight = 61 * scale // 从82再减少到61 (再减少25%)

    let width = minWidth
    if (name) width = Math.max(width, name.width + indent * 2)
    if (text && width < text.width + indent) width = text.width + indent
    if (name && width < name.width + indent) width = name.width + indent
    if (replyName) {
      if (width < replyName.width) width = replyName.width + indent * 2
      if (replyText && width < replyText.width) width = replyText.width + indent * 2
    }

    let height = Math.max(minHeight, indent)
    if (text) height += text.height
    else height += indent

    if (name) {
      height = Math.max(name.height, minHeight)
      if (text) height = text.height + name.height
      else height += indent
    }

    width += blockPosX + indent
    height += blockPosY

    let namePosX = blockPosX + indent
    let namePosY = indent

    if (!name) {
      namePosX = 0
      namePosY = -indent
    }

    const textPosX = blockPosX + indent
    let textPosY = indent
    if (name) {
      textPosY = name.height + indent * 0.25
      height += indent * 0.25
    }

    let replyPosX = 0
    let replyNamePosY = 0
    let replyTextPosY = 0

    if (replyName && replyText) {
      replyPosX = textPosX + indent

      const replyNameHeight = replyName.height
      const replyTextHeight = replyText.height * 0.5

      replyNamePosY = namePosY + replyNameHeight
      replyTextPosY = replyNamePosY + replyTextHeight

      textPosY += replyNameHeight + replyTextHeight + (indent / 4)
      height += replyNameHeight + replyTextHeight + (indent / 4)
    }

    let mediaPosX = 0
    let mediaPosY = 0

    let mediaWidth, mediaHeight

    if (media) {
      if (media.isAnimated || isAnimated) {
        // 动态媒体尺寸保持不变
        const baseMediaSize = Math.max(maxMediaSize, 169 * scale)
        mediaWidth = media.width || baseMediaSize
        mediaHeight = media.height || baseMediaSize
        
        if (mediaWidth > baseMediaSize || mediaHeight > baseMediaSize) {
          const scaleRatio = Math.min(baseMediaSize / mediaWidth, baseMediaSize / mediaHeight)
          mediaWidth *= scaleRatio
          mediaHeight *= scaleRatio
        }
        
        mediaWidth = Math.max(mediaWidth, 112 * scale)
        mediaHeight = Math.max(mediaHeight, 150 * scale)
      } else {
        mediaWidth = media.width * (maxMediaSize / media.height)
        mediaHeight = maxMediaSize

        if (mediaWidth >= maxMediaSize) {
          mediaWidth = maxMediaSize
          mediaHeight = media.height * (maxMediaSize / media.width)
        }
      }

      const mediaRequiredWidth = mediaWidth + blockPosX + indent * 1.69
      if (width < mediaRequiredWidth) {
        width = mediaRequiredWidth
      }

      height += mediaHeight + indent * 0.42 // 从0.56再减少到0.42 (再减少25%)

      if (name) {
        mediaPosX = namePosX
        mediaPosY = name.height + 4.5 * scale // 从6减少到4.5 (再减少25%)
      } else {
        mediaPosX = blockPosX + indent
        mediaPosY = indent * 0.84 // 从1.12减少到0.84 (再减少25%)
      }
      if (replyName) mediaPosY += replyNamePosY + indent / 2
      textPosY = mediaPosY + mediaHeight + 4.5 * scale // 从6减少到4.5 (再减少25%)
    }

    // 对话框尺寸调整
    let rectWidth = width - blockPosX
    let rectHeight = height

    // 宽度保持不变，只缩短高度
    rectWidth = Math.max(rectWidth, 142 * scale) // 宽度保持不变
    rectHeight = Math.max(rectHeight, 76 * scale) // 从101减少到76 (再减少25%)

    // 如果是动态媒体，适度增加对话框尺寸
    if (media && (media.isAnimated || isAnimated)) {
      rectWidth = Math.max(rectWidth, mediaWidth + indent * 1.12) // 宽度保持不变
      rectHeight = Math.max(rectHeight, mediaHeight + (name ? name.height : 0) + indent * 1.27) // 从1.69减少到1.27 (再减少25%)
    }

    // 修改sticker的背景逻辑，确保总是显示对话框
    let useBackgroundRect = true
    if (mediaType === 'sticker' && !name && !replyName && !text) {
      // 只有在纯sticker（无名字、无回复、无文字）时才不显示背景
      useBackgroundRect = false
    }

    if (mediaType === 'sticker' && (name || replyName || media.isAnimated)) {
      if (replyName && replyText) {
        rectHeight = Math.max(rectHeight, (replyName.height + replyText.height * 0.5) + indent * 0.84) // 从1.12减少到0.84 (再减少25%)
      } else if (name) {
        rectHeight = Math.max(rectHeight, name.height + indent * 0.84) // 从1.12减少到0.84 (再减少25%)
      }
      
      // 对于动态sticker，使用更明显的背景
      if (media && media.isAnimated) {
        backgroundColorOne = backgroundColorTwo = 'rgba(30, 30, 30, 0.9)'
      } else {
        backgroundColorOne = backgroundColorTwo = 'rgba(50, 50, 50, 0.8)'
      }
    }

    // 重新计算canvas尺寸以适应调整后的对话框
    const finalWidth = Math.max(width, rectWidth + blockPosX)
    const finalHeight = Math.max(height, rectHeight + blockPosY)

    const canvas = createCanvas(finalWidth, finalHeight)
    const canvasCtx = canvas.getContext('2d')

    const rectPosX = blockPosX
    const rectPosY = blockPosY
    const rectRoundRadius = 25 * scale

    let rect
    
    // 确保语录框总是被绘制
    if (useBackgroundRect) {
      if (backgroundColorOne === backgroundColorTwo) {
        rect = this.drawRoundRect(backgroundColorOne, rectWidth, rectHeight, rectRoundRadius)
      } else {
        rect = this.drawGradientRoundRect(backgroundColorOne, backgroundColorTwo, rectWidth, rectHeight, rectRoundRadius)
      }
    }

    // 绘制头像（确保为圆形）
    if (avatar) {
      const roundAvatar = this.roundImage(avatar, avatarSize / 2)
      canvasCtx.drawImage(roundAvatar, avatarPosX, avatarPosY, avatarSize, avatarSize)
    }
    
    // 绘制语录框
    if (rect) canvasCtx.drawImage(rect, rectPosX, rectPosY)
    
    // 绘制用户名
    if (name) canvasCtx.drawImage(name, namePosX, namePosY)
    
    // 绘制文字
    if (text) canvasCtx.drawImage(text, textPosX, textPosY)
    
    // 处理媒体绘制
    if (media) {
      try {
        if (media.isAnimated && media.localPath) {
          // 对于动态媒体，我们在静态层中完全跳过媒体绘制
          // 动态内容将在视频合成阶段单独处理
          console.log('为动态媒体预留空间:', `${mediaWidth}x${mediaHeight} at (${mediaPosX}, ${mediaPosY})`)
          
          // 可选：绘制一个调试边框来显示媒体位置
          // canvasCtx.strokeStyle = 'rgba(255, 0, 0, 0.3)'
          // canvasCtx.lineWidth = 2
          // canvasCtx.strokeRect(mediaPosX, mediaPosY, mediaWidth, mediaHeight)
          
        } else if (media.width && media.height) {
          // 常规图片/Canvas对象
          canvasCtx.drawImage(this.roundImage(media, 5 * scale), mediaPosX, mediaPosY, mediaWidth, mediaHeight)
        } else {
          console.error('媒体对象无效，跳过绘制')
        }
      } catch (error) {
        console.error('绘制媒体时出错:', error)
      }
    }

    if (replyName && replyText) {
      canvasCtx.drawImage(this.drawReplyLine(3 * scale, replyName.height + replyText.height * 0.4, replyNameColor), textPosX - 3, replyNamePosY)

      canvasCtx.drawImage(replyName, replyPosX, replyNamePosY)
      canvasCtx.drawImage(replyText, replyPosX, replyTextPosY)
    }

    // 返回包含动态媒体信息和位置信信息的结果
    return {
      canvas,
      animatedMedia: media && media.isAnimated ? {
        ...media,
        mediaPosX,
        mediaPosY,
        mediaWidth,
        mediaHeight
      } : null
    }
  }

  drawReplyLine (width, height, color) {
    const canvas = createCanvas(width, height)
    const canvasCtx = canvas.getContext('2d')

    canvasCtx.fillStyle = color
    canvasCtx.fillRect(0, 0, width, height)

    return canvas
  }

  normalizeColor (color) {
    if (color.startsWith('rgba')) {
      return color.replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/, '#$1$2$3')
        .replace(/(\d+)/g, (match) => parseInt(match).toString(16).padStart(2, '0'))
    }
    return color
  }

  getLineDirection (styledWords, startIndex) {
    // 检测文本方向 (LTR/RTL)
    const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
    
    for (let i = startIndex; i < Math.min(startIndex + 10, styledWords.length); i++) {
      if (styledWords[i] && styledWords[i].word && rtlChars.test(styledWords[i].word)) {
        return 'rtl'
      }
    }
    return 'ltr'
  }

  async drawAvatar (user) {
    return await this.downloadAvatarImage(user)
  }

  async generate (backgroundColorOne, backgroundColorTwo, message, width = 512, height = 512, scale = 2, emojiBrand = 'apple') {
    if (!scale) scale = 2
    if (scale > 20) scale = 20
    width = width || 512
    height = height || 512
    width *= scale
    height *= scale

    // check background style color black/light
    const backStyle = this.lightOrDark(backgroundColorOne)


    // historyPeer1NameFg: #c03d33; // red
    // historyPeer2NameFg: #4fad2d; // green
    // historyPeer3NameFg: #d09306; // yellow
    // historyPeer4NameFg: #168acd; // blue
    // historyPeer5NameFg: #8544d6; // purple
    // historyPeer6NameFg: #cd4073; // pink
    // historyPeer7NameFg: #2996ad; // sea
    // historyPeer8NameFg: #ce671b; // orange

    // { 0, 7, 4, 1, 6, 3, 5 }
    // const nameColor = [
    //   '#c03d33', // red
    //   '#ce671b', // orange
    //   '#8544d6', // purple
    //   '#4fad2d', // green
    //   '#2996ad', // sea
    //   '#168acd', // blue
    //   '#cd4073' // pink
    // ]

    const nameColorLight = [
      '#FC5C51', // red
      '#FA790F', // orange
      '#895DD5', // purple
      '#0FB297', // green
      '#0FC9D6', // sea
      '#3CA5EC', // blue
      '#D54FAF' // pink
    ]

    const nameColorDark = [
      '#FF8E86', // red
      '#FFA357', // orange
      '#B18FFF', // purple
      '#4DD6BF', // green
      '#45E8D1', // sea
      '#7AC9FF', // blue
      '#FF7FD5' // pink
    ]

    // user name  color
    let nameIndex = 1
    if (message.from && message.from.id) nameIndex = Math.abs(message.from.id) % 7

    const nameColorArray = backStyle === 'light' ? nameColorLight : nameColorDark

    let nameColor = nameColorArray[nameIndex]

    const colorContrast = new ColorContrast()

    // change name color based on background color by contrast
    const contrast = colorContrast.getContrastRatio(this.colorLuminance(backgroundColorOne, 0.55), nameColor)
    if (contrast > 90 || contrast < 30) {
      nameColor = colorContrast.adjustContrast(this.colorLuminance(backgroundColorTwo, 0.55), nameColor)
    }

    const nameSize = 22 * scale

    let nameCanvas
    if (message?.from?.name || (message?.from?.first_name || message?.from?.last_name)) {
      let name = message.from.name || `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim()

      if (!name) name = "User" // Default name if none provided

      const nameEntities = [
        {
          type: 'bold',
          offset: 0,
          length: name.length
        }
      ]

      if (message.from.emoji_status) {
        name += ' 🤡'

        nameEntities.push({
          type: 'custom_emoji',
          offset: name.length - 2,
          length: 2,
          custom_emoji_id: message.from.emoji_status
        })
      }

      nameCanvas = await this.drawMultilineText(
        name,
        nameEntities,
        nameSize,
        nameColor,
        0,
        nameSize,
        width,
        nameSize,
        emojiBrand
      )
    }

    let fontSize = 24 * scale

    let textColor = '#fff'
    if (backStyle === 'light') textColor = '#000'

    let textCanvas
    if (message.text) {
      textCanvas = await this.drawMultilineText(
        message.text,
        message.entities,
        fontSize,
        textColor,
        0,
        fontSize,
        width,
        height - fontSize,
        emojiBrand
      )
    }

    let avatarCanvas
    if (message.avatar && message.from) avatarCanvas = await this.drawAvatar(message.from)

    let replyName, replyNameColor, replyText
    if (message.replyMessage && message.replyMessage.name && message.replyMessage.text) {
      try {
        // Ensure chatId exists to prevent NaN in calculations
        const chatId = message.replyMessage.chatId || 0
        const replyNameIndex = Math.abs(chatId) % 7
        replyNameColor = nameColorArray[replyNameIndex]

        const replyNameFontSize = 16 * scale
        replyName = await this.drawMultilineText(
          message.replyMessage.name,
          'bold',
          replyNameFontSize,
          replyNameColor,
          0,
          replyNameFontSize,
          width * 0.9,
          replyNameFontSize,
          emojiBrand
        )

        let textColor = '#fff'
        if (backStyle === 'light') textColor = '#000'

        const replyTextFontSize = 21 * scale
        replyText = await this.drawMultilineText(
          message.replyMessage.text,
          message.replyMessage.entities || [],
          replyTextFontSize,
          textColor,
          0,
          replyTextFontSize,
          width * 0.9,
          replyTextFontSize,
          emojiBrand
        )
      } catch (error) {
        console.error("Error generating reply message:", error)
        // If reply message generation fails, continue without it
        replyName = null
        replyText = null
      }
    }

    let mediaCanvas, mediaType, maxMediaSize, isAnimated = false
    if (message.media) {
      let media, type

      let crop = false
      if (message.mediaCrop) crop = true

      if (message.media.url) {
        type = 'url'
        media = message.media.url
      } else {
        type = 'id'
        if (message.media.length > 1) {
          if (crop) media = message.media[1]
          else media = message.media.pop()
        } else media = message.media[0]
      }

      // 进一步减少动态媒体的最大尺寸 - 减少1/4宽度
      maxMediaSize = Math.max(width / 3 * scale, 225 * scale) // 从300减少到225 (减少25%)
      if (message.text && textCanvas && maxMediaSize < textCanvas.width) maxMediaSize = textCanvas.width

      // 检查是否为动态媒体
      isAnimated = media.is_animated || 
                   (typeof media === 'string' && (media.match(/\.webm/i) || media.match(/\.gif/i))) ||
                   (media.url && (media.url.match(/\.webm/i) || media.url.match(/\.gif/i)))

      if (isAnimated) {
        // 对于动态媒体，我们需要特殊处理
        try {
          const animatedMediaInfo = await this.processAnimatedMedia(media, maxMediaSize, crop)
          mediaCanvas = animatedMediaInfo // 保存动态媒体信息
        } catch (error) {
          console.error('处理动态媒体失败:', error)
          // 使用占位符
          const canvas = createCanvas(maxMediaSize, maxMediaSize)
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#4a90e2'
          ctx.fillRect(0, 0, maxMediaSize, maxMediaSize)
          ctx.fillStyle = '#ffffff'
          ctx.font = '20px Arial'
          ctx.textAlign = 'center'
          ctx.fillText('🎬', maxMediaSize/2, maxMediaSize/2 - 10)
          ctx.font = '14px Arial'
          ctx.fillText('动态内容', maxMediaSize/2, maxMediaSize/2 + 15)
          mediaCanvas = canvas
        }
      } else {
        if (media.is_animated) {
          media = media.thumb
          maxMediaSize = maxMediaSize / 2
        }
        mediaCanvas = await this.downloadMediaImage(media, maxMediaSize, type, crop)
      }
      mediaType = message.mediaType
    }

    const quote = await this.drawQuote(
      scale,
      backgroundColorOne, backgroundColorTwo,
      avatarCanvas,
      replyName, replyNameColor, replyText,
      nameCanvas, textCanvas,
      mediaCanvas, mediaType, maxMediaSize, isAnimated
    )

    return {
      ...quote,
      isAnimated: isAnimated && mediaCanvas && mediaCanvas.isAnimated
    }
  }
}

module.exports = QuoteGenerate

