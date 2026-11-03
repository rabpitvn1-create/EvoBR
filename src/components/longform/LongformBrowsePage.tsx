import { lazy, Suspense } from 'react'
import type { SidebarModule } from '../layout/sidebar-tree'
import { LONGFORM_STEPS, type LongformMode, type LongformSection } from './navigation'

const SettingsPage = lazy(() => import('../settings/SettingsPage'))
const UsageStatsPage = lazy(() => import('../settings/UsageStatsPage'))

const STEP_DESCRIPTIONS: Record<string, string> = {
  '作品概况': '维护作品名称、简介、题材、目标字数及多世界设置。',
  '灵感与参考': '整理灵感和参考材料，分析创作方向并保留候选。',
  '世界与设定': '逐步完善世界起源、自然、人文、力量体系与历史。',
  '故事设计': '确定主题、冲突、故事核心和创作规则。',
  '人物与关系': '创建角色、补充人物档案，按角色类型管理。',
  '关系网络': '查看和维护角色之间的关系。',
  '大纲与章纲': '建立卷纲与章纲，使用快速或精细生成，并审查候选。',
  '场景细纲': '为章节安排场景、目标、节拍与承接。',
  '正文': '选择章节写作，生成、续写、改写正文并处理章后任务。',
  '改稿影响': '修改正文后检查对设定、事实和后续章节的影响。',
  '故事线': '管理主支线及其在章节中的进度。',
  '角色驱动': '从角色目标规划剧情，审查调整后应用到未来大纲。',
  '伏笔看板': '记录、追踪和回收伏笔，审查 AI 提出的建议。',
  '事实与认知': '维护故事事实及人物认知，核对来源证据。',
  '状态与物品': '管理人物状态与物品的持有、变化和记录。',
  '故事年表': '按时间梳理事件，并关联正文及来源。',
  '地点与地图': '维护地点、地理信息与世界地图。',
  '修炼进度': '维护角色境界和修炼进度。',
  '场景考证': '核查具体场景中的历史、知识与合理性。',
  '文风学习': '分析参考文本的表达特点，形成可用的文风资料。',
  '资料与检索': '整理作品资料，检索相关来源供创作引用。',
  '提示词': '查看、编辑和管理创作使用的提示词。',
  '查找与替换': '查找作品中的内容，预览并确认替换范围。',
}

export default function LongformBrowsePage({ section, mode, module, onModule, onRequireWork }: {
  section: LongformSection; mode: LongformMode; module: SidebarModule;
  onModule: (module: SidebarModule) => void; onRequireWork: () => void;
}) {
  const current = LONGFORM_STEPS.find(step => step.modules.some(([id]) => id === module))
  const leaf = current?.modules.find(([id]) => id === module)?.[1]
  const tabs = section === 'versions'
    ? [['version-history', '版本历史'], ['export', '导出与备份']] as const
    : section === 'settings' ? [['settings', '通用设置'], ['usage-stats', '用量统计']] as const : []
  let heading = leaf ?? '作品概况'
  let description = STEP_DESCRIPTIONS[current?.label ?? '作品概况']
  let empty = '尚未选择作品，这里会显示该作品保存的内容。'
  let action = `编辑${leaf ?? '作品概况'}`
  if (section === 'workbench' && mode === 'nodes') {
    heading = '节点创作'; description = '把世界、故事、角色、卷章、细纲和正文组织为节点图，检查连接、运行结果和待采纳候选。'
    empty = '尚未选择作品，暂无节点图。'; action = '创建节点图'
  } else if (section === 'workbench' && mode === 'agent') {
    heading = '主 Agent'; description = '先对话明确需求，再确认创作计划；领域 Agent 生成的候选经采纳后回到分步骤对应位置。'
    empty = '尚未选择作品，暂无创作对话、计划或候选。'; action = '开始创作对话'
  } else if (section === 'versions') {
    heading = module === 'export' ? '导出与备份' : '版本历史'
    description = '查看和恢复作品版本，备份完整数据、导出正文，并核对全书交付情况。'
    empty = '尚未选择作品，暂无版本或可导出的内容。'; action = module === 'export' ? '导出作品' : '创建作品快照'
  } else if (false) {
    heading = '派生世界'; description = '从已确认的长篇内容创建独立世界草稿或封存版本，保留来源记录。'
    empty = '尚未选择来源作品，暂无派生世界。'; action = '派生世界草稿'
  } else if (section === 'import') {
    heading = '文档导入'; description = '解析外部文档，预览导入结果，再将内容写入选定作品。'
    empty = '尚未选择接收导入内容的作品。'; action = '选择文档并导入'
  } else if (false) {
    heading = '社区与发行'; description = '查看作品派生的世界版本，制作或导入本地世界分享包。'
    empty = '尚未选择作品，暂无派生版本或分享包。在线发布和社区统计尚未接入。'; action = '管理世界分享包'
  }
  return <>
    {tabs.length > 0 && <nav className="lf-subtabs" aria-label={section === 'versions' ? '版本与导出' : '通用设置'}>{tabs.map(([id, label]) => <button key={id} aria-current={module === id ? 'page' : undefined} onClick={() => onModule(id)}>{label}</button>)}</nav>}
    {section === 'settings' ? <>
      <section className="lf-paper"><p>通用 AI 配置和用量统计可直接使用。作品文件夹与备份设置需要指定作品。</p><button className="lf-action" onClick={onRequireWork}>{module === 'usage-stats' ? '查看作品用量' : '设置作品存储'}</button></section>
      <Suspense fallback={<p role="status">设置加载中…</p>}>{module === 'usage-stats' ? <UsageStatsPage/> : <SettingsPage/>}</Suspense>
    </> : <section className="lf-paper" aria-label="未选择作品的功能页">
      <h3>{heading}</h3><p>{description}</p>
      <div className="my-6 rounded-2xl border border-dashed border-border p-6"><p>{empty}</p></div>
      <button className="lf-action lf-action-primary" onClick={onRequireWork}>{action}</button>
    </section>}
  </>
}
