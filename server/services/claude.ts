import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_FAST_MODEL = "claude-haiku-4-5-20251001";
export const CLAUDE_SMART_MODEL = "claude-sonnet-4-6";

export const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});
