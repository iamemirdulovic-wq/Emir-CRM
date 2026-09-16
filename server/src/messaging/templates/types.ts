export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type TemplateStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

export type HeaderComponent = {
  type: 'HEADER';
  format: HeaderFormat;
  text?: string;
  example?: { header_text?: string[]; header_handle?: string[] };
};

export type BodyComponent = {
  type: 'BODY';
  text: string;
  example?: { body_text?: string[][] };
};

export type FooterComponent = {
  type: 'FOOTER';
  text: string;
};

export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string; payload?: string }
  | { type: 'URL'; text: string; url: string; example?: string[] }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string };

export type ButtonsComponent = {
  type: 'BUTTONS';
  buttons: TemplateButton[];
};

export type TemplateComponent = HeaderComponent | BodyComponent | FooterComponent | ButtonsComponent;

export type TemplateDefinition = {
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
};
