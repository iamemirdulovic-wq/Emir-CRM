/**
 * The Business Card Studio: pick a design, fill in your details, download it.
 *
 * Three steps, one page, nothing leaves the browser. The details are kept in
 * localStorage so nobody retypes their own phone number a second time, and
 * for the same reason nothing is sent to the server: a card is made from
 * facts the person already knows about themselves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../design/index.js';
import { Button } from '../design/forms.js';
import { Field, Input, Note, Select, useToast } from '../design/ui.js';
import { CardFace, CardMockup } from '../card/CardPreview.js';
import { TEMPLATES, TEMPLATE_ORDER, type TemplateId } from '../card/brand.js';
import {
  DEFAULT_DETAILS, DEFAULT_OPTIONS, SIZES, nameOverflows, qrTarget,
  type CardDetails, type CardOptions, type CardSize,
} from '../card/artboard.js';
import { downloadImage, downloadMockup, downloadPdf } from '../card/export.js';

const STORE_KEY = 'homes.card.studio';

type Saved = { template: TemplateId; details: CardDetails; options: CardOptions };

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!parsed.details) return null;
    return {
      template: TEMPLATE_ORDER.includes(parsed.template as TemplateId)
        ? (parsed.template as TemplateId) : 'signature',
      details: { ...DEFAULT_DETAILS, ...parsed.details },
      options: { ...DEFAULT_OPTIONS, ...parsed.options, showSafeArea: false },
    };
  } catch {
    /* A corrupted or blocked store is a reason to start fresh, not to show an
       error on a page somebody opened to make a business card. */
    return null;
  }
}

const STEPS = ['Choose design', 'Your details', 'Download'] as const;

export function BusinessCard() {
  const toast = useToast();
  const saved = useRef<Saved | null>(load());
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<TemplateId>(saved.current?.template ?? 'signature');
  const [details, setDetails] = useState<CardDetails>(saved.current?.details ?? DEFAULT_DETAILS);
  const [options, setOptions] = useState<CardOptions>(saved.current?.options ?? DEFAULT_OPTIONS);
  const [sameWhatsapp, setSameWhatsapp] = useState(
    !saved.current || saved.current.details.whatsapp === saved.current.details.phone,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [cropMarks, setCropMarks] = useState(false);
  const [compare, setCompare] = useState(false);
  const welcomeName = saved.current?.details.fullName.split(' ')[0] ?? '';

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ template, details, options }));
    } catch {
      /* Private browsing. The card still works; it just will not be remembered. */
    }
  }, [template, details, options]);

  const set = useCallback(<K extends keyof CardDetails>(key: K, value: CardDetails[K]) => {
    setDetails((d) => {
      const next = { ...d, [key]: value };
      if (key === 'phone' && sameWhatsapp) next.whatsapp = value as string;
      return next;
    });
  }, [sameWhatsapp]);

  const toggle = useCallback(<K extends keyof CardOptions>(key: K, value: CardOptions[K]) => {
    setOptions((o) => ({ ...o, [key]: value }));
  }, []);

  const current = TEMPLATES[template];
  const forExport = useMemo(() => ({ template: current, details, options }), [current, details, options]);

  const phoneHint = details.phone.trim() && !details.phone.trim().startsWith('+')
    ? 'Add the country code, for example +971' : null;
  const emailHint = details.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email.trim())
    ? 'That does not look like an email address' : null;
  const nameTooLong = nameOverflows(details.fullName, 44);

  async function run(label: string, job: () => Promise<void>) {
    setBusy(label);
    try {
      await job();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not download');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bc">
      <header className="bc-head">
        <div>
          <h1>Business cards</h1>
          <p className="muted">
            {welcomeName ? `Welcome back, ${welcomeName}. ` : ''}
            Pick a design, fill in your details, download a file your printer can use.
          </p>
        </div>
      </header>

      <ol className="bc-steps" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'on' : index < step ? 'done' : ''}>
            <button
              type="button"
              onClick={() => index <= step && setStep(index)}
              disabled={index > step}
            >
              <span className="bc-num">{index < step ? <Icon name="check" size={13} /> : index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <StepDesign
          template={template}
          onPick={setTemplate}
          details={details}
          options={options}
          onCompare={() => setCompare(true)}
          onContinue={() => setStep(1)}
        />
      )}

      {step === 1 && (
        <div className="bc-two">
          <div className="bc-form">
            <section>
              <h2>About you</h2>
              <Field label="Full name" hint="The first name is bold on the card.">
                <Input
                  value={details.fullName}
                  onChange={(e) => set('fullName', e.target.value)}
                  placeholder="Emir Dulovic"
                  autoFocus
                />
              </Field>
              {nameTooLong && <Note>That name is too long for the card. Try a shorter version of it.</Note>}
              <Field label="Job title">
                <Input
                  value={details.jobTitle}
                  onChange={(e) => set('jobTitle', e.target.value)}
                  placeholder="Off-plan Property Consultant"
                />
              </Field>
              <Field label="BRN / RERA number" hint="Shows after your title, as BRN 12345.">
                <Input value={details.brn} onChange={(e) => set('brn', e.target.value)} placeholder="12345" />
              </Field>
            </section>

            <section>
              <h2>Contact</h2>
              <Field label="Phone" hint={phoneHint ?? undefined}>
                <Input value={details.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+971 58 592 3565" />
              </Field>
              <label className="bc-check">
                <input
                  type="checkbox"
                  checked={sameWhatsapp}
                  onChange={(e) => {
                    setSameWhatsapp(e.target.checked);
                    if (e.target.checked) setDetails((d) => ({ ...d, whatsapp: d.phone }));
                  }}
                />
                WhatsApp is the same as my phone
              </label>
              {!sameWhatsapp && (
                <Field label="WhatsApp">
                  <Input value={details.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="+971 50 000 0000" />
                </Field>
              )}
              <Field label="Email" hint={emailHint ?? undefined}>
                <Input value={details.email} onChange={(e) => set('email', e.target.value)} placeholder="name@homes.me" />
              </Field>
              <Field label="Website">
                <Input value={details.website} onChange={(e) => set('website', e.target.value)} placeholder="homes.me" />
              </Field>
            </section>

            <section>
              <h2>Office</h2>
              <Field label="Address line 1">
                <Input value={details.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
              </Field>
              <Field label="Address line 2">
                <Input value={details.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} />
              </Field>
            </section>

            <section>
              <h2>Options</h2>
              {([
                ['tagline', 'Tagline', '“Find a home that makes you smile.” on the front.'],
                ['qr', 'WhatsApp QR code', 'Clients scan it and your chat opens.'],
                ['roundedCorners', 'Rounded corners', '3 mm. The printer die-cuts them.'],
                ['companyLine', 'Company name', 'EMIGEO Homes Real Estate LLC, small, on the back.'],
              ] as const).map(([key, label, hint]) => (
                <label className="routing-switch" key={key}>
                  <input
                    type="checkbox"
                    checked={Boolean(options[key])}
                    onChange={(e) => toggle(key, e.target.checked)}
                  />
                  <div><b>{label}</b><small>{hint}</small></div>
                </label>
              ))}
              <Field label="Card size">
                <Select
                  value={options.size}
                  onChange={(e) => toggle('size', e.target.value as CardSize)}
                >
                  {Object.entries(SIZES).map(([key, s]) => (
                    <option key={key} value={key}>{s.label}</option>
                  ))}
                </Select>
              </Field>
              <label className="bc-check">
                <input
                  type="checkbox"
                  checked={Boolean(options.showSafeArea)}
                  onChange={(e) => toggle('showSafeArea', e.target.checked)}
                />
                Show the safe area (on screen only)
              </label>
            </section>
          </div>

          <aside className="bc-side">
            <div className="bc-switch" role="radiogroup" aria-label="Design">
              {TEMPLATE_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={template === id}
                  className={template === id ? 'on' : ''}
                  onClick={() => setTemplate(id)}
                >
                  <span style={{ background: TEMPLATES[id].front.background }} />
                  {TEMPLATES[id].name}
                </button>
              ))}
            </div>

            <CardFace template={current} details={details} options={options} side="front" />
            <CardFace template={current} details={details} options={options} side="back" />
            <Note>
              The QR opens <code>{qrTarget(details)}</code>. Scan it with your phone to test it.
            </Note>

            <div className="bc-bar">
              <Button icon="arrow-left" onClick={() => setStep(0)}>Back to designs</Button>
              <Button variant="primary" icon="arrow-right" onClick={() => setStep(2)}>
                Looks good
              </Button>
            </div>
          </aside>
        </div>
      )}

      {step === 2 && (
        <div className="bc-done">
          <CardMockup template={current} details={details} options={options} />
          <div>
            <h2>
              {details.fullName.trim()
                ? `Your card is ready, ${details.fullName.trim().split(' ')[0]}.`
                : 'Your card is ready.'}
            </h2>
            <div className="bc-chips">
              <span>{current.name}</span>
              <span>{SIZES[options.size].label}</span>
              <span>{options.roundedCorners ? 'Rounded corners' : 'Square corners'}</span>
              <span>{options.qr ? 'QR on' : 'QR off'}</span>
              <button type="button" className="brief-link" onClick={() => setStep(1)}>Edit</button>
            </div>

            <div className="bc-downloads">
              <Button
                variant="primary" icon="file-down" loading={busy === 'pdf'}
                onClick={() => void run('pdf', () => downloadPdf(forExport, cropMarks))}
              >
                PDF for printing
              </Button>
              <label className="bc-check">
                <input type="checkbox" checked={cropMarks} onChange={(e) => setCropMarks(e.target.checked)} />
                Add crop marks for the printer
              </label>

              <div className="bc-row">
                <Button icon="download" loading={busy === 'png'}
                  onClick={() => void run('png', async () => {
                    await downloadImage(forExport, 'front', 'png', 1);
                    await downloadImage(forExport, 'back', 'png', 1);
                  })}
                >PNG, both sides</Button>
                <Button icon="download" loading={busy === 'jpg'}
                  onClick={() => void run('jpg', async () => {
                    await downloadImage(forExport, 'front', 'jpg', 1);
                    await downloadImage(forExport, 'back', 'jpg', 1);
                  })}
                >JPG, both sides</Button>
                <Button icon="sparkles" loading={busy === 'mockup'}
                  onClick={() => void run('mockup', () => downloadMockup(forExport))}
                >Mockup for sharing</Button>
              </div>
            </div>

            <Note>
              Send the PDF to the printer. Ask for 400gsm matte card and soft-touch lamination, and
              ask for a colour proof — orange looks slightly different on paper. Rounded corners
              need a die-cut.
            </Note>

            <button type="button" className="brief-link" onClick={() => { setDetails(DEFAULT_DETAILS); setStep(1); }}>
              Make another card
            </button>
          </div>
        </div>
      )}

      {compare && (
        <CompareModal
          details={details} options={options}
          onPick={(id) => { setTemplate(id); setCompare(false); setStep(1); }}
          onClose={() => setCompare(false)}
        />
      )}
    </div>
  );
}

/**
 * Step 1. Three designs, each shown as the real card at an angle.
 *
 * The mockups are the live artboard rather than a picture of one, so the name
 * somebody has already typed is on them — which is what makes a person pick a
 * design rather than guess at one.
 */
function StepDesign({
  template, onPick, details, options, onCompare, onContinue,
}: {
  template: TemplateId;
  onPick: (id: TemplateId) => void;
  details: CardDetails;
  options: CardOptions;
  onCompare: () => void;
  onContinue: () => void;
}) {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const shown: CardDetails = details.fullName.trim() ? details : { ...details, fullName: 'Your Name' };

  function onKey(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + TEMPLATE_ORDER.length) % TEMPLATE_ORDER.length;
    onPick(TEMPLATE_ORDER[next] as TemplateId);
    document.getElementById(`design-${TEMPLATE_ORDER[next]}`)?.focus();
  }

  return (
    <>
      <div className="bc-pick-head">
        <h2>Choose your card design</h2>
        <p className="muted">Pick a style. You can change it any time.</p>
      </div>

      <div className="bc-designs" role="radiogroup" aria-label="Card design">
        {TEMPLATE_ORDER.map((id, index) => {
          const item = TEMPLATES[id];
          const picked = template === id;
          return (
            <div key={id} className={picked ? 'bc-design on' : 'bc-design'}>
              <button
                id={`design-${id}`}
                type="button"
                role="radio"
                aria-checked={picked}
                className="bc-design-hit"
                onClick={() => onPick(id)}
                onKeyDown={(e) => onKey(e, index)}
              >
                <span className="sr-only">{item.name}</span>
              </button>
              <CardMockup
                template={item} details={shown} options={options} flipped={Boolean(flipped[id])}
              />
              <button
                type="button" className="bc-flip" title="Show the other side"
                onClick={() => setFlipped((f) => ({ ...f, [id]: !f[id] }))}
              >
                <Icon name="refresh-cw" size={14} />
              </button>
              <div className="bc-design-foot">
                <div className="bc-design-name">
                  {item.name}
                  {item.recommended && <span className="bc-rec">Recommended</span>}
                  {picked && <Icon name="check" size={14} />}
                </div>
                <p className="muted">{item.blurb}</p>
                <div className="bc-dots">
                  {item.dots.map((colour) => <span key={colour} style={{ background: colour }} />)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bc-bar">
        <button type="button" className="brief-link" onClick={onCompare}>Compare side by side</button>
        <div className="bc-bar-right">
          <span className="muted">Selected: {TEMPLATES[template].name}</span>
          <Button variant="primary" icon="arrow-right" onClick={onContinue}>Continue</Button>
        </div>
      </div>
    </>
  );
}

/** All three, both sides, large — for the decision people want to make slowly. */
function CompareModal({
  details, options, onPick, onClose,
}: {
  details: CardDetails;
  options: CardOptions;
  onPick: (id: TemplateId) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown: CardDetails = details.fullName.trim() ? details : { ...details, fullName: 'Your Name' };

  return (
    <div className="bc-modal" role="dialog" aria-modal="true" aria-label="Compare the designs">
      <div className="bc-modal-in">
        <header>
          <h2>All three, side by side</h2>
          <button type="button" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </header>
        <div className="bc-compare">
          {TEMPLATE_ORDER.map((id) => (
            <div key={id}>
              <h3>{TEMPLATES[id].name}</h3>
              <CardFace template={TEMPLATES[id]} details={shown} options={options} side="front" />
              <CardFace template={TEMPLATES[id]} details={shown} options={options} side="back" />
              <Button variant="primary" onClick={() => onPick(id)}>Use this design</Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
