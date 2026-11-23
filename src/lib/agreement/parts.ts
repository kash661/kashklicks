// The 7 parts of the agreement page and the sections each one holds (section numbers of clauses.json).
// No data imports: the page script imports this file too. A unit test proves every section is in exactly one part.
export const PARTS = [
  { n: 1, title: 'Your day', sections: [0, 1, 5, 6, 7, 10] },
  { n: 2, title: 'What you get', sections: [2, 8, 9, 12] },
  { n: 3, title: 'Price and payments', sections: [3] },
  { n: 4, title: 'Extras you can add', sections: [4] },
  { n: 5, title: 'Your photos and sharing', sections: [13, 14, 15] },
  { n: 6, title: 'If plans change', sections: [11, 16, 17, 18, 19, 20] },
  { n: 7, title: 'The legal basics', sections: [21, 22] },
] as const;
