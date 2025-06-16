require('dotenv').config({ path: './.env' })

console.log('启动Quote API服务...')
console.log('环境变量BOT_TOKEN:', process.env.BOT_TOKEN ? '已设置' : '未设置')

require('./app')
