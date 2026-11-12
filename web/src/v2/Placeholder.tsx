import { useLocation } from 'react-router-dom';
import { Icon } from '../design/index.js';

/**
 * A screen that has not been built yet, and says so.
 *
 * It exists so the shell can be walked end to end before any of the screens
 * inside it are real — every nav item leads somewhere, and what it leads to
 * admits what it is. A dead link teaches nothing; a page claiming to be
 * finished when it is not teaches something false.
 *
 * Every one of these disappears as its phase lands. When this file has no
 * callers left, the build order in the master prompt is finished.
 */
export function Placeholder({ title, phase }: { title: string; phase: string }) {
  const { pathname } = useLocation();
  return (
    <div className="v2-soon">
      <span className="v2-soon-mark"><Icon name="layers" /></span>
      <h2>{title}</h2>
      <p>Not built yet. It arrives in <b>{phase}</b>.</p>
      <code>{pathname}</code>
    </div>
  );
}
