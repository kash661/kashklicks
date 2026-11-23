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
  // Optional since 2026-11-23 (spec section 6): missing, null or a blank string means no phone.
  client_phone?: string | null;
  event_date: string;
  // Both or neither (spec section 6): missing, null or blank means the times are still to be set.
  start_time?: string | null;
  end_time?: string | null;
  place: string;
  price?: number;
  retainer?: number;
  balance_cash?: boolean;
  add_ons?: { id: string; qty: number }[];
  notes?: string;
}
export interface BookingFacts
  extends Required<Omit<BookingInput, 'price' | 'retainer' | 'add_ons' | 'notes' | 'client_phone' | 'start_time' | 'end_time'>> {
  // Left out of a booking made without them (spec section 6, 2026-11-23); every booking made before has
  // all three. start_time and end_time ('HH:MM') are both present or both missing (timesOf in render.ts).
  // Read them through phoneOf and timesOf in render.ts.
  client_phone?: string;
  start_time?: string;
  end_time?: string;
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
  // Frozen from business.json when the booking is made (2026-11-23 on): the usual retainer in percent of
  // the total, and the address the retainer is sent to. Missing on every booking made before: those read
  // as 50 and info@kashklicks.ca (retainerPercentOf and etransferEmailOf in render.ts).
  retainer_percent?: number;
  etransfer_email?: string;
  // Only on wedding bookings made before 2026-11-23, which were paid in three parts. Missing on every
  // other booking, and on every booking made since (two payments: the retainer and the balance).
  second_payment?: number;
  final_payment?: number;
  second_due?: string; // 'YYYY-MM-DD'
  final_due?: string; // 'YYYY-MM-DD'
  // Only on bookings of a package with a second photographer: the hours they join for.
  second_hours?: number;
  // Only on bookings of a package with a fee for private work, frozen with the booking. Not in the total.
  private_fee?: number;
  // The fee that is inside this total. Only on facts made by factsFor() for the private choice.
  sharing_fee?: number;
  // Only on bookings of a package with tick boxes: what can still be ticked at signing, frozen with the
  // booking. A tick box whose add-on was already booked when the link was made is not in this list.
  tick_boxes?: TickBox[];
  // Only on facts made by factsFor() with ticked extras: the ticked ids, in tick box order.
  extras?: string[];
  // Only on facts made by factsFor() with a ticked deposit. Never in the total.
  deposits?: { id: string; label: string; amount: number; note: string }[];
}
/** One tick box of a booking. amount: the unit price of a priced one (qty 1), or the deposit. */
export interface TickBox {
  id: string;
  kind: 'price' | 'deposit';
  label: string;
  amount: number;
  deposit_label?: string;
  deposit_note?: string;
}
/** The amounts of one mix, ready to show. Stored with the booking (and the signed record). */
export interface StoredSummary {
  package: string;
  date: string;
  total: string;
  retainer: string;
  balance: string;
  // How the balance is paid: 'in cash' or 'e-transfer or cash'. Missing on summaries stored before it existed.
  balance_how?: string;
  etransfer_email: string;
  // A booking paid in three parts (a wedding made before 2026-11-23): the second and the final payment,
  // ready to show. Missing on every other booking. When present, the page shows these instead of the balance.
  later_payments?: { label: string; text: string }[];
  // The fields below are present only on bookings that have page content (src/data/agreement/page.json).
  total_line?: string; // "Your total is $3,010.00. It stays the same ..."
  price_lines?: { label: string; amount: string }[]; // itemised, adds up to the total
  steps?: { title: string; amount: string; note: string }[]; // the payments as steps
  deposit?: { label: string; amount: string; note: string }; // a refundable deposit, outside the total
  extra_labels?: string[]; // labels of the ticked extras, for the recap (the name `extras` always means ids)
}
/** The words the new agreement page shows around the legal text, frozen with the booking (src/lib/agreement/page.ts makes it). */
export interface PageContent {
  v: 1;
  title: string; // the h1
  lede: string[]; // the lines under the h1
  glance: { label: string; value: string }[]; // the page adds the Total cell from the mix
  note: string; // "The main points help you read. The full wording is what we both agree to."
  parts: { n: number; title: string; sections: number[]; points: string[] }[]; // always the 7 parts
  extras: {
    intro: string;
    booked_title: string;
    booked: string[];
    // Exactly the entries of facts.tick_boxes, in that order: the page builds mix ids from it.
    ticks: { id: string; kind: 'price' | 'deposit'; label: string; price: string; blurb: string }[];
    more_title: string;
    more: string[];
  };
  sharing: { legend: string; points: string[] };
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
