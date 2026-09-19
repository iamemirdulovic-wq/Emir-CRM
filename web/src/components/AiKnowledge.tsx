import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Chip, Empty, ErrorNote, Field, Note, Panel, Spinner, TextArea, useToast } from '../design/ui.js';

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
  provider: { name: string; ready: boolean };
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

        {!provider.ready && (
          <Note>
            No AI key yet, so nothing here is being used. Add <code>GEMINI_API_KEY</code> and set
            <code> AI_PROVIDER=gemini</code> in Hostinger, then Restart. You can fill all of this in
            now — it starts working the moment the key is in.
          </Note>
        )}
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
