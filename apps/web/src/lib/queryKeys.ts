export const qk = {
  me: ['me'],
  models: ['models'],
  generations: ['generations'],
  generation: (id: string) => ['generation', id],
  elements: ['elements'],
  storyboards: ['storyboards'],
  storyboard: (id: string) => ['storyboard', id],
  storyboardCapabilities: ['storyboard-capabilities'],
  mcpKey: ['mcp-key'],
} as const;
