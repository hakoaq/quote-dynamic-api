const Router = require('koa-router')
const api = new Router()

const method = require('../methods')

const apiHandle = async (ctx) => {
  // 初始化props
  ctx.props = Object.assign(ctx.query || {}, ctx.request.body || {})
  
  // 获取路径并清理
  const fullPath = ctx.path
  console.log('API请求路径:', fullPath)
  console.log('Body大小:', JSON.stringify(ctx.request.body || {}).length, '字符')
  
  let methodName = 'generate'
  let isWebm = false
  
  // 检查是否为WebM请求
  if (fullPath === '/generate.webm' || fullPath.endsWith('.webm')) {
    isWebm = true
    ctx.props.ext = 'webm'
    ctx.props.type = 'animated'
    console.log('检测到WebM请求')
  } else if (fullPath === '/generate') {
    console.log('检测到静态请求')
  } else {
    console.log('未知请求路径:', fullPath)
  }
  
  try {
    console.log(`调用方法: ${methodName}, WebM: ${isWebm}`)
    ctx.result = await method(methodName, ctx.props)
    console.log('方法执行成功')
  } catch (error) {
    console.error('方法执行失败:', error)
    ctx.result = { error: error.message }
  }
}

// 明确定义每个路由
api.post('/generate.webm', async (ctx) => {
  console.log('✅ WebM路由匹配: /generate.webm')
  await apiHandle(ctx)
})

api.post('/generate', async (ctx) => {
  console.log('✅ 静态路由匹配: /generate')
  await apiHandle(ctx)
})

// 捕获其他可能的变体
api.post('/generate.png', async (ctx) => {
  console.log('✅ PNG路由匹配: /generate.png')
  await apiHandle(ctx)
})

api.post('/generate.webp', async (ctx) => {
  console.log('✅ WebP路由匹配: /generate.webp')
  await apiHandle(ctx)
})

// 通用捕获器（最后）
api.post('/(.*)', async (ctx, next) => {
  const path = ctx.params[0]
  console.log('通用路由捕获:', path)
  
  if (path && (path.includes('generate') || path === '')) {
    await apiHandle(ctx)
  } else {
    console.log('404错误: 路径', ctx.path, '未找到方法')
    ctx.status = 404
    ctx.body = {
      ok: false,
      error: {
        code: 404,
        message: 'Method not found',
        path: ctx.path,
        available_endpoints: [
          '/generate - 生成静态语录',
          '/generate.webm - 生成动态语录',
          '/generate.png - 生成PNG格式',
          '/generate.webp - 生成WebP格式'
        ]
      }
    }
  }
})

module.exports = api
