import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';
import { CardFace } from '../card/CardPreview.js';
import { TEMPLATES, TEMPLATE_ORDER, type TemplateId } from '../card/brand.js';
import {
  DEFAULT_DETAILS, DEFAULT_OPTIONS, SIZES, nameOverflows, qrTarget,
  type CardDetails, type CardOptions, type CardSize,
} from '../card/artboard.js';
import { downloadImage, downloadMockup, downloadPdf } from '../card/export.js';
import { usePhoneHead } from './phone.js';

/**
 * My business card, in three steps.
 *
 * `design/web/digital-card.html`: choose a design, fill in your details,
 * download the files. The design's own layout — the stepper, the three design
 * tiles, the sticky preview beside them, the four download buttons and the
 * public card link — is what this screen is.
 *
 * **The card itself is the artboard, not the design file's HTML card.** This
 * repository already builds business cards, and `DECISIONS.md`
 * (2026-10-31, cards) is explicit about why there is only one of them: the
 * preview, the PDF, the PNG, the JPG and the mockup are all `renderFace()`,
 * an SVG in real millimetres, because "a pretty preview and a separate print
 * path is how a card gets approved on screen and arrives from the printer
 * different". The design file draws its own card in HTML and CSS with a
 * slightly different accent orange; drawing that here would mean the thing on
 * screen is not the thing that prints. So the frame is the design's and the
 * card inside it is the one the printer gets, down to the 3 mm bleed.
 *
 * One thing in the design is left out: "Opened 14 times this month". Nothing
 * counts views of a public card, so that line would be a number we made up.
 * The panel says what the link does instead.
 */

interface Profile {
  user_id: string;
  slug: string;
  name: string;
  email: string;
  job_title: string | null;
  brn: string | null;
  phone_e164: string | null;
  public_phone: string | null;
  public_email: string | null;
  whatsapp: string | null;
  is_public: number;
}

interface Company {
  address?: string;
  website?: string;
}

/** Where the details are kept between visits — the same key the v1 studio uses. */
const STORE = 'homes.card.studio';

type Saved = { template: TemplateId; details: CardDetails; options: CardOptions };

function remembered(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!parsed.details) return null;
    return {
      template: TEMPLATE_ORDER.includes(parsed.template as TemplateId)
        ? parsed.template as TemplateId
        : 'signature',
      details: { ...DEFAULT_DETAILS, ...parsed.details },
      options: { ...DEFAULT_OPTIONS, ...parsed.options, showSafeArea: false },
    };
  } catch {
    /* A blocked or corrupted store is a reason to start fresh, not to show an
       error on a page somebody opened to make a business card. */
    return null;
  }
}

const STEPS = [
  { n: 1, label: 'Design' },
  { n: 2, label: 'Details' },
  { n: 3, label: 'Download' },
];

const TOGGLES: Array<{ key: keyof CardOptions; label: string }> = [
  { key: 'tagline', label: 'Tagline' },
  { key: 'qr', label: 'WhatsApp QR' },
  { key: 'roundedCorners', label: 'Rounded corners' },
  { key: 'companyLine', label: 'Company name' },
  { key: 'showSafeArea', label: 'Show safe area' },
];

export function V2Card() {
  const saved = useRef<Saved | null>(remembered());
  const me = useAsync<{ profile: Profile }>(() => api.get('/api/profiles/me'), []);
  const company = useAsync<{ company: Company }>(() => api.get('/api/company'), []);

  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<TemplateId>(saved.current?.template ?? 'signature');
  const [details, setDetails] = useState<CardDetails>(saved.current?.details ?? DEFAULT_DETAILS);
  const [options, setOptions] = useState<CardOptions>(saved.current?.options ?? DEFAULT_OPTIONS);
  const [sameWhatsapp, setSameWhatsapp] = useState(
    !saved.current || saved.current.details.whatsapp === saved.current.details.phone,
  );
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [compare, setCompare] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [publicCard, setPublicCard] = useState<boolean | null>(null);
  const filled = useRef(false);
  const toast = useToast();

  /* Nothing here is typed twice: the first load takes the name, title, BRN
     and numbers from the profile, and only when this browser has not already
     remembered a card.
     Both requests have to have settled first — filling from the profile while
     the company record is still in the air writes the fallback office
     address and then never corrects it. */
  useEffect(() => {
    if (filled.current || !me.data) return;
    setPublicCard(Number(me.data.profile.is_public) === 1);
    if (!company.data && !company.error) return;
    filled.current = true;
    if (saved.current) return;
    setDetails(fromProfile(me.data.profile, company.data?.company));
  }, [me.data, company.data, company.error]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ template, details, options }));
    } catch {
      /* A private window still makes a card; it just will not be remembered. */
    }
  }, [template, details, options]);

  const chosen = TEMPLATES[template];
  const forExport = useMemo(
    () => ({ template: chosen, details, options }),
    [chosen, details, options],
  );
  /* The tiles show a card with a name on it even before anybody types one. */
  const shown: CardDetails = details.fullName.trim()
    ? details
    : { ...details, fullName: 'Your Name' };

  function set<K extends keyof CardDetails>(key: K, value: CardDetails[K]) {
    setDetails((was) => {
      const next = { ...was, [key]: value };
      if (key === 'phone' && sameWhatsapp) next.whatsapp = value as string;
      return next;
    });
  }

  function toggle<K extends keyof CardOptions>(key: K, value: CardOptions[K]) {
    setOptions((was) => ({ ...was, [key]: value }));
  }

  const problems: Record<string, string> = {};
  if (details.fullName.trim().length < 3) problems.fullName = 'Write your full name.';
  else if (nameOverflows(details.fullName, 44)) problems.fullName = 'That name is too long for the card. Try a shorter version.';
  if (!/^\d{4,6}$/.test(details.brn.trim())) problems.brn = 'A BRN has 4 to 6 digits.';
  if (!/^\+?[\d ]{9,}$/.test(details.phone.trim())) problems.phone = 'Digits only, at least 9.';
  if (!sameWhatsapp && !/^\+?[\d ]{9,}$/.test(details.whatsapp.trim())) problems.whatsapp = 'Digits only, at least 9.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email.trim())) problems.email = 'This email does not look right.';
  const ready = Object.keys(problems).length === 0;
  const show = (key: string) => (touched ? problems[key] : undefined);

  function go(next: number) {
    if (next > 2 && !ready) {
      setTouched(true);
      setStep(2);
      toast('Check the red fields first');
      return;
    }
    if (next === 2) setSide('back');
    if (next === 1) setSide('front');
    setStep(next);
  }

  async function run(label: string, job: () => Promise<void>) {
    setBusy(label);
    try {
      await job();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not download.');
    } finally {
      setBusy(null);
    }
  }

  async function setPublic(on: boolean) {
    if (!me.data) return;
    setPublicCard(on);
    try {
      await api.patch(`/api/profiles/${me.data.profile.user_id}`, { isPublic: on });
      toast(on ? 'Your card link is public' : 'Your card link is switched off');
    } catch (err) {
      setPublicCard(!on);
      toast(err instanceof Error ? err.message : 'That did not save.');
    }
  }

  /*
   * `DigitalCard.dc.html`: "My digital card" over "Your link and your printed
   * card". The shared header used to call this screen "My business …" — the
   * name from the address, truncated at 390px — and put an Add lead button
   * beside it, which the design never does on this screen.
   */
  usePhoneHead({
    title: 'My digital card',
    sub: `Step ${step} of 3 · your link and your printed card`,
  });

  if (me.error) return <div className="p-card"><ErrorNote>{me.error}</ErrorNote></div>;
  if (!me.data) return <div className="p-card"><Spinner /></div>;

  const link = `${window.location.origin}/card/${me.data.profile.slug}`;

  return (
    <div className="p-card">
      <div className="d-dc">
        <div className="d-dc-left">
          <section className="d-card v2-card-steps">
            <div className="d-stepper d-mb-0 d-id-steps">
              {STEPS.map((one, index) => (
                <span key={one.n} className="v2-step-wrap">
                  <button
                    type="button"
                    className={step === one.n ? 'd-step d-on' : one.n < step ? 'd-step d-done' : 'd-step'}
                    onClick={() => go(one.n)}
                  >
                    <span className="d-n">{one.n}</span>{one.label}
                  </button>
                  {index < STEPS.length - 1 && (
                    <span className={one.n < step ? 'd-line d-done' : 'd-line'} />
                  )}
                </span>
              ))}
            </div>
          </section>

          {/* ── 1 · the design ─────────────────────────────────────────── */}
          {step === 1 && (
            <section className="d-card d-dc-step">
              <div className="d-card-head">
                <h2 className="d-grow">Choose a design</h2>
                <button
                  type="button"
                  className={compare ? 'd-btn d-sm d-dark' : 'd-btn d-sm'}
                  onClick={() => setCompare(!compare)}
                >
                  <Icon name="layout-grid" />Compare
                </button>
              </div>

              <div className="d-dz" role="radiogroup" aria-label="Card design">
                {TEMPLATE_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={template === id}
                    className={template === id ? 'd-dz-opt d-on' : 'd-dz-opt'}
                    onClick={() => setTemplate(id)}
                  >
                    <span className="v2-card-mini">
                      <CardFace
                        template={TEMPLATES[id]} details={shown} options={options} side="front"
                      />
                    </span>
                    <span className="d-dz-lab">
                      <b>{TEMPLATES[id].name}</b>
                      <span>{TEMPLATES[id].blurb}</span>
                    </span>
                  </button>
                ))}
              </div>

              {compare && (
                <div className="d-cmp">
                  <h4 className="d-mb-8">Front and back, side by side</h4>
                  <div className="d-cmp-grid">
                    {TEMPLATE_ORDER.map((id) => (
                      <div key={id}>
                        <span className="v2-card-mini">
                          <CardFace
                            template={TEMPLATES[id]} details={shown} options={options} side="front"
                          />
                        </span>
                        <span className="v2-card-mini">
                          <CardFace
                            template={TEMPLATES[id]} details={shown} options={options} side="back"
                          />
                        </span>
                        <b className="d-small">{TEMPLATES[id].name}</b>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── 2 · the details ────────────────────────────────────────── */}
          {step === 2 && (
            <section className="d-card d-dc-step">
              <div className="d-card-head">
                <h2 className="d-grow">Your details</h2>
                <button
                  type="button"
                  className="d-btn d-sm d-ghost"
                  onClick={() => {
                    setDetails(fromProfile(me.data!.profile, company.data?.company));
                    setSameWhatsapp(true);
                    toast('Details taken from your profile');
                  }}
                >
                  <Icon name="refresh-cw" />Take from my profile
                </button>
              </div>

              <div className="d-form-grid">
                <Field label="Name" required problem={show('fullName')}>
                  <input
                    className="d-input"
                    value={details.fullName}
                    aria-label="Name"
                    onChange={(e) => set('fullName', e.target.value)}
                  />
                </Field>

                <Field label="Title">
                  <input
                    className="d-input"
                    value={details.jobTitle}
                    aria-label="Title"
                    placeholder="Property Consultant"
                    onChange={(e) => set('jobTitle', e.target.value)}
                  />
                </Field>

                <Field label="BRN" required problem={show('brn')}>
                  <input
                    className="d-input"
                    value={details.brn}
                    aria-label="BRN"
                    inputMode="numeric"
                    onChange={(e) => set('brn', e.target.value)}
                  />
                </Field>

                <Field label="Phone" required problem={show('phone')}>
                  <input
                    className="d-input"
                    value={details.phone}
                    aria-label="Phone"
                    placeholder="+971 50 123 4567"
                    onChange={(e) => set('phone', e.target.value)}
                  />
                </Field>

                <Field label="WhatsApp" problem={show('whatsapp')}>
                  <input
                    className="d-input"
                    value={details.whatsapp}
                    aria-label="WhatsApp"
                    disabled={sameWhatsapp}
                    onChange={(e) => set('whatsapp', e.target.value)}
                  />
                  <label className="d-switch d-small d-mt-4">
                    <input
                      type="checkbox"
                      checked={sameWhatsapp}
                      onChange={(e) => {
                        setSameWhatsapp(e.target.checked);
                        if (e.target.checked) setDetails((was) => ({ ...was, whatsapp: was.phone }));
                      }}
                    />
                    <span className="d-track" />
                    WhatsApp is the same number
                  </label>
                </Field>

                <Field label="Email" required problem={show('email')}>
                  <input
                    className="d-input"
                    value={details.email}
                    aria-label="Email"
                    onChange={(e) => set('email', e.target.value)}
                  />
                </Field>

                <Field label="Website">
                  <input
                    className="d-input"
                    value={details.website}
                    aria-label="Website"
                    onChange={(e) => set('website', e.target.value)}
                  />
                </Field>

                <div className="d-field">
                  <span className="d-field-label">Card size</span>
                  <div className="d-seg d-block">
                    {(Object.keys(SIZES) as CardSize[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={options.size === key}
                        className={options.size === key ? 'd-on' : undefined}
                        onClick={() => toggle('size', key)}
                      >
                        {SIZES[key].label}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Address line 1">
                  <input
                    className="d-input"
                    value={details.addressLine1}
                    aria-label="Address line 1"
                    maxLength={48}
                    onChange={(e) => set('addressLine1', e.target.value)}
                  />
                </Field>

                <Field label="Address line 2">
                  <input
                    className="d-input"
                    value={details.addressLine2}
                    aria-label="Address line 2"
                    maxLength={48}
                    onChange={(e) => set('addressLine2', e.target.value)}
                  />
                </Field>

                <div className="d-full d-dc-sw">
                  {TOGGLES.map((one) => (
                    <label className="d-switch" key={one.key}>
                      <input
                        type="checkbox"
                        checked={Boolean(options[one.key])}
                        onChange={(e) => toggle(one.key, e.target.checked)}
                      />
                      <span className="d-track" />
                      {one.label}
                    </label>
                  ))}
                </div>
              </div>

              <p className="d-small d-muted">
                The QR opens {qrTarget(details)} — scan it with your phone to test it.
              </p>
            </section>
          )}

          {/* ── 3 · the files ──────────────────────────────────────────── */}
          {step === 3 && (
            <section className="d-card d-dc-step">
              <div className="d-card-head">
                <h2 className="d-grow">Download</h2>
                <span className="d-small d-muted">
                  {chosen.name} · {SIZES[options.size].label} · front and back
                </span>
              </div>

              <div className="d-dl-grid">
                <button
                  type="button"
                  className="d-dl"
                  disabled={busy !== null}
                  onClick={() => void run('pdf', () => downloadPdf(forExport, true))}
                >
                  <span className="d-card-icon d-accent"><Icon name="file-text" /></span>
                  <span className="d-grow">
                    <b>PDF + crop marks</b>
                    <span>For the print shop · 3 mm bleed</span>
                  </span>
                  <Icon name={busy === 'pdf' ? 'loader-2' : 'download'} />
                </button>

                <button
                  type="button"
                  className="d-dl"
                  disabled={busy !== null}
                  onClick={() => void run('png', async () => {
                    await downloadImage(forExport, 'front', 'png', 1);
                    await downloadImage(forExport, 'back', 'png', 1);
                  })}
                >
                  <span className="d-card-icon"><Icon name="image-up" /></span>
                  <span className="d-grow">
                    <b>PNG</b>
                    <span>Both sides, sharp · for WhatsApp and email</span>
                  </span>
                  <Icon name={busy === 'png' ? 'loader-2' : 'download'} />
                </button>

                <button
                  type="button"
                  className="d-dl"
                  disabled={busy !== null}
                  onClick={() => void run('jpg', async () => {
                    await downloadImage(forExport, 'front', 'jpg', 1);
                    await downloadImage(forExport, 'back', 'jpg', 1);
                  })}
                >
                  <span className="d-card-icon"><Icon name="image-up" /></span>
                  <span className="d-grow">
                    <b>JPG</b>
                    <span>Smaller files · for social media</span>
                  </span>
                  <Icon name={busy === 'jpg' ? 'loader-2' : 'download'} />
                </button>

                <button
                  type="button"
                  className="d-dl"
                  disabled={busy !== null}
                  onClick={() => void run('mockup', () => downloadMockup(forExport))}
                >
                  <span className="d-card-icon"><Icon name="eye" /></span>
                  <span className="d-grow">
                    <b>Mockup</b>
                    <span>Both sides at an angle, for sharing</span>
                  </span>
                  <Icon name={busy === 'mockup' ? 'loader-2' : 'download'} />
                </button>
              </div>

              <div className="d-mock">
                <span className="v2-mock-a">
                  <CardFace template={chosen} details={shown} options={options} side="back" />
                </span>
                <span className="v2-mock-b">
                  <CardFace template={chosen} details={shown} options={options} side="front" />
                </span>
              </div>

              <p className="d-small d-muted">
                Print tip: 350 g paper, matt. Ask the print shop for a test card first — orange
                looks slightly different on paper. Rounded corners are a die-cut, and page 3 of the
                PDF tells them so.
              </p>
            </section>
          )}

          <div className="d-row">
            <button
              type="button"
              className="d-btn d-ghost"
              disabled={step === 1}
              onClick={() => go(step - 1)}
            >
              <Icon name="arrow-left" />Back
            </button>
            <span className="d-grow" />
            <span className="d-small d-muted">Step {step} of 3</span>
            {step < 3
              ? (
                <button type="button" className="d-btn d-primary" onClick={() => go(step + 1)}>
                  {step === 1 ? 'Next: details' : 'Next: download'}<Icon name="arrow-right" />
                </button>
              )
              : (
                <button
                  type="button"
                  className="d-btn d-primary"
                  disabled={busy !== null}
                  onClick={() => void run('all', async () => {
                    await downloadPdf(forExport, true);
                    await downloadImage(forExport, 'front', 'png', 1);
                    await downloadImage(forExport, 'back', 'png', 1);
                    await downloadMockup(forExport);
                    toast('PDF, both PNGs and the mockup are downloading');
                  })}
                >
                  <Icon name="download" />Download all
                </button>
              )}
          </div>
        </div>

        {/* ── the preview, and the link ─────────────────────────────────── */}
        <aside className="d-dc-right">
          <div className="d-pv">
            <div className="d-row">
              <h4 className="d-grow">{side === 'front' ? 'Front' : 'Back'}</h4>
              <button
                type="button"
                className="d-btn d-sm"
                onClick={() => setSide(side === 'front' ? 'back' : 'front')}
              >
                <Icon name="repeat" />Flip
              </button>
            </div>
            <div className="d-pv-stage">
              <button
                type="button"
                className="v2-card-art"
                aria-label="Flip the card"
                onClick={() => setSide(side === 'front' ? 'back' : 'front')}
              >
                <CardFace template={chosen} details={shown} options={options} side={side} />
              </button>
            </div>
            <div className="d-row d-between d-small d-muted">
              <span>{SIZES[options.size].label}</span>
              <span>Click the card to flip it</span>
            </div>
          </div>

          <section className="d-card">
            <div className="d-switch-row v2-flat">
              <span className="d-card-icon"><Icon name="link" /></span>
              <div className="d-txt">
                <b>Public card link</b>
                <span>
                  {publicCard
                    ? 'Anyone with the link sees your card'
                    : 'Off · only you can see your card'}
                </span>
              </div>
              <label className="d-switch">
                <input
                  type="checkbox"
                  checked={Boolean(publicCard)}
                  aria-label="Public card link"
                  onChange={(e) => void setPublic(e.target.checked)}
                />
                <span className="d-track" />
              </label>
            </div>

            <div className={publicCard ? 'd-pub-link' : 'd-pub-link d-off'}>
              <span className="d-grow d-truncate">{link}</span>
              <button
                type="button"
                className="d-btn d-sm"
                disabled={!publicCard}
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  toast('Link copied');
                }}
              >
                <Icon name="copy" />Copy link
              </button>
            </div>

            <div className="d-card-foot">
              <Icon name="info" />
              <span>
                The link opens a page with your photo, your numbers and a button that saves you to
                a client's phone. Nothing counts how often it is opened.
              </span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

function Field({
  label, required, problem, children,
}: {
  label: string;
  required?: boolean;
  problem?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="d-field">
      <label>{label}{required && <> <span className="d-req">*</span></>}</label>
      {children}
      {problem && <span className="v2-field-error">{problem}</span>}
    </div>
  );
}

/**
 * The card's details, from the record rather than from memory.
 *
 * The public number is preferred over the login one where somebody has set
 * it: a public card is where an agent chooses what a stranger may ring.
 */
function fromProfile(profile: Profile, company: Company | undefined): CardDetails {
  const phone = profile.public_phone?.trim() || profile.phone_e164?.trim() || '';
  return {
    fullName: profile.name,
    jobTitle: profile.job_title ?? '',
    brn: profile.brn ?? '',
    phone,
    whatsapp: profile.whatsapp?.trim() || phone,
    email: profile.public_email?.trim() || profile.email,
    website: website(company?.website) || DEFAULT_DETAILS.website,
    ...addressLines(company?.address),
  };
}

/** "https://homes.me/" on a card is noise; "homes.me" is what people read. */
function website(value: string | undefined): string {
  return (value ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * The office address, over the card's two lines.
 *
 * Settings → Company keeps the address as one field, and the card has two
 * lines of 48 characters. Split at the comma nearest the middle so both lines
 * fit; if there is no comma to split on, the company's address is left out
 * rather than cut in half mid-word, and the card keeps the default office
 * address, which the agent can edit.
 */
function addressLines(address: string | undefined): { addressLine1: string; addressLine2: string } {
  const text = (address ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { addressLine1: DEFAULT_DETAILS.addressLine1, addressLine2: DEFAULT_DETAILS.addressLine2 };
  if (text.length <= 48) return { addressLine1: text, addressLine2: '' };

  const commas = [...text].reduce<number[]>((at, letter, index) => {
    if (letter === ',') at.push(index);
    return at;
  }, []);
  const middle = text.length / 2;
  const cut = commas.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
  if (cut === undefined) {
    return { addressLine1: DEFAULT_DETAILS.addressLine1, addressLine2: DEFAULT_DETAILS.addressLine2 };
  }
  return {
    addressLine1: text.slice(0, cut).trim().slice(0, 48),
    addressLine2: text.slice(cut + 1).trim().slice(0, 48),
  };
}
