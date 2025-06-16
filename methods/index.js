const crypto = require('crypto')
const LRU = require('lru-cache')
const sizeof = require('object-sizeof')

const generate = require('./generate')

const methods = {
  generate,
  // 添加别名支持
  'generate.webm': generate,
  'quote': generate,
  'webm': generate
}

const cache = new LRU({
  max: 1000 * 1000 * 1000,
  length: (n) => { return sizeof(n) },
  maxAge: 1000 * 60 * 45
})

module.exports = async (method, parm) => {
  console.log(`🔍 方法查找开始:`)
  console.log(`  - 输入方法: "${method}"`)
  console.log(`  - 参数类型: ${parm ? Object.keys(parm).join(', ') : '无'}`)
  console.log(`  - 可用方法: ${Object.keys(methods).join(', ')}`)
  
  // 清理方法名
  const cleanMethod = (method || 'generate').replace(/\.(webm|png|webp)$/, '').replace(/^\/+/, '') || 'generate'
  console.log(`  - 清理后方法: "${cleanMethod}"`)
  
  // 查找方法
  let targetMethod = methods[cleanMethod] || methods[method] || methods['generate']
  
  if (targetMethod) {
    console.log(`  - ✅ 找到方法处理器`)
    
    let methodResult = {}

    // 生成缓存键，但动态内容不使用缓存
    const isAnimated = parm && (parm.ext === 'webm' || parm.type === 'animated')
    let cacheString = null
    
    if (!isAnimated) {
      cacheString = crypto.createHash('md5').update(JSON.stringify({ 
        method: cleanMethod, 
        parm: {
          ...parm,
          // 排除时间戳等动态字段
          timestamp: undefined,
          _t: undefined
        }
      })).digest('hex')
      
      const methodResultCache = cache.get(cacheString)
      if (methodResultCache) {
        console.log(`  - 🎯 使用缓存结果`)
        return methodResultCache
      }
    }

    console.log(`  - 🚀 执行方法: ${cleanMethod}${isAnimated ? ' (动态内容, 跳过缓存)' : ''}`)
    
    try {
      methodResult = await targetMethod(parm)
      console.log(`  - ✅ 方法执行成功`)
      
      if (!methodResult.error && !isAnimated && cacheString) {
        cache.set(cacheString, methodResult)
        console.log(`  - 💾 结果已缓存`)
      }
    } catch (error) {
      console.error(`  - ❌ 方法执行错误:`, error)
      methodResult = { error: error.message }
    }

    return methodResult
  } else {
    console.log(`  - ❌ 方法未找到: ${method} (cleaned: ${cleanMethod})`)
    return {
      error: `Method '${method}' not found. Available methods: ${Object.keys(methods).join(', ')}`
    }
  }
}
