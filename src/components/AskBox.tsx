import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ask, ApiError, type AskAnswer } from '../api';
import { speakUrl } from '../audio';
import './AskBox.css';

const MAX = 300;

type Status =
  | { kind: 'idle' }
  | { kind: 'thinking'; q: string }
  | { kind: 'answer'; q: string; data: AskAnswer }
  | { kind: 'error'; q: string; message: string };

function friendly(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'offline';
  switch (code) {
    case 'ask-not-configured':
      return 'Ginny can’t take new questions yet. Try one of the questions above.';
    case 'too-many-questions':
      return 'That’s a lot of questions! Give Ginny a minute to catch up.';
    case 'offline':
    case 'timeout':
      return 'Ginny can’t hear you right now. Check your connection and try again.';
    case 'invalid-question':
      return 'Try a shorter question, up to 300 letters.';
    default:
      return e instanceof ApiError && e.message ? e.message : 'Ginny couldn’t answer that just now. Try again.';
  }
}

const isWebLink = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

/** "Ask Ginny anything": a free question answered by the API from sourced NASA facts. Enter sends; no buttons. */
export default function AskBox({ world }: { world: 'moon' | 'mars' }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const pending = useRef<AbortController | null>(null);

  // leaving (or switching world) cancels a pending answer, so a late reply can't land in the wrong place
  useEffect(() => {
    setStatus({ kind: 'idle' });
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [world]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = text.trim().slice(0, MAX);
    if (!q || status.kind === 'thinking') return;
    const ctrl = new AbortController();
    pending.current = ctrl;
    setStatus({ kind: 'thinking', q });
    setText('');
    try {
      const data = await ask(q, world, ctrl.signal);
      if (!ctrl.signal.aborted) {
        setStatus({ kind: 'answer', q, data });
        if (data.speechUrl) speakUrl(data.speechUrl); // Ginny says it out loud (when sound is on)
      }
    } catch (err) {
      if (!ctrl.signal.aborted) setStatus({ kind: 'error', q, message: friendly(err) });
    } finally {
      if (pending.current === ctrl) pending.current = null;
    }
  }

  // typing must not trigger the app's single-key shortcuts (space, C, T, M, arrows); Esc still closes things
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.currentTarget.blur();
      return;
    }
    e.stopPropagation();
  }

  const thinking = status.kind === 'thinking';

  return (
    <form className="askbox" onSubmit={submit} onPointerDown={(e) => e.stopPropagation()} role="search" aria-label="Ask Ginny anything">
      <div className="askbox-field">
        <input
          className="askbox-input"
          type="text"
          value={text}
          maxLength={MAX}
          placeholder="Ask Ginny anything…"
          aria-label="Ask Ginny anything"
          aria-describedby="askbox-hint"
          autoComplete="off"
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <p className="askbox-privacy">Your question goes to Google Gemini, which answers only from checked NASA facts. Questions aren't saved by this app or used by Google to train its models. Please don't type your name, email, address or phone number.</p>
        <div className="askbox-hint" id="askbox-hint">
          <span>{thinking ? 'Ginny is thinking' : 'Enter · Ask'}</span>
          {text.length >= MAX - 60 && (
            <span className={text.length >= MAX ? 'askbox-count full' : 'askbox-count'}>
              {text.length} / {MAX}
            </span>
          )}
        </div>
      </div>

      <div className="askbox-out" aria-live="polite" aria-busy={thinking}>
        {status.kind !== 'idle' && <p className="askbox-q">› {status.q}</p>}

        {thinking && (
          <p className="askbox-thinking">
            Thinking<span className="askbox-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
          </p>
        )}

        {status.kind === 'answer' && (
          <>
            <div className="askbox-tag">{status.data.grounded ? 'AI answer · from NASA facts' : 'AI answer'}</div>
            <p className="askbox-answer">{status.data.answer}</p>
            {status.data.sources.length > 0 && (
              <ul className="askbox-sources" aria-label="Sources">
                {status.data.sources.map((s, i) => (
                  <li key={`${s.url ?? s.title}-${i}`}>
                    {isWebLink(s.url) ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                    ) : (
                      <span>{s.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {status.kind === 'error' && (
          <p className="askbox-error" role="alert">
            {status.message}
          </p>
        )}
      </div>
    </form>
  );
}
