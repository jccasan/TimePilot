import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_FAST_MODEL = "claude-haiku-4-5-20251001";
export const CLAUDE_SMART_MODEL = "claude-sonnet-4-6";

export const KNOWN_GOOD_CLAUDE_MODELS: ReadonlySet<string> = new Set([
  "claude-3-haiku-20240307",
  "claude-3-sonnet-20240229",
  "claude-3-opus-20240229",
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]);

function warnIfModelUnknown(modelConst: string, modelId: string): void {
  if (!KNOWN_GOOD_CLAUDE_MODELS.has(modelId)) {
    console.warn(
      `[Claude] WARNING: ${modelConst} is set to "${modelId}" which is not in the known-good model list. ` +
        `This may be a deprecated or invalid model ID. Valid models: ${[...KNOWN_GOOD_CLAUDE_MODELS].join(", ")}`
    );
  }
}

warnIfModelUnknown("CLAUDE_FAST_MODEL", CLAUDE_FAST_MODEL);
warnIfModelUnknown("CLAUDE_SMART_MODEL", CLAUDE_SMART_MODEL);

export const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});
