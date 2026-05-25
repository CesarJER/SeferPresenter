// Port of transliterate_tanaj.py to TypeScript

const HEB = {
    SHEVA: '\u05B0',
    HATAF_SEGOL: '\u05B1',
    HATAF_PATAH: '\u05B2',
    HATAF_QAMATS: '\u05B3',
    HIRIQ: '\u05B4',
    TSERE: '\u05B5',
    SEGOL: '\u05B6',
    PATAH: '\u05B7',
    QAMATS: '\u05B8',
    HOLAM: '\u05B9',
    HOLAM_HASER: '\u05BA',
    QUBUTS: '\u05BB',
    DAGESH: '\u05BC',
    METEG: '\u05BD',
    MAQAF: '\u05BE',
    SHIN_DOT: '\u05C1',
    SIN_DOT: '\u05C2',
    SOF_PASUQ: '\u05C3',
    PASEQ: '\u05C0',
    QAMATS_QATAN: '\u05C7',

    ALEF: '\u05D0',
    BET: '\u05D1',
    GIMEL: '\u05D2',
    DALET: '\u05D3',
    HE: '\u05D4',
    VAV: '\u05D5',
    ZAYIN: '\u05D6',
    HET: '\u05D7',
    TET: '\u05D8',
    YOD: '\u05D9',
    FINAL_KAF: '\u05DA',
    KAF: '\u05DB',
    LAMED: '\u05DC',
    FINAL_MEM: '\u05DD',
    MEM: '\u05DE',
    FINAL_NUN: '\u05DF',
    NUN: '\u05E0',
    SAMEKH: '\u05E1',
    AYIN: '\u05E2',
    FINAL_PE: '\u05E3',
    PE: '\u05E4',
    FINAL_TSADI: '\u05E5',
    TSADI: '\u05E6',
    QOF: '\u05E7',
    RESH: '\u05E8',
    SHIN: '\u05E9',
    TAV: '\u05EA',

    TAAM_START: 0x0591,
    TAAM_END: 0x05AF
};

const ALL_VOWELS = [
    HEB.SHEVA, HEB.HATAF_SEGOL, HEB.HATAF_PATAH, HEB.HATAF_QAMATS,
    HEB.HIRIQ, HEB.TSERE, HEB.SEGOL, HEB.PATAH,
    HEB.QAMATS, HEB.HOLAM, HEB.HOLAM_HASER, HEB.QUBUTS,
    HEB.QAMATS_QATAN
];

const LONG_VOWELS = new Set([HEB.QAMATS, HEB.TSERE, HEB.HOLAM, HEB.HOLAM_HASER, HEB.QAMATS_QATAN]);
const BEGADKEFAT = new Set([HEB.BET, HEB.GIMEL, HEB.DALET, HEB.KAF, HEB.FINAL_KAF, HEB.PE, HEB.FINAL_PE, HEB.TAV]);

class Cluster {
    text: string;
    consonant: string = '';
    dagesh: boolean = false;
    vowelChar: string | null = null;
    hasTaam: boolean = false;
    hasMeteg: boolean = false;
    isShuruq: boolean = false;
    isHolamVav: boolean = false;
    isSin: boolean = false;
    isShin: boolean = false;
    isAyin: boolean = false;

    constructor(text: string) {
        this.text = text.normalize('NFD');
        this._parse();
    }

    _parse() {
        for (const char of this.text) {
            const code = char.charCodeAt(0);
            if (0x05D0 <= code && code <= 0x05EA) {
                this.consonant = char;
                this.isAyin = (char === HEB.AYIN);
            } else if (HEB.TAAM_START <= code && code <= HEB.TAAM_END) {
                this.hasTaam = true;
            } else if (char === HEB.METEG) {
                this.hasMeteg = true;
            } else if (char === HEB.DAGESH) {
                this.dagesh = true;
            } else if (char === HEB.SIN_DOT) {
                this.isSin = true;
            } else if (char === HEB.SHIN_DOT) {
                this.isShin = true;
            } else if (ALL_VOWELS.includes(char)) {
                this.vowelChar = char;
            }
        }

        if (this.consonant === HEB.VAV && this.dagesh && !this.vowelChar) {
            this.isShuruq = true;
        }
        if (this.consonant === HEB.VAV && (this.vowelChar === HEB.HOLAM || this.vowelChar === HEB.HOLAM_HASER)) {
            this.isHolamVav = true;
        }
    }
}

function parseClusters(word: string): Cluster[] {
    word = word.normalize('NFD');
    const pattern = /[\u05D0-\u05EA][\u0591-\u05BD\u05BF-\u05C7]*/g;
    const matches = word.match(pattern) || [];
    return matches.map(m => new Cluster(m));
}

const HEBREW_SINGLE_PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'כ', 'ש'];
const HEBREW_DOUBLE_PREFIXES = ['וה', 'וב', 'ול', 'ומ', 'וכ', 'וש', 'בה', 'כב', 'כש', 'לה', 'מה', 'שה'].sort((a, b) => b.length - a.length);
const HEBREW_TRIPLE_PREFIXES = ['ומה', 'וכה', 'ושה', 'ולה', 'ובה'].sort((a, b) => b.length - a.length);

const PROPER_NOUNS_RAW = [
    'אלהים', 'אברהם','אברם','יצחק','יעקב','ישראל','שרה','שרי','רבקה','רחל','לאה',
    'ראובן','שמעון','לוי','יהודה','יששכר','זבולון','דן','נפתלי','גד','אשר','יוסף','בנימין','בנימן','אפרים','מנשה',
    'משה','אהרן','מרים','יהושע','שמואל','שאול','דוד','שלמה','זבולן',
    'אליהו','אלישע','ישעיהו','ירמיהו','יחזקאל','דניאל','עזרא','נחמיה',
    'הושע','יואל','עמוס','עובדיה','יונה','מיכה','נחום','חבקוק','צפניה','חגי','זכריה','מלאכי',
    'הבל','קין','נח','לוט','ישמעאל','אליעזר','בתואל','לבן',
    'פינחס','קרח','בלעם','בלק','כלב','עמלק','מואב','אדום','מדין',
    'יהונתן','אבשלום','תמר','גלית','גולית','מרדכי','אסתר','הדסה','ושתי','ברוך',
    'גדליה','גדליהו','ירבעם','רחבעם','אחאב','איזבל','חזקיהו','יאשיהו','מנשה',
    'אמציה','עוזיה','יואש','יהואחז','יהויקים','יהויכין','צדקיהו','יהוא','עמרי',
    'מיכאל','גבריאל','רפאל','אוריאל','אלעזר','אלקנה','בצלאל','דבורה','יאיר','שמואל','יחזקאל',
    'מצרים','אשור','בבל','כנען','ארם','מואב','אדום','פלשתים','עמלק','מדין','צור','צידון',
    'יון','פרס','מדי','כוש','ירושלים','ירושלם','ציון','סיני','חורב',
    'סדם','עמרה','בארשבע','יריחו','ביתאל','חברון','ביתלחם',
    'שכם','גלגל','שלה','שילה','ירדן','הירדן',
    'אדומים','אדרעי','אפק','אשדוד','אשקלון','אשתרות','אשתאול','אילון',
    'אלתקה','אלתקון','אלתולד','ענב','ענים','ענתות','עזה','עגלון','עכור','עכסה',
    'עיבל','עיןדור','עקרבים','עקרון','ערד','ערוער','ערבה','ארנון','אשנה',
    'בעלה','בעלת','באר','בארות','בצר','בשן','ביתשאן','ביתשמש','ביתחורון',
    'בלעם','ברנע','בעשתרה',
    'גדי','גדור','גדר','גדרות','גבעון','גבע','גבתון','גולן','גליל','גלעד',
    'גריזים','גשור','גזר','גת','גשן','געש',
    'דביר','דבירה','דברת','דגון','דיבון','דימונה','דילן','דנה','דור',
    'העי','הירקון','הישימות','הכפירה','המלח','המצפה','הנגב','הערבה','הפרה','הפסגה',
    'חוקוק','חורון','חצור','חצרון','חרמון','חשבון',
    'יבוס','יבנאל','יבוק','יבלעם','יגור','ידלה','יהוד','יעזר','יערים','יפו','יפיע',
    'יזרעאל','ינוח','ינון','יקנעם','יקדם','יקתאל','ירמות',
    'ישימון','יתיר','יתלה','יתנן',
    'כבל','כנרת','כסלות','כסיל','כפירה',
    'לבאות','לבנה','לבנון','לוז','לכיש','לשם',
    'מאון','מדון','מדמנה','מגדל','מגידו','מולדה','מוצא','מופעת','מרום','מרשה',
    'מצפה','משרפות','מעלהעקרבים','מערה',
    'נמרה','נפתוח','נערתה','נעמה',
    'עוג','עפרה','עתר','עצמונה',
    'פעור','פסגה',
    'קבצאל','קדמות','קדש','קינה','קישיון','קעילה','קריתים','קריתארבע',
    'קריתבעל','קריתיערים','קריתספר','קרתן',
    'רבה','רוגל','רחוב','רמון','רמות','רקם','רפאים',
    'שומרון','שונם','שיחור','שמרון','שעלבים','שערים','שטים',
    'תבור','תלם','תמנה','תמנת','תפוח','תרצה','יביש'
];

const AMBIGUOUS_PROPER_NOUNS = new Set(['אדם', 'אשר', 'דן', 'גד', 'אל', 'הבל', 'יונה', 'מיכה', 'צור', 'שילה']);
const HOLY_ELOHE_TARGETS = new Set([
    'ישראל', 'אברהם', 'יצחק', 'יעקב', 'דוד', 'צבאות', 'ירושלים',
    'אבותינו', 'אבותיכם', 'אבותם', 'אבותיו', 'אבותיך', 'אבותי', 'אבות',
    'אבתינו', 'אבתיכם', 'אבתם', 'אבתיו', 'אבתיך', 'אבתי', 'אבת'
]);
const ALWAYS_CAPITALIZE_NEXT_HEADS = new Set(['בית', 'קרית']);
const PERSON_LINK_HEADS = new Set(['בן', 'בת', 'בני']);
const AGE_WORDS = new Set(['שנה', 'שנים', 'שנת', 'שנות']);

function normalizeHebForMatch(word: string): string {
    if (!word) return '';
    const nfc = word.normalize('NFC');
    let res = '';
    for (let i = 0; i < nfc.length; i++) {
        const c = nfc[i];
        const code = c.charCodeAt(0);
        if (0x05D0 <= code && code <= 0x05EA) res += c;
    }
    return res;
}

const PROPER_NOUNS_SET = new Set(PROPER_NOUNS_RAW.map(normalizeHebForMatch).filter(Boolean));
const HOLY_ELOHE_TARGETS_SET = new Set(Array.from(HOLY_ELOHE_TARGETS).map(normalizeHebForMatch).filter(Boolean));

function getCandidates(word: string): Array<{ base: string; prefixLen: number }> {
    const clean = normalizeHebForMatch(word);
    const candidates: Array<{ base: string; prefixLen: number }> = [];
    if (!clean) return candidates;
    candidates.push({ base: clean, prefixLen: 0 });
    if (clean.length >= 3 && HEBREW_SINGLE_PREFIXES.includes(clean[0])) {
        candidates.push({ base: clean.substring(1), prefixLen: 1 });
    }
    for (const pref of HEBREW_DOUBLE_PREFIXES) {
        if (clean.startsWith(pref) && clean.length > pref.length + 1) {
            candidates.push({ base: clean.substring(pref.length), prefixLen: pref.length });
        }
    }
    for (const pref of HEBREW_TRIPLE_PREFIXES) {
        if (clean.startsWith(pref) && clean.length > pref.length + 1) {
            candidates.push({ base: clean.substring(pref.length), prefixLen: pref.length });
        }
    }
    return candidates.sort((a, b) => b.prefixLen - a.prefixLen);
}

function isProperNameBase(base: string, parts: string[], index: number | null): boolean {
    if (!base) return false;
    if (AMBIGUOUS_PROPER_NOUNS.has(base)) return false;
    if (base === 'אלהים') {
        if (parts && index !== null && index + 2 < parts.length) {
            if (normalizeHebForMatch(parts[index + 2]) === 'אחרים') return false;
        }
        return true;
    }
    if (['אלהי', 'אלוהי'].includes(base)) {
        if (parts && index !== null && index + 2 < parts.length) {
            const nextWord = parts[index + 2];
            const cands = getCandidates(nextWord);
            if (cands.some(c => HOLY_ELOHE_TARGETS_SET.has(c.base) || c.base.endsWith('יהו') || (c.base.endsWith('יה') && c.base.length >= 4))) {
                return true;
            }
        }
        return false;
    }
    if (PROPER_NOUNS_SET.has(base)) return true;
    if (base.length >= 4 && base.endsWith('יהו')) return true;
    if (base.length >= 4 && base.endsWith('יה') && !base.endsWith('היה')) {
        if (!['יחיה', 'תחיה', 'נחיה', 'אליה', 'עליה', 'אריה', 'ראיה'].some(x => base.endsWith(x))) {
            return true;
        }
    }
    return false;
}

function getProperNounMatch(word: string, parts: string[], index: number) {
    const cands = getCandidates(word);
    for (const c of cands) {
        if (isProperNameBase(c.base, parts, index)) return c;
    }
    return null;
}

function classifyShevas(clusters: Cluster[], stressIdx: number, config: any) {
    const states: (string | null)[] = new Array(clusters.length).fill(null);
    for (let i = 0; i < clusters.length; i++) {
        const curr = clusters[i];
        if (curr.vowelChar !== HEB.SHEVA) continue;

        if (i === clusters.length - 1) {
            states[i] = 'nach';
            continue;
        }

        const prev = i > 0 ? clusters[i - 1] : null;
        const nextC = i < clusters.length - 1 ? clusters[i + 1] : null;
        let state = 'nach';

        if (i === 0) {
            state = 'na';
        } else if (prev && prev.vowelChar === HEB.SHEVA && states[i - 1] === 'nach') {
            state = 'na';
        } else if (prev && isLongVowelCluster(clusters, i - 1, states, stressIdx, config) && (i - 1) !== stressIdx) {
            state = 'na';
        } else if (curr.dagesh) {
            state = 'na';
        } else if (nextC && curr.consonant === nextC.consonant) {
            state = 'na';
        }

        states[i] = state;
    }
    return states;
}

function isLongVowelCluster(clusters: Cluster[], idx: number, shevaStates: (string | null)[], stressIdx: number, config: any): boolean {
    const c = clusters[idx];
    if (c.isShuruq || c.isHolamVav) return true;
    if (!c.vowelChar || c.vowelChar === HEB.SHEVA) return false;
    if (c.vowelChar === HEB.QAMATS && isQamatsQatan(clusters, idx, shevaStates, stressIdx, config)) return false;
    if (LONG_VOWELS.has(c.vowelChar)) return true;
    if (c.vowelChar === HEB.HIRIQ && idx < clusters.length - 1) {
        if (clusters[idx + 1].consonant === HEB.YOD && !clusters[idx + 1].vowelChar) return true;
    }
    return false;
}

function isQamatsQatan(clusters: Cluster[], idx: number, shevaStates: (string | null)[], stressIdx: number, config: any): boolean {
    const c = clusters[idx];
    if (c.vowelChar === HEB.QAMATS_QATAN) return true;
    if (c.vowelChar !== HEB.QAMATS) return false;
    if (!config.qamatsQatanInference) return false;
    const isStressed = (idx === stressIdx);
    const nextC = idx < clusters.length - 1 ? clusters[idx + 1] : null;
    if (!isStressed && nextC) {
        const nextSheva = nextC.vowelChar === HEB.SHEVA ? shevaStates[idx + 1] : null;
        if (nextSheva === 'nach' || !clusterHasPronouncedVowel(clusters, idx + 1, shevaStates)) {
            return true;
        }
    }
    return false;
}

function clusterHasPronouncedVowel(clusters: Cluster[], idx: number, shevaStates: (string | null)[]): boolean {
    const c = clusters[idx];
    if (c.isShuruq || c.isHolamVav) return true;
    if (!c.vowelChar) return false;
    if (c.vowelChar === HEB.SHEVA) return shevaStates[idx] === 'na';
    return true;
}

function classifyDagesh(clusters: Cluster[], shevaStates: (string | null)[]) {
    const kinds = [];
    for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i];
        if (!c.dagesh) kinds.push('none');
        else if (c.consonant === HEB.VAV && c.isShuruq) kinds.push('shuruq');
        else if (c.consonant === HEB.HE && i === clusters.length - 1) kinds.push('mappiq');
        else if (BEGADKEFAT.has(c.consonant)) {
            if (i === 0 || !clusterHasPronouncedVowel(clusters, i - 1, shevaStates)) kinds.push('lene');
            else kinds.push('forte');
        } else {
            kinds.push('forte');
        }
    }
    return kinds;
}

function mapCons(cluster: Cluster, idx: number, clusters: Cluster[], dageshKinds: string[], config: any): string {
    const char = cluster.consonant;
    if (cluster.isShuruq || cluster.isHolamVav) return '';
    const dagesh = dageshKinds[idx];
    if (char === HEB.YOD && !cluster.vowelChar && idx > 0) {
        const prev = clusters[idx - 1];
        const pv = prev.isShuruq ? HEB.QUBUTS : (prev.isHolamVav ? HEB.HOLAM : prev.vowelChar);
        if (pv && [HEB.HIRIQ, HEB.TSERE, HEB.SEGOL].includes(pv)) return '';
    }
    if (char === HEB.HE && idx === clusters.length - 1 && dagesh !== 'mappiq' && (config.finalHeMode || 'silent') === 'silent') {
        return '';
    }

    const mapping: Record<string, string> = {
        [HEB.ALEF]: '', [HEB.AYIN]: '',
        [HEB.BET]: dagesh === 'none' ? 'v' : 'b',
        [HEB.GIMEL]: 'g', [HEB.DALET]: 'd', [HEB.HE]: 'h', [HEB.VAV]: 'v',
        [HEB.ZAYIN]: 'z', [HEB.HET]: 'ḥ', [HEB.TET]: 't', [HEB.YOD]: 'y',
        [HEB.KAF]: dagesh === 'none' ? 'j' : 'k',
        [HEB.FINAL_KAF]: dagesh === 'none' ? 'j' : 'k',
        [HEB.LAMED]: 'l', [HEB.MEM]: 'm', [HEB.FINAL_MEM]: 'm',
        [HEB.NUN]: 'n', [HEB.FINAL_NUN]: 'n', [HEB.SAMEKH]: 's',
        [HEB.PE]: dagesh === 'none' ? 'f' : 'p',
        [HEB.FINAL_PE]: dagesh === 'none' ? 'f' : 'p',
        [HEB.TSADI]: 'ts', [HEB.FINAL_TSADI]: 'ts',
        [HEB.QOF]: 'k', [HEB.RESH]: 'r',
        [HEB.SHIN]: cluster.isSin ? 's' : 'sh',
        [HEB.TAV]: 't'
    };
    return mapping[char] || '';
}

function mapVowel(clusters: Cluster[], idx: number, shevaStates: (string | null)[], stressIdx: number, config: any): string {
    const c = clusters[idx];
    let v = c.vowelChar;
    if (c.isShuruq) v = HEB.QUBUTS;
    if (c.isHolamVav) v = HEB.HOLAM;
    if (!v) return '';
    if (v === HEB.SHEVA) return shevaStates[idx] === 'na' ? 'e' : '';

    if ([HEB.HATAF_SEGOL, HEB.SEGOL, HEB.TSERE].includes(v)) return 'e';
    if (v === HEB.HIRIQ) return 'i';
    if ([HEB.PATAH, HEB.HATAF_PATAH].includes(v)) return 'a';
    if (v === HEB.QAMATS) return isQamatsQatan(clusters, idx, shevaStates, stressIdx, config) ? 'o' : 'a';
    if ([HEB.HATAF_QAMATS, HEB.HOLAM, HEB.HOLAM_HASER, HEB.QAMATS_QATAN].includes(v)) return 'o';
    if (v === HEB.QUBUTS) return 'u';
    return '';
}

function accentVowel(v: string): string {
    const m: Record<string, string> = { 'a': 'á', 'e': 'é', 'i': 'í', 'o': 'ó', 'u': 'ú' };
    return m[v] || v;
}

function findStress(clusters: Cluster[]): number {
    for (let i = clusters.length - 1; i >= 0; i--) if (clusters[i].hasTaam) return i;
    for (let i = clusters.length - 1; i >= 0; i--) if (clusters[i].hasMeteg) return i;
    for (let i = clusters.length - 1; i >= 0; i--) {
        const c = clusters[i];
        if (c.isShuruq || c.isHolamVav || (c.vowelChar && c.vowelChar !== HEB.SHEVA)) return i;
    }
    return -1;
}

function capitalizeFirst(s: string): string {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function transliterateWord(word: string, capIdx: number = -1, config: any = {}): string {
    const clusters = parseClusters(word);
    if (!clusters.length) return word;
    const stressIdx = findStress(clusters);
    const shevaStates = classifyShevas(clusters, stressIdx, config);
    const dageshKinds = classifyDagesh(clusters, shevaStates);

    let output = "";
    for (let i = 0; i < clusters.length; i++) {
        const curr = clusters[i];
        const dk = dageshKinds[i];
        let cons = mapCons(curr, i, clusters, dageshKinds, config);
        if (dk === 'forte' && config.showForteMarker !== false && cons) {
            cons = cons + '·' + cons;
        }

        if (capIdx === i) {
            if (i > 0 && cons.includes('·')) {
                const parts = cons.split('·');
                parts[parts.length - 1] = capitalizeFirst(parts[parts.length - 1]);
                cons = parts.join('·');
            } else {
                cons = capitalizeFirst(cons);
            }
        }

        let vowel = mapVowel(clusters, i, shevaStates, stressIdx, config);

        let isFurtive = false;
        if (i === clusters.length - 1 && curr.vowelChar === HEB.PATAH) {
            if ([HEB.HET, HEB.AYIN].includes(curr.consonant)) {
                isFurtive = true;
            } else if (curr.consonant === HEB.HE && dk === 'mappiq') {
                isFurtive = true;
            }
        }

        if (isFurtive) {
            let f = 'a';
            if (i === stressIdx) f = accentVowel(f);
            if (curr.isAyin && config.ayinMode === 'underline') f += '\u0331';
            output += f + cons;
            continue;
        }

        if (vowel && i === stressIdx) vowel = accentVowel(vowel);
        if (vowel && curr.isAyin && config.ayinMode === 'underline') vowel += '\u0331';
        output += cons + vowel;
    }

    if (capIdx === 0) output = capitalizeFirst(output);

    output = output.replace(/iy/g, 'i');
    if (output.startsWith("'")) output = output.substring(1);
    return output.trim();
}

export function transliterateText(text: string, config: any = null): string {
    if (!config) config = { qereDivine: true, properNamesOnly: true, showForteMarker: true, forceInitialCapital: true, ayinMode: 'underline' };
    
    // Replace html tokens or custom marks
    text = text.replace(/<[^>]*>/g, '').replace(/[\[\]*()]/g, '');

    const parts = text.split(/(\s+|-|\||\u05BE)/);
    let result = [];

    for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        if (!/[\u05D0-\u05EA]/.test(part)) {
            if (part.includes('\u05BE')) part = part.replace(/\u05BE/g, '-');
            result.push(part);
            continue;
        }

        let word = part.normalize('NFD');

        if (config.qereDivine) {
            const cands = getCandidates(word);
            let foundDivine = false;
            for (const c of cands) {
                if (c.base === 'יהוה') {
                    const clusters = parseClusters(word);
                    const prefClusters = clusters.slice(0, c.prefixLen);
                    const baseClusters = clusters.slice(c.prefixLen);

                    let prefTrans = "";
                    if (prefClusters.length > 0) {
                        const prefHeb = prefClusters.map(cl => cl.text).join('');
                        prefTrans = transliterateWord(prefHeb, -1, config);
                        while (prefTrans && 'aeiouáéíóúAEIOUÁÉÍÓÚ\u0331'.includes(prefTrans[prefTrans.length - 1])) {
                            prefTrans = prefTrans.substring(0, prefTrans.length - 1);
                        }
                    }

                    const firstBaseVowel = baseClusters.length > 0 ? baseClusters[0].vowelChar : null;
                    const reading = [HEB.HATAF_SEGOL, HEB.SEGOL].includes(firstBaseVowel as string) ? 'Elohím' : 'Adonáy';

                    result.push(prefTrans + reading);
                    foundDivine = true;
                    break;
                }
            }
            if (foundDivine) continue;
        }

        let capIdx = -1;
        if (config.properNamesOnly) {
            const match = getProperNounMatch(word, parts, i);
            if (match) capIdx = match.prefixLen;
        }

        if (i >= 2) {
            const prevWord = parts[i - 2];
            const candsPrev = getCandidates(prevWord);
            if (candsPrev.some(c => ALWAYS_CAPITALIZE_NEXT_HEADS.has(c.base))) {
                if (capIdx === -1) capIdx = 0;
            } else if (candsPrev.some(c => PERSON_LINK_HEADS.has(c.base))) {
                let isAge = false;
                for (let j = i + 2; j < Math.min(parts.length, i + 10); j += 2) {
                    if (AGE_WORDS.has(normalizeHebForMatch(parts[j]))) {
                        isAge = true; break;
                    }
                }
                if (!isAge && capIdx === -1) capIdx = 0;
            }
        }

        const trans = transliterateWord(word, capIdx, config);
        result.push(trans);
    }

    let res = result.join('').replace(/\|/g, ' | ');
    res = res.replace(/\s+/g, ' ').trim();
    if (config.forceInitialCapital && res) {
        res = capitalizeFirst(res);
    }
    return res;
}
