const express = require('express');
const { generateTravelPlan } = require('../services/aiService');
const { streamTravelChat } = require('../services/streamChatService');
const router = express.Router();

const writeSseEvent = (res, event, payload) => {
  res.write(`data: ${JSON.stringify({
    code: 200,
    event,
    payload
  })}\n\n`);
};

// 旅游规划接口：接收首页表单提交的数据，后续会在这里调用 AI 模型
router.post('/plan', async function(req, res, next) {
  try {
    const destination = req.body && req.body.destination;
    const budget = req.body && req.body.budget;
    const days = req.body && req.body.days;

    if (!destination || budget === undefined || budget === null || days === undefined || days === null) {
      return res.status(400).json({
        code: 400,
        message: '缺少必填参数，destination、budget、days 为必填',
        data: null
      });
    }

    const planRequest = {
      destination,
      budget: Number(budget),
      days: Number(days)
    };

    const aiResult = await generateTravelPlan(planRequest);

    return res.json({
      code: 200,
      message: '旅游规划请求已接收',
      data: {
        ...aiResult
      }
    });
  } catch (error) {
    return next(error);
  }
});

// 旅游聊天接口：路由只负责校验和返回流，而 AI 调用逻辑全部放在 aiService
router.post('/chat/stream', async function(req, res, next) {
  try {
    const message = req.body && (req.body.message || req.body.content || req.body.text);
    const history = req.body && (req.body.history || req.body.messages || []);

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        code: 400,
        message: '缺少必填参数，message 为必填',
        data: null
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) {
      res.flushHeaders();
    }

    const abortController = new AbortController();

    res.on('close', () => {
      abortController.abort();
    });

    const onChunk = (text) => {
      if (typeof text === 'string' && text) {
        writeSseEvent(res, 'chunk', text);
      }
    };

    const result = await streamTravelChat({
      message: message.trim(),
      history
    }, onChunk, abortController.signal);

    if (!abortController.signal.aborted) {
      writeSseEvent(res, 'done', result);
    }
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        code: 500,
        message: '旅游聊天失败',
        data: null
      });
    }

    if (!res.writableEnded) {
      writeSseEvent(res, 'error', error && error.message ? error.message : '聊天失败');
    }
    return res.end();
  }
});

module.exports = router;
