import { Cloud, LoaderCircle, SkipForward, Upload, X } from 'lucide-react';
import { useState } from 'react';

export function FirstRunDialog({ open, onSkip, onContinue, onImport, onPersonalLogin }: { open: boolean; onSkip: () => void; onContinue: () => void; onImport: () => void; onPersonalLogin: () => Promise<void> }) {
  const [testing, setTesting] = useState(false);
  if (!open) return null;
  const skip = () => {
    localStorage.setItem('work-review-onboarding-seen', '1');
    onSkip();
  };
  const connect = async () => { setTesting(true); try { await onPersonalLogin(); } finally { setTesting(false); } };
  return <div className="dialog-backdrop first-run-backdrop" role="presentation">
    <section className="dialog first-run-dialog" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
      <button className="dialog-close" onClick={skip} aria-label="跳过设置"><X size={19}/></button>
      <div className="dialog-icon"><Cloud size={25}/></div>
      <p className="first-run-kicker">首次使用</p>
      <h2 id="first-run-title">连接你的个人 WPS 云文档</h2>
      <p>使用个人 WPS 账号网页登录，读取你自己的云文档。登录凭据由官方组件保存在当前电脑的系统凭据中，不会写入项目源码或上传到 GitHub。</p>
      <div className="first-run-personal-note"><Cloud size={18}/><span>不需要填写 App ID、App Key，也不需要配置 CloudBase 云函数。</span></div>
      <div className="first-run-actions">
        <button className="dialog-secondary" onClick={() => { skip(); onImport(); }}><SkipForward size={16}/>跳过，导入文件</button>
        <button className="dialog-primary" onClick={onContinue}>稍后再连接</button>
      </div>
      <button className="dialog-primary first-run-test-button" onClick={connect} disabled={testing}>{testing ? <LoaderCircle className="spin" size={16}/> : <Cloud size={16}/>}登录个人 WPS</button>
      <button className="first-run-file-link" onClick={() => { skip(); onImport(); }}><Upload size={15}/>我暂时不连接 WPS，直接选择 Excel 工作簿</button>
    </section>
  </div>;
}
