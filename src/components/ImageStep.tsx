import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { loadImage } from '../lib/storage';
import { getCloudImageUrl, hasCloudApi } from '../lib/api';

export function ImageStep({ imageId, name, onOpen, onReady }: { imageId: string; name?: string; onOpen: (url: string, title: string) => void; onReady?: (imageId: string, url: string, title: string) => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    loadImage(imageId).then(async image => {
      if (!active) return;
      if (image) { objectUrl = URL.createObjectURL(image.blob); setUrl(objectUrl); onReady?.(imageId, objectUrl, name || '处理照片'); return; }
      if (hasCloudApi()) { try { const remote = await getCloudImageUrl(imageId); if (active) { setUrl(remote.url); onReady?.(imageId, remote.url, name || '处理照片'); } } catch { /* keep the protected placeholder */ } }
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageId]);
  if (!url) return <div className="image-placeholder"><ImageIcon size={18}/><span>{name || '处理照片'}</span></div>;
  return <button className="step-image" onClick={() => onOpen(url, name || '处理照片')}><img src={url} alt={name || '处理照片'} loading="lazy" /></button>;
}
