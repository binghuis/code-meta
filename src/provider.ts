/**
 * OpenAI-compatible LLM chat client with timeout and token estimation.
 */

import type { ProviderConfig } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  responseFormat?: {
    type: "json_schema";
    json_schema: { name: string; schema: object; strict?: boolean };
  };
  temperature?: number;
}

/**
 * Rough token estimate: ~4 chars per token for English, ~2 for Chinese.
 */
export function estimateTokens(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const other = text.length - chinese;
  return Math.ceil(chinese / 2 + other / 4);
}

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const { baseUrl, apiKey, model, timeout = 90000 } = config;
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.2,
  };

  if (options.responseFormat) {
    body["response_format"] = options.responseFormat;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      let msg = `API ${res.status}: ${errText}`;
      if (res.status === 401) {
        msg = "API key 无效或未配置，请检查 provider.apiKey 或环境变量。";
      } else if (
        res.status === 404 &&
        /ModelNotOpen|model.*not.*activated/i.test(errText)
      ) {
        msg = "当前 model 未开通或配置错误。请在对应控制台创建推理接入点。";
      }
      throw new Error(msg);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text == null) throw new Error("API 返回内容为空");
    return text;
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`请求超时（${timeout}ms）`);
    }
    throw e;
  }
}
