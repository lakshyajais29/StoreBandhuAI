import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icon';

type Props = { disabled: boolean; lockedReason?: string; onSend: (text: string, files: File[]) => void };
const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_FILES = 4;

export function Composer({ disabled, lockedReason, onSend }: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // Grow with content, then scroll — keeps the composer usable on small screens.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t, files);
    setText(''); setFiles([]);
  };

  return (
    <div className={`composer ${lockedReason ? 'is-locked' : ''}`}>
      {files.length > 0 && !lockedReason && (
        <ul className="chips">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {previews[i] && <img src={previews[i]} alt="" />}
              <span>{f.name.length > 18 ? `${f.name.slice(0, 16)}…` : f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-row">
        <button
          type="button" className="icon-btn" aria-label="Attach product photo"
          disabled={disabled || files.length >= MAX_FILES} onClick={() => fileRef.current?.click()}
        >
          <Icon name="clip" size={19} />
        </button>
        <input
          ref={fileRef} type="file" accept={ACCEPT} multiple hidden
          onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])].slice(0, MAX_FILES)); e.target.value = ''; }}
        />
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={lockedReason || 'Ask in English, Hindi or Hinglish…'}
          aria-label="Message Bandhu"
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button type="button" className="send" disabled={disabled || !text.trim()} onClick={send} aria-label="Send message">
          <Icon name="send" size={18} />
        </button>
      </div>
      <p className="composer-hint">{lockedReason || 'Bandhu asks before changing anything in your store.'}</p>
    </div>
  );
}
