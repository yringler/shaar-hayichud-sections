/**
 * Search glossary: key terms of the text, each with its Hebrew spellings and
 * Latin transliterations. Search treats every form of an entry as the same
 * word, so `chochmah`, `chokhmah` and `חכמת` all find `חכמה`, and `מידות`
 * finds `מדות`. The first Hebrew form is the entry's canonical token: the
 * indexer adds it to every record that has any form of the entry, and the
 * search page rewrites any form in the query to it (search/text.ts).
 *
 * Forms are matched as whole words after folding (foldWord: quotes and
 * gershayim dropped, Latin lowercased), and a Hebrew form's first word also
 * matches behind prefix letters (`בחכמה`, `דאצילות`). Multi-word forms match
 * as consecutive words. Keep the first Hebrew form a single word where you
 * can: a multi-word canonical token makes every search for the entry need
 * all of its words. Leave out Latin forms that are ordinary English words
 * (`or`, `din`): they would turn English searches into Hebrew ones.
 */
export interface GlossaryEntry {
  he: readonly string[];
  en: readonly string[];
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  { he: ['אין סוף', 'א"ס'], en: ['ein sof', 'ain sof', 'eyn sof', 'ein soph'] },
  { he: ['עצמות'], en: ['atzmus', 'atzmut', 'atsmus', 'atzmuth', 'atzmis'] },
  { he: ['אור'], en: ['ohr'] },
  { he: ['אורות'], en: ['oros', 'orot'] },
  { he: ['צמצום'], en: ['tzimtzum', 'tsimtsum', 'tzimtzim', 'zimzum'] },
  { he: ['קו'], en: ['kav'] },
  { he: ['רשימו'], en: ['reshimu', 'reshimo'] },
  { he: ['מקום פנוי'], en: ['makom panui', 'mokom panui'] },
  { he: ['ספירות', 'ספירה', 'ספירת'], en: ['sefiros', 'sefirot', 'sephirot', 'sefirah', 'sefira', 'sephirah', 'sfiros'] },
  { he: ['כתר'], en: ['keser', 'kesser', 'keter', 'kether'] },
  { he: ['חכמה', 'חכמת', 'חכמות'], en: ['chochmah', 'chochma', 'chachmah', 'chokhmah', 'chokmah', 'hochmah', 'hokhmah'] },
  { he: ['בינה', 'בינת'], en: ['binah', 'bina'] },
  { he: ['דעת'], en: ['daas', 'daat', 'daath'] },
  { he: ['חב"ד'], en: ['chabad'] },
  { he: ['חסד', 'חסדים'], en: ['chesed', 'chessed', 'hesed', 'chasadim'] },
  { he: ['גבורה', 'גבורות'], en: ['gevurah', 'gevura', 'gevuros', 'gevurot'] },
  { he: ['תפארת'], en: ['tiferes', 'tiferet', 'tifereth', 'tifferes'] },
  { he: ['נצח'], en: ['netzach', 'netsach'] },
  { he: ['הוד'], en: ['hod'] },
  { he: ['יסוד'], en: ['yesod'] },
  { he: ['מלכות'], en: ['malchus', 'malchut', 'malchuth', 'malkhut', 'malkus'] },
  { he: ['נה"י'], en: ['nehi'] },
  { he: ['מדות', 'מידות', 'מדה', 'מידה', 'מידת', 'מדת'], en: ['midos', 'middos', 'midot', 'middot', 'midah', 'middah'] },
  { he: ['מוחין', 'מוחים'], en: ['mochin', 'mochim'] },
  { he: ['אצילות'], en: ['atzilus', 'atzilut', 'atsilut', 'atziluth'] },
  { he: ['בריאה'], en: ['beriah', 'beria', 'briah', 'bria'] },
  { he: ['יצירה'], en: ['yetzirah', 'yetzira', 'yetsirah'] },
  { he: ['עשיה', 'עשייה'], en: ['asiyah', 'asiya', 'assiah', 'asiah'] },
  { he: ['אבי"ע', "אבי''ע"], en: ['abya', 'abiya', 'abiyah'] },
  { he: ['אדם קדמון', 'א"ק'], en: ['adam kadmon'] },
  { he: ['עתיק', 'עתיק יומין'], en: ['atik', 'atik yomin', 'attik'] },
  { he: ['אריך', 'אריך אנפין', 'א"א'], en: ['arich', 'arich anpin', 'arikh anpin'] },
  { he: ['ז"א', 'זעיר אנפין'], en: ['zeir anpin', 'zeer anpin'] },
  { he: ['נוקבא'], en: ['nukva', 'nukvah'] },
  { he: ['אבא'], en: ['abba'] },
  { he: ['אימא', 'אמא'], en: ['imma', 'ima'] },
  { he: ['פרצוף', 'פרצופים'], en: ['partzuf', 'partzufim', 'parsuf', 'partsuf', 'partsufim'] },
  { he: ['כלים', 'כלי'], en: ['keilim', 'kelim', 'kli', 'keli'] },
  { he: ['עיגולים', 'עיגול', 'עגולים'], en: ['igulim', 'iggulim', 'igul'] },
  { he: ['יושר'], en: ['yosher'] },
  { he: ['מקיף', 'מקיפים'], en: ['makif', 'makifim', 'mekif'] },
  { he: ['פנימי'], en: ['pnimi', 'penimi'] },
  { he: ['פנימיות'], en: ['pnimiyus', 'penimiyus', 'pnimiyut', 'penimiyut', 'pnimius'] },
  { he: ['חיצוניות'], en: ['chitzoniyus', 'chitzoniyut', 'chitzonius'] },
  { he: ['ממוצע'], en: ['memutza', 'mamutza', 'memutzah', 'memutsa'] },
  { he: ['ממלא'], en: ['memale', 'mimale', 'memaleh', 'memale kol almin'] },
  { he: ['סובב'], en: ['sovev', 'sovev kol almin'] },
  { he: ['השתלשלות'], en: ['hishtalshelus', 'hishtalshelut', 'histalshelus', 'hishtalshlus'] },
  { he: ['התבוננות'], en: ['hisbonenus', 'hitbonenut', 'hisbonnenus', 'hisbonnenut'] },
  { he: ['התלבשות'], en: ['hislabshus', 'hitlabshut'] },
  { he: ['התכללות'], en: ['hiskalelus', 'hitkalelut'] },
  { he: ['התפשטות'], en: ['hispashtus', 'hitpashtut'] },
  { he: ['יחוד', 'יחודא', 'ייחוד'], en: ['yichud', 'yihud'] },
  { he: ['שער היחוד'], en: ['shaar hayichud', 'shaar ha yichud'] },
  { he: ['ביטול', 'בטול'], en: ['bittul', 'bitul'] },
  { he: ['רצון'], en: ['ratzon', 'rotzon', 'ratson'] },
  { he: ['תענוג', 'עונג'], en: ['taanug', 'tanug', 'oneg'] },
  { he: ['גילוי', 'גלוי'], en: ['giluy', 'gilui'] },
  { he: ['העלם'], en: ['helem', 'heelem'] },
  { he: ['אלקות', 'אלוקות', 'אלהות'], en: ['elokus', 'elokut', 'elokis'] },
  { he: ['תוהו', 'תהו'], en: ['tohu'] },
  { he: ['תיקון', 'תקון'], en: ['tikun', 'tikkun'] },
  { he: ['שבירה', 'שבירת הכלים'], en: ['shevirah', 'shviras hakeilim', 'sheviras hakeilim', 'shevirat hakelim'] },
  { he: ['קליפה', 'קליפות'], en: ['kelipah', 'klipah', 'kelipa', 'kelipos', 'klipos', 'kelipot', 'klipot'] },
  { he: ['נפש'], en: ['nefesh'] },
  { he: ['נשמה'], en: ['neshamah', 'neshama'] },
  { he: ['חשמל'], en: ['chashmal'] },
  { he: ['קבלה'], en: ['kabbalah', 'kabala', 'kabbala', 'kabalah', 'qabbalah'] },
  { he: ['חסידות'], en: ['chassidus', 'chasidus', 'chassidut', 'chasidut', 'hasidut'] },
  { he: ['עולם', 'עולמות'], en: ['olam', 'olamos', 'olamot'] },
  { he: ['השגה'], en: ['hasagah', 'hasaga'] },
  { he: ['משל'], en: ['mashal', 'moshol'] },
  { he: ['נמשל'], en: ['nimshal'] },
  { he: ['עצם'], en: ['etzem'] },
  { he: ['מחשבה', 'מחשבת'], en: ['machshavah', 'machshava'] },
  { he: ['דיבור', 'דבור'], en: ['dibur', 'dibbur'] },
  { he: ['אותיות'], en: ['osiyos', 'otiyot', 'osios'] },
  { he: ['היולי'], en: ['hiyuli', 'hyuli'] },
  { he: ['נקודה'], en: ['nekudah', 'nekuda'] },
  { he: ['תבונה'], en: ['tevunah', 'tvunah', 'tevuna'] },
  { he: ['גבול'], en: ['gevul', 'bli gvul', 'bli gevul'] },
  { he: ['דוקא', 'דווקא'], en: ['davka', 'dafka'] },
  { he: ['ענין', 'עניין'], en: ['inyan', 'inyon'] },
  { he: ['בחינת', 'בחינה'], en: ['bechinah', 'bchinah', 'bechina', 'bechinas'] },
  { he: ['כח', 'כוח'], en: ['koach', 'koiach'] },
];
