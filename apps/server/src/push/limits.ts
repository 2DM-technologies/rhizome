export interface PushLimits {
  maxObjects: number;
  maxElements: number;
  maxObjectsPerCall: number;
  maxInputTokensPerCall: number;
  maxCalls: number;
  maxTokens: number;
  maxWallMs: number;
  maxAttachmentBytes: number;
  maxAttachmentBytesPerCall: number;
}

export const DEFAULT_PUSH_LIMITS: PushLimits = {
  maxObjects: 500,
  maxElements: 2000,
  maxObjectsPerCall: 25,
  maxInputTokensPerCall: 24_000,
  maxCalls: 40,
  maxTokens: 400_000,
  maxWallMs: 900_000,
  maxAttachmentBytes: 8 * 1024 * 1024,
  maxAttachmentBytesPerCall: 32 * 1024 * 1024,
};
