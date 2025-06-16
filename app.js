const logger = require('koa-logger')
const responseTime = require('koa-response-time')
const bodyParser = require('koa-bodyparser')
const ratelimit = require('koa-ratelimit')
const Router = require('koa-router')
const Koa = require('koa')
const multer = require('koa-multer')
const path = require('path')
const fs = require('fs')

const app = new Koa()

app.use(logger())
app.use(responseTime())
app.use(bodyParser())

const ratelimitВb = new Map()

app.use(ratelimit({
  driver: 'memory',
  db: ratelimitВb,
  duration: 1000 * 55,
  errorMessage: {
    ok: false,
    error: {
      code: 429,
      message: 'Rate limit exceeded. See "Retry-After"'
    }
  },
  id: (ctx) => ctx.ip,
  headers: {
    remaining: 'Rate-Limit-Remaining',
    reset: 'Rate-Limit-Reset',
    total: 'Rate-Limit-Total'
  },
  max: 20,
  disableHeader: false,
  whitelist: (ctx) => {
    return ctx.query.botToken === process.env.BOT_TOKEN
  },
  blacklist: (ctx) => {
  }
}))

app.use(require('./helpers').helpersApi)

const route = new Router()

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}_${file.originalname}`)
  }
})

const upload = multer({ storage: storage })

// 延迟初始化 WebmQuoteGenerator，避免构造函数错误
let webmGenerator

// 获取 WebmQuoteGenerator 实例的辅助函数
function getWebmGenerator() {
  if (!webmGenerator) {
    try {
      const { WebmQuoteGenerator } = require('./utils')
      webmGenerator = new WebmQuoteGenerator()
    } catch (error) {
      console.error('WebmQuoteGenerator 初始化失败:', error)
      throw error
    }
  }
  return webmGenerator
}

// 添加新的API路由
route.get('/api/status', (ctx) => {
  ctx.body = {
    status: 'ok',
    message: 'API服务正常运行',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  };
});

// 添加根路径处理
route.get('/', (ctx) => {
  ctx.body = {
    name: 'Quote API',
    version: '1.0.0',
    description: '动态语录生成API服务',
    endpoints: {
      status: '/api/status',
      generate_static: '/generate',
      generate_animated: '/generate.webm',
      upload_webm: '/api/upload-webm',
      generate_quote_webm: '/api/generate-quote-webm'
    },
    usage: {
      static_quote: 'POST /generate',
      animated_quote: 'POST /generate.webm',
      health_check: 'GET /api/status'
    },
    timestamp: new Date().toISOString()
  };
});

// 添加健康检查路由
route.get('/health', (ctx) => {
  ctx.body = { 
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
});

route.post('/api/upload-webm', upload.single('webm_file'), async (ctx) => {
  try {
    if (!ctx.req.file) {
      ctx.status = 400
      ctx.body = {
        success: false,
        message: '没有找到上传的文件'
      }
      return
    }

    const file = ctx.req.file
    console.log('文件上传成功:', file.path)

    ctx.body = {
      success: true,
      message: '文件上传成功',
      file_id: path.basename(file.path),
      file_path: file.path,
      original_name: file.originalname,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = {
      success: false,
      message: '文件上传失败',
      error: error.message
    }
  }
});

route.post('/api/generate-quote-webm', async (ctx) => {
  try {
    const { quote, author, style, webm_file_id } = ctx.request.body

    if (!quote) {
      ctx.status = 400
      ctx.body = {
        success: false,
        message: '缺少必要参数: quote'
      }
      return
    }

    let webmFilePath
    if (webm_file_id) {
      webmFilePath = path.join(__dirname, 'uploads', webm_file_id)
      if (!fs.existsSync(webmFilePath)) {
        ctx.status = 404
        ctx.body = {
          success: false,
          message: '找不到指定的WebM文件'
        }
        return
      }
    } else {
      // 使用默认的sticker.webm文件
      webmFilePath = path.join(__dirname, 'sticker.webm')
      if (!fs.existsSync(webmFilePath)) {
        ctx.status = 404
        ctx.body = {
          success: false,
          message: '找不到默认的WebM文件'
        }
        return
      }
    }

    const outputFileName = `quote_${Date.now()}.webm`
    
    const generator = getWebmGenerator()
    const result = await generator.generateQuoteWebm({
      webmFilePath: webmFilePath,
      quote: quote,
      author: author,
      style: style,
      outputFileName: outputFileName
    })

    ctx.body = {
      success: true,
      message: '动态语录生成成功',
      quote: quote,
      author: author,
      output_file: result.fileName,
      output_path: result.outputPath,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    console.error('生成动态语录失败:', error)
    ctx.status = 500
    ctx.body = {
      success: false,
      message: '动态语录生成失败',
      error: error.message
    }
  }
});

// 添加下载生成的WebM文件的路由
route.get('/api/download/:filename', async (ctx) => {
  try {
    const filename = ctx.params.filename
    const generator = getWebmGenerator()
    const filePath = generator.getOutputPath(filename)
    
    if (!fs.existsSync(filePath)) {
      ctx.status = 404
      ctx.body = {
        success: false,
        message: '文件不存在'
      }
      return
    }

    ctx.response.set('Content-Type', 'video/webm')
    ctx.response.set('Content-Disposition', `attachment; filename="${filename}"`)
    ctx.body = fs.createReadStream(filePath)
  } catch (error) {
    ctx.status = 500
    ctx.body = {
      success: false,
      message: '下载失败',
      error: error.message
    }
  }
})

const routes = require('./routes')

// 在通用路由之前添加具体路由
route.use('/generate.webm', routes.routeApi.routes())
route.use('/generate', routes.routeApi.routes())
route.use('/*', routes.routeApi.routes())

app.use(route.routes())

const port = process.env.PORT || 3000

app.listen(port, () => {
  console.log('Listening on localhost, port', port)
})
