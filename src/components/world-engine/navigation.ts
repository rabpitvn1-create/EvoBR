import { canonicalPowerModule } from '../../lib/workspace/module-alias'
import type { SidebarModule } from '../layout/sidebar-tree'

export const WORLD_PAGES: {id:string;label:string;description:string;modules?:[SidebarModule,string][]}[] = [
  {id:'worlds',label:'我的世界',description:'创建、选择和管理本地世界。'},
  {id:'worldbuilding',label:'世界设定',description:'从规则、环境与人物出发，逐步完善世界内容；准备好后再封存为可引用的版本。'},
  {id:'basics',label:'规则与起源',description:'建立世界规则、起源与力量体系。',modules:[['world-rules','世界规则'],['worldview-origin','世界起源'],['cultivation-progress','修炼进度']]},
  {id:'nature',label:'自然与地理',description:'编辑自然环境、资源、地点与地理设定。',modules:[['worldview-natural','自然环境与资源'],['geography','地理设定'],['locations','地点与实体']]},
  {id:'society',label:'人文与社会',description:'管理种族、势力、城市、政治、文化、经济与物品。',modules:[['worldview-humanity','人文环境与实体'],['inventory','物品'],['state-table','状态']]},
  {id:'characters',label:'人物与关系',description:'建立人物档案与关系网络。',modules:[['characters','角色生成'],['characters-main','主要角色'],['characters-minor','次要角色'],['characters-npc','NPC'],['characters-extra','路人'],['relations','关系网络']]},
  {id:'history',label:'历史与事实',description:'维护历史事件、故事年表、事实及角色认知。',modules:[['history','历史年表'],['story-timeline','故事年表'],['fact-library','事实与认知']]},
  {id:'story',label:'故事与叙事',description:'可选地加入故事、主支线、伏笔、大纲、细纲和正文。',modules:[['info','叙事基本信息'],['story-design','故事核心'],['rules','创作规则'],['story-arc','主支线与进度'],['foreshadow','伏笔'],['outline','大纲与章纲'],['detailed-outline','场景细纲'],['chapters-list','章节与正文'],['editor','改稿与影响'],['character-driven-plot','角色驱动'],['references','参考资料'],['import-doc','文档导入'],['inspiration','灵感反推'],['rag-library','资料与检索'],['style-learning','文风学习'],['scene-verify','场景考证'],['global-replace','查找与替换'],['visual-workflows','叙事节点']]},
  {id:'multiverse',label:'多世界与位面',description:'管理世界集合、位面、通道与跨世界引用。',modules:[['world-overview','世界集合与通道']]},
  {id:'map',label:'世界地图',description:'根据世界设定生成地图候选，确认后保存；浏览图层并导出高清地图。',modules:[['world-map','世界树与地图']]},
  {id:'versions',label:'版本与封存',description:'选择语义范围，冻结修订并发布不可变世界版本。'},
  {id:'outlet',label:'数据出口',description:'浏览指定版本的能力、资源目录和原文证据。'},
  {id:'sharing',label:'分享与导入',description:'设置署名、许可和用途，导出或校验导入世界分享包。'},
  {id:'community',label:'社区与发行',description:'准备可分享的世界版本与许可；当前通过本地文件分享。'},
  {id:'settings',label:'通用设置',description:'管理模型、用量和完整数据备份。',modules:[['settings','通用设置'],['usage-stats','用量统计'],['data-management','备份与恢复'],['prompts','提示词库']]},
]
export function worldPageForModule(module:string):string {
  return WORLD_PAGES.find(page=>page.modules?.some(([id])=>id===canonicalPowerModule(module)))?.id ?? 'story'
}
export function worldModulePath(projectId:number|string,module:string,params?:URLSearchParams):string {
  if(module==='version-history')return `/world/versions?project=${projectId}`
  if(module==='export')module='data-management'
  const query=new URLSearchParams(params)
  if(module==='power-system'){module='worldview-origin';query.set('originField','power')}
  query.set('project',String(projectId));query.set('module',module)
  query.delete('section');query.delete('mode')
  return `/world/${worldPageForModule(module)}?${query}`
}

/** Product operations are primary; editable content families live within 世界设定.
 * Existing content URLs stay stable for bookmarks and embedded editor navigation. */
export const WORLD_CONTENT_PAGES = WORLD_PAGES.filter(page =>
  !['worlds', 'worldbuilding', 'versions', 'outlet', 'sharing', 'community', 'settings'].includes(page.id))
export const WORLD_PRIMARY_PAGES = WORLD_PAGES.filter(page => !WORLD_CONTENT_PAGES.includes(page))
export function worldPrimaryPage(pageId: string): string {
  return WORLD_CONTENT_PAGES.some(page => page.id === pageId) ? 'worldbuilding' : pageId
}
