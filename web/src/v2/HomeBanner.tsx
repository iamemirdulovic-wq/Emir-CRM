/**
 * The banner at the top of both phone homes.
 *
 * `design/screens/Main.dc.html` draws it for the agent and the owner's change
 * list of 14 Nov asks for the same one on `OwnerHome`: a picture the width of
 * the screen, a label on it ("FROM EMIR"), a headline, one line of text, one
 * button, and dots underneath. It moves on every 4.5 seconds and a thumb can
 * push it along.
 *
 * Built once and used twice on purpose — the owner's words were "the same
 * banner on top", and two copies of a carousel drift apart within a week.
 *
 * Three rules it keeps:
 *
 * 1. **Never an empty space.** With no banner configured it shows one
 *    homes.me card rather than a gap, which is the owner's point 9.
 * 2. **Nothing invented.** The title, the words and the picture are the
 *    owner's own, from the `banners` table. Where the home endpoint does not
 *    yet send a field — the label above the headline, the button's wording
 *    and where it goes — the card leaves it out rather than making one up.
 *    See the note on `BannerSlide` below.
 * 3. **Reduce motion means no motion.** Somebody who has asked their phone
 *    for less movement gets a banner that waits for a thumb, and the setting
 *    is watched rather than read once at start-up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../design/index.js';

/** The design's own: 4.5 seconds a slide. */
const EVERY_MS = 4500;

/** How far a thumb has to travel before it counts as a swipe. */
const SWIPE_PX = 40;

/**
 * One banner, as `/api/v2/home` sends it today.
 *
 * `label`, `buttonText` and `opens` are on the `banners` table and the owner
 * sets all three on Settings → Home banners, but the home endpoint does not
 * select them — it sends `id`, `title`, `body` and `linkUrl` only. They are
 * optional here so that the moment the server starts sending them this draws
 * them, and until then the card shows the plain "FROM THE OFFICE" label and
 * no button rather than guessing where the owner meant it to go.
 */
export interface BannerSlide {
  id: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  label?: string | null;
  buttonText?: string | null;
}

/** The label when the server has not told us which one the owner picked. */
const PLAIN_LABEL = 'From the office';

/**
 * The one card shown when nobody has written a banner.
 *
 * Says what the space is for and opens the place where office news lives.
 * Nothing on it is a figure, a price or a project.
 */
const DEFAULT_SLIDE = {
  id: 'homes-me',
  label: 'homes.me',
  title: 'Nothing from the office today',
  body: 'New projects, prizes and notices show up here.',
  to: '/v2/wall',
  buttonText: 'Team wall',
};

/**
 * The drawn picture behind a slide that has no photograph.
 *
 * A skyline, the same shape the prototype draws, in three colourways so three
 * banners in a row do not look like one banner that failed to move. It is
 * decoration: it says nothing and carries no number.
 */
const SKIES: Array<[string, string, string, string]> = [
  ['#DCDED7', '#2A3330', '#404B46', '#F0E4C8'],
  ['#DFD8E8', '#312B45', '#473F5F', '#F2E2D2'],
  ['#D4DFE8', '#223A4C', '#355065', '#F1E7CE'],
];

function Skyline({ seed }: { seed: number }) {
  const sky = SKIES[seed % SKIES.length] as [string, string, string, string];
  /* Block heights chosen once, not at random, so a slide looks the same every
     time it comes round. */
  const towers = [
    { x: 14, w: 58, h: 104 }, { x: 78, w: 42, h: 138 }, { x: 126, w: 64, h: 86 },
    { x: 196, w: 48, h: 112 }, { x: 252, w: 56, h: 64 }, { x: 318, w: 68, h: 46 },
  ];
  return (
    <svg
      className="v2-b-ban-art"
      viewBox="0 0 400 170"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable={false}
    >
      <rect width="400" height="170" fill={sky[0]} />
      <circle cx="318" cy="48" r="26" fill={sky[3]} fillOpacity="0.5" />
      {towers.map((tower, i) => (
        <g key={tower.x}>
          <rect
            x={tower.x}
            y={170 - tower.h}
            width={tower.w}
            height={tower.h}
            rx="4"
            fill={sky[(i % 2) + 1] as string}
          />
          {Array.from({ length: Math.floor(tower.h / 18) }, (_, row) => (
            <rect
              key={row}
              x={tower.x + 9}
              y={170 - tower.h + 12 + row * 18}
              width="5"
              height="6"
              rx="1"
              fill="#FFFFFF"
              fillOpacity="0.28"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** What one slide shows, after the missing fields have been dealt with. */
interface Shown {
  id: string;
  label: string;
  title: string;
  body: string | null;
  /** The real picture, when the banner has one uploaded. */
  imageUrl: string | null;
  buttonText: string | null;
  /** A page in the CRM. */
  to: string | null;
  /** A web address the owner typed. */
  href: string | null;
}

function shownFrom(banners: BannerSlide[]): Shown[] {
  if (banners.length === 0) {
    return [{
      id: DEFAULT_SLIDE.id,
      label: DEFAULT_SLIDE.label,
      title: DEFAULT_SLIDE.title,
      body: DEFAULT_SLIDE.body,
      imageUrl: null,
      buttonText: DEFAULT_SLIDE.buttonText,
      to: DEFAULT_SLIDE.to,
      href: null,
    }];
  }
  return banners.map((banner) => ({
    id: banner.id,
    label: banner.label?.trim() || PLAIN_LABEL,
    title: banner.title,
    body: banner.body,
    /* Everybody may fetch a banner's picture — `GET /api/v2/banners/:id/image`
       has no role on it for exactly this reason. A banner without one answers
       404 and the drawn skyline takes over. */
    imageUrl: `/api/v2/banners/${banner.id}/image`,
    /*
     * No destination, no button — even when the owner typed wording for one.
     * The slide itself is the link (see below), so a button drawn without an
     * href is not a button at all, just text shaped like one that does nothing
     * when a thumb lands on it. The server now sends `buttonText`, so this
     * guard is what stops that wording appearing on a banner with no address.
     */
    buttonText: banner.linkUrl ? (banner.buttonText?.trim() || 'Open') : null,
    to: null,
    href: banner.linkUrl,
  }));
}

export function HomeBanner({ banners }: { banners: BannerSlide[] }) {
  const slides = useMemo(() => shownFrom(banners), [banners]);
  const [at, setAt] = useState(0);
  const [still, setStill] = useState(false);
  /* Which slides answered 404 for their picture, so the drawn one is used and
     the browser is not asked a second time. */
  const [noPicture, setNoPicture] = useState<string[]>([]);
  const win = useRef<HTMLDivElement | null>(null);

  /* The reduce-motion setting is watched, not read once: a phone can be
     switched to "reduce motion" while the app is open, and the carousel is
     the most obvious thing in the CRM that should stop when it is. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setStill(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);

  const count = slides.length;

  /** Move the strip, which is what moves the dots: they follow the scroll. */
  const slideTo = useCallback((index: number) => {
    const el = win.current;
    if (!el) return;
    const where = index * el.clientWidth;
    /* `scrollTo` with an options object is not in jsdom, and a banner is
       never a reason for a screen to throw. */
    try {
      el.scrollTo({ left: where, behavior: still ? 'auto' : 'smooth' });
    } catch {
      el.scrollLeft = where;
    }
  }, [still]);

  useEffect(() => {
    if (count < 2 || still) return undefined;
    /*
     * `at` is a dependency on purpose: a swipe restarts the clock, so a slide
     * a thumb has just brought in is not whipped away a tenth of a second
     * later.
     */
    const timer = window.setTimeout(() => slideTo((at + 1) % count), EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [count, still, at, slideTo]);

  /* A slide taken away while it was showing must not leave the dots pointing
     past the end of the strip. */
  useEffect(() => { setAt((n) => (n < count ? n : 0)); }, [count]);

  if (count === 0) return null;

  return (
    <section className="v2-b-ban" aria-label="From the office" aria-roledescription="carousel">
      {/*
        * The strip is scrolled rather than translated, so a thumb pushes it
        * along itself — no touch handlers, the same feel as every other
        * carousel on the phone, and it still works with a trackpad. Snapping
        * is what makes it stop square on a slide.
        */}
      <div
        className="v2-b-ban-win"
        ref={win}
        onScroll={(e) => {
          const el = e.currentTarget;
          const now = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          setAt((was) => (was === now ? was : Math.min(Math.max(now, 0), count - 1)));
        }}
      >
        {slides.map((slide, i) => (
          <Slide
            key={slide.id}
            slide={slide}
            seed={i}
            picture={!noPicture.includes(slide.id)}
            onNoPicture={() => setNoPicture(
              (was) => (was.includes(slide.id) ? was : [...was, slide.id]),
            )}
          />
        ))}
      </div>

      {count > 1 && (
        <div className="v2-b-ban-dots">
          {slides.map((slide, i) => (
            <button
              type="button"
              key={slide.id}
              className={i === at ? 'v2-b-ban-dot v2-b-ban-dot-on' : 'v2-b-ban-dot'}
              aria-label={`Show “${slide.title}”`}
              aria-current={i === at}
              onClick={() => { setAt(i); slideTo(i); }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Slide({ slide, seed, picture, onNoPicture }: {
  slide: Shown; seed: number; picture: boolean; onNoPicture: () => void;
}) {
  const inside = (
    <>
      <span className="v2-b-ban-pic">
        {slide.imageUrl && picture
          ? (
            <img
              className="v2-b-ban-art"
              src={slide.imageUrl}
              alt=""
              onError={onNoPicture}
            />
          )
          : <Skyline seed={seed} />}
        <span className="v2-b-ban-wash" />
      </span>
      <span className="v2-b-ban-txt">
        <span className="v2-b-ban-tag">{slide.label}</span>
        <b className="v2-b-ban-title">{slide.title}</b>
        {slide.body && <span className="v2-b-ban-body">{slide.body}</span>}
        {slide.buttonText && (
          <span className="v2-b-ban-go">
            {slide.buttonText}
            <Icon name="arrow-right" size={14} />
          </span>
        )}
      </span>
    </>
  );

  const common = { className: 'v2-b-ban-slide' };
  if (slide.to) return <Link {...common} to={slide.to}>{inside}</Link>;
  if (slide.href) {
    return <a {...common} href={slide.href} target="_blank" rel="noreferrer">{inside}</a>;
  }
  return <div {...common}>{inside}</div>;
}
