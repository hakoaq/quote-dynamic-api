module.exports = async (ctx, next) => {
  // 添加请求日志
  console.log(`📨 ${ctx.method} ${ctx.path}`)
  if (ctx.request.body && Object.keys(ctx.request.body).length > 0) {
    console.log(`📄 请求体包含字段: ${Object.keys(ctx.request.body).join(', ')}`)
  }
  
  ctx.props = Object.assign(ctx.query || {}, ctx.request.body || {})

  try {
    await next()

    if (!ctx.body) {
      // 检查是否有结果
      if (!ctx.result) {
        // 如果是根路径或健康检查等，不返回404
        if (ctx.path === '/' || ctx.path === '/health' || ctx.path.startsWith('/api/')) {
          console.log(`⏭️ 跳过处理: ${ctx.path}`)
          return
        }
        
        console.log(`❌ 404错误: 路径 ${ctx.path} 未找到结果`)
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
              '/api/status - 服务状态',
              '/ - API信息'
            ]
          }
        }
        return
      }

      if (ctx.result.error) {
        console.log(`❌ 业务错误: ${ctx.result.error}`)
        ctx.status = 400
        ctx.body = {
          ok: false,
          error: {
            code: 400,
            message: ctx.result.error
          }
        }
      } else {
        if (ctx.result.ext) {
          // 设置正确的Content-Type
          if (ctx.result.ext === 'webp') ctx.response.set('content-type', 'image/webp')
          if (ctx.result.ext === 'png') ctx.response.set('content-type', 'image/png')
          if (ctx.result.ext === 'webm') ctx.response.set('content-type', 'video/webm')
          
          // 添加额外的头信息
          ctx.response.set('quote-type', ctx.result.type || 'unknown')
          ctx.response.set('quote-width', ctx.result.width || '512')
          ctx.response.set('quote-height', ctx.result.height || '512')
          
          if (ctx.result.isAnimated) {
            ctx.response.set('quote-animated', 'true')
            if (ctx.result.duration) {
              ctx.response.set('quote-duration', ctx.result.duration.toString())
            }
            if (ctx.result.fps) {
              ctx.response.set('quote-fps', ctx.result.fps.toString())
            }
            if (ctx.result.codec) {
              ctx.response.set('quote-codec', ctx.result.codec)
            }
          }
          
          console.log(`✅ 返回二进制文件: ${ctx.result.ext}, 大小: ${ctx.result.image ? ctx.result.image.length : 0} bytes`)
          ctx.body = ctx.result.image
        } else {
          console.log(`✅ 返回JSON结果`)
          ctx.body = {
            ok: true,
            result: ctx.result
          }
        }
      }
    }
  } catch (error) {
    console.error('💥 API处理错误:', error)
    ctx.status = error.statusCode || error.status || 500
    ctx.body = {
      ok: false,
      error: {
        code: ctx.status,
        message: error.message,
        description: error.description || 'Internal server error'
      }
    }
  }
}
