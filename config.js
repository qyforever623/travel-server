// 统一配置文件：后续放置服务端常用配置，如端口、模型 Key、环境变量等
const path = require('path');
require('dotenv').config();

const config = {
  // 服务端端口
  port: process.env.PORT || 3000,

  // 当前运行环境
  env: process.env.NODE_ENV || 'development',

  // AI 模型相关配置，后续接入真实模型时在这里维护
  ai: {
    provider: process.env.AI_PROVIDER || 'placeholder',
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || '',
    model: process.env.AI_MODEL || 'placeholder-model'
  },

  // JWT / 登录相关配置，后续如果接身份认证可以放在这里
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'travel-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  // 文件上传/静态资源配置，后续扩展时可放置目录路径
  upload: {
    root: path.join(__dirname, 'public')
  }
};

module.exports = config;
