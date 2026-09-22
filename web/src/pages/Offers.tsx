import { useCallback, useMemo, useState } from 'react';
import { api, qs, ApiError } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { useShellSearch } from '../components/Layout.js';
import { OfferMenu, type MenuItem } from '../components/OfferMenu.js';
import { Icon } from '../design/index.js';
import { avatarColour, initials } from '../design/stages.js';
import { Chip, Empty, ErrorNote, Input, Modal, Panel, Seg, Spinner, Toolbar, useToast } from '../design/ui.js';
import type { OfferCard, OfferFilter, OfferFolder, OfferState } from '../lib/types.js';

/** The four cover styles from the design: Dusk, Marina, Desert, Midnight. */
export const COVERS = [
  'linear-gradient(140deg,#1B3A5C 0%,#3E6E8E 45%,#C89B6A 100%)',
  'linear-gradient(140deg,#0E3B46 0%,#1C7F8C 50%,#86C9C2 100%)',
  'linear-gradient(140deg,#4A3524 0%,#A9793F 55%,#E2C089 100%)',
  'linear-gradient(140deg,#0B1B33 0%,#243B6B 55%,#6B7FC0 100%)',
];

const STATE_LABEL: Record<OfferState, string> = {
  draft: 'Draft',
  sent: 'Sent',
  opened: 'Opened',
  reading: 'Reading now',
  revoked: 'Link off',
};

const FILTERS: { value: OfferFilter; label: string; icon: 'files' | 'star' | 'eye' | 'pencil-line' | 'trash-2' }[] = [
  { value: 'all', label: 'All offers', icon: 'files' },
  { value: 'star', label: 'Starred', icon: 'star' },
  { value: 'viewed', label: 'Opened by client', icon: 'eye' },
  { value: 'draft', label: 'Drafts', icon: 'pencil-line' },
  { value: 'trash', label: 'Trash', icon: 'trash-2' },
];

/** "4m 12s" — how the design writes reading time. */
function readingTime(seconds: number): string {
  const whole = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return mins ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

/** The line under the offer's name: the most recent thing that happened to it. */
function whenLine(offer: OfferCard): string {
  if (offer.deleted_at) return `In the trash · deleted ${ago(offer.deleted_at)}`;
  if (offer.state === 'draft') return 'Draft · not sent';
  if (offer.state === 'reading') return 'Viewing right now';
  if (offer.last_view_at) return `Opened ${ago(offer.last_view_at)}`;
  if (offer.sent_at) return `Sent ${ago(offer.sent_at)}`;
  return `Updated ${ago(offer.updated_at)}`;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * Sales offers — the library.
 *
 * A Drive, deliberately: agents already think in folders, and an offer is a
 * document they will go back to. What is on screen is only ever what this
 * person is allowed to see — the server decides that, not this file.
 */
export function Offers() {
  const { user } = useAuth();
  const toast = useToast();
  const shellSearch = useShellSearch();
  const search = useDebounced(shellSearch.value);

  const [filter, setFilter] = useState<OfferFilter>('all');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [menu, setMenu] = useState<{ offer: OfferCard; anchor: DOMRect } | null>(null);
  const [renaming, setRenaming] = useState<OfferCard | null>(null);
  const [moving, setMoving] = useState<OfferCard | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);

  const canPurge = user?.role === 'owner' || user?.role === 'admin';

  const offers = useAsync<{ items: OfferCard[] }>(
    () => api.get(`/api/offers${qs({ filter, folder: folderId, search })}`),
    [filter, folderId, search],
  );
  const folders = useAsync<{ items: OfferFolder[] }>(() => api.get('/api/offers/folders'), []);

  const reload = useCallback(() => { offers.reload(); folders.reload(); }, [offers, folders]);

  const openFolder = folders.data?.items.find((row) => row.id === folderId) ?? null;

  /* Folders show at the top level only, the way the design has it: inside a
     folder you are looking at its offers, not at more folders. */
  const visibleFolders = useMemo(() => {
    if (filter !== 'all') return [];
    const all = folders.data?.items ?? [];
    const here = all.filter((row) => (row.parent_id ?? null) === folderId);
    if (!search.trim()) return here;
    const needle = search.trim().toLowerCase();
    return here.filter((row) => row.name.toLowerCase().includes(needle));
  }, [folders.data, folderId, filter, search]);

  /** Every action in the row menu, in one place so failures read the same. */
  const act = useCallback(async (id: string, run: () => Promise<unknown>, said: string) => {
    setBusy(true);
    try {
      await run();
      toast(said);
      reload();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }, [toast, reload]);

  async function onPick(action: string, offer: OfferCard) {
    switch (action) {
      case 'copy': {
        // The link is the secret, so copying it is worth saying out loud.
        const url = `${window.location.origin}/offer/${offer.slug}`;
        try {
          await navigator.clipboard.writeText(url);
          toast('Private link copied — anyone with it can open the offer');
        } catch {
          toast(url);
        }
        return;
      }
      case 'star':
        return act(offer.id, () => api.patch(`/api/offers/${offer.id}`, { starred: !offer.starred }),
          offer.starred ? 'Star removed' : 'Starred');
      case 'duplicate':
        return act(offer.id, () => api.post(`/api/offers/${offer.id}/duplicate`), 'Duplicated as a new draft');
      case 'rename':
        setDraftName(offer.title);
        setRenaming(offer);
        return;
      case 'move':
        setMoving(offer);
        return;
      case 'trash':
        return act(offer.id, () => api.del(`/api/offers/${offer.id}`), 'Moved to the trash');
      case 'restore':
        return act(offer.id, () => api.post(`/api/offers/${offer.id}/restore`), 'Restored');
      case 'purge':
        if (!window.confirm(`Delete "${offer.title}" for good? This cannot be undone.`)) return;
        return act(offer.id, () => api.del(`/api/offers/${offer.id}/forever`), 'Deleted for good');
      default:
        // open, preview, whatsapp and pdf arrive with the builder and the
        // client page. Saying so beats a button that silently does nothing.
        toast('That opens once the offer builder is built');
    }
  }

  const menuItems = useCallback((offer: OfferCard): MenuItem[] => (
    offer.deleted_at
      ? [
        { kind: 'item', id: 'restore', label: 'Restore', icon: 'undo-2' },
        ...(canPurge
          ? [{ kind: 'item', id: 'purge', label: 'Delete forever', icon: 'trash-2', danger: true } as MenuItem]
          : []),
      ]
      : [
        { kind: 'item', id: 'open', label: 'Open offer', icon: 'external-link' },
        { kind: 'item', id: 'preview', label: 'Preview as client', icon: 'eye' },
        { kind: 'item', id: 'copy', label: 'Copy private link', icon: 'link' },
        { kind: 'item', id: 'whatsapp', label: 'Send on WhatsApp', icon: 'message-circle' },
        { kind: 'item', id: 'pdf', label: 'Download PDF', icon: 'download' },
        { kind: 'rule' },
        { kind: 'item', id: 'star', label: offer.starred ? 'Remove star' : 'Add star', icon: 'star' },
        { kind: 'item', id: 'duplicate', label: 'Duplicate', icon: 'copy-plus' },
        { kind: 'item', id: 'rename', label: 'Rename', icon: 'pencil' },
        { kind: 'item', id: 'move', label: 'Move to folder', icon: 'folder-input' },
        { kind: 'rule' },
        { kind: 'item', id: 'trash', label: 'Move to trash', icon: 'trash-2', danger: true },
      ]
  ), [canPurge]);

  const list = offers.data?.items ?? [];

  return (
    <>
      <div className="sof-bar rise" style={{ ['--i' as string]: 0 }}>
        <nav className="crumb" aria-label="Where you are">
          {openFolder
            ? (
              <>
                <button type="button" onClick={() => setFolderId(null)}>Sales offers</button>
                <Icon name="chevron-right" />
                <b>{openFolder.name}</b>
              </>
            )
            : <b>Sales offers</b>}
        </nav>
        <div className="right">
          <Seg
            value={view}
            options={[{ value: 'grid' as const, label: 'Grid' }, { value: 'list' as const, label: 'List' }]}
            onChange={setView}
          />
          <button type="button" className="btn" onClick={() => { setDraftName(''); setNewFolder(true); }}>
            <Icon name="folder-plus" /><span>New folder</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => act('new', () => api.post('/api/offers', { folderId }), 'Draft offer created')}
          >
            <Icon name="plus" /><span>New offer</span>
          </button>
        </div>
      </div>

      <Toolbar>
        {FILTERS.map((entry) => (
          <Chip
            key={entry.value}
            on={filter === entry.value}
            icon={entry.icon}
            onClick={() => { setFilter(entry.value); setFolderId(null); }}
          >
            {entry.label}
          </Chip>
        ))}
      </Toolbar>

      {offers.error && <ErrorNote>{offers.error}</ErrorNote>}
      {offers.loading && !offers.data ? <Spinner label="Loading your offers…" /> : null}

      {!offers.loading && !list.length && !visibleFolders.length ? (
        <Empty
          icon={filter === 'trash' ? 'trash-2' : 'sparkles'}
          title={filter === 'trash' ? 'The trash is empty' : 'Nothing here yet'}
          hint={filter === 'trash'
            ? `Deleted offers stay here for 30 days, then go for good.`
            : 'Press New offer to build one from a lead and a project.'}
        />
      ) : (
        <div className={view === 'list' ? 'drive list rise' : 'drive rise'} style={{ ['--i' as string]: 2 }}>
          {visibleFolders.map((folder, index) => (
            <button
              key={folder.id}
              type="button"
              className="folder"
              style={{ animationDelay: `${index * 40}ms` }}
              onClick={() => { setFolderId(folder.id); setFilter('all'); }}
            >
              <span className="fi"><Icon name={folder.is_shared ? 'layout-template' : 'folder'} /></span>
              <div>
                <b>{folder.name}</b>
                {/* Starts with a digit, so inside an Arabic page the browser
                    would reorder it to "offers 0". dir="auto" takes the
                    direction from the first real letter instead. */}
                <small dir="auto">
                  {Number(folder.offer_count) === 1 ? '1 offer' : `${Number(folder.offer_count)} offers`}
                  {folder.is_shared ? ' · shared' : ''}
                </small>
              </div>
            </button>
          ))}

          {list.map((offer, index) => (
            <article
              key={offer.id}
              className="ocard"
              style={{ animationDelay: `${(visibleFolders.length + index) * 40}ms` }}
            >
              <button
                type="button"
                className="kebab"
                aria-label={`More for ${offer.title}`}
                onClick={(event) => setMenu({ offer, anchor: event.currentTarget.getBoundingClientRect() })}
              >
                <Icon name="more-horizontal" />
              </button>
              <div className="ocover" style={{ background: COVERS[offer.cover_style % COVERS.length] }}>
                <span className="tag">
                  {offer.starred ? '★ ' : ''}{offer.client_name ?? 'No client yet'}
                </span>
              </div>
              <div className="body">
                <b>{offer.title}</b>
                <small>{whenLine(offer)}</small>
                <div className="meta">
                  {/* Shown in the list view, where the cover is too small for
                      the client's name to ride on it. */}
                  <span className="who">
                    {offer.starred ? <Icon name="star" style={{ width: 12, height: 12, verticalAlign: -2 }} /> : null}
                    {offer.client_name ?? 'No client yet'}
                  </span>
                  <span className={`st ${offer.state}`}>{STATE_LABEL[offer.state]}</span>
                  {Number(offer.opens) > 0 && (
                    <span dir="auto">
                      <Icon name="eye" style={{ width: 12, height: 12, verticalAlign: -2 }} />
                      {' '}{Number(offer.opens)}× · {readingTime(offer.total_secs)}
                    </span>
                  )}
                  <span
                    className="avatar"
                    title={offer.agent_name ?? ''}
                    style={{ background: avatarColour(offer.agent_user_id) }}
                  >
                    {initials(offer.agent_name)}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {menu && (
        <OfferMenu
          anchor={menu.anchor}
          items={menuItems(menu.offer)}
          onPick={(action) => { void onPick(action, menu.offer); }}
          onClose={() => setMenu(null)}
        />
      )}

      <Modal
        open={newFolder}
        onClose={() => setNewFolder(false)}
        title="New folder"
        icon="folder-plus"
        footer={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !draftName.trim()}
            onClick={() => {
              const name = draftName.trim();
              setNewFolder(false);
              void act('folder', () => api.post('/api/offers/folders', { name, parentId: folderId }), 'Folder created');
            }}
          >
            Create
          </button>
        }
      >
        <label className="field">
          <span>Name it after the community, the client type, anything.</span>
          <Input
            autoFocus
            value={draftName}
            placeholder="Saadiyat Island"
            onChange={(event) => setDraftName(event.target.value)}
          />
        </label>
      </Modal>

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename offer"
        icon="pencil"
        footer={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !draftName.trim()}
            onClick={() => {
              const offer = renaming;
              const title = draftName.trim();
              setRenaming(null);
              if (offer) void act(offer.id, () => api.patch(`/api/offers/${offer.id}`, { title }), 'Renamed');
            }}
          >
            Save
          </button>
        }
      >
        <label className="field">
          <span>Only your team sees this name — the client never does.</span>
          <Input autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} />
        </label>
      </Modal>

      <Modal
        open={moving !== null}
        onClose={() => setMoving(null)}
        title="Move to folder"
        icon="folder-input"
      >
        <Panel>
          <button
            type="button"
            className="folder"
            style={{ marginBottom: 8 }}
            onClick={() => {
              const offer = moving;
              setMoving(null);
              if (offer) void act(offer.id, () => api.patch(`/api/offers/${offer.id}`, { folderId: null }), 'Moved to the top level');
            }}
          >
            <span className="fi"><Icon name="arrow-up" /></span>
            <div><b>Top level</b><small>Out of every folder</small></div>
          </button>
          {(folders.data?.items ?? []).map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="folder"
              style={{ marginBottom: 8 }}
              onClick={() => {
                const offer = moving;
                setMoving(null);
                if (offer) void act(offer.id, () => api.patch(`/api/offers/${offer.id}`, { folderId: folder.id }), `Moved to ${folder.name}`);
              }}
            >
              <span className="fi"><Icon name={folder.is_shared ? 'layout-template' : 'folder'} /></span>
              <div>
                <b>{folder.name}</b>
                <small dir="auto">{Number(folder.offer_count) === 1 ? '1 offer' : `${Number(folder.offer_count)} offers`}</small>
              </div>
            </button>
          ))}
        </Panel>
      </Modal>
    </>
  );
}
