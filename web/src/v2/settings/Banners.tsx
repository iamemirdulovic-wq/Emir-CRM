import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Home banners.
 *
 * From `design/web/home-banners.html`: the cards at the top of every agent's
 * My Day, with a preview of how they will see it.
 *
 * Five is the limit and the server enforces it, not just this screen. Six
 * banners rotating is not five plus one — it is a carousel nobody waits
 * through, and the sixth is the one nobody ever sees.
 */

interface Banner {
  id: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  imagePath: string | null;
  position: number;
  isActive: boolean;
}

const MAX = 5;

export function V2SettingsBanners() {
  const got = useAsync<{ items: Banner[] }>(() => api.get('/api/v2/banners'), []);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '', linkUrl: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setDraft({
      title: editing?.title ?? '',
      body: editing?.body ?? '',
      linkUrl: editing?.linkUrl ?? '',
    });
    setConfirming(false);
  }, [editing]);

  if (got.error) {
    return <SettingsShell page="p-banners"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data) {
    return <SettingsShell page="p-banners"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const banners = got.data.items;
  const showing = banners.filter((one) => one.isActive).length;

  async function save() {
    if (draft.title.trim().length < 2) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = {
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        linkUrl: draft.linkUrl.trim() || null,
      };
      if (editing) await api.patch(`/api/v2/banners/${editing.id}`, body);
      else await api.post('/api/v2/banners', body);
      toast(editing ? 'Banner saved' : 'Banner added');
      setEditing(null);
      setDraft({ title: '', body: '', linkUrl: '' });
      got.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(one: Banner) {
    try {
      await api.patch(`/api/v2/banners/${one.id}`, { isActive: !one.isActive });
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    }
  }

  async function remove(one: Banner) {
    if (!confirming) { setConfirming(true); return; }
    try {
      await api.del(`/api/v2/banners/${one.id}`);
      toast('Banner removed');
      setEditing(null);
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not delete.');
    }
  }

  async function move(one: Banner, by: number) {
    const order = banners.map((b) => b.id);
    const at = order.indexOf(one.id);
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to] as string, order[at] as string];
    try {
      await api.post('/api/v2/banners/order', { ids: order });
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    }
  }

  return (
    <SettingsShell page="p-banners">
      <div className="d-set-body">
        <SettingsTitle
          title="Home banners"
          note="The cards at the top of every agent's My Day. Up to five, and they take turns."
        >
          <span className={showing >= MAX ? 'd-chip d-lg d-amber' : 'd-chip d-lg'}>
            {showing} of {MAX} showing
          </span>
        </SettingsTitle>

        <div className="d-hb">
          <div className="d-col d-gap-16">
            <section className="d-card">
              <div className="d-card-head">
                <h3>Preview</h3>
                <span className="d-small d-muted">How an agent sees it</span>
              </div>
              <div className="v2-hb-prev">
                <span className="v2-hb-lab">From the owner</span>
                <h2>{draft.title.trim() || 'Your headline here'}</h2>
                <p>{draft.body.trim() || 'And a line underneath, if you want one.'}</p>
                {draft.linkUrl.trim() && <span className="v2-hb-cta">Open</span>}
              </div>
            </section>

            <div className="d-row">
              <h3 className="d-grow">Your banners</h3>
              <span className="d-small d-muted">The order they take turns in</span>
            </div>

            <div className="d-col d-gap-8">
              {banners.length === 0 && (
                <p className="d-small d-muted">None yet. Write one on the right.</p>
              )}
              {banners.map((one, index) => (
                <div
                  className={one.isActive ? 'd-list-row v2-hb-row' : 'd-list-row v2-hb-row v2-hb-off'}
                  key={one.id}
                >
                  <span className="d-card-icon">{index + 1}</span>
                  <span className="d-grow">
                    <b className="d-bold">{one.title}</b>
                    {one.body && <div className="d-small d-muted">{one.body}</div>}
                  </span>
                  <button
                    type="button" className="d-btn d-xs d-icon" aria-label="Move up"
                    disabled={index === 0} onClick={() => void move(one, -1)}
                  >
                    <Icon name="chevron-up" />
                  </button>
                  <button
                    type="button" className="d-btn d-xs d-icon" aria-label="Move down"
                    disabled={index === banners.length - 1} onClick={() => void move(one, 1)}
                  >
                    <Icon name="chevron-down" />
                  </button>
                  <label className="d-switch">
                    <input
                      type="checkbox"
                      checked={one.isActive}
                      aria-label={`Show ${one.title}`}
                      onChange={() => void toggle(one)}
                    />
                    <span className="d-track" />
                  </label>
                  <button type="button" className="d-btn d-xs" onClick={() => setEditing(one)}>
                    Change
                  </button>
                </div>
              ))}
            </div>
          </div>

          <section className="d-card">
            <div className="d-card-head d-mb-0">
              <h3>{editing ? 'Change banner' : 'New banner'}</h3>
              {editing && (
                <button
                  type="button"
                  className="d-btn d-xs d-danger"
                  onClick={() => void remove(editing)}
                >
                  {confirming ? 'Tap again to remove' : 'Remove'}
                </button>
              )}
            </div>

            <div className="d-field">
              <label>Headline <span className="d-req">*</span></label>
              <input
                className="d-input"
                value={draft.title}
                aria-label="Headline"
                placeholder="Valia launches on Sunday"
                onChange={(e) => setDraft((was) => ({ ...was, title: e.target.value }))}
              />
            </div>

            <div className="d-field">
              <label>A line underneath</label>
              <input
                className="d-input"
                value={draft.body}
                aria-label="A line underneath"
                placeholder="Prices from AED 2.1M · ask me for the list"
                onChange={(e) => setDraft((was) => ({ ...was, body: e.target.value }))}
              />
            </div>

            <div className="d-field">
              <label>Where it goes when tapped</label>
              <input
                className="d-input"
                value={draft.linkUrl}
                aria-label="Where it goes when tapped"
                placeholder="/v2/projects"
                onChange={(e) => setDraft((was) => ({ ...was, linkUrl: e.target.value }))}
              />
              <span className="d-hint">Leave it empty and the banner is just a message.</span>
            </div>

            {problem && <ErrorNote>{problem}</ErrorNote>}

            <div className="d-row d-gap-8 d-mt-12">
              {editing && (
                <button type="button" className="d-btn d-ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              )}
              <span className="d-grow" />
              <button
                type="button"
                className="d-btn d-primary"
                disabled={busy || draft.title.trim().length < 2}
                onClick={save}
              >
                {busy ? 'Saving…' : editing ? 'Save' : 'Add the banner'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </SettingsShell>
  );
}
