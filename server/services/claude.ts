import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_FAST_MODEL = "claude-3-5-haiku-20241022";
export const CLAUDE_SMART_MODEL = "claude-3-5-sonnet-20241022";

export const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});
