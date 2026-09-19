import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import {
  Chip, Empty, ErrorNote, Field, Input, Note, Panel, Select, Spinner, TextArea, useToast,
} from '../design/ui.js';

type Section = {
  key: string;
  label: string;
  help: string;
  placeholder: string;
  uses: ('verdict' | 'draft' | 'ask' | 'brief')[];
  bilingual: boolean;
  softLimit: number;
};

type Value = { section_key: string; language: 'en' | 'ar'; content: string | null; updated_at: string | null; updated_by_name: string | null };

type Payload = {
  sections: Section[];
  values: Value[];
  completeness: { filled: number; total: number; chars: number };
  spend: { spentUsd: string; capUsd: string; calls: number; capped: boolean };
  provider: {
    name: string;
    ready: boolean;
    model: string;
    /** 'env' = set in the hosting panel and not editable here. */
    keySource: 'env' | 'crm' | 'none';
    keyEndsWith: string | null;
    capUsd: string;
  };
};

type Version = { id: string; content: string | null; created_at: string; updated_by_name: string | null };

const USE_LABEL: Record<string, string> = {
  verdict: 'judging leads',
  draft: 'writing messages',
  ask: 'answering questions',
  brief: 'the daily brief',
};

/**
 * Teaching Emir AI about this brokerage.
 *
 * Not model training — the model is never changed. What is written here is put
 * in front of it on every request, which is why an edit takes effect on the
 * next answer and costs nothing to change.
 *
 * Every section shows which features read it, because that is also what decides
 * the cost: text is only sent to the features that need it.
 */
export function AiKnowledgeTab() {
  const toast = useToast();
  const data = useAsync<Payload>(() => api.get('/api/ai/knowledge'), []);
  const [language, setLanguage] = useState<'en' | 'ar'>('en');

  if (data.error) return <ErrorNote>{data.error}</ErrorNote>;
  if (data.loading && !data.data) return <Spinner />;
  if (!data.data) return null;

  const { sections, values, completeness, spend, provider } = data.data;
  const pct = Math.round((completeness.filled / completeness.total) * 100);

  return (
    <>
      <Panel span={12} index={0} icon="sparkles" title="What Emir AI knows about us">
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
          Write this once and the AI reads it before every answer, so drafts sound like your
          brokerage instead of a generic estate agent. Change a line and the next message already
          follows it — nothing has to be retrained.
        </p>

        <div className="ai-meters">
          <div className="ai-meter">
            <span className="muted">Filled in</span>
            <b>{completeness.filled} of {completeness.total}</b>
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="ai-meter">
            <span className="muted">This month's AI spend</span>
            <b>${spend.spentUsd} <span className="muted" style={{ fontWeight: 400 }}>of ${spend.capUsd}</span></b>
            <div className="bar">
              <span
                className={spend.capped ? 'over' : undefined}
                style={{ width: `${Math.min(100, (Number(spend.spentUsd) / Math.max(0.01, Number(spend.capUsd))) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {spend.capped && (
          <div className="err" style={{ display: 'block' }} role="alert">
            This month's ${spend.capUsd} budget is used up, so the AI has stopped. It starts again
            on the 1st, or raise <code>AI_MONTHLY_CAP_USD</code> in Hostinger.
          </div>
        )}

        <Note>
          Short and specific beats long and vague. Everything written here is sent to the AI on
          every request, so a tidy ten lines costs less and works better than three pages.
        </Note>

        <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
          <Chip on={language === 'en'} onClick={() => setLanguage('en')}>English</Chip>
          <Chip on={language === 'ar'} onClick={() => setLanguage('ar')}>العربية</Chip>
        </div>
      </Panel>

      <Connection provider={provider} onSaved={() => data.reload()} />

      {sections
        .filter((section) => language === 'en' || section.bilingual)
        .map((section, index) => (
          <SectionEditor
            key={`${section.key}-${language}`}
            section={section}
            language={language}
            index={index + 1}
            value={values.find((v) => v.section_key === section.key && v.language === language) ?? null}
            onSaved={() => { data.reload(); toast(`${section.label} saved`); }}
          />
        ))}

      {language === 'ar' && (
        <Panel span={12} index={9} icon="info" title="The rest is written once">
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            Only the wording sections have an Arabic version — how we talk, and the answers to
            common questions. Facts like the company details and what we sell are the same in both
            languages, so they are written once in English.
          </p>
        </Panel>
      )}

      <TryBox ready={provider.ready} onAsked={() => data.reload()} />
    </>
  );
}

/**
 * The key, the model and the budget — set from here rather than from the
 * hosting panel.
 *
 * The owner has no terminal, and every environment variable on managed hosting
 * is a trip through a control panel and a restart. A key that can only be set
 * that way is a key that never gets set. What is typed here is encrypted before
 * it is stored and never comes back to the browser; only the last four
 * characters do, so one key can be told from another.
 */
function Connection({ provider, onSaved }: { provider: Payload['provider']; onSaved: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [model, setModel] = useState(provider.model);
  const [cap, setCap] = useState(provider.capUsd);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fromHost = provider.keySource === 'env';

  async function save() {
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        model,
        monthlyCapUsd: Number(cap) || 0,
        enabled: true,
      };
      if (key.trim()) body.apiKey = key.trim();

      const response = await api.put<{ ready: boolean; works: boolean | null }>('/api/ai/connection', body);
      setKey('');
      setResult(
        response.works === true
          ? 'Connected. Emir AI answered.'
          : response.ready
            ? 'Key saved, but the test question came back empty. Check the key and that billing is on.'
            : 'Saved, but there is still no usable key.',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    try {
      await api.del('/api/ai/connection');
      toast('Emir AI switched off');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not switch it off');
    }
  }

  return (
    <Panel span={12} index={0} icon="key-round" title="Connect Emir AI">
      {provider.ready ? (
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
          <span className="pill ok">Connected</span>{' '}
          {fromHost
            ? 'The key is set in your hosting panel, so it cannot be changed from here.'
            : provider.keyEndsWith
              ? `Using the key ending ${provider.keyEndsWith}.`
              : 'A key is saved.'}
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
          Paste your Gemini key below and press Connect. Nothing else is needed — no hosting
          settings, no restart. Get a key at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.
        </p>
      )}

      {!fromHost && (
        <Field
          label={provider.ready ? 'Replace the key' : 'Gemini API key'}
          hint="Stored encrypted. It is never shown again and never leaves the server."
        >
          <Input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={provider.ready ? 'Leave blank to keep the current key' : 'Paste the key here'}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}

      <div className="field-row">
        <Field label="Model" hint="Flash-Lite is the cheapest and is enough for everything here.">
          <Select value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite — cheapest</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash — a little sharper</option>
          </Select>
        </Field>
        <Field label="Monthly budget (US$)" hint="The AI stops when this is reached. It cannot go over.">
          <Input inputMode="decimal" value={cap} onChange={(event) => setCap(event.target.value)} />
        </Field>
      </div>

      <div className="ai-row">
        {provider.ready && !fromHost && (
          <button type="button" className="rowbtn danger" onClick={() => void disconnect()}>
            Switch off
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Checking…' : provider.ready ? 'Save' : 'Connect'}
        </button>
      </div>

      {result && <Note>{result}</Note>}
      {error && <div className="err" style={{ display: 'block', marginTop: 10 }} role="alert">{error}</div>}

      <Note>
        Use a key with billing switched on. On Google&rsquo;s free tier your prompts may be used to
        improve their models, and these prompts contain real buyers&rsquo; names, numbers and
        conversations.
      </Note>
    </Panel>
  );
}

function SectionEditor({ section, language, index, value, onSaved }: {
  section: Section;
  language: 'en' | 'ar';
  index: number;
  value: Value | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(value?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Version[] | null>(null);

  useEffect(() => { setText(value?.content ?? ''); }, [value?.content]);

  const dirty = text !== (value?.content ?? '');
  const over = text.length > section.softLimit;

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/ai/knowledge/${section.key}`, { language, content: text });
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }

  async function loadHistory() {
    try {
      const result = await api.get<{ items: Version[] }>(`/api/ai/knowledge/${section.key}/history?language=${language}`);
      setHistory(result.items);
    } catch {
      setHistory([]);
    }
  }

  async function restore(versionId: string) {
    try {
      await api.post(`/api/ai/knowledge/restore/${versionId}`);
      setHistory(null);
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not put that version back');
    }
  }

  return (
    <Panel span={12} index={index} icon="sticky-note" title={section.label}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{section.help}</p>

      <div className="ai-uses">
        <Icon name="zap" size={13} />
        <span>Used for {section.uses.map((use) => USE_LABEL[use]).join(', ')}</span>
      </div>

      <TextArea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        placeholder={section.placeholder}
        dir={language === 'ar' ? 'rtl' : undefined}
        maxLength={8000}
      />

      <div className="ai-row">
        <span className={over ? 'due' : 'muted'} style={{ fontSize: 12.5 }}>
          {text.length} characters
          {over && ' — getting long. Every extra line is paid for on every request.'}
        </span>
        <button type="button" className="rowbtn" onClick={() => void loadHistory()}>
          Earlier versions
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {value?.updated_at && (
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          Last changed by {value.updated_by_name ?? 'someone'}.
        </p>
      )}

      {history !== null && (
        <div style={{ marginTop: 10 }}>
          <div className="sec-t">Earlier versions</div>
          {history.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Nothing saved before this.</p>
          ) : (
            history.map((version) => (
              <div className="task" key={version.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12.5 }}>
                    {(version.content ?? '').slice(0, 160)}
                    {(version.content ?? '').length > 160 ? '…' : ''}
                  </p>
                  <small className="muted">by {version.updated_by_name ?? 'someone'}</small>
                </div>
                <button type="button" className="rowbtn" onClick={() => void restore(version.id)}>
                  Put this back
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </Panel>
  );
}

/** Ask something and see the answer before a client does. */
function TryBox({ ready, onAsked }: { ready: boolean; onAsked: () => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [chars, setChars] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await api.post<{ answer: string | null; knowledgeChars: number }>('/api/ai/try', {
        question,
        feature: 'draft',
      });
      setAnswer(result.answer ?? 'The AI returned nothing. Try again, or check the key.');
      setChars(result.knowledgeChars);
      onAsked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not ask that');
    } finally {
      setAsking(false);
    }
  }

  return (
    <Panel span={12} index={8} icon="message-square" title="Try it">
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Ask something a client might, and see what the AI would say with everything above in front
        of it. This is a real request, so it counts towards the monthly budget.
      </p>

      <Field label="Your question">
        <TextArea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          placeholder="Write a WhatsApp message to Ahmed about a 2-bedroom in Dubai Harbour"
          maxLength={500}
        />
      </Field>

      <div className="ai-row">
        <span className="muted" style={{ fontSize: 12.5 }}>
          {chars !== null && `Sent ${chars} characters of your knowledge with it.`}
        </span>
        <button type="button" className="btn btn-primary" onClick={() => void ask()} disabled={asking || !ready || !question.trim()}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </div>

      {!ready && <Note>Add the AI key first and this will work.</Note>}
      {error && <div className="err" style={{ display: 'block', marginTop: 10 }} role="alert">{error}</div>}

      {answer && (
        <div className="ai" style={{ marginTop: 12 }}>
          <b><Icon name="sparkles" /> Emir AI</b>
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p>
        </div>
      )}

      {!answer && !error && !asking && <Empty icon="message-square" title="Nothing asked yet" />}
    </Panel>
  );
}
