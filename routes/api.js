const Router = require('koa-router')
const api = new Router()

const method = require('../methods')

const apiHandle = async (ctx) => {
  // 改进路由处理逻辑
  const path = ctx.params[0] || ctx.path.replace(/^\//, '')
  const methodWithExt = path.match(/(.*)\.webm$/)
  
  if (methodWithExt) {
    ctx.props.ext = 'webm'
    ctx.props.type = 'animated'
    ctx.result = await method(methodWithExt[1], ctx.props)
  } else {
    // 处理其他扩展名
    const otherExt = path.match(/(.*)\.(?:png|webp)$/)
    if (otherExt) {
      ctx.props.ext = path.match(/\.(.+)$/)[1]
    }
    ctx.result = await method(otherExt ? otherExt[1] : path, ctx.props)
  }
}

// 更精确的路由匹配
api.post('/generate.webm', apiHandle)
api.post('/generate', apiHandle) 
api.post('/*', apiHandle)

module.exports = api
