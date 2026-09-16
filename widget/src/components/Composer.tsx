import { useRef, useState } from 'react';

type Props = { disabled: boolean; onSend: (text: string, files: File[]) => void };
const ACCEPT = 'image/jpeg,image/png,image/webp';

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t, files);
    setText(''); setFiles([]);
  };

  return (
    <div className="composer">
      {files.length > 0 && (
        <ul className="chips">
          {files.map((f, i) => (
            <li key={i}>
              {f.name.slice(0, 18)}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-row">
        <button type="button" className="attach" aria-label="Attach product photo" disabled={disabled || files.length >= 4} onClick={() => fileRef.current?.click()}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M16.5 6.5 8 15a2.1 2.1 0 0 0 3 3l8.5-8.5a4.2 4.2 0 0 0-6-6L5 12a6.4 6.4 0 0 0 9 9l6.5-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 4)); e.target.value = ''; }} />
        <textarea
          rows={1}
          value={text}
          placeholder="Ask in English, Hindi or Hinglish…"
          aria-label="Message Bandhu"
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button type="button" className="send" disabled={disabled || !text.trim()} onClick={send}>Send</button>
      </div>
    </div>
  );
}
