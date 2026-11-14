/**
 * Joins consecutive recognized signs into one short English utterance.
 *
 * This is deliberately simple and transparent: it concatenates sign glosses in signing
 * order and fixes punctuation. It is NOT ASL→English translation (ASL grammar, facial
 * markers and word order are not modeled), so the UI always shows the raw sign sequence.
 */
const KEEP_CASE = new Set(['I', 'OK', 'English', 'ASL'])
const QUESTION_WORDS = new Set(['what', 'where', 'who', 'why', 'how', 'when', 'which'])

export function stripPunct(english: string): string {
  return english.replace(/[.?!]+$/g, '').trim()
}

export function composePhrase(englishWords: string[]): string {
  const words = englishWords.map(stripPunct).filter(Boolean)
  if (words.length === 0) return ''
  const isQuestion = englishWords.some((w) => /\?$/.test(w.trim())) || words.some((w) => QUESTION_WORDS.has(w.toLowerCase()))
  const body = words
    .map((w, i) => (i === 0 || KEEP_CASE.has(w) || w.startsWith('I ') ? w : w.charAt(0).toLowerCase() + w.slice(1)))
    .join(' ')
  const out = body.charAt(0).toUpperCase() + body.slice(1)
  return out + (isQuestion ? '?' : '.')
}
