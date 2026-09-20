import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Empty, ErrorNote, Note, Panel, Select, Spinner, useToast } from '../design/ui.js';
import { FileDrop, fileSize } from './FileDrop.js';

type Photo = {
  id: string; filename: string | null; byte_size: number | null;
  caption: string | null; is_cover: number;
};
type Document = {
  id: string; kind: string; filename: string; content_type: string; byte_size: number;
};

const DOC_LABELS: Record<string, string> = {
  developer_offer: 'Developer sales offer',
  brochure_en: 'Brochure (English)',
  brochure_ar: 'Brochure (Arabic)',
  price_list: 'Price list',
  floor_plan_pack: 'Floor plans',
  master_plan: 'Master plan',
  payment_plan_sheet: 'Payment plan',
  rera_certificate: 'RERA / DLD certificate',
  commission_agreement: 'Commission agreement',
  spa_template: 'SPA template',
  other: 'Something else',
};

/**
 * A project's pictures and paperwork.
 *
 * Both are served back through the API rather than from a public folder, so
 * the session cookie is what decides who sees a developer's price list.
 */
export function ProjectMedia({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(0);

  const photos = useAsync<{ items: Photo[] }>(() => api.get(`/api/library/${projectId}/photos`), [projectId]);
  const documents = useAsync<{ items: Document[] }>(() => api.get(`/api/library/${projectId}/documents`), [projectId]);

  async function upload(path: string, files: File[], headers: (file: File) => Record<string, string> = () => ({})) {
    setBusy(files.length);
    let failed = 0;
    // One at a time: a single failed request must not lose the rest.
    for (const file of files) {
      try {
        const response = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), ...headers(file) },
          body: file,
        });
        if (!response.ok) throw new Error(await response.text().catch(() => ''));
      } catch {
        failed += 1;
      }
      setBusy((current) => current - 1);
    }
    if (failed) toast(`${failed} of ${files.length} did not upload`);
    else toast(files.length === 1 ? 'Added' : `${files.length} added`);
  }

  async function addPhotos(files: File[]) {
    await upload(`/api/library/${projectId}/photos`, files);
    photos.reload();
  }

  async function addDocuments(files: File[]) {
    await upload(`/api/library/${projectId}/documents`, files);
    documents.reload();
  }

  async function act(run: () => Promise<unknown>, reload: () => void, done: string) {
    try {
      await run();
      toast(done);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not do that');
    }
  }

  if (photos.error) return <ErrorNote>{photos.error}</ErrorNote>;

  const photoRows = photos.data?.items ?? [];
  const documentRows = documents.data?.items ?? [];

  return (
    <>
      <Panel index={1} icon="camera" title={`Photos${photoRows.length ? ` · ${photoRows.length}` : ''}`}>
        {canManage && (
          <FileDrop
            accept="image/jpeg,image/png,image/webp"
            icon="image-up"
            title="Add photos"
            hint="Drag them here, or tap to choose. JPEG, PNG or WebP."
            disabled={busy > 0}
            onFiles={(files) => void addPhotos(files)}
          />
        )}

        {busy > 0 && <Note>Uploading… {busy} to go.</Note>}
        {photos.loading && photoRows.length === 0 && <Spinner />}

        {!photos.loading && photoRows.length === 0 && (
          <Empty
            icon="camera"
            title="No photos yet"
            hint={canManage ? 'The first one you add becomes the cover on the project card.' : 'Nobody has added photos yet.'}
          />
        )}

        <div className="shots">
          {photoRows.map((photo) => (
            <figure className="shot" key={photo.id}>
              <img src={`/api/library/photos/${photo.id}`} alt={photo.caption ?? photo.filename ?? 'Project photo'} loading="lazy" />
              {photo.is_cover === 1 && <span className="pill ok">Cover</span>}
              {canManage && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void act(() => api.del(`/api/library/photos/${photo.id}`), photos.reload, 'Photo removed')}
                  aria-label={`Remove ${photo.filename ?? 'photo'}`}
                >
                  <Icon name="trash-2" />
                </button>
              )}
              <figcaption>
                {photo.is_cover !== 1 && canManage ? (
                  <button
                    type="button"
                    className="rowbtn"
                    style={{ color: '#fff' }}
                    onClick={() => void act(() => api.post(`/api/library/photos/${photo.id}/cover`, {}), photos.reload, 'Cover set')}
                  >
                    Make cover
                  </button>
                ) : (
                  photo.byte_size ? fileSize(photo.byte_size) : ''
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </Panel>

      <Panel index={2} icon="folder" title={`Documents${documentRows.length ? ` · ${documentRows.length}` : ''}`}>
        {canManage && (
          <FileDrop
            accept="application/pdf,image/jpeg,image/png,image/webp"
            icon="file-up"
            title="Add the developer's files"
            hint="Sales offer, brochure, price list, floor plans. PDF or a photo of the page."
            disabled={busy > 0}
            onFiles={(files) => void addDocuments(files)}
          />
        )}

        {!documents.loading && documentRows.length === 0 && (
          <Empty
            icon="folder"
            title="No documents yet"
            hint="A developer sales offer uploaded here is what a client offer attaches, instead of a generated sheet."
          />
        )}

        {documentRows.length > 0 && (
          <div className="close-list" style={{ marginTop: 10 }}>
            {documentRows.map((document) => (
              <div className="close-item" key={document.id}>
                <Icon name="file-text" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b style={{ display: 'block' }}>{document.filename}</b>
                  <small className="muted">
                    {DOC_LABELS[document.kind] ?? document.kind} · {fileSize(document.byte_size)}
                  </small>
                </div>
                <a className="rowbtn" href={`/api/library/documents/${document.id}`} target="_blank" rel="noreferrer">
                  <Icon name="external-link" size={13} />
                  <span>Open</span>
                </a>
                {canManage && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void act(() => api.del(`/api/library/documents/${document.id}`), documents.reload, 'Document removed')}
                    aria-label={`Remove ${document.filename}`}
                  >
                    <Icon name="trash-2" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
