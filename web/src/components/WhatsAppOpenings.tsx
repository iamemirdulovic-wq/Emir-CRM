import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { BottomSheet } from '../design/feedback.js';
import { Icon } from '../design/index.js';
import { Spinner } from '../design/ui.js';

/**
 * Four openings, filled in for this lead.
 *
 * The alternative is what agents do now: open WhatsApp, type "Hi" and stall,
 * or paste the same block of text they pasted to the last forty people with
 * the wrong project name still in it. These are written on the server so they
 * quote the project the lead actually asked about.
 *
 * Nothing is sent from here. The link opens WhatsApp with the message ready,
 * and the agent presses send — which is the only way a message from a
 * personal number should ever go out.
 */

interface Opening {
  key: string;
  label: string;
  text: string;
  url: string;
}

export function WhatsAppOpenings({
  open, onClose, contactId, onPicked,
}: {
  open: boolean;
  onClose: () => void;
  contactId: string;
  onPicked?: () => void;
}) {
  const data = useAsync<{ phone: string; openings: Opening[] }>(
    () => api.get(`/api/email/whatsapp-openings/${contactId}`),
    [contactId],
  );

  return (
    <BottomSheet open={open} title="Open WhatsApp with…" onClose={onClose}>
      {!data.data && !data.error && <Spinner />}
      {data.error && <p className="err">{data.error}</p>}

      <div className="wa-openings">
        {data.data?.openings.map((opening) => (
          <a
            key={opening.key}
            className="wa-opening"
            href={opening.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              onPicked?.();
              onClose();
            }}
          >
            <span className="wa-opening-label">
              <Icon name="message-circle" size={14} />
              {opening.label}
            </span>
            <span className="wa-opening-text">{opening.text}</span>
          </a>
        ))}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        This opens WhatsApp with the message typed out. You still press send.
      </p>
    </BottomSheet>
  );
}
