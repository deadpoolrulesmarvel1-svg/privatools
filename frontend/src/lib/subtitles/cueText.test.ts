import { describe, expect, it } from "vitest";
import { convertCueMarkup, cueParts, renderCue } from "./cueText";

const TWO = { maxLineChars: 42, maxLines: 2 };
const pick = (lines: string[]) => cueParts(lines).map(({ before, text, markup, after, turn, style, translatable }) => ({ before, text, markup, after, turn, style, translatable }));

describe("taking a cue apart", () => {
    it("reads one speaker's two lines as one part", () => {
        expect(pick(["I went to the store", "and bought some milk."])).toEqual([
            { before: "", text: "I went to the store and bought some milk.", markup: "I went to the store and bought some milk.", after: "", turn: false, style: "", translatable: true },
        ]);
    });

    it("gives each speaker of a dialogue cue a part, with the dash kept aside", () => {
        expect(pick(["- Are you coming?", "- Yes, in a minute."])).toEqual([
            { before: "- ", text: "Are you coming?", markup: "Are you coming?", after: "", turn: true, style: "", translatable: true },
            { before: "- ", text: "Yes, in a minute.", markup: "Yes, in a minute.", after: "", turn: true, style: "", translatable: true },
        ]);
        // The second speaker alone marked, as some styles do.
        expect(pick(["Are you coming?", "-Yes."]).map(part => [part.before, part.text, part.turn])).toEqual([["", "Are you coming?", false], ["-", "Yes.", true]]);
    });

    it("keeps wrapping tags, overrides, voice spans, labels and music notes around the words", () => {
        expect(pick(["{\\an8}<i>I'm on the phone.</i>"])[0]).toMatchObject({ before: "{\\an8}<i>", text: "I'm on the phone.", after: "</i>", style: "i+{\\an8}" });
        expect(pick(["<i>I went to the store</i>", "<i>and bought milk.</i>"])[0]).toMatchObject({ before: "<i>", text: "I went to the store and bought milk.", after: "</i>" });
        expect(pick(["<v Bob>Welcome back</v>"])[0]).toMatchObject({ before: "<v Bob>", text: "Welcome back", after: "</v>", turn: true, style: "" });
        expect(pick(["<c.yellow>Thanks.</c>"])[0]).toMatchObject({ before: "<c.yellow>", text: "Thanks.", after: "</c>", style: "c" });
        expect(pick(["JOHN: Hi there."])[0]).toMatchObject({ before: "JOHN: ", text: "Hi there.", turn: true });
        expect(pick(["♪ Happy birthday to you ♪"])[0]).toMatchObject({ before: "♪ ", text: "Happy birthday to you", after: " ♪", style: "♪" });
    });

    it("keeps a minus sign and a doubled dash in the words", () => {
        expect(pick(["-5 degrees outside."])[0]).toMatchObject({ before: "", text: "-5 degrees outside.", turn: false });
        expect(pick(["-- and then"])[0]).toMatchObject({ before: "", text: "-- and then" });
    });

    it("leaves formatting inside the words out of the plain text and counts it, keeping balanced <i>, <b> and <u> for a model", () => {
        const [part] = cueParts(["I said <i>no</i> to <font color=\"red\">him</font>."]);
        expect(part).toMatchObject({ text: "I said no to him.", markup: "I said <i>no</i> to him.", plainDrops: 2, markupDrops: 1 });
        // A wrapping tag closed among the words wraps only some of them.
        expect(cueParts(["<i>Hello</i>, he said."])[0]).toMatchObject({ before: "", text: "Hello, he said.", markup: "<i>Hello</i>, he said.", after: "", plainDrops: 1, markupDrops: 0 });
        // Unbalanced spans are kept by neither.
        expect(cueParts(["I <b>said no</i>"])[0]).toMatchObject({ markup: "I said no", markupDrops: 1 });
    });

    it("decodes VTT escapes and drops direction marks and ruby readings", () => {
        expect(cueParts(["R&amp;D &lt;3"])[0].text).toBe("R&D <3");
        expect(cueParts(["‏مرحبا"])[0].text).toBe("مرحبا");
        expect(cueParts(["<ruby>漢字<rt>かんじ</rt></ruby>を読む"])[0].text).toBe("漢字を読む");
    });

    it("joins lines of a script written without spaces without adding one", () => {
        expect(cueParts(["我们今天", "要讨论隐私"])[0].text).toBe("我们今天要讨论隐私");
    });

    it("keeps the space between two lines of Korean, which is written with spaces", () => {
        expect(cueParts(["오늘은 개인정보에 대해", "이야기하겠습니다"])[0].text).toBe("오늘은 개인정보에 대해 이야기하겠습니다");
    });

    it("marks a part of only music notes or numbers as nothing to translate", () => {
        expect(pick(["♪♪"])[0]).toMatchObject({ text: "", translatable: false });
        expect(pick(["1984"])[0]).toMatchObject({ translatable: false });
    });
});

describe("putting a translated cue back", () => {
    it("wraps one speaker's words to two lines of 42 inside the cue's own marks", () => {
        const parts = cueParts(["{\\an8}<i>I went to the store and bought some milk", "and some bread for the weekend.</i>"]);
        const { text, long } = renderCue(parts, ["Fui a la tienda y compré leche y un poco de pan para el fin de semana."], "srt", TWO);
        expect(long).toBe(false);
        const lines = text.split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0].startsWith("{\\an8}<i>")).toBe(true);
        expect(lines[1].endsWith("</i>")).toBe(true);
        expect(text.replace(/\{\\an8\}|<\/?i>/g, "").split("\n").join(" ")).toBe("Fui a la tienda y compré leche y un poco de pan para el fin de semana.");
        for (const line of text.replace(/\{\\an8\}|<\/?i>/g, "").split("\n")) expect(Array.from(line).length).toBeLessThanOrEqual(42);
    });

    it("keeps one line for each speaker, with each dash back in place", () => {
        const parts = cueParts(["<i>- Are you coming?</i>", "- Yes, in a minute."]);
        expect(renderCue(parts, ["¿Vienes?", "Sí, en un minuto."], "srt", TWO)).toEqual({ text: "<i>- ¿Vienes?</i>\n- Sí, en un minuto.", long: false });
    });

    it("keeps a part it was given no translation for as written", () => {
        const parts = cueParts(["- Are you coming?", "- ♪"]);
        expect(renderCue(parts, ["¿Vienes?", null], "srt", TWO).text).toBe("- ¿Vienes?\n- ♪");
    });

    it("runs long rather than past two lines when the words can't fit, and says so", () => {
        const words = Array(24).fill("palabra").join(" ");
        const { text, long } = renderCue(cueParts(["Words."]), [words], "srt", TWO);
        expect(long).toBe(true);
        expect(text.split("\n")).toHaveLength(2);
        expect(text.split("\n").join(" ")).toBe(words);
    });

    it("breaks a line inside carried tags without cutting one", () => {
        const { text } = renderCue(cueParts(["Words."]), ["Te lo dije: <i>no voy a ir a la fiesta de esta noche</i> con ellos."], "vtt", TWO);
        expect(text.split("\n")).toHaveLength(2);
        expect(text).toMatch(/^Te lo dije: <i>[^<]*\n?[^<]*<\/i> con ellos\.$/);
    });

    it("escapes a translation for VTT, and leaves SRT text as it is", () => {
        expect(renderCue(cueParts(["R&amp;D"]), ["I+D & <más>"], "vtt", TWO).text).toBe("I+D &amp; &lt;más&gt;");
        expect(renderCue(cueParts(["R&D"]), ["I+D & más"], "srt", TWO).text).toBe("I+D & más");
        // Text shaped like a tag is text: written as it was, it would open a bold span and lose "y c".
        expect(renderCue(cueParts(["If a &lt; b and c &gt; d, stop."]), ["Si a<b y c>d, para."], "vtt", TWO).text).toBe("Si a&lt;b y c&gt;d, para.");
        expect(renderCue(cueParts(["I said <i>no</i>."]), ["Dije <i>no</i>."], "vtt", TWO).text).toBe("Dije <i>no</i>.");
    });

    it("breaks between words when a reply has a space just inside a span", () => {
        const reply = "Le dije <i> no</i> a toda la idea de ir allí esta noche otra vez, de verdad.";
        const { text } = renderCue(cueParts(["I said <i>no</i> to the whole idea of going there tonight again."]), [reply], "srt", TWO);
        expect(text.replace(/<\/?i>/g, "").split("\n").join(" ")).toBe("Le dije no a toda la idea de ir allí esta noche otra vez, de verdad.");
        expect(text).toContain("<i>no</i>");
    });

    it("wraps Chinese at 16 characters a line between words, without spaces", () => {
        const { text } = renderCue(cueParts(["We are going to talk about privacy today, and about why it matters."]), ["我们今天要谈谈隐私以及隐私为什么如此重要的原因"], "srt", { maxLineChars: 16, maxLines: 2 });
        const lines = text.split("\n");
        expect(lines).toHaveLength(2);
        expect(lines.join("")).toBe("我们今天要谈谈隐私以及隐私为什么如此重要的原因");
        for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(16);
    });
});

describe("converting markup between the formats", () => {
    it("keeps <i>, <b> and <u> both ways and counts what it leaves out", () => {
        expect(convertCueMarkup("<b>Bold</b> &amp; <c.loud><v Ann>loud</v></c>", "vtt", "srt")).toEqual({ text: "<b>Bold</b> & loud", dropped: 2 });
        expect(convertCueMarkup("<i>Ann</i> & {\\an8}<font color=\"#fff\">Bo</font>", "srt", "vtt")).toEqual({ text: "<i>Ann</i> &amp; Bo", dropped: 2 });
        expect(convertCueMarkup("<i.loud>Hi</i>", "vtt", "srt").text).toBe("<i>Hi</i>");
        expect(convertCueMarkup("same", "srt", "srt")).toEqual({ text: "same", dropped: 0 });
    });

    it("leaves VTT karaoke timestamps out of an SRT", () => {
        expect(convertCueMarkup("Never <00:00:01.500>gonna", "vtt", "srt")).toEqual({ text: "Never gonna", dropped: 1 });
    });
});
