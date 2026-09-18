/**
 * Telling a person's name apart from an answer to a form question.
 *
 * Meta lead-form exports get concatenated: an agency downloads one CSV per form
 * and stacks them, so column 3 holds "Ana Oliveira" for the first four hundred
 * rows and "2pm / 6pm" for the next eighty. The importer picks the column once,
 * from the first rows it sees, and then trusts every value in it. That is how a
 * CRM ends up with a contact called "I am on holiday till 25.05 and have time.
 * From 9 am to 8 pm ( Cyprus time)".
 *
 * The test has to be asymmetric, because the two mistakes are not equally bad:
 *
 * - Keeping a bad name puts a lie in front of an agent, and it goes out in the
 *   WhatsApp template as `{{1}}`. "Hello Katalog, thank you for your interest."
 * - Rejecting a good name loses nothing permanently: the value is written to
 *   the contact's notes, and the inbox shows their phone number instead, which
 *   is what the agent needs in order to ring them anyway.
 *
 * So this is built as a *rejecter* of things that are definitely not names,
 * rather than a validator of things that are. Anything it cannot classify is
 * kept. A single-word name like "Ahmed" is real and common in Gulf data, so
 * word count cannot carry the decision on its own.
 */

/**
 * Answers that turn up in the name column of a stacked export, in the languages
 * these campaigns actually run in — English, Portuguese, Turkish, Arabic,
 * Russian and Spanish all appeared in the first real import.
 *
 * A list like this is never finished, and it is not meant to be: it is here to
 * catch the common answers cheaply. The structural tests below do the rest, and
 * whatever slips through is caught by the review screen a human reads.
 */
const FORM_ANSWERS = new Set([
  // Placeholders and header rows
  'name', 'full name', 'fullname', 'first name', 'last name', 'n/a', 'na', 'none',
  '-', '--', '.', 'null', 'nil', 'unknown', 'test', 'testing', 'xxx', 'abc',
  // English
  'yes', 'no', 'ok', 'okay', 'sure', 'maybe', 'any', 'anytime', 'all', 'both',
  'now', 'done', 'asap', 'today', 'tomorrow', 'morning', 'afternoon', 'evening',
  'noon', 'midday', 'midnight', 'weekend', 'weekday', 'week', 'month', 'anyday',
  'night', 'cash', 'mortgage', 'call', 'call me', 'whatsapp', 'email', 'info',
  'information', 'price', 'pricing', 'brochure', 'catalog', 'catalogue',
  'details', 'interested', 'not interested', 'investment', 'buy', 'rent', 'hi',
  'hello', 'hey', 'please', 'thanks', 'urgent', 'immediately', 'soon', 'later',
  // Portuguese
  'sim', 'não', 'nao', 'agora', 'hoje', 'amanhã', 'amanha', 'qualquer', 'ambos',
  'tudo', 'todos', 'dinheiro', 'ligar', 'manhã', 'manha', 'tarde', 'noite',
  'catálogo', 'catalogo', 'preço', 'preco', 'urgente', 'interessado', 'olá', 'ola',
  // Turkish
  'evet', 'hayır', 'hayir', 'şimdi', 'simdi', 'bugün', 'bugun', 'yarın', 'yarin',
  'katalog', 'fiyat', 'nakit', 'ara', 'arayın', 'arayin', 'sabah', 'akşam',
  'aksam', 'herhangi', 'merhaba', 'acil', 'bilgi',
  // Arabic
  'نعم', 'لا', 'الان', 'الآن', 'اليوم', 'غدا', 'غداً', 'كاتالوج', 'كتالوج',
  'السعر', 'سعر', 'نقدا', 'نقداً', 'اتصل', 'اتصل بي', 'صباحا', 'صباحاً', 'مساء',
  'مساءً', 'اي', 'أي', 'مهتم', 'معلومات', 'مرحبا', 'عاجل',
  // Russian
  'да', 'нет', 'сейчас', 'сегодня', 'завтра', 'каталог', 'цена', 'наличные',
  'позвоните', 'утро', 'вечер', 'любой', 'привет', 'срочно', 'информация',
  // Spanish
  'sí', 'ahora', 'mañana', 'manana', 'cualquier', 'efectivo', 'llamar',
  'catálogo', 'precio', 'interesado', 'hola', 'urgente',
]);

/**
 * The vocabulary of *when*.
 *
 * Most answers that land in a name column are scheduling: "Tomorrow morning",
 * "Yes Afternoon", "Next week after". Individually several of these could be a
 * surname — Monday and Summer are real ones — so no single word here decides
 * anything. They only count towards the "made of answer words" test below.
 */
const TIME_WORDS = new Set([
  'now', 'today', 'tomorrow', 'yesterday', 'tonight', 'morning', 'noon',
  'midday', 'afternoon', 'evening', 'night', 'midnight', 'week', 'weekend',
  'weekday', 'month', 'year', 'day', 'days', 'weeks', 'months', 'hour', 'hours',
  'next', 'last', 'after', 'before', 'later', 'soon', 'early', 'late', 'any',
  'anytime', 'asap', 'urgent', 'immediately', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'am', 'pm', 'time', 'oclock',
  // The same idea in the other campaign languages.
  'agora', 'hoje', 'amanha', 'amanhã', 'manha', 'manhã', 'tarde', 'noite',
  'semana', 'mes', 'mês', 'proxima', 'próxima', 'depois', 'qualquer', 'horas',
  'simdi', 'şimdi', 'bugun', 'bugün', 'yarin', 'yarın', 'sabah', 'aksam',
  'akşam', 'hafta', 'sonra', 'herhangi', 'saat',
  'ahora', 'hoy', 'manana', 'mañana', 'semana', 'despues', 'después',
  'сейчас', 'сегодня', 'завтра', 'утро', 'вечер', 'неделя', 'потом',
]);

/**
 * True when the value is built out of answer words rather than names.
 *
 * Proportional rather than absolute: "Tomorrow morning" is two answer words out
 * of two, "Next wrrk Week after" is three out of four — that last one has a typo
 * in it, which is exactly why an all-words rule is too brittle. A single
 * coincidence is not enough ("Dawn Morning" is one of two, and stays a name), so
 * this needs at least two matches and most of the words.
 */
function madeOfAnswerWords(value: string): boolean {
  const words = value.toLowerCase().split(/\s+/).map((word) => word.replace(/[.,]/g, '')).filter(Boolean);
  if (words.length < 2) return false;
  const matches = words.filter(
    (word) => FORM_ANSWERS.has(word) || TIME_WORDS.has(word) || SENTENCE_WORDS.has(word),
  ).length;
  return matches >= 2 && matches / words.length >= 0.6;
}

/**
 * Characters that appear in answers and questions but not in names.
 *
 * The full stop is deliberately absent: "Paulo de A. L. Neto" is a real name
 * and a common shape in Brazilian data, and rejecting it to catch a sentence
 * would be exactly the trade this module is built to avoid.
 */
const NOT_IN_A_NAME = /[()[\]{}:;!?/\\@#$%^*=+<>|"“”]/;

/** A time of day, a range, or anything else carrying a digit. */
const HAS_DIGIT = /\d/;

/**
 * Keyboard mash: a short run repeated to fill the string — "asdasdasd",
 * "abcabc", "aaaa". Real names repeat syllables ("Ntanda") but not from the
 * very first character for the whole length.
 */
function isKeyboardMash(value: string): boolean {
  const letters = value.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (letters.length < 4) return false;
  for (let size = 1; size <= 4; size += 1) {
    if (letters.length % size !== 0) continue;
    const times = letters.length / size;
    if (times < 2) continue;
    if (letters.slice(0, size).repeat(times) !== letters) continue;
    /*
     * A unit repeated exactly twice in a short word is a name — "Didi",
     * "Lala", "Nana", "Bibi" are all real, and rejecting them to catch
     * "abcabc" would be the wrong way round. Three repeats, or two in
     * something six letters or longer, is mashing.
     */
    if (times >= 3 || letters.length >= 6) return true;
  }
  return false;
}

/*
 * Words that appear in a sentence and never in a name.
 *
 * Deliberately pronouns and verbs only. Name *particles* — de, da, van, der,
 * bin, ibn, al, abu — are what make a real name long, so they must not be in
 * here: "محمد عبد الله بن سالم آل نهيان" is seven words and a person, while
 * "I am looking to buy in Dubai" is seven words and a sentence. Counting words
 * cannot tell those apart; this can.
 */
const SENTENCE_WORDS = new Set([
  // English
  'i', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
  'want', 'wants', 'need', 'needs', 'would', 'will', 'can', 'could', 'should',
  'my', 'me', 'we', 'our', 'you', 'your', 'they', 'them', 'this', 'that',
  'these', 'those', 'till', 'until', 'from', 'about', 'looking', 'searching',
  'please', 'thanks', 'thank', 'send', 'give', 'tell', 'let', 'know', 'when',
  'what', 'which', 'where', 'how', 'why', 'there', 'here', 'with', 'without',
  'for', 'and', 'but', 'or', 'not', 'very', 'more', 'less', 'much', 'many',
  // Portuguese
  'eu', 'sou', 'estou', 'quero', 'preciso', 'tenho', 'gostaria', 'minha',
  'você', 'voce', 'nós', 'nos', 'obrigado', 'obrigada', 'quando', 'onde',
  // Turkish
  'ben', 'istiyorum', 'benim', 'lütfen', 'lutfen', 'nerede', 'nasıl', 'nasil',
  // Spanish
  'yo', 'soy', 'estoy', 'quiero', 'necesito', 'gracias', 'cuando', 'donde',
  // Russian
  'я', 'хочу', 'мне', 'нужно', 'пожалуйста', 'когда', 'где',
]);

/**
 * Four words or more, at least one of which only ever appears in a sentence.
 */
function isSentence(value: string): boolean {
  const words = value.toLowerCase().split(/\s+/);
  if (words.length < 4) return false;
  return words.some((word) => SENTENCE_WORDS.has(word.replace(/[.,]/g, '')));
}

/**
 * How many letters, ignoring spaces and punctuation. A name needs at least two:
 * "Y" is an answer to a yes/no question, not somebody called Y.
 */
function letterCount(value: string): number {
  return (value.match(/\p{L}/gu) ?? []).length;
}

/**
 * True when this value is definitely not a person's name.
 *
 * Errs towards keeping: everything it rejects, it rejects for a reason it can
 * name, which is also what makes the review screen explainable.
 */
export function notAName(value: string | null | undefined): false | string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'empty';

  if (FORM_ANSWERS.has(trimmed.toLowerCase())) return 'a form answer, not a name';
  if (HAS_DIGIT.test(trimmed)) return 'contains numbers';
  if (NOT_IN_A_NAME.test(trimmed)) return 'contains punctuation a name would not';
  if (letterCount(trimmed) < 2) return 'too short to be a name';
  if (isKeyboardMash(trimmed)) return 'looks like keyboard mashing';

  if (isSentence(trimmed)) return 'a sentence, not a name';
  if (madeOfAnswerWords(trimmed)) return 'made of form answers, not a name';
  /*
   * A backstop for a sentence in a language whose function words are not
   * listed. Set high on purpose: a formal Arabic name carrying a patronymic and
   * a tribal name reaches seven words, so anything under ten stays.
   */
  if (trimmed.split(/\s+/).length >= 10) return 'too many words to be a name';
  // 80 characters is longer than any name and shorter than any answer worth
  // storing in a name field.
  if (trimmed.length > 80) return 'too long to be a name';

  return false;
}

/** The inverse, for readability at call sites. */
export function looksLikeName(value: string | null | undefined): boolean {
  return notAName(value) === false;
}

/**
 * The best name available for a row: the mapped column if it holds one,
 * otherwise whatever a neighbouring column holds.
 *
 * Same shape as `findPhone`. When the export is stacked, the block whose third
 * column holds an answer usually holds the actual name a column or two over,
 * so looking is worth more than giving up.
 */
export function findName(unmapped: Record<string, string>): string | null {
  for (const value of Object.values(unmapped)) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (!looksLikeName(trimmed)) continue;

    const words = trimmed.split(/\s+/);
    /*
     * Two to four words when guessing, where the mapped column accepts one.
     * An unmapped single word could be a city, a unit type or a developer, and
     * promoting "Dubai" to somebody's name is worse than leaving it blank.
     */
    if (words.length < 2 || words.length > 4) continue;
    /*
     * And no sentence word anywhere in it, at any length — the four-word floor
     * that `isSentence` uses is too lax to guess on. "Nothing useful here" is
     * three words of plain letters and would otherwise become a customer.
     */
    if (words.some((word) => SENTENCE_WORDS.has(word.toLowerCase().replace(/[.,]/g, '')))) continue;
    // Nor an answer word: "Not interested" is two capitalised words too.
    if (words.some((word) => FORM_ANSWERS.has(word.toLowerCase()))) continue;

    return trimmed;
  }
  return null;
}
