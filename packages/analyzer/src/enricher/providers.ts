import type { LlmMessage, LlmResponse, LlmProvider } from "@code-style/core";

export type { LlmMessage, LlmResponse, LlmProvider } from "@code-style/core";

export class ClaudeHaikuProvider implements LlmProvider {
  readonly name = "claude-haiku";
  private apiKey: string;
  private model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "claude-haiku-4-20250414";
  }

  async generate(
    messages: LlmMessage[],
    options: { maxTokens: number },
  ): Promise<LlmResponse> {
    const systemMessage = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens,
        system: systemMessage?.content,
        messages: userMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Claude API error (${response.status}): ${body}`,
      );
    }

    const data: unknown = await response.json();

    // Validate response shape
    if (
      !data ||
      typeof data !== "object" ||
      !("content" in data) ||
      !Array.isArray((data as Record<string, unknown>).content) ||
      !("usage" in data)
    ) {
      throw new Error(
        `Unexpected Claude API response shape: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    const typed = data as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = typed.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      content: text,
      tokensUsed: (typed.usage?.input_tokens ?? 0) + (typed.usage?.output_tokens ?? 0),
    };
  }
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(options?: { baseUrl?: string; model?: string }) {
    this.baseUrl = options?.baseUrl ?? "http://localhost:11434";
    this.model = options?.model ?? "llama3.2";
  }

  async generate(
    messages: LlmMessage[],
    options: { maxTokens: number },
  ): Promise<LlmResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Ollama API error (${response.status}): ${body}`,
      );
    }

    const data: unknown = await response.json();

    if (
      !data ||
      typeof data !== "object" ||
      !("message" in data) ||
      !(data as Record<string, unknown>).message ||
      typeof ((data as Record<string, unknown>).message as Record<string, unknown>)?.content !== "string"
    ) {
      throw new Error(
        `Unexpected Ollama API response shape: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    const typed = data as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      content: typed.message.content,
      tokensUsed: (typed.eval_count ?? 0) + (typed.prompt_eval_count ?? 0),
    };
  }
}

export function createProvider(
  type: "claude" | "ollama",
  options?: Record<string, string>,
): LlmProvider {
  if (type === "claude") {
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for Claude provider",
      );
    }
    return new ClaudeHaikuProvider({
      apiKey,
      model: options?.model,
    });
  }

  return new OllamaProvider({
    baseUrl: options?.baseUrl,
    model: options?.model,
  });
}
