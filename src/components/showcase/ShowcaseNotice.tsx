import { SHOWCASE_NOTICE } from '../../lib/showcase/policy'

export default function ShowcaseNotice() {
  return <section className="rounded-xl border border-border bg-bg-surface p-6" aria-label="官网体验版说明">
    <h2 className="text-lg font-semibold">在这里了解完整项目，在本机开始 AI 创作</h2>
    <p className="my-3 leading-7">{SHOWCASE_NOTICE} 你仍可浏览各模块、阅读内置作品、创建体验副本和尝试手动编辑。</p>
    <p className="mb-4 text-sm text-text-muted">这里不提供 API、模型地址或密钥输入，也不会调用你的本机模型。体验内容只保存在当前浏览器的独立空间。</p>
    <a className="lf-action lf-action-primary" href="https://github.com/yuanbw2025/storyforge" target="_blank" rel="noreferrer">下载完整项目</a>
  </section>
}
