import { useEffect, useRef, useState } from 'react';
import { useLoom } from '../state';
import manny from '../content/manny.json';
import { speak, stopSpeech } from '../audio';

/* Manny's captions on the landing page. He looks through the telescope with you and reacts.
   Lines marked cultural + review "pending" only show while showLinesInReview is true, and always carry
   the review tag (PRD: nothing cultural is presented as approved until the Lakota reader approves it). */

type Line = { id: string; text: string; cultural: boolean; review?: string };

const lines: Line[] = (manny.landing as Line[]).filter((l) => !l.cultural || l.review === 'approved' || manny.showLinesInReview);

/** shared with the 3D figure so he nods while he talks */
export const mannyTalk = { talking: false };

export default function MannyLanding() {
  const goTo = useLoom((s) => s.goTo);
  const diving = useLoom((s) => s.diving);
  const [i, setI] = useState(-1);
  const [line, setLine] = useState<Line | null>(null);
  const [shown, setShown] = useState('');
  const said = useRef(false);

  // the opening: one line after another, then he waits with you
  useEffect(() => {
    const t = setTimeout(() => setI(0), 1400);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (i < 0 || i >= lines.length) return;
    setLine(lines[i]);
    const dur = 1800 + lines[i].text.length * 55;
    const t = setTimeout(() => setI((x) => x + 1), dur);
    return () => clearTimeout(t);
  }, [i]);

  // you clicked a world: "Let's go."
  useEffect(() => {
    if ((goTo || diving) && !said.current) {
      said.current = true;
      setI(lines.length);
      setLine(manny.go as Line);
    }
  }, [goTo, diving]);

  // typewriter + voice
  useEffect(() => {
    if (!line) return;
    setShown('');
    mannyTalk.talking = true;
    speak(line.text);
    let n = 0;
    const iv = setInterval(() => {
      n += 1;
      setShown(line.text.slice(0, n));
      if (n >= line.text.length) { clearInterval(iv); setTimeout(() => { mannyTalk.talking = false; }, 400); }
    }, 32);
    return () => { clearInterval(iv); mannyTalk.talking = false; };
  }, [line]);

  useEffect(() => () => stopSpeech(), []);

  if (!line) return null;
  const inReview = line.cultural && line.review !== 'approved';
  return (
    <div className="manny-caption" aria-live="polite">
      <div className="who"><span className="dot" /><b>MANNY</b></div>
      <p>{shown}</p>
      {inReview && <div className="review-tag">{manny.reviewTag}</div>}
    </div>
  );
}
