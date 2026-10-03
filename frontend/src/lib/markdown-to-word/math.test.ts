import { describe, expect, it } from "vitest";
import temml from "temml";
import { latexToOmml, mathmlToOmml, parseMathML, prepareTex, Unsupported } from "./math";

/** The OMML for some LaTeX, failing the test if it stayed text. */
function omml(tex: string, display = true): string {
    const result = latexToOmml(temml, tex, display);
    if (result.ok === false) throw new Error(`${tex} stayed text: ${result.reason}`);
    return result.omml;
}

function reason(tex: string, display = true): string {
    const result = latexToOmml(temml, tex, display);
    if (result.ok === true) throw new Error(`${tex} became an equation: ${result.omml}`);
    return result.reason;
}

/** The text of every m:t in order, joined. */
const texts = (xml: string) => [...xml.matchAll(/<m:t[^>]*>([^<]*)<\/m:t>/g)].map(match => match[1]).join("");

describe("LaTeX to Word equations", () => {
    it("fractions, and binomials as fractions without a bar inside stretchy parentheses", () => {
        expect(omml("\\frac{a}{b}")).toMatch(/^<m:f><m:num><m:r>.*<m:t xml:space="preserve">a<\/m:t><\/m:r><\/m:num><m:den>.*b<\/m:t><\/m:r><\/m:den><\/m:f>$/);
        const binomial = omml("\\binom{n}{k}");
        expect(binomial).toMatch(/^<m:d><m:e><m:f><m:fPr><m:type m:val="noBar"\/><\/m:fPr>/);
        expect(omml("{a \\over b}")).toContain("<m:f><m:num>");
    });

    it("sub- and superscripts", () => {
        expect(omml("x^2")).toMatch(/^<m:sSup><m:e>.*>x<\/m:t>.*<\/m:e><m:sup>.*>2<\/m:t>.*<\/m:sup><\/m:sSup>$/);
        expect(omml("x_i")).toMatch(/^<m:sSub><m:e>.*<\/m:e><m:sub>.*<\/m:sub><\/m:sSub>$/);
        expect(omml("x_i^2")).toMatch(/^<m:sSubSup><m:e>.*<\/m:e><m:sub>.*>i<.*<\/m:sub><m:sup>.*>2<.*<\/m:sup><\/m:sSubSup>$/);
        expect(omml("e^{i\\pi}")).toContain("<m:sup>");
        // An empty base (as in {}^{14}C or chemistry) gets an invisible character, never Word's placeholder box.
        expect(omml("{}^{14}C")).toContain("<m:sSup><m:e><m:r><w:rPr><w:rFonts w:ascii=\"Cambria Math\" w:hAnsi=\"Cambria Math\"/></w:rPr><m:t xml:space=\"preserve\">\u{200b}</m:t></m:r></m:e>");
    });

    it("square and n-th roots", () => {
        expect(omml("\\sqrt{x}")).toMatch(/^<m:rad><m:radPr><m:degHide m:val="1"\/><\/m:radPr><m:deg\/><m:e>.*x<\/m:t>.*<\/m:e><\/m:rad>$/);
        expect(omml("\\sqrt[3]{y}")).toMatch(/^<m:rad><m:deg>.*>3<\/m:t>.*<\/m:deg><m:e>.*>y<\/m:t>.*<\/m:e><\/m:rad>$/);
    });

    it("Greek letters and symbols as their characters, upright where LaTeX sets them upright", () => {
        const xml = omml("\\alpha + \\Gamma \\le \\infty \\cdot \\nabla");
        expect(texts(xml)).toBe("α+Γ≤∞⋅∇");
        expect(xml).toMatch(/<m:r><m:rPr><m:sty m:val="p"\/><\/m:rPr>.*?Γ<\/m:t>/);
        expect(xml).not.toMatch(/<m:sty m:val="p"\/><\/m:rPr><w:rPr>[^]*?α/);
    });

    it("function names upright, and invisible function application left out", () => {
        const xml = omml("\\sin x + \\log_2 y + \\operatorname{argmax}_\\theta f");
        expect(xml).toMatch(/<m:sty m:val="p"\/><\/m:rPr>.*?>sin<\/m:t>/);
        expect(xml).toContain(">argmax</m:t>");
        expect(xml).not.toContain("\u{2061}");
    });

    it("big operators with limits take the operand that follows them", () => {
        const sum = omml("\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}");
        expect(sum).toMatch(/^<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr><m:sub>.*<\/m:sub><m:sup>.*>n<\/m:t>.*<\/m:sup><m:e><m:sSup>.*<\/m:sSup><\/m:e><\/m:nary>/);
        // The relation after the operand is not inside it.
        expect(sum).toMatch(/<\/m:nary><m:r>.*>=<\/m:t><\/m:r><m:f>/);
        const integral = omml("\\int_0^1 x^2\\,dx");
        expect(integral).toMatch(/^<m:nary><m:naryPr><m:limLoc m:val="subSup"\/><\/m:naryPr><m:sub>.*>0<.*<\/m:sub><m:sup>.*>1<.*<\/m:sup><m:e>/);
        expect(texts(integral)).toBe("01x2\u{2009}dx");
        expect(omml("\\prod_{k} a_k")).toMatch(/<m:chr m:val="∏"\/><m:limLoc m:val="undOvr"\/><m:supHide m:val="1"\/>/);
        // Integrals keep Word's default of limits beside the sign.
        expect(omml("\\oint F")).toMatch(/<m:chr m:val="∮"\/><m:limLoc m:val="subSup"\/><m:subHide m:val="1"\/><m:supHide m:val="1"\/>/);
        // Inline, limits go beside the operator.
        expect(omml("\\sum_{i=1}^n i", false)).toMatch(/<m:limLoc m:val="subSup"\/>/);
        // A sum of sums nests, and a sign between terms ends an operand.
        expect(omml("\\sum_i \\sum_j a_{ij}")).toMatch(/^<m:nary>.*<m:e><m:nary>.*<\/m:nary><\/m:e><\/m:nary>$/);
        expect(omml("\\int f\\,dx + \\int g\\,dx").match(/<m:nary>/g)).toHaveLength(2);
        // Brackets after the operator stay whole in its operand, signs inside them included.
        const bracketed = omml("\\int (3x^2 + 2x)\\,dx");
        expect(bracketed).toMatch(/<m:e><m:r>.*>\(<\/m:t>.*>\+<\/m:t>.*>\)<\/m:t>.*>d<\/m:t>.*>x<\/m:t><\/m:r><\/m:e><\/m:nary>$/);
        expect(texts(bracketed)).toBe("(3x2+2x)\u{2009}dx");
        expect(omml("\\int_a^b [f(x) + g(x)]\\,dx")).toMatch(/<m:e><m:r>.*>\[<\/m:t>.*>\]<\/m:t>.*<\/m:e><\/m:nary>$/);
        expect(omml("\\sum_{k=1}^n (a_k + b_k) = S")).toMatch(/>\)<\/m:t><\/m:r><\/m:e><\/m:nary><m:r>.*>=<\/m:t>/);
    });

    it("accents, over- and underlines", () => {
        const accent = (tex: string) => /<m:accPr><m:chr m:val="([^"]+)"\/><\/m:accPr>/.exec(omml(tex))?.[1];
        expect(accent("\\hat{x}")).toBe("\u{302}");
        expect(accent("\\widehat{abc}")).toBe("\u{302}");
        expect(accent("\\bar{x}")).toBe("\u{305}");
        expect(accent("\\tilde{x}")).toBe("\u{303}");
        expect(accent("\\dot{x}")).toBe("\u{307}");
        expect(accent("\\ddot{x}")).toBe("\u{308}");
        expect(accent("\\vec{v}")).toBe("\u{20d7}");
        expect(accent("\\overrightarrow{AB}")).toBe("\u{20d7}");
        expect(accent("\\acute{a}")).toBe("\u{301}");
        expect(accent("\\check{a}")).toBe("\u{30c}");
        expect(omml("\\overline{AB}")).toMatch(/^<m:bar><m:barPr><m:pos m:val="top"\/><\/m:barPr><m:e>/);
        expect(omml("\\underline{x}")).toMatch(/^<m:bar><m:e>/);
    });

    it("braces with labels, stacked symbols and labelled arrows", () => {
        expect(omml("\\underbrace{c+d}_{m}")).toMatch(/^<m:limLow><m:e><m:groupChr><m:groupChrPr><m:chr m:val="⏟"\/><\/m:groupChrPr>.*<\/m:groupChr><\/m:e><m:lim>.*>m<.*<\/m:lim><\/m:limLow>$/);
        expect(omml("\\overbrace{a+b}^{n}")).toMatch(/^<m:limUpp><m:e><m:groupChr><m:groupChrPr><m:chr m:val="⏞"\/><m:pos m:val="top"\/><m:vertJc m:val="bot"\/><\/m:groupChrPr>/);
        expect(omml("\\overset{!}{=}")).toMatch(/^<m:limUpp><m:e>.*>=<.*<\/m:e><m:lim>.*>!<.*<\/m:lim><\/m:limUpp>$/);
        expect(omml("\\lim_{x \\to 0} \\frac{\\sin x}{x}")).toMatch(/^<m:limLow><m:e>.*>lim<\/m:t>.*<\/m:e><m:lim>.*→.*<\/m:lim><\/m:limLow>/);
        expect(omml("\\underset{\\theta}{\\operatorname{argmin}} L")).toMatch(/^<m:limLow><m:e>.*>argmin<\/m:t>.*<\/m:e><m:lim>.*>θ<.*<\/m:lim><\/m:limLow>/);
        const arrow = omml("A \\xrightarrow{f} B");
        expect(arrow).toMatch(/<m:groupChr><m:groupChrPr><m:chr m:val="→"\/><m:vertJc m:val="bot"\/><\/m:groupChrPr><m:e>.*>f<\/m:t>.*<\/m:e><\/m:groupChr>/);
    });

    it("delimiters that grow, with \\middle, and brackets that don't", () => {
        expect(omml("\\left( \\frac{a}{b} \\right)")).toMatch(/^<m:d><m:e><m:f>/);
        expect(omml("\\left[ x \\right]")).toMatch(/^<m:d><m:dPr><m:begChr m:val="\["\/><m:endChr m:val="\]"\/><\/m:dPr>/);
        expect(omml("\\left\\{ y \\right\\}")).toMatch(/<m:begChr m:val="\{"\/><m:endChr m:val="\}"\/>/);
        expect(omml("\\left| z \\right|")).toMatch(/<m:begChr m:val="\|"\/><m:endChr m:val="\|"\/>/);
        expect(omml("\\left. \\frac{d}{dx} \\right|_{x=0}")).toMatch(/^<m:sSub><m:e><m:d><m:dPr><m:begChr m:val=""\/><m:endChr m:val="\|"\/><\/m:dPr>/);
        expect(omml("\\left\\langle \\psi \\middle| \\phi \\right\\rangle")).toMatch(/^<m:d><m:dPr><m:begChr m:val="⟨"\/><m:sepChr m:val="\|"\/><m:endChr m:val="⟩"\/><\/m:dPr><m:e>.*ψ.*<\/m:e><m:e>.*ϕ.*<\/m:e><\/m:d>$/);
        // f(x): ordinary parentheses stay characters, as LaTeX sets them.
        const plain = omml("f(x)");
        expect(plain).not.toContain("<m:d>");
        expect(texts(plain)).toBe("f(x)");
    });

    it("matrices of every bracket", () => {
        const pmatrix = omml("\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}");
        expect(pmatrix).toMatch(/^<m:d><m:e><m:m><m:mPr><m:plcHide m:val="1"\/><m:mcs>(<m:mc><m:mcPr><m:count m:val="1"\/><m:mcJc m:val="center"\/><\/m:mcPr><\/m:mc>){2}<\/m:mcs><\/m:mPr><m:mr>(<m:e>.*?<\/m:e>){2}<\/m:mr><m:mr>(<m:e>.*?<\/m:e>){2}<\/m:mr><\/m:m><\/m:e><\/m:d>$/);
        expect(texts(pmatrix)).toBe("1234");
        expect(omml("\\begin{bmatrix} a \\\\ b \\end{bmatrix}")).toMatch(/^<m:d><m:dPr><m:begChr m:val="\["\/><m:endChr m:val="\]"\/><\/m:dPr><m:e><m:m>/);
        expect(omml("\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}")).toMatch(/<m:begChr m:val="\|"\/><m:endChr m:val="\|"\/>/);
        expect(omml("\\begin{matrix} 1 & 0 \\end{matrix}")).toMatch(/^<m:m>/);
        // Short rows are padded to the widest.
        expect(omml("\\begin{bmatrix} 1 & 0 & 0 \\\\ 0 \\end{bmatrix}").match(/<m:e[>/]/g)!.length).toBe(1 + 6);
    });

    it("cases, as a brace before left-aligned columns", () => {
        const cases = omml("f(x) = \\begin{cases} x & x \\ge 0 \\\\ -x & \\text{otherwise} \\end{cases}");
        expect(cases).toMatch(/<m:d><m:dPr><m:begChr m:val="\{"\/><m:endChr m:val=""\/><\/m:dPr><m:e><m:m><m:mPr><m:plcHide m:val="1"\/><m:mcs>(<m:mc><m:mcPr><m:count m:val="1"\/><m:mcJc m:val="left"\/><\/m:mcPr><\/m:mc>){2}<\/m:mcs>/);
        expect(cases).toContain("<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space=\"preserve\">otherwise</m:t></m:r>");
    });

    it("aligned and gathered lines as an equation array, aligned at &", () => {
        const aligned = omml("\\begin{aligned} a &= b + c \\\\ d &= e \\end{aligned}");
        expect(aligned).toMatch(/^<m:eqArr><m:e>.*<\/m:e><m:e>.*<\/m:e><\/m:eqArr>$/);
        expect(aligned.match(/<m:aln\/>/g)).toHaveLength(2);
        expect(aligned).toMatch(/<m:r><m:rPr><m:aln\/><\/m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"\/><\/w:rPr><m:t xml:space="preserve">=<\/m:t><\/m:r>/);
        expect(omml("\\begin{gathered} a \\\\ b \\end{gathered}")).toMatch(/^<m:eqArr><m:e>.*>a<.*<\/m:e><m:e>.*>b<.*<\/m:e><\/m:eqArr>$/);
        expect(omml("\\begin{align} a &= b \\\\ c &= d \\end{align}").match(/<m:aln\/>/g)).toHaveLength(2);
        // Display math with a bare line break, as AI answers write it, becomes lines too.
        expect(omml("a = 1 \\\\ b = 2")).toMatch(/^<m:eqArr>/);
        expect(omml("x &= 1 \\\\ y &= 2").match(/<m:aln\/>/g)).toHaveLength(2);
    });

    it("text, spacing, colour, boxes, cancels and tags", () => {
        // Temml keeps the space ending \text{if } as a no-break space, which Word shows as a space.
        expect(omml("\\text{if } x")).toContain("<m:rPr><m:nor/></m:rPr><m:t xml:space=\"preserve\">if\u{a0}</m:t>");
        expect(texts(omml("a \\quad b \\qquad c \\, d \\; e"))).toBe("a\u{2003}b\u{2003}\u{2003}c\u{2009}d\u{2004}e");
        expect(omml("\\color{red}{z}")).toContain("<w:color w:val=\"FF0000\"/>");
        expect(omml("\\boxed{x}")).toMatch(/^<m:borderBox><m:e>/);
        expect(omml("\\cancel{y}")).toMatch(/^<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"\/><m:hideBot m:val="1"\/><m:hideLeft m:val="1"\/><m:hideRight m:val="1"\/><m:strikeBLTR m:val="1"\/><\/m:borderBoxPr>/);
        expect(omml("E = mc^2 \\tag{1}").endsWith("<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space=\"preserve\">\u{2003}(1)</m:t></m:r>")).toBe(true);
        expect(texts(omml("\\begin{equation} x = 1 \\end{equation}"))).toBe("x=1");
        // \phantom only reserves space: it is left out, never shown.
        expect(texts(omml("a\\phantom{-}b"))).toBe("ab");
    });

    it("bold, script and blackboard letters, from Temml's Unicode letters", () => {
        expect(texts(omml("\\mathbf{x} + \\mathbb{R} + \\mathcal{L}"))).toBe("𝐱+ℝ+ℒ");
    });

    it("escapes what XML needs escaped, and leaves out what it can't hold", () => {
        expect(omml("a < b")).toContain(">&lt;</m:t>");
        expect(omml("\\text{a \\& b}").replace(/\u{a0}/gu, " ")).toContain(">a &amp; b</m:t>");
        expect(omml("\\text{a\u{ffff}b\u{fffe}c}")).toContain(">abc</m:t>");
    });

    it("keeps unsupported or invalid LaTeX as text, saying why", () => {
        expect(reason("\\unknownmacro{x}")).toBe("\\unknownmacro isn’t supported");
        expect(reason("\\href{https://example.com}{x}")).toBe("\\href isn’t supported");
        expect(reason("\\frac{a")).toBe("it isn’t LaTeX that can be read");
        expect(reason("\\prescript{14}{6}{C}")).toBe("prescripts aren’t supported");
        expect(reason("x".repeat(20001))).toBe("it is too long to convert");
        expect(reason("   ")).toBe("it is empty");
    });

    it("reads only well-formed MathML, and maps nothing it does not know", () => {
        expect(() => parseMathML("<math><mi>x</mo></math>")).toThrow();
        expect(() => parseMathML("<math><mi>x</mi>")).toThrow();
        expect(() => mathmlToOmml(parseMathML("<math><mglyph></mglyph></math>"))).toThrow(Unsupported);
        expect(mathmlToOmml(parseMathML("<math><mi>a</mi><mo>&amp;</mo><mn>&#x31;</mn></math>"))).toContain(">&amp;</m:t>");
    });

    it("sets line breaks outside environments as gathered or aligned lines", () => {
        expect(prepareTex("a \\\\ b", true)).toBe("\\begin{gathered}a \\\\ b\\end{gathered}");
        expect(prepareTex("a &= 1 \\\\ b &= 2", true)).toBe("\\begin{aligned}a &= 1 \\\\ b &= 2\\end{aligned}");
        expect(prepareTex("\\begin{pmatrix} a \\\\ b \\end{pmatrix}", true)).toBe("\\begin{pmatrix} a \\\\ b \\end{pmatrix}");
        expect(prepareTex("\\frac{a}{b \\\\ c}", true)).toBe("\\frac{a}{b \\\\ c}");
        expect(prepareTex("a \\\\ b", false)).toBe("a \\\\ b");
    });

    it("converts the equations AI answers use most without falling back", () => {
        const common = [
            "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
            "E = mc^2",
            "\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}",
            "\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e",
            "P(A \\mid B) = \\frac{P(B \\mid A) \\, P(A)}{P(B)}",
            "\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}",
            "\\mathbb{E}[X] = \\sum_{x} x \\, p(x)",
            "\\hat{\\beta} = (X^\\top X)^{-1} X^\\top y",
            "\\sigma(z) = \\frac{1}{1 + e^{-z}}",
            "\\text{softmax}(z_i) = \\frac{e^{z_i}}{\\sum_{j} e^{z_j}}",
            "\\begin{aligned} f'(x) &= \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h} \\end{aligned}",
            "\\binom{n}{k} = \\frac{n!}{k!(n-k)!}",
            "a^2 + b^2 = c^2",
            "\\theta \\leftarrow \\theta - \\eta \\nabla_\\theta J(\\theta)",
            "\\det(A - \\lambda I) = 0",
            "\\|x\\|_2 = \\sqrt{\\sum_i x_i^2}",
            "\\vec{F} = m \\vec{a}",
            "\\frac{\\partial L}{\\partial w} = \\frac{1}{n} \\sum_{i=1}^{n} (\\hat{y}_i - y_i) x_i",
            "\\ce{H2O}",
            "f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}",
        ];
        for (const tex of common) expect(latexToOmml(temml, tex, true), tex).toMatchObject({ ok: true });
    });
});
