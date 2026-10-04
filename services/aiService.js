const config = require('../config');
const OpenAI = require('openai');

// 这个文件负责：
// 1) 接收前端传来的旅游计划参数
// 2) 组装给大模型的 prompt
// 3) 调用 OpenAI 兼容接口（这里是 DeepSeek）
// 4) 清洗/解析模型返回的 JSON
// 5) 对结构做校验，确保返回数据符合前端约定
// 6) 如果模型调用失败或返回异常，就返回兜底结构，而不是直接报错

// 兜底数据：当 AI 没配好、余额不足、接口失败、返回结构异常时，前端至少能拿到一个稳定格式
// 这样前端不用处理 null/undefined，至少知道它是一份“失败的计划结果”
function buildPlaceholderPlan(planRequest) {
  return {
    success: false,
    city: planRequest.destination,
    days: planRequest.days,
    totalBudget: planRequest.budget,
    dailyItinerary: [],
    budgetBreakdown: {},
    tips: [],
    warnings: []
  };
}

// 生成给 AI 的提示词：
// 这里的重点是把“返回格式”写得非常死，要求模型直接返回 JSON，不要解释，不要 Markdown，不要多余文字
// 如果不加这个约束，模型很容易返回 ```json ... ``` 或者自然语言说明，后续 JSON.parse 会失败
function buildTravelPrompt(planRequest) {
  return `
你是专业旅行规划助手。请根据用户提交的信息，生成一份旅游规划方案。

用户信息：
- 目的地：${planRequest.destination}
- 预算：${planRequest.budget} 元
- 出行天数：${planRequest.days} 天

输出要求：
1. 必须返回严格的 JSON 格式
2. 不能包含 markdown 代码块
3. 不能包含任何额外说明文字
4. 字段名和结构必须完全遵守下面的格式
5. 每天行程要包含 morning / afternoon / evening
6. 预算分项必须为 accommodation / food / transportation / tickets / other
7. 建议根据用户预算和天数做合理规划

必须返回的 JSON 结构：
{
  "success": true,
  "city": "城市名",
  "days": 天数,
  "totalBudget": 总预算,
  "dailyItinerary": [
    {
      "day": 1,
      "date": "第1天",
      "morning": {
        "spot": "景点名称",
        "duration": "游览时长",
        "ticket": "门票价格",
        "transportation": "交通方式",
        "description": "景点介绍"
      },
      "afternoon": {
        "spot": "景点名称",
        "duration": "游览时长",
        "ticket": "门票价格",
        "transportation": "交通方式",
        "description": "景点介绍"
      },
      "evening": {
        "spot": "活动名称",
        "duration": "活动时长",
        "ticket": "费用",
        "transportation": "交通方式",
        "description": "活动介绍"
      }
    }
  ],
  "budgetBreakdown": {
    "accommodation": "住宿费用",
    "food": "餐饮费用",
    "transportation": "交通费用",
    "tickets": "门票费用",
    "other": "其他费用"
  },
  "tips": ["提示1", "提示2", "提示3"],
  "warnings": ["注意事项1", "注意事项2"]
}

注意：返回时请直接输出 JSON 对象，不要解释。
  `;
}

// 清洗模型返回内容：
// 模型可能返回：
// 1) 纯 JSON
// 2) ```json ... ```
// 3) ``` ... ```
// 4) 夹杂空格、换行、前后说明文字
// 这个函数用来把这些情况统一成可被 JSON.parse 读取的纯 JSON 字符串
function cleanJsonContent(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  let trimmed = content.trim();

  // 去掉 markdown 代码块包裹 ```json ... ```
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
    trimmed = trimmed.replace(/```\s*$/i, '');
  }

  // 去掉前后空白
  return trimmed.trim();
}

// 实际解析 JSON：
// 1）先清洗
// 2）再 JSON.parse
// 3）如果解析失败或结果不是对象，就直接抛错，交给外层 catch 兜底处理
function parseAiJson(content) {
  const cleaned = cleanJsonContent(content);

  if (!cleaned) {
    throw new Error('AI 返回为空');
  }

  const parsed = JSON.parse(cleaned);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 返回不是对象');
  }

  return parsed;
}

// 结构校验：
// 即使模型返回了 JSON 也不一定是“符合前端要求”的数据，
// 例如可能缺字段、字段类型不对、day 结构不完整、budgetBreakdown 没有必需键等。
// 这里做统一校验，避免前端拿到脏数据。
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return false;
  }

  const requiredTopLevelFields = ['city', 'days', 'totalBudget', 'dailyItinerary', 'budgetBreakdown', 'tips', 'warnings'];
  if (!requiredTopLevelFields.every((field) => Object.prototype.hasOwnProperty.call(plan, field))) {
    return false;
  }

  if (typeof plan.city !== 'string' || !plan.city.trim()) {
    return false;
  }

  if (!Number.isInteger(plan.days) || plan.days <= 0) {
    return false;
  }

  if (typeof plan.totalBudget !== 'number' || Number.isNaN(plan.totalBudget) || plan.totalBudget < 0) {
    return false;
  }

  if (!Array.isArray(plan.dailyItinerary) || plan.dailyItinerary.length === 0) {
    return false;
  }

  if (!plan.budgetBreakdown || typeof plan.budgetBreakdown !== 'object' || Array.isArray(plan.budgetBreakdown)) {
    return false;
  }

  const requiredBudgetKeys = ['accommodation', 'food', 'transportation', 'tickets', 'other'];
  if (!requiredBudgetKeys.every((key) => Object.prototype.hasOwnProperty.call(plan.budgetBreakdown, key))) {
    return false;
  }

  if (!Array.isArray(plan.tips) || !Array.isArray(plan.warnings)) {
    return false;
  }

  const validDayItem = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }

    const requiredFields = ['day', 'date', 'morning', 'afternoon', 'evening'];
    if (!requiredFields.every((field) => Object.prototype.hasOwnProperty.call(item, field))) {
      return false;
    }

    const timeSlots = ['morning', 'afternoon', 'evening'];
    return timeSlots.every((slot) => {
      const block = item[slot];
      if (!block || typeof block !== 'object' || Array.isArray(block)) {
        return false;
      }

      return ['spot', 'duration', 'ticket', 'transportation', 'description']
        .every((field) => Object.prototype.hasOwnProperty.call(block, field));
    });
  };

  if (!plan.dailyItinerary.every(validDayItem)) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(plan, 'success') && typeof plan.success !== 'boolean') {
    return false;
  }

  return true;
}

// 真正的 DeepSeek 调用入口：
// 1. 从配置读取 provider / apiKey / baseUrl / model
// 2. 先校验是否已配置真实模型参数
// 3. 用 OpenAI SDK 兼容的方式发起请求
// 4. 把返回结果做清洗和结构校验
// 5. 成功返回计划，失败返回兜底数据
async function callDeepSeek(planRequest) {
  const provider = config.ai.provider;
  const apiKey = config.ai.apiKey;
  const baseUrl = config.ai.baseUrl;
  const model = config.ai.model;

  // 未配置真实 API Key 时，直接返回失败兜底结构
  if (provider !== 'deepseek' || !apiKey || !baseUrl || !model) {
    return buildPlaceholderPlan(planRequest);
  }
  try {
    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey,
      timeout: 30000 
    });

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: '你是一名专业旅行规划助手，输出必须为 JSON。'
        },
        {
          role: 'user',
          content: buildTravelPrompt(planRequest)
        }
      ],
      temperature: 0.7,
      stream: false,
      response_format: { type: 'json_object' }
    });

    const content = completion?.choices?.[0]?.message?.content;

    if (!content) {
      return buildPlaceholderPlan(planRequest);
    }

    const parsed = parseAiJson(content);

    const isValidPlan = validatePlan(parsed);
    if (!isValidPlan) {
      // 非法结构说明模型返回“看起来像 JSON，但不符合约定”
      // 这时不要直接信任它，直接返回兜底值
      console.warn('AI 返回结构校验失败，已拒绝该响应', parsed);
      return buildPlaceholderPlan(planRequest);
    }

    // 关键修正：
    // 只在 success === true 时才认为是成功结果；
    // 如果模型没给 success 字段，或者它是 false，都会被视为失败
    // 这样不会出现 undefined !== false 这种漏洞导致误判成功
    return {
      ...parsed,
      success: parsed.success === true
    };
  } catch (error) {
    console.error('DeepSeek AI call failed:', error);
    return buildPlaceholderPlan(planRequest);
  }
}

// 统一 AI 调用入口：
// 后续如果要接 ChatGPT / Qwen / Claude 等模型，只需要在这里扩展 provider 分支，
// 业务代码不用改动，其余流程保持一致。
async function generateTravelPlan(planRequest) {
  try {
    const provider = config.ai.provider;

    if (provider === 'deepseek') {
      return await callDeepSeek(planRequest);
    }

    return buildPlaceholderPlan(planRequest);
  } catch (error) {
    console.error('AI service error:', error);
    return buildPlaceholderPlan(planRequest);
  }
}

module.exports = {
  buildPlaceholderPlan,
  generateTravelPlan,
  callDeepSeek,
  validatePlan
};
