const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function testQuoteApi() {
  try {
    // 读取webm文件
    const webmFile = fs.readFileSync('./sticker.webm');
    
    // 创建FormData对象
    const formData = new FormData();
    formData.append('messages', JSON.stringify([{
      from: {
        name: '测试用户',
        photo: {}
      },
      media: {
        url: 'data:video/webm;base64,' + webmFile.toString('base64')
      },
      mediaType: 'webm'
    }]));
    formData.append('format', 'webm');
    formData.append('type', 'quote');
    formData.append('scale', '2');

    // 发送请求
    const response = await axios.post('http://localhost:3000/generate', formData, {
      headers: {
        ...formData.getHeaders(),
      },
      responseType: 'arraybuffer'
    });

    // 保存响应
    fs.writeFileSync('output.webm', response.data);
    console.log('语录已生成并保存为 output.webm');

  } catch (error) {
    console.error('错误:', error.message);
    if (error.response) {
      console.error('响应数据:', error.response.data.toString());
    }
  }
}

testQuoteApi(); 