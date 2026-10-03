/**
 * The languages Whisper's multilingual models were trained on, by the codes
 * its tokenizer takes (transformers.js, models/whisper/common_whisper.js).
 * transformers.js does not detect the language: with none given it assumes
 * English, so the visitor chooses it.
 */
const WHISPER_LANGUAGES: [code: string, name: string][] = [
    ["af", "Afrikaans"], ["sq", "Albanian"], ["am", "Amharic"], ["ar", "Arabic"], ["hy", "Armenian"], ["as", "Assamese"],
    ["az", "Azerbaijani"], ["ba", "Bashkir"], ["eu", "Basque"], ["be", "Belarusian"], ["bn", "Bengali"], ["bs", "Bosnian"],
    ["br", "Breton"], ["bg", "Bulgarian"], ["my", "Burmese"], ["ca", "Catalan"], ["zh", "Chinese"], ["hr", "Croatian"],
    ["cs", "Czech"], ["da", "Danish"], ["nl", "Dutch"], ["en", "English"], ["et", "Estonian"], ["fo", "Faroese"],
    ["fi", "Finnish"], ["fr", "French"], ["gl", "Galician"], ["ka", "Georgian"], ["de", "German"], ["el", "Greek"],
    ["gu", "Gujarati"], ["ht", "Haitian Creole"], ["ha", "Hausa"], ["haw", "Hawaiian"], ["he", "Hebrew"], ["hi", "Hindi"],
    ["hu", "Hungarian"], ["is", "Icelandic"], ["id", "Indonesian"], ["it", "Italian"], ["ja", "Japanese"], ["jw", "Javanese"],
    ["kn", "Kannada"], ["kk", "Kazakh"], ["km", "Khmer"], ["ko", "Korean"], ["lo", "Lao"], ["la", "Latin"],
    ["lv", "Latvian"], ["ln", "Lingala"], ["lt", "Lithuanian"], ["lb", "Luxembourgish"], ["mk", "Macedonian"], ["mg", "Malagasy"],
    ["ms", "Malay"], ["ml", "Malayalam"], ["mt", "Maltese"], ["mi", "Maori"], ["mr", "Marathi"], ["mn", "Mongolian"],
    ["ne", "Nepali"], ["no", "Norwegian"], ["nn", "Norwegian Nynorsk"], ["oc", "Occitan"], ["ps", "Pashto"], ["fa", "Persian"],
    ["pl", "Polish"], ["pt", "Portuguese"], ["pa", "Punjabi"], ["ro", "Romanian"], ["ru", "Russian"], ["sa", "Sanskrit"],
    ["sr", "Serbian"], ["sn", "Shona"], ["sd", "Sindhi"], ["si", "Sinhala"], ["sk", "Slovak"], ["sl", "Slovenian"],
    ["so", "Somali"], ["es", "Spanish"], ["su", "Sundanese"], ["sw", "Swahili"], ["sv", "Swedish"], ["tl", "Tagalog"],
    ["tg", "Tajik"], ["ta", "Tamil"], ["tt", "Tatar"], ["te", "Telugu"], ["th", "Thai"], ["bo", "Tibetan"],
    ["tr", "Turkish"], ["tk", "Turkmen"], ["uk", "Ukrainian"], ["ur", "Urdu"], ["uz", "Uzbek"], ["vi", "Vietnamese"],
    ["cy", "Welsh"], ["yi", "Yiddish"], ["yo", "Yoruba"],
];

export const SPEECH_LANGUAGES: readonly { code: string; name: string }[] = WHISPER_LANGUAGES.map(([code, name]) => ({ code, name }));

export function languageName(code: string): string {
    return SPEECH_LANGUAGES.find(language => language.code === code)?.name ?? code;
}

export function isSpeechLanguage(code: unknown): code is string {
    return typeof code === "string" && SPEECH_LANGUAGES.some(language => language.code === code);
}
