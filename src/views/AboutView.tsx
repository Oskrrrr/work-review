import { CalendarDays, Cloud, ExternalLink, FileText, FolderKanban, Info, ShieldCheck, Sparkles } from 'lucide-react';
import packageJson from '../../package.json';

const features = [
  { icon: CalendarDays, title: '年度概览', text: '用工作热力图、分类统计和当日事项快速回顾一整年的投入。' },
  { icon: FileText, title: '时间线与图片', text: '按日期、分类、关键词和事项编号检索完整工作记录，支持查看图片跟进。' },
  { icon: FolderKanban, title: '事项串联与长期项目', text: '把分散记录归并为同一事项，区分长期事项和阶段性工作，并支持跨年度主档。' },
  { icon: Sparkles, title: 'AI 年度报告素材', text: '导出结构化 Markdown 文字稿和年度总结海报，方便继续交给 AI 整理。' }
];

export function AboutView() {
  return <section className="workspace-view about-view">
    <div className="about-hero panel">
      <div className="about-app-icon"><img src="./work-review-icon.png" alt="工作脉络图标" /></div>
      <div className="about-hero-copy">
        <span className="about-kicker">个人工作复盘客户端</span>
        <h2>工作脉络</h2>
        <p>把零散的工作记录，整理成可回顾、可追踪、可写成年度报告的工作脉络。</p>
        <div className="about-badges"><span>版本 {packageJson.version}</span><span>发布者 Oskrrrr</span><span>Windows / Web</span></div>
      </div>
    </div>

    <div className="about-feature-grid">
      {features.map(({ icon: Icon, title, text }) => <article className="panel about-feature" key={title}>
        <span className="about-feature-icon"><Icon size={19} /></span>
        <div><h3>{title}</h3><p>{text}</p></div>
      </article>)}
    </div>

    <div className="about-detail-grid">
      <article className="panel about-detail-card">
        <div className="about-section-title"><ShieldCheck size={18} /><h3>本地优先与隐私</h3></div>
        <p>Excel 解析、工作记录整理、配置备份、Markdown 文字稿和年度海报默认都在当前电脑完成。软件不会自动把工作记录发送给 AI 服务。</p>
        <ul><li>个人 WPS 登录由官方组件处理</li><li>不需要企业 WPS AppID、AppKey 或 CloudBase</li><li>配置备份不包含原始工作记录、图片和登录密钥</li></ul>
      </article>
      <article className="panel about-detail-card">
        <div className="about-section-title"><Cloud size={18} /><h3>数据来源</h3></div>
        <p>可以导入本地 Excel，也可以登录个人 WPS 选择云文档。多个年度数据表可以同时保留，并按数据年度切换查看。</p>
        <ul><li>支持年度显示名称和年份手动调整</li><li>支持完整配置导出与导入</li><li>原始 Excel 文件不会被软件删除或修改</li></ul>
      </article>
    </div>

    <article className="panel about-footer-card">
      <div><div className="about-section-title"><Info size={18} /><h3>关于这个项目</h3></div><p>工作脉络由 Oskrrrr 开发，面向个人工作记录的整理、复盘和年度总结。欢迎通过 GitHub 反馈 Excel 格式兼容性、长期事项整理方式和使用体验。</p></div>
      <a className="secondary-action about-github-link" href="https://github.com/Oskrrrr/work-review" target="_blank" rel="noreferrer">查看 GitHub 项目 <ExternalLink size={14} /></a>
    </article>
  </section>;
}
