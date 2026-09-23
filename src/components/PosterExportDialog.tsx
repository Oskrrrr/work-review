import { Download, Eye, EyeOff, ImagePlus, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { WorkDataset } from '../types';
import { buildAnnualPosterSvg, posterFileName } from '../lib/poster';

function svgToPngDataUrl(svg: string) {
  return new Promise<string>((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1600;
      const context = canvas.getContext('2d');
      if (!context) { URL.revokeObjectURL(url); reject(new Error('当前环境无法生成海报图片。')); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('海报预览生成失败。')); };
    image.src = url;
  });
}

export function PosterExportDialog({ open, dataset, defaultHideContent, onClose, onSaved }: { open: boolean; dataset: WorkDataset; defaultHideContent: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [hideContent, setHideContent] = useState(defaultHideContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setHideContent(defaultHideContent); setError(''); setBusy(false); } }, [open, defaultHideContent]);
  const svg = useMemo(() => buildAnnualPosterSvg(dataset, { hideContent }), [dataset, hideContent]);
  if (!open) return null;
  const filename = posterFileName(dataset);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const dataUrl = await svgToPngDataUrl(svg);
      const result = await window.workReviewDesktop?.savePoster?.({ fileName: filename, dataUrl });
      if (!result) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        link.click();
        onSaved(`海报已下载：${filename}`);
      } else onSaved(`海报已保存到：${result.path}`);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '海报保存失败。');
    } finally { setBusy(false); }
  };
  return <div className="dialog-backdrop poster-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className="dialog poster-dialog" role="dialog" aria-modal="true" aria-labelledby="poster-title">
      <button className="dialog-close" onClick={onClose} aria-label="关闭" disabled={busy}><X size={19}/></button>
      <div className="poster-dialog-head"><div className="dialog-icon"><ImagePlus size={25}/></div><div><h2 id="poster-title">生成年度总结海报</h2><p>保存前可以选择是否隐藏工作内容，统计结构和软件特色会保留。</p></div></div>
      <label className={`poster-privacy-option${hideContent ? ' active' : ''}`}><input type="checkbox" checked={hideContent} onChange={event => setHideContent(event.target.checked)}/>{hideContent ? <EyeOff size={17}/> : <Eye size={17}/>}<span><strong>{hideContent ? '隐藏工作内容' : '显示工作内容'}</strong><small>{hideContent ? '名称、分类和项目标题会以圆点打码' : '海报中显示事项分类和长期项目名称'}</small></span></label>
      <div className="poster-preview" dangerouslySetInnerHTML={{ __html: svg }}/>
      <div className="poster-dialog-footer"><span>文件名：{filename}</span><button className="dialog-secondary" onClick={onClose} disabled={busy}>取消</button><button className="dialog-primary" onClick={() => void save()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <Download size={17}/>}保存海报</button></div>
      {error && <div className="dialog-error" role="alert">{error}</div>}
      <small className="poster-save-note">桌面端优先保存到应用根目录的“工作脉络海报”文件夹；若安装目录不可写，会自动保存到用户文档目录中的同名文件夹。</small>
    </section>
  </div>;
}
