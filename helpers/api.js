module.exports = async (ctx, next) => {
  ctx.props = Object.assign(ctx.query || {}, ctx.request.body || {})

  try {
    await next()

    if (!ctx.body) {
      ctx.assert(ctx.result, 404, 'Not Found')

      if (ctx.result.error) {
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
          if (ctx.result.ext === 'webp') {
            ctx.response.set('content-type', 'image/webp')
          }
          if (ctx.result.ext === 'png') ctx.response.set('content-type', 'image/png')
          if (ctx.result.ext === 'webm') ctx.response.set('content-type', 'video/webm')
          
          ctx.response.set('quote-type', ctx.result.type)
          ctx.response.set('quote-width', ctx.result.width)
          ctx.response.set('quote-height', ctx.result.height)
          
          if (ctx.result.isAnimated) {
            ctx.response.set('quote-animated', 'true')
            ctx.response.set('quote-format', 'webp') // 明确标记为WebP格式
          }
          
          ctx.body = ctx.result.image
        } else {
          ctx.body = {
            ok: true,
            result: ctx.result
          }
        }
      }
    }
  } catch (error) {
    console.error(error)
    ctx.status = error.statusCode || error.status || 500
    ctx.body = {
      ok: false,
      error: {
        code: ctx.status,
        message: error.message,
        description: error.description
      }
    }
  }
}
