/**
 * OpenAI-compatible LLM chat client with timeout and token estimation.
 */

import type { ProviderConfig } from "./core/types";

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

const RETRY_BACKOFF_MS = [1000, 3000];
const MAX_RETRIES = 2;

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableNetworkError(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return false;
  return true;
}

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const { baseUrl, apiKey, model, timeout = 90000 } = config;
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.2,
  };
  if (options.responseFormat) {
    body["response_format"] = options.responseFormat;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
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
        const retryable = isRetryable(res.status);
        let msg = `API ${res.status}: ${errText}`;
        if (res.status === 401) {
          msg = "API key 无效或未配置，请检查 provider.apiKey 或环境变量。";
        } else if (
          res.status === 404 &&
          /ModelNotOpen|model.*not.*activated/i.test(errText)
        ) {
          msg = "当前 model 未开通或配置错误。请在对应控制台创建推理接入点。";
        }
        const err = new Error(msg);
        if (retryable && attempt < MAX_RETRIES) {
          lastError = err;
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]!));
          continue;
        }
        throw err;
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
      if (isRetryableNetworkError(e) && attempt < MAX_RETRIES) {
        lastError = e instanceof Error ? e : new Error(String(e));
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]!));
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new Error("API 请求失败");
}

/** 从模型返回中提取 JSON 字符串（兼容 ```json ... ``` 或 ``` ... ``` 包裹） */
export function extractJsonFromModelResponse(raw: string): string {
  const trimmed = raw.trim();
  const codeBlock = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = trimmed.match(codeBlock);
  return m ? m[1]!.trim() : trimmed;
}
