import { useEffect, useState } from 'react';
import { Icon } from '../design/index.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';

/**
 * A card saying where this number is and what time it is there.
 *
 * Emir, 10 Nov 2026: "make one proper card box like this number is from
 * Russia, and okay, now the timing should be 1 watch icon ... should be 12
 * hours time, not 16 17 18, like 3 a.m. 4 p.m. ... how many hours is
 * different from Dubai, it should be mentioned here."
 *
 * It earns the space because his leads are not local: his own export runs 186
 * UK numbers against 184 UAE ones and fifty other countries besides. An agent
 * in Dubai ringing a London number at 10am is waking somebody at 6am, and
 * nothing on the screen said so. The number knew all along.
 *
 * Three lines, in the order the question is actually asked: where are they,
 * what time is it there, should I ring now.
 *
 * Shows nothing at all when the dialling code is not in the table, or when
 * the country spans several zones. A missing card costs nothing; a confident
 * wrong flag or a wrong clock costs a call at the wrong hour.
 */
export function WhereTheyAre({ phone }: { phone: string | null }) {
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
    <div className={advice && !advice.ok ? 'wta-card wait' : 'wta-card'}>
      <div className="wta-head">
        <span className="wta-flag" aria-hidden="true">{flagOf(origin.iso2)}</span>
        <div className="wta-where">
          <small>This number is from</small>
          <b>{origin.name}</b>
        </div>
      </div>

      {clock && (
        <div className="wta-time">
          <Icon name="clock-3" />
          <div>
            <b>
              {clock.time}
              {/* Named where the country has more than one clock, so nobody
                  reads Moscow time off a Vladivostok number by accident. */}
              {origin.zoneLabel && <span className="wta-zone">in {origin.zoneLabel}</span>}
            </b>
            <small>{clock.offset}</small>
          </div>
        </div>
      )}

      {advice && (
        <div className={advice.ok ? 'wta-advice ok' : 'wta-advice wait'}>
          <Icon name={advice.ok ? 'phone' : 'alarm-clock'} />
          {advice.line}
        </div>
      )}
    </div>
  );
}
