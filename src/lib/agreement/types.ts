export type TagGroup = string[]; // every tag in a group must be active
export interface SourceClause {
  type: 'clause';
  id: string;
  tags: TagGroup[];
  text: string;
  bullets: string[];
}
export interface SourceBlock {
  type: 'block';
  name: 'TABLE:BOOKING' | 'LIST:DELIVERABLES' | 'TABLE:ADDONS';
}
export interface SourceSection {
  num: number;
  title: string;
  items: (SourceClause | SourceBlock)[];
}
export interface ClauseFile {
  version: string;
  title: string;
  intro: string;
  sections: SourceSection[];
}

export type Choice = 'share' | 'private';
export interface BookingInput {
  package_id: string;
  client_name: string;
  partner_name: string;
  client_email: string;
  client_phone: string;
  event_date: string;
  start_time: string;
  end_time: string;
  place: string;
  price?: number;
  retainer?: number;
  balance_cash?: boolean;
  add_ons?: { id: string; qty: number }[];
  notes?: string;
}
export interface BookingFacts extends Required<Omit<BookingInput, 'price' | 'retainer' | 'add_ons' | 'notes'>> {
  number: string;
  created_at: string;
  package_name: string;
  package_price: number;
  add_ons: { id: string; label: string; qty: number; unit_price: number; line_total: number }[];
  total: number;
  retainer: number;
  balance: number;
  hours: number;
  delivery_date: string;
  notes: string;
}
export type DocItem =
  | { type: 'clause'; n: string; text: string; bullets: string[] } // n is '' in section 0
  | { type: 'table'; kind: 'booking' | 'addons'; rows: string[][]; bold: string[] }
  | { type: 'list'; items: string[] };
export interface AgreementDoc {
  title: string;
  intro: string;
  clause_version: string;
  choice: Choice;
  number: string;
  sections: { num: number; title: string; items: DocItem[] }[];
  business_signature: string;
}
