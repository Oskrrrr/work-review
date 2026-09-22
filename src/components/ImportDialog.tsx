import { Cloud, FileSpreadsheet, LoaderCircle, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ImportResult } from '../lib/workbook';
import { importWorkbook } from '../lib/workbook';
import { loginPersonalWps } from '../lib/api';

export function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (result: ImportResult) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return null;
  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try { const result = await importWorkbook(file, year); await onImported(result); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败，请检查工作簿。'); }
    finally { setBusy(false); }
  };
  const connectWps = async () => {
    setBusy(true); setError('');
    try { const result = await loginPersonalWps(); if (!result.authenticated) throw new Error(result.message || '个人 WPS 登录未完成。'); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法发起 WPS 授权。'); setBusy(false); }
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <button className="dialog-close" onClick={onClose} aria-label="关闭"><X size={19}/></button>
      <div className="dialog-icon"><FileSpreadsheet size={25}/></div><h2 id="import-title">连接工作记录</h2><p>可以直接导入本地 Excel，也可以登录个人 WPS 云文档后选择工作记录。</p>
      <label className="year-field">工作簿年份<input type="number" min="2000" max="2100" value={year} onChange={event => setYear(Number(event.target.value))}/></label>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.et" hidden onChange={event => handleFile(event.target.files?.[0])}/>
      <button className="dialog-primary" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <Upload size={18}/>}选择 Excel 工作簿</button>
      <button className="dialog-secondary" onClick={connectWps} disabled={busy}><Cloud size={18}/>登录个人 WPS</button>
      {error && <div className="dialog-error" role="alert">{error}</div>}
      <small>本地导入的数据和照片保存在当前浏览器中，不会上传到第三方服务。</small>
    </section>
  </div>;
}
