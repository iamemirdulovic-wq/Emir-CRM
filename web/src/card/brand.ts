/**
 * The homes.me card brand: colours, templates and the logo artwork.
 *
 * Every value here is from the brand sheet and none of it is a judgement
 * call — which is the point of keeping it in one file. A card that invents a
 * colour is a card that has to be reprinted.
 */

export const INK = {
  orange: '#FF4000',
  night: '#1A1A1A',
  warmWhite: '#FBF7F3',
  white: '#FFFFFF',
  warmGrey: '#6B605A',
} as const;

/** The tagline, on by default and switchable off. */
export const TAGLINE = 'Find a home that makes you smile.';

export type TemplateId = 'signature' | 'reverse' | 'light';

/** One side's palette. Both sides of all three templates are built from these. */
export interface Face {
  background: string;
  /** The logo artwork to use on this background. */
  logo: 'colour' | 'onOrange' | 'onDark';
  /** The big icon behind everything, already mixed down to a solid colour.
   *  Solid rather than transparent because some printers flatten transparency
   *  badly, and a watermark that prints as a grey box ruins the card. */
  watermark: string;
  tagline: string;
  /** Back only. */
  firstName: string;
  lastName: string;
  titleLine: string;
  contactText: string;
  icons: string;
}

export interface Template {
  id: TemplateId;
  name: string;
  blurb: string;
  recommended?: boolean;
  /** Three dots under the design card, in the order they read best. */
  dots: [string, string, string];
  front: Face;
  back: Face;
}

/* The pre-mixed watermarks. Each is the background with the overlay already
   blended in, at the opacity the brand sheet asks for. */
const WATERMARK_ON_ORANGE = '#EE3D02'; // #FF4000 + 7% #1A1A1A
const WATERMARK_ON_NIGHT = '#262626'; // #1A1A1A + 4.5% white
const WATERMARK_ON_WARM = '#FBEAE1'; // #FBF7F3 + 6% orange

const ORANGE_FACE: Face = {
  background: INK.orange,
  logo: 'onOrange',
  watermark: WATERMARK_ON_ORANGE,
  tagline: INK.white,
  firstName: INK.night,
  lastName: INK.white,
  titleLine: '#FFD9C9',
  contactText: INK.white,
  icons: INK.night,
};

const NIGHT_FACE: Face = {
  background: INK.night,
  logo: 'onDark',
  watermark: WATERMARK_ON_NIGHT,
  tagline: '#FFB08F',
  firstName: INK.orange,
  lastName: INK.white,
  titleLine: '#9C918A',
  contactText: '#EDE6E1',
  icons: INK.orange,
};

const LIGHT_FACE: Face = {
  background: INK.warmWhite,
  logo: 'colour',
  watermark: WATERMARK_ON_WARM,
  tagline: INK.warmGrey,
  firstName: INK.orange,
  lastName: INK.night,
  titleLine: INK.warmGrey,
  contactText: INK.night,
  icons: INK.orange,
};

export const TEMPLATES: Record<TemplateId, Template> = {
  signature: {
    id: 'signature',
    name: 'Signature',
    blurb: 'Orange front, black back. Bold and instantly homes.me.',
    recommended: true,
    dots: [INK.orange, INK.night, INK.white],
    front: ORANGE_FACE,
    back: NIGHT_FACE,
  },
  reverse: {
    id: 'reverse',
    name: 'Reverse',
    blurb: 'Black front, orange back. Confident and modern.',
    dots: [INK.night, INK.orange, INK.white],
    front: NIGHT_FACE,
    back: ORANGE_FACE,
  },
  light: {
    id: 'light',
    name: 'Light',
    blurb: 'Warm white front, black back. Calm and premium.',
    dots: [INK.warmWhite, INK.orange, INK.night],
    front: LIGHT_FACE,
    back: NIGHT_FACE,
  },
};

export const TEMPLATE_ORDER: TemplateId[] = ['signature', 'reverse', 'light'];
