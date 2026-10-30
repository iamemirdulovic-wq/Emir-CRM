import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Button } from '../design/forms.js';
import { Icon } from '../design/index.js';
import {
  Chip, Drawer, DrawerHead, Field, Select, Spinner, TextArea, useToast,
} from '../design/ui.js';

/**
 * Writing one email to one client.
 *
 * The two things that make this worth having over the agent's own mail app:
 * the templates are the team's, and the preview is the real thing. The
 * preview comes from the server through exactly the code that sends — a
 * preview assembled in the browser is a preview that stops matching the
 * moment the branding changes.
 */

interface Template {
  id: string;
  template_key: string | null;
  name: string;
  category: string;
  subject: string;
  body: string;
  preview_text: string | null;
  is_system: number;
  enabled: number;
}

interface MergeField {
  key: string;
  label: string;
}

interface Preview {
  subject: string;
  html: string;
  text: string;
  unknown: string[];
  usedFallback: string[];
  to: string | null;
  readiness: {
    sendingOn: boolean;
    testMode: boolean;
    testRedirect: string | null;
    problems: string[];
  };
}

export function EmailComposer({
  open, onClose, contactId, opportunityId, contactName, onSent,
}: {
  open: boolean;
  onClose: () => void;
  contactId: string;
  opportunityId: string | null;
  contactName: string | null;
  onSent?: () => void;
}) {
  const toast = useToast();
  const library = useAsync<{ items: Template[]; mergeFields: MergeField[] }>(
    () => api.get('/api/email/templates'),
    [],
  );

  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const bodyField = useRef<HTMLTextAreaElement>(null);

  const templates = library.data?.items.filter((item) => item.enabled === 1) ?? [];
  const fields = library.data?.mergeFields ?? [];

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setSubject(template.subject);
    setBody(template.body);
  }

  /* The preview is a round trip, so it waits until typing stops. */
  const refreshPreview = useCallback(async () => {
    if (!subject.trim() || !body.trim()) {
      setPreview(null);
      return;
    }
    setChecking(true);
    try {
      setPreview(await api.post<Preview>('/api/email/preview', {
        contactId, opportunityId, subject, body,
      }));
    } catch {
      setPreview(null);
    } finally {
      setChecking(false);
    }
  }, [contactId, opportunityId, subject, body]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => void refreshPreview(), 500);
    return () => window.clearTimeout(timer);
  }, [open, refreshPreview]);

  function insertField(key: string) {
    const field = bodyField.current;
    const token = `{{${key}}}`;
    if (!field) {
      setBody((current) => `${current}${token}`);
      return;
    }
    /* At the cursor, not at the end — an agent adding a name mid-sentence
       should not find it appended to the signature. */
    const start = field.selectionStart ?? body.length;
    const end = field.selectionEnd ?? start;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    window.requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function send() {
    setSending(true);
    try {
      const result = await api.post<{ sent: boolean; reason?: string; redirected?: boolean }>(
        '/api/email/send',
        { contactId, opportunityId, subject, body, templateKey: templateId || null },
      );
      if (!result.sent) {
        toast(result.reason ?? 'That did not send');
        return;
      }
      toast(result.redirected ? 'Sent to the test address' : 'Email sent');
      onSent?.();
      onClose();
      setSubject('');
      setBody('');
      setTemplateId('');
      setPreview(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not send');
    } finally {
      setSending(false);
    }
  }

  const blocked = (preview?.unknown.length ?? 0) > 0;
  const noAddress = preview !== null && !preview.to;

  return (
    <Drawer open={open} onClose={onClose} label="Write an email">
      <DrawerHead onClose={onClose}>
        <div>
          <b>Email {contactName ?? 'this lead'}</b>
          {preview?.to && <div className="muted" style={{ fontSize: 12 }}>{preview.to}</div>}
        </div>
      </DrawerHead>

      <div className="compose">
        {!library.data && <Spinner />}

        {/* Said before anything is typed, not after Send is pressed. */}
        {preview && !preview.readiness.sendingOn && (
          <div className="compose-warn">
            <Icon name="info" size={14} />
            Email sending is switched off, so this will be saved to the lead but not delivered.
          </div>
        )}
        {preview?.readiness.testMode && preview.readiness.sendingOn && (
          <div className="compose-warn test">
            <Icon name="shield" size={14} />
            Test mode: this goes to {preview.readiness.testRedirect}, not to the client.
          </div>
        )}
        {noAddress && (
          <div className="compose-warn bad">
            <Icon name="alert-triangle" size={14} />
            This lead has no email address. Add one on their page first.
          </div>
        )}

        {templates.length > 0 && (
          <Field label="Start from a template" hint="You can change every word of it.">
            <Select value={templateId} onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">Write it myself</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Subject">
          <input
            className="input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="About Emaar Beachfront"
          />
        </Field>

        <Field label="Message">
          <TextArea
            ref={bodyField}
            rows={10}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={'Hi {{first_name}},\n\n…'}
          />
        </Field>

        <div className="compose-fields">
          <small>Insert:</small>
          {fields.map((field) => (
            <button
              key={field.key}
              type="button"
              className="note-quick-btn"
              title={field.label}
              onClick={() => insertField(field.key)}
            >
              {field.key}
            </button>
          ))}
        </div>

        {blocked && (
          <div className="compose-warn bad">
            <Icon name="alert-triangle" size={14} />
            {preview?.unknown.join(', ')} {preview?.unknown.length === 1 ? 'is not a field' : 'are not fields'}.
            Fix the spelling, or the client will see it written out.
          </div>
        )}

        {(preview?.usedFallback.length ?? 0) > 0 && (
          <div className="compose-warn">
            <Icon name="info" size={14} />
            This lead has no {preview?.usedFallback.join(', ')}, so the email says
            {' '}&ldquo;there&rdquo; and &ldquo;the project&rdquo; instead. Still reads properly.
          </div>
        )}

        <div className="compose-actions">
          <Chip on={showPreview} icon="eye" onClick={() => setShowPreview((on) => !on)}>
            {showPreview ? 'Hide preview' : 'Preview'}
          </Chip>
          {checking && <small className="muted">Checking…</small>}
          <Button
            variant="primary"
            icon="send"
            loading={sending}
            disabled={!subject.trim() || !body.trim() || blocked || noAddress}
            onClick={() => void send()}
          >
            Send
          </Button>
        </div>

        {showPreview && preview && (
          <div className="compose-preview">
            <div className="compose-preview-subject">{preview.subject}</div>
            {/* The server's own HTML, in a sandboxed frame: it is rendered
                rather than described, and it cannot reach this page. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
            />
          </div>
        )}
      </div>
    </Drawer>
  );
}
