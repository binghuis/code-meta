/**
 * OpenAI-compatible LLM chat client with timeout and token estimation.
 */

import OpenAI, {
  type APIError,
  AuthenticationError,
  NotFoundError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "openai";
import type { ProviderConfig } from "./core/types";

const clientCache = new Map<string, OpenAI>();

function getClient(config: ProviderConfig): OpenAI {
  const key = `${config.baseUrl}:${config.apiKey}:${config.timeout ?? 90000}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new OpenAI({
      baseURL: config.baseUrl.replace(/\/$/, "") + "/",
      apiKey: config.apiKey,
      timeout: config.timeout ?? 90000,
      maxRetries: 2,
    });
    clientCache.set(key, client);
  }
  return client;
}

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

function mapApiError(e: unknown): Error {
  if (e instanceof AuthenticationError) {
    return new Error("API key 无效或未配置，请检查 provider.apiKey 或环境变量。");
  }
  if (e instanceof NotFoundError) {
    const err = e as APIError;
    const body = err.error as { message?: string } | undefined;
    const msg = body?.message ?? "";
    if (/ModelNotOpen|model.*not.*activated/i.test(String(msg))) {
      return new Error("当前 model 未开通或配置错误。请在对应控制台创建推理接入点。");
    }
  }
  if (e instanceof APIConnectionTimeoutError || e instanceof APIUserAbortError) {
    return new Error("请求超时，请检查网络或增大 provider.timeout。");
  }
  if (e instanceof Error) return e;
  return new Error(String(e));
}

export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const { model } = config;
  const client = getClient(config);

  try {
    const body: Parameters<OpenAI["chat"]["completions"]["create"]>[0] = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.2,
    };
    if (options.responseFormat) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: options.responseFormat.json_schema.name,
          schema: options.responseFormat.json_schema.schema as Record<string, unknown>,
          strict: options.responseFormat.json_schema.strict,
        },
      };
    }
    const completion = await client.chat.completions.create(body);
    const text =
      "choices" in completion
        ? completion.choices[0]?.message?.content?.trim()
        : undefined;
    if (text == null) throw new Error("API 返回内容为空");
    return text;
  } catch (e) {
    throw mapApiError(e);
  }
}

/** 从模型返回中提取 JSON 字符串（兼容 ```json ... ``` 或 ``` ... ``` 包裹） */
export function extractJsonFromModelResponse(raw: string): string {
  const trimmed = raw.trim();
  const codeBlock = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = trimmed.match(codeBlock);
  return m ? m[1]!.trim() : trimmed;
}
