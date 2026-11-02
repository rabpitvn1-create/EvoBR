/** Device appearance only: never rewrite manuscripts or saved editor formatting. */
export const DEFAULT_THEME = 'storyforge' as const
export const THEME_OPTIONS = [
  {
    "id": "storyforge",
    "name": "青绿山水",
    "description": "青绿山景，奶油纸面。",
    "group": "浅色"
  },
  {
    "id": "inkwash",
    "name": "水墨远山",
    "description": "淡墨远山，暖宣纸面，朱砂点睛。",
    "group": "浅色"
  },
  {
    "id": "mist",
    "name": "雾青桃陶",
    "description": "浅雾青与桃陶按钮",
    "group": "浅色"
  },
  {
    "id": "paper-ink",
    "name": "纸与墨",
    "description": "暖灰与素纸",
    "group": "浅色"
  },
  {
    "id": "apricot",
    "name": "暖杏书笺",
    "description": "奶油杏纸 / 淡陶粉 / 赤陶按钮",
    "group": "浅色"
  },
  {
    "id": "vellum",
    "name": "羊皮古卷",
    "description": "蜂蜜色羊皮纹理 / 棕墨正文 / 旧铜点缀",
    "group": "浅色"
  },
  {
    "id": "gilded",
    "name": "古卷鎏金",
    "description": "泛黄纸面与铁胆墨",
    "group": "浅色"
  },
  {
    "id": "verdant",
    "name": "青绿金笺",
    "description": "金色绢底 / 石青石绿山峦 / 深青按钮",
    "group": "浅色"
  },
  {
    "id": "ember",
    "name": "熔炉余烬",
    "description": "深褐、余烬橙、暗金",
    "group": "深色"
  },
  {
    "id": "silver-blue",
    "name": "银蓝书房",
    "description": "冷灰、银蓝与淡白纸面",
    "group": "浅色"
  },
  {
    "id": "dusk",
    "name": "暮紫星灯",
    "description": "淡紫暮色、暖白纸面与星灯金点缀。",
    "group": "浅色"
  },
  {
    "id": "starlight",
    "name": "星夜萤黄",
    "description": "深蓝黑外框 / 象牙白纸面 / 萤黄点睛",
    "group": "混合"
  },
  {
    "id": "starlight-dark",
    "name": "星夜萤黄 · 全暗版",
    "description": "深蓝灰正文 / 柔灰文字 / 低亮萤黄",
    "group": "深色"
  },
  {
    "id": "cosmic-glass",
    "name": "星穹 · 透光版",
    "description": "整体星空 / 透光导航与辅助面板 / 稳定深色正文",
    "group": "深色"
  }
] as const
export type StoryForgeTheme = typeof THEME_OPTIONS[number]['id']
export function resolveStoryForgeTheme(savedTheme: string | null): StoryForgeTheme {
  return THEME_OPTIONS.find(theme => theme.id === savedTheme)?.id ?? DEFAULT_THEME
}
export function applyStoryForgeTheme(theme: StoryForgeTheme) {
  localStorage.setItem('storyforge-theme', theme)
  document.documentElement.setAttribute('data-theme', theme)
  window.dispatchEvent(new Event('themechange'))
}

export function getStoryForgeTheme(): StoryForgeTheme {
  return resolveStoryForgeTheme(document.documentElement.getAttribute('data-theme'))
}

export function subscribeStoryForgeTheme(onChange: () => void) {
  window.addEventListener('themechange', onChange)
  return () => window.removeEventListener('themechange', onChange)
}
