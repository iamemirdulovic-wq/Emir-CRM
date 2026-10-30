/**
 * Recording a voice note.
 *
 * Wrapped rather than used directly because the three things that go wrong
 * with MediaRecorder all go wrong in front of a user holding a phone:
 *
 * - the microphone permission is refused, or the page is not on HTTPS, and
 *   `getUserMedia` rejects with a name rather than anything readable;
 * - the browser supports MediaRecorder but not the type you asked for, so you
 *   must ask what it can do rather than assume webm;
 * - the tracks are left running when recording stops, which leaves the
 *   recording dot lit in the tab for the rest of the day.
 */

export interface Recording {
  blob: Blob;
  /** Seconds, rounded. The server trusts this only as a display hint. */
  seconds: number;
  mimeType: string;
}

/** What this browser can actually record, best first. Safari only does mp4. */
function pickMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  if (typeof MediaRecorder === 'undefined') return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia);
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;

  private stream: MediaStream | null = null;

  private chunks: Blob[] = [];

  private startedAt = 0;

  /**
   * Asks for the microphone and starts.
   *
   * The error messages are plain because they are shown as-is: "permission
   * denied" tells an agent nothing about what to press.
   */
  async start(): Promise<void> {
    if (!canRecord()) {
      throw new Error('This browser cannot record audio. Try Chrome or Safari.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('The microphone is blocked. Allow it in your browser settings and try again.');
      }
      if (name === 'NotFoundError') throw new Error('No microphone found on this device.');
      throw new Error('Could not start recording.');
    }

    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.startedAt = Date.now();
    this.recorder.start();
  }

  /** Stops, releases the microphone, and hands back what was recorded. */
  async stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('Not recording');

    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await finished;

    const seconds = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
    const mimeType = recorder.mimeType || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    this.release();
    return { blob, seconds, mimeType };
  }

  /**
   * Throws the recording away and releases the microphone.
   *
   * Safe to call at any point, including when nothing is recording — it is
   * what an unmount calls, and an unmount does not know the state.
   */
  release(): void {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* Already stopped. */
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

/** `0:07`, `1:04`. Used by the timer while recording and on a saved note. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '0:00';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
