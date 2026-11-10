import { useEffect, useState } from 'react';
import { Icon } from '../design/index.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';

/**
 * Where this number is, what time it is there, and whether to ring now.
 *
 * Emir, 10 Nov 2026: "this number from which country with flag, and that
 * country time also ... you can recommend time to call them."
 *
 * His leads are not local — his own export carries 186 UK numbers against 184
 * UAE ones and fifty other countries besides. An agent in Dubai ringing a
 * London number at 10am is waking someone at 6am, and nothing on the screen
 * said so. The number knew all along.
 *
 * Shows nothing at all when the dialling code is not in the table, or when
 * the country spans several zones. A missing strip costs nothing; a confident
 * wrong flag or a wrong clock costs a call at the wrong hour.
 */
export function WhereTheyAre({ phone, compact }: { phone: string | null; compact?: boolean }) {
  const origin = originOf(phone);

  /* Ticks so the clock stays true on a tab left open all afternoon. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!origin) return null;
  const clock = clockIn(origin.timeZone, now);
  const advice = whenToCall(clock, origin.timeZone);

  return (
    <div className={compact ? 'where-they-are compact' : 'where-they-are'}>
      <span className="wta-country">
        <span className="wta-flag" aria-hidden="true">{flagOf(origin.iso2)}</span>
        {origin.name}
      </span>

      {clock && (
        <span className="wta-clock" title={origin.timeZone ?? undefined}>
          <Icon name="clock-3" />
          {clock.time}
          <small>{clock.offset}</small>
        </span>
      )}

      {advice && (
        <span className={advice.ok ? 'wta-call ok' : 'wta-call wait'}>
          <Icon name={advice.ok ? 'phone' : 'alarm-clock'} />
          {advice.line}
        </span>
      )}
    </div>
  );
}
