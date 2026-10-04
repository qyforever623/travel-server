const config = require('../config');
const OpenAI = require('openai');

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const role = item.role === 'assistant' || item.role === 'user' ? item.role : 'user';
      const content = typeof item.content === 'string' ? item.content : '';
      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

function buildTravelChatPrompt(chatRequest) {
  const history = normalizeHistory(chatRequest && chatRequest.history);
  const userMessage = chatRequest && typeof chatRequest.message === 'string' ? chatRequest.message : '';

  const historyPrompt = history.length
    ? `\n\n历史对话：\n${history.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`).join('\n')}`
    : '';

  return `
你是专业旅游助手，负责为用户提供旅行建议、景点推荐、路线规划、预算分析和出行提醒。

当前用户消息：${userMessage}${historyPrompt}

输出要求：
1. 直接回答用户问题，不要输出额外说明。
2. 语气自然、准确、简洁、适合中文用户。
3. 如果涉及预算、时间、交通、景点，尽量给出实用建议。
4. 如需要，可按“推荐方案 + 预算建议 + 注意事项”结构来回答。
5. 不要返回 Markdown 代码块。
`;
}

async function streamTravelChat(chatRequest, onChunk, signal) {
  const provider = config.ai.provider;
  const apiKey = config.ai.apiKey;
  const baseUrl = config.ai.baseUrl;
  const model = config.ai.model;
  let hasEmitted = false;

  const emitChunk = (text) => {
    if (typeof text !== 'string' || !text) {
      return;
    }

    hasEmitted = true;
    if (typeof onChunk === 'function') {
      onChunk(text);
    }
  };

  if (signal && signal.aborted) {
    return {
      success: false,
      content: '',
      aborted: true
    };
  }

  if (provider !== 'deepseek' || !apiKey || !baseUrl || !model) {
    const fallbackText = '您好，我是旅游助手。当前 AI 服务尚未配置，暂时无法提供实时回复。';
    emitChunk(fallbackText);
    return {
      success: false,
      content: fallbackText
    };
  }

  try {
    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey,
      timeout: 30000
    });

    const history = normalizeHistory(chatRequest && chatRequest.history);
    const userMessage = typeof chatRequest === 'object' && typeof chatRequest.message === 'string'
      ? chatRequest.message.trim()
      : '';

    const messages = [
      {
        role: 'system',
        content: '你是一名专业旅行助手，回答要简洁、实用、中文友好，并结合用户需求给出具体建议。'
      },
      ...history,
      {
        role: 'user',
        content: buildTravelChatPrompt({ message: userMessage, history })
      }
    ];

    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.8,
      stream: true,
      signal
    });

    let fullContent = '';

    for await (const chunk of stream) {
      if (signal && signal.aborted) {
        break;
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) {
        continue;
      }

      fullContent += delta;
      emitChunk(delta);
    }

    if (signal && signal.aborted) {
      return {
        success: false,
        content: fullContent.trim(),
        aborted: true
      };
    }

    return {
      success: true,
      content: fullContent.trim()
    };
  } catch (error) {
    if (signal && signal.aborted) {
      console.warn('客户端断开，已中止 DeepSeek 流式响应');
      return {
        success: false,
        content: '',
        aborted: true
      };
    }

    console.error('DeepSeek stream chat failed:', error);

    if (!hasEmitted) {
      const fallbackText = '抱歉，旅游聊天服务暂时出现问题，请稍后再试。';
      emitChunk(fallbackText);
      return {
        success: false,
        content: fallbackText
      };
    }

    return {
      success: false,
      content: ''
    };
  }
}

module.exports = {
  streamTravelChat
};
