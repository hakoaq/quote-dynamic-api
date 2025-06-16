const Router = require('koa-router')
const api = new Router()

const method = require('../methods')

const apiHandle = async (ctx) => {
  // 改进路由处理逻辑，确保ctx.props存在
  if (!ctx.props) {
    ctx.props = Object.assign(ctx.query || {}, ctx.request.body || {})
  }
  
  // 获取请求路径，移除前导斜杠
  const path = ctx.params[0] ? ctx.params[0].replace(/^\/+/, '') : ctx.path.replace(/^\//, '')
  console.log('处理请求路径:', path)
  
  // 检查是否为WebM请求
  const webmMatch = path.match(/^(.*)\.webm$/)
  
  if (webmMatch) {
    console.log('检测到WebM请求:', webmMatch[1])
    ctx.props.ext = 'webm'
    ctx.props.type = 'animated'
    ctx.result = await method(webmMatch[1] || 'generate', ctx.props)
  } else {
    // 处理其他扩展名
    const otherExtMatch = path.match(/^(.*)\.(?:png|webp)$/)
    if (otherExtMatch) {
      ctx.props.ext = path.match(/\.(.+)$/)[1]
      console.log('检测到其他格式请求:', otherExtMatch[1], '扩展名:', ctx.props.ext)
    }
    
    const methodName = otherExtMatch ? otherExtMatch[1] : (path || 'generate')
    console.log('调用方法:', methodName)
    ctx.result = await method(methodName, ctx.props)
  }
}

// 明确的路由定义，按优先级排序
api.post('/generate.webm', async (ctx) => {
  console.log('直接WebM路由匹配')
  ctx.props = Object.assign(ctx.query || {}, ctx.request.body || {})
  ctx.props.ext = 'webm'
  ctx.props.type = 'animated'
  ctx.result = await method('generate', ctx.props)
})

api.post('/generate', async (ctx) => {
  console.log('直接generate路由匹配')
  ctx.props = Object.assign(ctx.query || {}, ctx.request.body || {})
  ctx.result = await method('generate', ctx.props)
})

// 通用路由作为备用
api.post('/*', apiHandle)

module.exports = api
