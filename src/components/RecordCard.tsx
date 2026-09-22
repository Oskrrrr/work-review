import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Images, X } from 'lucide-react';
import { useState } from 'react';
import type { WorkRecord } from '../types';
import { ImageStep } from './ImageStep';

export function RecordCard({ record, onOpenImage, categoryLabel, datasetId, hideContent = false }: { record: WorkRecord; onOpenImage: (url: string, title: string) => void; categoryLabel?: string; datasetId?: string; hideContent?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [gallery, setGallery] = useState<Array<{ id: string; url: string; title: string }>>([]);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const textSteps = record.steps.filter(step => step.kind === 'text');
  const imageSteps = record.steps.filter(step => step.kind === 'image');
  const registerImage = (id: string, url: string, title: string) => setGallery(current => { const next = current.some(item => item.id === id) ? current.map(item => item.id === id ? { id, url, title } : item) : [...current, { id, url, title }]; const order = new Map(imageSteps.map((step, index) => [step.id, index])); return next.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)); });
  const openGalleryImage = (url: string, title: string, id: string) => { setGallery(current => current.some(item => item.id === id) ? current : [...current, { id, url, title }]); setPreviewIndex(current => { const index = gallery.findIndex(item => item.id === id); return index >= 0 ? index : gallery.length; }); };
  return <article className="record-card">
    <button className="record-card-head" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
      <div><div className="record-meta"><time>{record.date}</time>{record.caseId && <span className={hideContent ? 'privacy-mask' : undefined}>{record.caseId}</span>}</div><h3 className={hideContent ? 'privacy-mask' : undefined}>{record.title}</h3></div>
      <div className="record-actions"><span className={`category-chip${hideContent ? ' privacy-mask' : ''}`}>{categoryLabel || record.effectiveCategory}</span>{imageSteps.length > 0 && <span className={`image-count${hideContent ? ' privacy-mask' : ''}`}><Images size={14}/>{imageSteps.length}</span>}{expanded ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}</div>
    </button>
    <p className={`record-summary${hideContent ? ' privacy-mask' : ''}`}>{textSteps[0]?.text || (imageSteps.length ? '该事项包含图片处理记录。' : '暂无跟进内容。')}</p>
    {expanded && !hideContent && <ol className="step-list">{record.steps.map(step => <li key={step.id}>{step.kind === 'text' ? <p>{step.text}</p> : <ImageStep imageId={step.imageId!} name={step.imageName} datasetId={datasetId} onReady={registerImage} onOpen={(url, title) => imageSteps.length > 1 ? openGalleryImage(url, title, step.id) : onOpenImage(url, title)}/>}</li>)}</ol>}
    {previewIndex >= 0 && gallery.length > 1 && gallery[previewIndex] && <div className="record-gallery" onMouseDown={event => event.stopPropagation()}><button className="record-gallery-close" onClick={() => setPreviewIndex(-1)} aria-label="关闭预览"><X size={18}/></button><button className="record-gallery-nav prev" onClick={() => setPreviewIndex(index => (index - 1 + gallery.length) % gallery.length)} aria-label="上一张"><ChevronLeft size={24}/></button><figure><img src={gallery[previewIndex].url} alt={gallery[previewIndex].title}/><figcaption>{gallery[previewIndex].title} · {previewIndex + 1} / {gallery.length}</figcaption></figure><button className="record-gallery-nav next" onClick={() => setPreviewIndex(index => (index + 1) % gallery.length)} aria-label="下一张"><ChevronRight size={24}/></button></div>}
  </article>;
}
