export const BIBLE = {
  character: {
    gender: 'woman', age: 'early 30s', ethnicity: 'Brazilian, light brown skin',
    face: 'round face, small freckles on the nose', hair: 'long dark curly hair, parted in the middle',
    build: 'average build', outfit: 'oversized cream linen shirt, gold hoop earrings', accessories: 'thin gold necklace',
    voice: 'warm, fast, excited',
  },
  product: { name: 'Glow Serum da Luma', look: 'frosted glass dropper bottle, coral cap', packaging: 'white box with coral stripe', key_detail: 'coral cap' },
  setting: 'small bright bathroom with white tiles, a plant and a round mirror',
  lighting: 'soft daylight from a window on the left',
  camera_style: 'handheld front-camera selfie, slight shake',
  color_grade: 'warm, slightly lifted blacks',
  audio_style: 'room tone, no music',
  negative: 'no subtitles',
};

export function rawScript(overrides = {}) {
  return {
    format: 'ugc',
    language: 'pt-BR',
    title: 'Glow Serum manhã',
    concept: 'Rotina honesta de 45s.',
    bible: BIBLE,
    scenes: Array.from({ length: 6 }, (_, i) => ({
      role: 'x', goal: 'y', action: `Ação ${i + 1}`, dialogue: `Fala ${i + 1}`, camera: 'selfie', sound: 'room tone',
    })),
    tiktok: { caption: 'Meu segredo', hashtags: ['#skincare', 'glow'], hook_text: 'Olha isso', cover_text: 'Glow' },
    ...overrides,
  };
}

export const PLAN = { format: 'ugc', targetSeconds: 45, clipSeconds: 8, language: 'pt-BR' };
