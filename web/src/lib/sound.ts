/**
 * The three sounds the CRM makes.
 *
 * Synthesised rather than loaded from files. Three reasons, in order: nothing
 * to download on a phone in a lift, no licence to get wrong, and a tone we can
 * tune by changing a number instead of finding another recording. They are
 * short, soft, and none of them is a notification sound anyone else's app
 * already uses.
 *
 * Browsers refuse to make noise before a person has interacted with the page,
 * which is the right rule — so the audio context is created on the first real
 * click or key press and the first lead alert before that is silent. The card
 * on screen is doing the work anyway; the sound is the reminder for an agent
 * looking somewhere else.
 */

export type SoundName = 'new-lead' | 'won' | 'notify';

const STORAGE_KEY = 'emir.sound';

let context: AudioContext | null = null;
let armed = false;

type AudioContextCtor = typeof AudioContext;

function contextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Call once at start-up. It only listens; the context is built on the first
 * gesture, because building it earlier gets it created in a suspended state
 * that Safari in particular will not resume.
 */
export function armSound(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;

  const wake = () => {
    const Ctor = contextCtor();
    if (!Ctor) return;
    try {
      context ??= new Ctor();
      void context.resume();
    } catch {
      /* No audio on this device. Everything else still works. */
    }
  };

  for (const event of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(event, wake, { once: true, passive: true });
  }
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    /* Private window, or storage blocked. Sound on is the better default. */
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* Nothing to do; the setting simply will not survive a reload. */
  }
}

/**
 * One soft note. A sine with a slow attack and a long tail — a square wave or
 * a hard attack is what makes a notification sound cheap.
 */
function note(at: number, hz: number, length: number, peak: number, kind: OscillatorType = 'sine'): void {
  if (!context) return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = kind;
  osc.frequency.value = hz;

  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

  osc.connect(gain).connect(context.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

export function play(name: SoundName): void {
  if (!context || context.state !== 'running' || !soundEnabled()) return;
  const now = context.currentTime;

  if (name === 'new-lead') {
    /* Two notes rising — a question, not an alarm. The lead is good news. */
    note(now, 880, 0.26, 0.16);
    note(now + 0.1, 1318.5, 0.42, 0.13);
    return;
  }

  if (name === 'won') {
    /*
     * A gong: a low fundamental that rings on, with two quieter partials
     * above it slightly detuned, which is what stops it sounding like a
     * synthesiser beep.
     */
    note(now, 196, 1.9, 0.2);
    note(now + 0.02, 392.6, 1.5, 0.1);
    note(now + 0.04, 587.3, 1.1, 0.05);
    note(now + 0.26, 783.9, 0.9, 0.04);
    return;
  }

  /* A pop: one short note, quiet enough to sit under a conversation. */
  note(now, 660, 0.1, 0.08, 'triangle');
}
