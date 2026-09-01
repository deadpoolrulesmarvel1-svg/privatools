export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  readTime: string;
  tags: string[];
  body: string;
  author?: string;
  /** Short, snippet-optimised summary rendered at the top of the post and
   *  used in the `speakable` JSON-LD selector for voice/AEO/GEO surfaces. */
  tldr?: string;
  /** Slugs of related tools to surface in the article's "Tools mentioned"
   *  panel. Drives internal linking + gives AI engines a concrete entity
   *  graph for the post. */
  relatedTools?: string[];
}

export const blogPosts: BlogPost[] = [
  {
    slug: "compress-pdf-without-losing-quality",
    title: "How to Compress a PDF Without Losing Quality",
    description:
      "Learn how to reduce PDF file size by up to 90% without visible quality loss. Three methods compared: online tools, desktop apps, and command-line.",
    publishedAt: "2026-03-22",
    readTime: "5 min read",
    tldr:
      "Use lossy compression at a balanced setting (PrivaTools' 'Recommended' level) to cut PDF size by 60–90% with no visible quality loss. Lossless saves only 5–30% but never touches image data. For maximum reduction, drop image DPI to 96 and lower JPEG quality.",
    relatedTools: ["compress-pdf", "batch-compress-pdf", "web-optimize-pdf"],
    tags: ["PDF", "Compression", "How-To"],
    body: `
<p>PDF files can balloon to enormous sizes — especially scanned documents, presentations, and forms with embedded images. Emailing a 50&nbsp;MB PDF frustrates everyone involved. The good news: you can typically cut that size by 60–90% without any visible loss in quality.</p>

<h2>Why PDF Files Get So Large</h2>
<p>PDFs store several types of data that balloon file sizes:</p>
<ul>
  <li><strong>Embedded images</strong> — The biggest culprit. A single high-resolution TIFF scan can add 10–20&nbsp;MB.</li>
  <li><strong>Embedded fonts</strong> — Full font subsets include every glyph in the typeface, adding overhead even for rarely used characters.</li>
  <li><strong>Revision history</strong> — Deleted content, old form-field states, and comment threads linger invisibly in the file structure.</li>
  <li><strong>Duplicate resources</strong> — The same image referenced on multiple pages is sometimes embedded multiple times.</li>
</ul>

<h2>Lossless vs Lossy Compression</h2>
<p>There are two fundamentally different ways to shrink a PDF:</p>
<p><strong>Lossless compression</strong> removes redundant data structures without touching any content. Images remain at their original quality. Typical savings: 5–30%.</p>
<p><strong>Lossy compression</strong> resamples embedded images at a lower DPI or higher JPEG ratio. Images look nearly identical on screen and when printed at standard sizes, but pixel data is permanently altered. Typical savings: 40–90%.</p>
<p>For most everyday uses — sharing reports, uploading to portals, emailing forms — lossy compression at a "balanced" setting is the right choice. The quality difference is invisible at normal viewing sizes.</p>

<h2>Method 1: Compress PDF Online (Fastest, Free, No Software)</h2>
<p>The fastest method requires nothing but a browser:</p>
<ol>
  <li>Open <a href="/tool/compress-pdf">PrivaTools Compress PDF</a>.</li>
  <li>Drag and drop your PDF (or click to browse).</li>
  <li>Choose a compression level: <em>Light</em>, <em>Balanced</em>, or <em>Extreme</em>.</li>
  <li>Click <strong>Compress</strong> and download the result instantly.</li>
</ol>
<p>Your file is processed and immediately deleted after download — it is never stored, indexed, or shared. If file privacy matters (medical records, legal documents, financials), this matters.</p>

<h2>Method 2: Adobe Acrobat (Desktop, Paid)</h2>
<p>Acrobat Pro's <em>Reduce File Size</em> and <em>PDF Optimizer</em> tools give granular control — you can independently dial down image DPI, remove embedded fonts, strip metadata, and prune revision history. Results are excellent but require an Acrobat Pro subscription (~$23/month).</p>
<p>For occasional compression needs, this is overkill. Use an online tool instead.</p>

<h2>Method 3: Ghostscript (Command-Line, Free, Batch)</h2>
<p>For developers or power users compressing many files:</p>
<pre><code>gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
   -dPDFSETTINGS=/ebook \
   -dNOPAUSE -dQUIET -dBATCH \
   -sOutputFile=output.pdf input.pdf</code></pre>
<p>The <code>-dPDFSETTINGS</code> flag controls quality: <code>/screen</code> (smallest), <code>/ebook</code> (balanced), <code>/printer</code> (high quality), <code>/prepress</code> (maximum quality).</p>

<h2>Tips to Get Maximum Compression</h2>
<ul>
  <li><strong>Strip metadata first</strong> — Remove author names, GPS data, and creation timestamps with <a href="/tool/strip-metadata">Strip PDF Metadata</a> before compressing.</li>
  <li><strong>Flatten filled forms</strong> — Interactive fields carry overhead. <a href="/tool/flatten-pdf">Flatten</a> the PDF before compressing if the form is already completed.</li>
  <li><strong>Remove blank pages</strong> — Scanned documents often include blank separators. <a href="/tool/remove-blank-pages">Delete them</a> first.</li>
  <li><strong>Don't compress twice</strong> — Running a compressed PDF through compression again yields minimal savings and can degrade quality further.</li>
</ul>

<h2>Realistic Size Expectations</h2>
<ul>
  <li><strong>Scanned documents (image PDFs)</strong>: 60–90% reduction with Balanced or Extreme.</li>
  <li><strong>PDFs with embedded JPEG photos</strong>: 20–50% reduction with Balanced.</li>
  <li><strong>Text-only PDFs</strong>: 5–20% reduction — there's little image data to compress.</li>
  <li><strong>Already-compressed PDFs</strong>: Minimal savings; may even increase size slightly.</li>
</ul>

<h2>The Bottom Line</h2>
<p>For most documents, the <strong>Balanced</strong> preset in a good PDF compressor will produce a file that looks identical to the original at all standard viewing sizes, at 40–70% smaller size. Start there — only reach for Extreme compression if file size is more critical than occasional print fidelity.</p>
<p><a href="/tool/compress-pdf">Try PrivaTools Compress PDF — free, no sign-up required →</a></p>
    `,
  },
  {
    slug: "merge-pdf-files-online-free",
    title: "How to Merge PDF Files Online for Free",
    description:
      "Step-by-step guide to combining multiple PDF files online for free. Drag, drop, reorder, and merge — no software, no account, no watermarks.",
    publishedAt: "2026-03-22",
    readTime: "4 min read",
    tldr:
      "Drop 2+ PDFs into a free merger like PrivaTools, drag-reorder, click Merge, download. No software, no account, no watermarks. Files are deleted from the server immediately after the response.",
    relatedTools: ["merge-pdf", "organize-pages", "image-to-pdf"],
    tags: ["PDF", "Merge", "How-To"],
    body: `
<p>Whether you're assembling a report from multiple chapters, combining signed contract pages, or packaging several scanned receipts into one file — merging PDFs is one of the most common file tasks. Here's how to do it online for free, without downloading anything.</p>

<h2>When You Need to Merge PDFs</h2>
<p>Common reasons people merge PDF files:</p>
<ul>
  <li>Combining chapters or sections written separately into one document</li>
  <li>Assembling a job application (resume, cover letter, portfolio) as a single PDF</li>
  <li>Collating multiple invoices or receipts for expense reporting</li>
  <li>Combining front-side and back-side duplex scans in the correct order</li>
  <li>Packaging signed contract pages with attachments</li>
</ul>

<h2>How to Merge PDFs Online — Step by Step</h2>
<ol>
  <li>Open <a href="/tool/merge-pdf">PrivaTools Merge PDF</a> in your browser.</li>
  <li>Click <strong>Add Files</strong> or drag and drop multiple PDFs into the upload zone. You can add as many files as you need.</li>
  <li><strong>Reorder the files</strong> by dragging them into the desired sequence. The top file will be the first pages of the merged document.</li>
  <li>Optionally preview individual file thumbnails to verify page order before merging.</li>
  <li>Click <strong>Merge PDF</strong>. The combined file downloads to your device within seconds.</li>
</ol>
<p>No account, no email, no watermark. The merged PDF is yours entirely — PrivaTools does not retain any copy of your files.</p>

<h2>Page-Level Control</h2>
<p>If you need to merge specific pages rather than entire files, use <a href="/tool/extract-pages">Extract Pages</a> to pull the pages you want from each source PDF first, then merge the extracts. This gives you precise control over exactly which content ends up in the final document.</p>

<h2>Merging Scanned Documents (Duplex Order)</h2>
<p>Scanners that do single-sided scanning produce two files from a double-sided document: all the odd pages in one scan, all the even pages in another — often in reverse order. The <a href="/tool/alternate-mix">Alternate Mix</a> tool interleaves pages from two PDFs in alternating fashion, reconstructing the correct double-sided page order automatically.</p>

<h2>Privacy Considerations</h2>
<p>Most free online PDF mergers upload your files to their servers, process them, and store them for a period afterward (sometimes 1–24 hours). If your PDFs contain sensitive content — legal contracts, financial statements, medical records — this matters.</p>
<p>PrivaTools processes files through a FastAPI backend and deletes them immediately after your download. The source code is open and auditable at <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools" target="_blank" rel="noopener">GitHub</a>. If you want total certainty, you can self-host the entire stack with Docker.</p>

<h2>What About File Size Limits?</h2>
<p>PrivaTools supports uploads up to 500&nbsp;MB per file — far more generous than most free tools. Even large scan archives and high-resolution documents can be merged directly without pre-compression.</p>

<h2>Alternatives to Online Merging</h2>
<ul>
  <li><strong>macOS Preview</strong> — Drag thumbnails between open PDFs in the sidebar. Built-in, no software needed.</li>
  <li><strong>pdftk (command-line)</strong> — <code>pdftk file1.pdf file2.pdf cat output merged.pdf</code>. Fast for batch scripts.</li>
  <li><strong>Adobe Acrobat</strong> — Reliable but requires a paid subscription.</li>
</ul>
<p>For quick, occasional merges without installing anything, an online tool is the fastest option.</p>

<p><a href="/tool/merge-pdf">Merge your PDFs now — free, private, no sign-up →</a></p>
    `,
  },
  {
    slug: "best-free-pdf-tools-2026",
    title: "Best Free PDF Tools in 2026: Honest Comparison",
    description:
      "We tested 8 free PDF tool suites in 2026. Honest verdict on which are truly free, which have hidden limits, and which respect your privacy.",
    publishedAt: "2026-03-22",
    readTime: "8 min read",
    tldr:
      "In 2026: PrivaTools (100% free, open source, 221 tools) and PDF24 (free with cloud uploads) lead. Smallpdf and iLovePDF impose aggressive free-tier quotas. Sejda is best for editing PDF text but capped at 3 tasks/hour.",
    relatedTools: ["merge-pdf", "compress-pdf", "edit-pdf", "ocr-pdf", "pdf-to-word"],
    tags: ["PDF", "Comparison", "Review"],
    body: `
<p>Searching for "free PDF tools" returns hundreds of options — but many aren't truly free. Some limit you to 2 tasks per day. Others add watermarks unless you pay. A few quietly upload your documents to their servers and retain them indefinitely. This guide cuts through the noise.</p>

<h2>Our Testing Criteria</h2>
<p>We evaluated each tool on four dimensions:</p>
<ul>
  <li><strong>Actually free?</strong> No task limits, no file size caps, no paywalled essentials.</li>
  <li><strong>No account required?</strong> You shouldn't need to hand over your email to compress a PDF.</li>
  <li><strong>Privacy?</strong> Where do files go? How long are they retained? Is the code auditable?</li>
  <li><strong>Tool breadth?</strong> How many operations are covered? PDF-only vs multi-format?</li>
</ul>

<h2>1. PrivaTools — Best Overall for Privacy + Tool Count</h2>
<p><strong>Free:</strong> Yes, 100% · <strong>Account required:</strong> No · <strong>Tools:</strong> 200+ (PDF, image, video, audio, developer)</p>
<p>PrivaTools is open source (MIT license), self-hostable, and covers the most tool categories of any free suite tested. It handles PDF operations, image processing, video tools, and developer utilities — all in one place. Files are processed on the server and immediately deleted.</p>
<p><strong>Strengths:</strong> No task limits, no ads, no watermarks, open-source and auditable. Covers tools that most PDF suites don't touch (video compression, developer utilities, archive tools).</p>
<p><strong>Weaknesses:</strong> Server-side processing (not fully client-side). Newer service with a smaller community than established alternatives.</p>

<h2>2. iLovePDF — Most Popular, but Limited</h2>
<p><strong>Free:</strong> Limited · <strong>Account required:</strong> No · <strong>Tools:</strong> ~25 (PDF only)</p>
<p>iLovePDF is the most trafficked free PDF tool on the internet. The free tier allows basic operations without an account, but file sizes are capped at 25&nbsp;MB and the experience pushes aggressively toward premium upgrades. Files are uploaded to their servers and retained for a period after download.</p>
<p><strong>Verdict:</strong> Good for quick, low-stakes operations. Not suitable for sensitive documents.</p>

<h2>3. Smallpdf — Quality UX, Aggressive Limits</h2>
<p><strong>Free:</strong> 2 tasks/day · <strong>Account required:</strong> No · <strong>Tools:</strong> ~21 (PDF only)</p>
<p>Smallpdf is polished, fast, and handles most common PDF tasks. The 2-tasks-per-day free limit is the most commonly complained-about restriction in the PDF tool space. If you need to compress three files in one afternoon, you'll hit the wall.</p>
<p><strong>Verdict:</strong> Best UX in the free tier. Worst limit. Use sparingly.</p>

<h2>4. PDF24 — Genuinely Free, But Not Open Source</h2>
<p><strong>Free:</strong> Yes · <strong>Account required:</strong> No · <strong>Tools:</strong> ~45 (PDF + basic image)</p>
<p>PDF24 is the closest competitor to PrivaTools in terms of being genuinely free with no task limits. It covers a wide range of PDF operations, has a Windows desktop app, and doesn't require an account. The catch: it's not open source, so you can't audit what happens to your files, and it's ad-supported.</p>
<p><strong>Verdict:</strong> A solid choice if you need a free tool and privacy isn't a concern.</p>

<h2>5. Adobe Acrobat Online — Industry Standard, Expensive</h2>
<p><strong>Free:</strong> Very limited · <strong>Account required:</strong> Yes (Adobe ID) · <strong>Tools:</strong> ~15 free</p>
<p>Adobe's free online tier lets you do a handful of basic conversions per month, but the real tools (editing, signing, OCR) require a subscription. An Adobe ID is mandatory. Files are processed in the Adobe cloud.</p>
<p><strong>Verdict:</strong> Only worth it if you already have an Acrobat subscription. Otherwise, overkill.</p>

<h2>6. Sejda — Clean UI, Strict Hourly Limits</h2>
<p><strong>Free:</strong> 3 tasks/hour, 50&nbsp;MB limit · <strong>Account required:</strong> No · <strong>Tools:</strong> ~25 (PDF only)</p>
<p>Sejda has a clean, minimalist interface and genuinely good tools — especially its PDF editor. The 3-tasks-per-hour limit is more generous than Smallpdf's daily cap but still frustrating for heavy users. Files are deleted from Sejda's servers within 2 hours.</p>
<p><strong>Verdict:</strong> Good for occasional PDF editing. Better privacy policy than most alternatives.</p>

<h2>7. Stirling PDF — Best for Self-Hosting</h2>
<p><strong>Free:</strong> Yes (self-hosted) · <strong>Account required:</strong> No · <strong>Tools:</strong> ~50 (PDF only)</p>
<p>Stirling PDF is an open-source (GPL-3.0) PDF tool suite that you deploy yourself with Docker. If you want zero data leaving your network, this is the strongest option — but it requires technical knowledge to set up.</p>
<p><strong>Verdict:</strong> Best for privacy-conscious users with a home server or VPS. Not suitable for non-technical users.</p>

<h2>8. Foxit PDF — Business Grade, Fully Paid</h2>
<p><strong>Free:</strong> No (trial only) · <strong>Account required:</strong> Yes · <strong>Tools:</strong> PDF suite</p>
<p>Foxit is a legitimate Adobe Acrobat alternative for enterprise use, with strong editing and e-signature capabilities. There is no meaningful free tier — the trial converts files with watermarks.</p>
<p><strong>Verdict:</strong> Consider only for business use where you need desktop-grade PDF editing with support contracts.</p>

<h2>The Verdict</h2>
<p>If you want a tool that is genuinely free (no task limits, no upsells), handles more than just PDFs, and treats your files with respect: <a href="/">PrivaTools</a> is the answer. If you need a self-hosted option and have the technical skills: Stirling PDF. If you just need to compress one file and don't care about privacy: PDF24 works fine.</p>
<p>Avoid Smallpdf's 2-task limit for anything resembling regular use, and don't upload sensitive documents to iLovePDF or Adobe without reading their data retention policies.</p>
    `,
  },
  {
    slug: "remove-password-from-pdf",
    title: "How to Remove a Password from a PDF",
    description:
      "Three ways to remove or bypass a PDF password you own — online tool, Adobe Acrobat, and command-line — explained step by step.",
    publishedAt: "2026-03-22",
    readTime: "4 min read",
    tldr:
      "If you know the password: PrivaTools Unlock PDF or qpdf --password=… --decrypt. If you don't, you can't legally bypass it. 'Print to PDF' from a viewer is a workaround for owner-password-only PDFs.",
    relatedTools: ["unlock-pdf", "protect-pdf", "set-permissions"],
    tags: ["PDF", "Security", "How-To"],
    body: `
<p>PDF passwords come in two varieties, and understanding which type you're dealing with determines which removal method works.</p>

<h2>Two Types of PDF Passwords</h2>
<p><strong>Open password (user password)</strong> — Required to open and view the document. Without this password, the file appears as scrambled, unreadable data. This is true encryption.</p>
<p><strong>Permissions password (owner password)</strong> — Does not prevent opening the file, but restricts operations: printing, copying text, editing, or annotating. Many PDF tools can remove this type of restriction without knowing the password, because the file content itself isn't encrypted — only the permission flags are set.</p>
<p>The methods below apply to removing passwords from PDFs <strong>you legally own</strong>. Attempting to decrypt PDFs you don't have rights to is illegal in most jurisdictions.</p>

<h2>Method 1: Remove Password Online (Easiest)</h2>
<p>For PDFs where you know the open password:</p>
<ol>
  <li>Open <a href="/tool/unlock-pdf">PrivaTools Unlock PDF</a>.</li>
  <li>Upload your password-protected PDF.</li>
  <li>Enter the correct password when prompted.</li>
  <li>Download the unlocked PDF — password-free, fully accessible.</li>
</ol>
<p>This works for both open passwords (when you provide the correct one) and permissions passwords (restrictions are lifted). Your file is deleted immediately after download.</p>

<h2>Method 2: Adobe Acrobat (Desktop)</h2>
<p>If you have Acrobat Pro:</p>
<ol>
  <li>Open the PDF in Acrobat. Enter the password if prompted.</li>
  <li>Go to <strong>Tools → Protect → Security → Remove Security</strong>.</li>
  <li>If prompted for the permissions password, enter it. Click <strong>OK</strong>.</li>
  <li>Save the file. The password is removed from the saved copy.</li>
</ol>
<p>Acrobat also shows exactly which permissions are restricted and allows you to modify them individually.</p>

<h2>Method 3: Print to PDF (Works for Open Passwords You Know)</h2>
<p>A simple workaround available on any operating system:</p>
<ol>
  <li>Open the PDF in any viewer (enter the password).</li>
  <li>Use <strong>File → Print</strong> and select <strong>"Save as PDF"</strong> (macOS) or <strong>"Microsoft Print to PDF"</strong> (Windows) as the printer.</li>
  <li>Save the new PDF. It will be a copy without the password.</li>
</ol>
<p>Caveat: this re-renders the PDF as a new document. Complex layouts, hyperlinks, form fields, bookmarks, and exact font rendering may not be preserved. Use this only when you need the content, not the exact file structure.</p>

<h2>What If You Forgot the Password?</h2>
<p>If you've genuinely forgotten the password to a PDF you own, options are limited:</p>
<ul>
  <li>Check if the original sender can resend an unlocked version.</li>
  <li>Check your password manager or saved passwords.</li>
  <li>For permissions-only passwords (no open password), online tools like PrivaTools can often remove the restrictions without needing the password, since the file content is technically accessible.</li>
  <li>True open-password encryption (AES-128/256) cannot be broken with any online tool. Forensic password recovery software exists but is slow and not guaranteed for strong passwords.</li>
</ul>

<h2>How to Check What Kind of Password a PDF Has</h2>
<p>Try opening the PDF without a password:</p>
<ul>
  <li>If it opens but printing/copying is greyed out → it has a <strong>permissions password only</strong>. You can remove restrictions without the password using <a href="/tool/unlock-pdf">Unlock PDF</a>.</li>
  <li>If it won't open at all and demands a password → it has an <strong>open password</strong>. You must know the correct password to decrypt it.</li>
</ul>

<p><a href="/tool/unlock-pdf">Remove PDF password now — free, private, no sign-up →</a></p>
    `,
  },
  {
    slug: "convert-word-to-pdf-free",
    title: "How to Convert Word to PDF for Free",
    description:
      "5 ways to convert .docx files to PDF without Microsoft Office — online tools, Google Docs, LibreOffice — plus which preserves formatting best.",
    publishedAt: "2026-03-22",
    readTime: "5 min read",
    tldr:
      "Best preservation: open the .docx in Word/LibreOffice and Save as PDF. Online: PrivaTools Word to PDF or Office to PDF. Google Docs preserves layout fairly well. python-docx + reportlab works for plain text but loses complex formatting.",
    relatedTools: ["word-to-pdf", "office-to-pdf", "pdf-to-word"],
    tags: ["PDF", "Convert", "How-To"],
    body: `
<p>Converting a Word document to PDF is one of the most common file tasks — and one of the easiest to do for free. Here are five methods, from fastest to most control, with honest notes on which preserves formatting best.</p>

<h2>Why Convert Word to PDF?</h2>
<p>PDF is the universally readable format — it looks the same on every device, operating system, and screen size, regardless of whether the recipient has Microsoft Office installed. Sending a .docx file is risky: fonts may substitute, spacing may shift, and the layout you spent hours perfecting can look different on the other end. PDF locks the presentation.</p>

<h2>Method 1: PrivaTools Word to PDF (Online, No Software)</h2>
<p>The fastest option if you don't have Office installed:</p>
<ol>
  <li>Open <a href="/tool/word-to-pdf">PrivaTools Word to PDF</a>.</li>
  <li>Upload your .docx file (up to 100&nbsp;MB).</li>
  <li>Click <strong>Convert</strong> and download the PDF.</li>
</ol>
<p>Conversion uses LibreOffice under the hood, which handles most formatting correctly — headings, bold/italic, images, tables, and standard paragraph styles. Your file is deleted immediately after conversion.</p>
<p><strong>Formatting fidelity:</strong> Excellent for standard documents. Complex custom styles, tracked changes, or embedded macros may not survive perfectly.</p>

<h2>Method 2: Google Docs (Free, Browser-Based)</h2>
<ol>
  <li>Upload the .docx to Google Drive.</li>
  <li>Open it with Google Docs (right-click → Open with → Google Docs).</li>
  <li>Go to <strong>File → Download → PDF Document (.pdf)</strong>.</li>
</ol>
<p><strong>Formatting fidelity:</strong> Good for simple documents. Google Docs re-renders the document in its own engine, which can shift spacing on complex layouts. Headers/footers, custom page sizes, and intricate tables sometimes look different.</p>
<p><strong>Privacy note:</strong> Your document is uploaded to and processed by Google's servers. It will remain in your Google Drive unless you delete it.</p>

<h2>Method 3: Microsoft Word (Save as PDF)</h2>
<p>If you have Microsoft Word (desktop or Microsoft 365):</p>
<ol>
  <li>Open your document in Word.</li>
  <li>Go to <strong>File → Save As → PDF</strong> (or <strong>File → Export → Create PDF/XPS</strong>).</li>
  <li>Choose whether to optimize for <em>Standard</em> (print quality) or <em>Minimum size</em> (web).</li>
</ol>
<p><strong>Formatting fidelity:</strong> Best. Word renders its own format natively, preserving every typographic detail exactly.</p>
<p><strong>Cost:</strong> Requires a Microsoft 365 subscription or perpetual license.</p>

<h2>Method 4: LibreOffice (Free Desktop App)</h2>
<ol>
  <li><a href="https://www.libreoffice.org/download/libreoffice/" target="_blank" rel="noopener">Download and install LibreOffice</a> (free, open source).</li>
  <li>Open your .docx in LibreOffice Writer.</li>
  <li>Go to <strong>File → Export As → Export as PDF</strong>.</li>
</ol>
<p><strong>Formatting fidelity:</strong> Very good for standard documents. Matches what PrivaTools produces (same rendering engine). Better than Google Docs for complex layouts.</p>
<p><strong>Best for:</strong> Users who need offline conversion without a subscription.</p>

<h2>Method 5: macOS Print to PDF (Built-In)</h2>
<p>Every Mac has a built-in PDF printer — no software needed:</p>
<ol>
  <li>Open the .docx in any application (even Preview can open simple Word files).</li>
  <li>Press <strong>Cmd + P</strong> to open the Print dialog.</li>
  <li>Click the PDF dropdown in the bottom-left → <strong>Save as PDF</strong>.</li>
</ol>
<p><strong>Formatting fidelity:</strong> Depends on the application you used to open the file. If opened in Pages or Preview rather than Word, formatting can shift significantly.</p>

<h2>Which Method Preserves Formatting Best?</h2>
<table>
  <thead>
    <tr>
      <th>Method</th>
      <th>Formatting Fidelity</th>
      <th>Cost</th>
      <th>Privacy</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Microsoft Word</td><td>Excellent</td><td>Paid</td><td>Local</td></tr>
    <tr><td>LibreOffice</td><td>Very good</td><td>Free</td><td>Local</td></tr>
    <tr><td>PrivaTools</td><td>Very good</td><td>Free</td><td>Files deleted immediately</td></tr>
    <tr><td>Google Docs</td><td>Good</td><td>Free</td><td>Stored in Google Drive</td></tr>
    <tr><td>macOS Print to PDF</td><td>Varies</td><td>Free</td><td>Local</td></tr>
  </tbody>
</table>

<h2>What About .doc Files (Older Word Format)?</h2>
<p>All five methods above also work with the older .doc format, though formatting fidelity may be slightly lower due to the format's age and quirks. If possible, re-save .doc files as .docx before converting.</p>

<p><a href="/tool/word-to-pdf">Convert Word to PDF now — free, no sign-up required →</a></p>
    `,
  },
  {
    slug: "edit-pdf-online-free-no-sign-up",
    title: "How to Edit a PDF Online for Free — No Sign-Up Required",
    description:
      "Step-by-step guide to editing PDF text, images, and annotations online without creating an account. Compare 5 free methods.",
    publishedAt: "2026-03-29",
    readTime: "5 min read",
    tldr:
      "Sejda has the best free PDF text editor (3 tasks/hour). PrivaTools' Edit PDF adds annotations, text boxes, and drawings without a quota. PDFescape's free tier limits 10 MB / 100 pages.",
    relatedTools: ["edit-pdf", "annotate-pdf", "fill-form", "watermark"],
    tags: ["PDF", "Edit", "How-To"],
    body: `
<p>Need to add a sentence to a contract, fix a typo on a form, or annotate a report? Editing a PDF used to require expensive desktop software. Today you can do it in a browser for free — no account, no download, no watermark.</p>

<h2>What "Edit PDF" Actually Means</h2>
<p>PDF editing covers a wide range of operations, and not all tools handle all of them:</p>
<ul>
  <li><strong>Text annotation</strong> — Adding new text boxes, sticky notes, or comments on top of existing content. Nearly every tool supports this.</li>
  <li><strong>Form filling</strong> — Filling in interactive form fields (text boxes, checkboxes, dropdowns). Requires the PDF to have form fields defined.</li>
  <li><strong>Direct text editing</strong> — Modifying existing text in the PDF (changing words, fixing typos). This is harder because PDFs store text as positioned character runs, not editable paragraphs. Only a few tools do this well.</li>
  <li><strong>Image editing</strong> — Adding, replacing, or removing images within the PDF.</li>
  <li><strong>Page manipulation</strong> — Reordering, deleting, rotating, or adding pages.</li>
</ul>

<h2>Method 1: PrivaTools Edit PDF (Free, No Sign-Up)</h2>
<ol>
  <li>Open <a href="/tool/edit-pdf">PrivaTools Edit PDF</a>.</li>
  <li>Upload your PDF (up to 100&nbsp;MB).</li>
  <li>Use the toolbar to add text boxes, highlights, shapes, or freehand drawings on any page.</li>
  <li>Click Save to download the edited PDF with all changes flattened into the document.</li>
</ol>
<p>Annotations are permanently embedded — they'll appear in any PDF reader. Your file is deleted from the server within minutes.</p>

<h2>Method 2: PrivaTools Specialized Tools</h2>
<p>For specific editing tasks, dedicated tools often work better than a general editor:</p>
<ul>
  <li><a href="/tool/sign-pdf">Sign PDF</a> — Draw, type, or upload a signature image</li>
  <li><a href="/tool/annotate-pdf">Annotate PDF</a> — Highlights, underlines, strikethrough, sticky notes</li>
  <li><a href="/tool/fill-form">Fill PDF Form</a> — Fill interactive form fields</li>
  <li><a href="/tool/watermark">Watermark PDF</a> — Add text or image watermarks</li>
  <li><a href="/tool/redact-pdf">Redact PDF</a> — Permanently black out sensitive information</li>
  <li><a href="/tool/whiteout-pdf">White-Out PDF</a> — Cover content with white rectangles</li>
</ul>

<h2>Method 3: Google Docs (Free, Account Required)</h2>
<ol>
  <li>Upload the PDF to Google Drive.</li>
  <li>Right-click → Open with → Google Docs.</li>
  <li>Edit the text directly, then download as PDF.</li>
</ol>
<p><strong>Caveat:</strong> Google Docs converts the PDF to its own format, which frequently breaks formatting — columns collapse, images shift, fonts change. This works for simple text-only documents but is unreliable for anything with layout complexity.</p>

<h2>Method 4: macOS Preview (Free, Built-In)</h2>
<p>Preview on macOS lets you add text, shapes, signatures, and highlights to PDFs. It cannot edit existing text, but it handles annotations well. No software installation needed.</p>

<h2>Method 5: Adobe Acrobat Online (Limited Free)</h2>
<p>Adobe allows a few free operations per month with an Adobe ID. The editing tools are good but gated behind a subscription for regular use. Files are processed in Adobe's cloud.</p>

<h2>Can You Edit Text Directly in a PDF?</h2>
<p>True text editing (changing existing words) is technically possible but has limitations. PDFs don't store text as you'd expect — each character is individually positioned on the page. When you change a word, the surrounding text doesn't reflow automatically. For significant text changes, it's often better to convert the PDF back to Word with <a href="/tool/pdf-to-word">PDF to Word</a>, make your edits, and convert back with <a href="/tool/word-to-pdf">Word to PDF</a>.</p>

<h2>Privacy Matters When Editing Sensitive Documents</h2>
<p>Contracts, tax forms, medical records, legal filings — these are exactly the types of PDFs people need to edit, and exactly the types you shouldn't upload to random websites. PrivaTools processes files on the server and deletes them within minutes. The code is <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools" target="_blank" rel="noopener">open source</a> — you can verify this yourself or self-host the entire stack.</p>

<p><a href="/tool/edit-pdf">Edit your PDF now — free, no sign-up required →</a></p>
    `,
  },
  {
    slug: "split-pdf-online-free",
    title: "How to Split a PDF File Online — 3 Free Methods",
    description:
      "Three ways to split PDF files for free: by page range, by file size, and by bookmarks. No software needed, no sign-up.",
    publishedAt: "2026-03-29",
    readTime: "4 min read",
    tldr:
      "Three approaches: by page range (Split PDF), by file size for email attachment caps (Split by Size), by bookmarks/chapters (Split by Bookmarks). All free on PrivaTools, no sign-up.",
    relatedTools: ["split-pdf", "split-by-bookmarks", "split-by-size", "split-by-text", "extract-pages"],
    tags: ["PDF", "Split", "How-To"],
    body: `
<p>Whether you need to extract a few pages from a long report, break a document into email-friendly chunks, or separate chapters from a textbook — splitting a PDF is straightforward with the right tool.</p>

<h2>Three Ways to Split a PDF</h2>
<p>Different situations call for different splitting methods:</p>
<ul>
  <li><strong>By page range</strong> — "Give me pages 1-5 as one file and pages 6-20 as another." The most common use case.</li>
  <li><strong>By file size</strong> — "Break this 80&nbsp;MB scan into chunks under 10&nbsp;MB so I can email them." Useful for attachments.</li>
  <li><strong>By bookmarks</strong> — "Split this textbook into one PDF per chapter." Requires the PDF to have bookmarks defined.</li>
</ul>

<h2>Method 1: Split by Page Range (Most Common)</h2>
<ol>
  <li>Open <a href="/tool/split-pdf">PrivaTools Split PDF</a>.</li>
  <li>Upload your PDF (up to 100&nbsp;MB).</li>
  <li>Choose your split mode:
    <ul>
      <li><strong>Fixed interval</strong> — Split every N pages (e.g., every 5 pages creates separate PDFs).</li>
      <li><strong>Custom ranges</strong> — Specify exact page numbers (e.g., "1-3, 7-10, 15-20").</li>
      <li><strong>Extract every page</strong> — One PDF per page.</li>
    </ul>
  </li>
  <li>Click Split. The resulting files are packaged in a ZIP for download.</li>
</ol>

<h2>Method 2: Split by File Size</h2>
<p>When email size limits are the problem rather than page counts:</p>
<ol>
  <li>Open <a href="/tool/split-by-size">PrivaTools Split by Size</a>.</li>
  <li>Upload the PDF.</li>
  <li>Set the maximum file size per chunk (e.g., 10&nbsp;MB).</li>
  <li>The tool splits at page boundaries, keeping each part under your target size.</li>
</ol>
<p>This is particularly useful for large scanned documents that need to be emailed or uploaded to portals with size restrictions.</p>

<h2>Method 3: Split by Bookmarks / Chapters</h2>
<p>For structured documents like textbooks, manuals, or reports with a table of contents:</p>
<ol>
  <li>Open <a href="/tool/split-by-bookmarks">PrivaTools Split by Bookmarks</a>.</li>
  <li>Upload the PDF. The tool detects bookmark entries automatically.</li>
  <li>Choose the bookmark level to split at (top-level bookmarks = chapters, second-level = sections).</li>
  <li>Each section becomes its own PDF file.</li>
</ol>

<h2>Extract Just a Few Pages</h2>
<p>If you only need specific pages rather than splitting the entire document, <a href="/tool/extract-pages">Extract Pages</a> is more precise. Select individual pages or ranges and get a new PDF containing only those pages.</p>

<h2>Alternatives</h2>
<ul>
  <li><strong>macOS Preview</strong> — Drag pages from the sidebar to the desktop to create individual page PDFs. Manual but requires no tools.</li>
  <li><strong>pdftk (command-line)</strong> — <code>pdftk input.pdf cat 1-5 output pages1-5.pdf</code>. Excellent for scripting batch splits.</li>
  <li><strong>Adobe Acrobat</strong> — Full-featured splitting with preview, but requires a paid subscription.</li>
</ul>

<p><a href="/tool/split-pdf">Split your PDF now — free, no sign-up →</a></p>
    `,
  },
  {
    slug: "redact-pdf-free-guide",
    title: "How to Redact Sensitive Information from PDFs — Free Guide",
    description:
      "Learn how to permanently black out names, SSNs, addresses, and confidential text in PDFs. Understand why covering text with black boxes isn't enough.",
    publishedAt: "2026-03-29",
    readTime: "5 min read",
    tldr:
      "Drawing black rectangles over text doesn't redact — the text is still in the file. Use real redaction (PrivaTools Redact PDF or Smart Redact) which permanently removes the underlying content. Always verify with text extraction afterwards.",
    relatedTools: ["redact-pdf", "smart-redact", "strip-metadata", "sanitize-pdf"],
    tags: ["PDF", "Security", "Redaction", "How-To"],
    body: `
<p>PDF redaction permanently removes sensitive information from a document — names, Social Security numbers, financial data, addresses, or any confidential text. But there's a critical distinction between <em>real</em> redaction and simply drawing a black box over text.</p>

<h2>Why Black Boxes Aren't Enough</h2>
<p>A common mistake: people draw a black rectangle over sensitive text using a PDF editor and think it's hidden. It's not. The text underneath is still in the PDF file — anyone can select it, copy-paste it, or use a text extraction tool to read it. This has caused real data breaches in legal filings, government documents, and corporate reports.</p>
<p><strong>Real redaction</strong> permanently destroys the underlying text data. After proper redaction, the original content cannot be recovered — even by editing the PDF's raw source code.</p>

<h2>How to Redact a PDF Properly</h2>
<ol>
  <li>Open <a href="/tool/redact-pdf">PrivaTools Redact PDF</a>.</li>
  <li>Upload the document containing sensitive information.</li>
  <li>Draw rectangles over the text, images, or regions you want to permanently remove. You can also search for a specific word or phrase to auto-highlight all occurrences across every page.</li>
  <li>Preview the redactions to verify you've covered everything before committing.</li>
  <li>Click Redact. The underlying content is permanently destroyed and replaced with black boxes.</li>
</ol>
<p><strong>Warning:</strong> Redaction is irreversible. Once applied, the original text cannot be recovered. Always keep an unredacted backup copy of the original document.</p>

<h2>What Gets Removed During Redaction?</h2>
<p>Proper redaction removes:</p>
<ul>
  <li>The visible text and images under the redaction box</li>
  <li>The underlying text data (not just the visual layer)</li>
  <li>Any associated metadata linked to the redacted content</li>
</ul>
<p>For maximum security, combine redaction with <a href="/tool/sanitize-pdf">Sanitize PDF</a> to also remove hidden data, JavaScript, embedded files, and metadata layers.</p>

<h2>Common Redaction Mistakes</h2>
<ul>
  <li><strong>Using a black highlight instead of redaction</strong> — Highlights change the background color but don't remove the text data.</li>
  <li><strong>Using white-out</strong> — White rectangles hide text visually but the data is still selectable and extractable.</li>
  <li><strong>Forgetting headers and footers</strong> — Document names, case numbers, and dates often appear in headers/footers on every page.</li>
  <li><strong>Ignoring metadata</strong> — The document title, author name, and revision history may contain the same information you're redacting from the body. Use <a href="/tool/strip-metadata">Strip Metadata</a> after redacting.</li>
</ul>

<h2>When You Need Redaction</h2>
<ul>
  <li>FOIA (Freedom of Information Act) responses</li>
  <li>Legal discovery — removing privileged information before producing documents</li>
  <li>HR documents — removing SSNs, salaries, or personal details before sharing</li>
  <li>Medical records — HIPAA compliance when sharing patient documents</li>
  <li>Financial documents — removing account numbers before forwarding</li>
</ul>

<h2>Alternatives</h2>
<ul>
  <li><strong>Adobe Acrobat Pro</strong> — Has a dedicated Redact tool with search-and-redact. Paid subscription required.</li>
  <li><strong>PDF-XChange Editor</strong> — Windows-only, has redaction in the paid version.</li>
  <li><strong>Command-line (qpdf + mutool)</strong> — Technical but scriptable for batch redaction workflows.</li>
</ul>

<p><a href="/tool/redact-pdf">Redact your PDF now — free, permanent, no sign-up →</a></p>
    `,
  },
  {
    slug: "best-free-online-pdf-editors-2026",
    title: "The Best Free Online PDF Editors in 2026 — No Downloads Required",
    description:
      "We tested 7 free online PDF editors in 2026. Here's which ones are truly free, which add watermarks, and which respect your privacy.",
    publishedAt: "2026-03-29",
    readTime: "7 min read",
    tldr:
      "PrivaTools wins on unrestricted free editing with privacy. Sejda has the best text editor (limited free). PDF24 has the most features but uploads to their cloud. Adobe Acrobat Online is good but mostly paywalled.",
    relatedTools: ["edit-pdf", "annotate-pdf", "fill-form", "sign-pdf"],
    tags: ["PDF", "Editor", "Comparison", "Review"],
    body: `
<p>Every online PDF editor claims to be free. Most aren't — at least not in any meaningful way. After testing seven popular options, here's what we found.</p>

<h2>What We Tested</h2>
<p>We uploaded the same 15-page document (a mix of text, images, tables, and form fields) to each editor and tested: adding text, adding a signature, highlighting, filling forms, and re-downloading. We checked for watermarks, file size limits, task limits, account requirements, and how files are handled after download.</p>

<h2>1. PrivaTools — Best for Privacy + No Limits</h2>
<p><strong>Price:</strong> Free · <strong>Account:</strong> Not required · <strong>Watermarks:</strong> None · <strong>File limit:</strong> 500 MB</p>
<p><a href="/tool/edit-pdf">PrivaTools Edit PDF</a> lets you add text, highlights, shapes, and signatures to any PDF. It also offers 76 other PDF tools — from <a href="/tool/merge-pdf">merging</a> to <a href="/tool/ocr-pdf">OCR</a> to <a href="/tool/redact-pdf">redaction</a> — all free, all without accounts.</p>
<p><strong>Privacy:</strong> Files are processed on the server and deleted within minutes. The source code is open and auditable on GitHub. You can self-host the entire stack with Docker for complete control.</p>
<p><strong>Best for:</strong> Users who need frequent PDF editing without limits and care about where their files go.</p>

<h2>2. Sejda — Best General-Purpose Editor</h2>
<p><strong>Price:</strong> Free (3 tasks/hour) · <strong>Account:</strong> Not required · <strong>Watermarks:</strong> None · <strong>File limit:</strong> 50 MB</p>
<p>Sejda's online editor is arguably the most full-featured free option for direct text editing — you can click on existing text and modify it, not just add annotations. The 3-task-per-hour limit is the main downside.</p>
<p><strong>Best for:</strong> Occasional editing where you need to modify existing text rather than just annotate.</p>

<h2>3. PDF24 — Most Generous Free Tier</h2>
<p><strong>Price:</strong> Free · <strong>Account:</strong> Not required · <strong>Watermarks:</strong> None · <strong>File limit:</strong> Generous</p>
<p>PDF24 is genuinely free with no task limits. The editor is functional but basic — it handles annotations, form filling, and simple text addition. Not open source, and files are uploaded to their servers.</p>
<p><strong>Best for:</strong> Users who need a no-limits free tool and don't prioritize privacy.</p>

<h2>4. PDFescape — Simple but Dated</h2>
<p><strong>Price:</strong> Free (10 MB, 100 pages) · <strong>Account:</strong> Not required · <strong>Watermarks:</strong> None</p>
<p>PDFescape works for basic editing — adding text, forms, annotations. The interface feels outdated compared to modern alternatives, and the 10 MB file limit is restrictive. It was one of the first free online PDF editors and still gets traffic from brand recognition.</p>
<p><strong>Best for:</strong> Quick, simple edits on small documents.</p>

<h2>5. Smallpdf — Polished but Restrictive</h2>
<p><strong>Price:</strong> Free (2 tasks/day) · <strong>Account:</strong> Not required · <strong>Watermarks:</strong> None on free</p>
<p>Smallpdf's editor is clean and well-designed. The 2-task daily limit makes it impractical for regular use. Files are uploaded to Smallpdf's servers and retained for a period.</p>
<p><strong>Best for:</strong> A one-off edit when you need a quick, polished experience.</p>

<h2>6. iLovePDF — Popular but Limited</h2>
<p><strong>Price:</strong> Free (limited) · <strong>Account:</strong> Optional · <strong>Watermarks:</strong> On some exports</p>
<p>iLovePDF's editor handles basic annotations. Free users face file size limits (25 MB), and the experience pushes aggressively toward premium. Files are uploaded to and retained on their servers.</p>
<p><strong>Best for:</strong> Light use when other options aren't available.</p>

<h2>7. Adobe Acrobat Online — Best Features, Worst Free Tier</h2>
<p><strong>Price:</strong> Very limited free · <strong>Account:</strong> Required (Adobe ID) · <strong>Watermarks:</strong> None</p>
<p>Adobe's online tools are technically excellent but gated behind an account and a limited free tier. Meaningful editing requires a subscription (~$23/month). Files go through Adobe's cloud.</p>
<p><strong>Best for:</strong> Users who already have an Adobe subscription.</p>

<h2>Comparison Table</h2>
<table>
  <thead>
    <tr><th>Editor</th><th>Truly Free?</th><th>Account?</th><th>Limit</th><th>Privacy</th></tr>
  </thead>
  <tbody>
    <tr><td>PrivaTools</td><td>Yes</td><td>No</td><td>500 MB</td><td>Open source, files deleted</td></tr>
    <tr><td>Sejda</td><td>3 tasks/hr</td><td>No</td><td>50 MB</td><td>Deleted in 2 hours</td></tr>
    <tr><td>PDF24</td><td>Yes</td><td>No</td><td>Generous</td><td>Uploaded to their servers</td></tr>
    <tr><td>PDFescape</td><td>Yes</td><td>No</td><td>10 MB</td><td>Uploaded to their servers</td></tr>
    <tr><td>Smallpdf</td><td>2 tasks/day</td><td>No</td><td>Varies</td><td>Retained temporarily</td></tr>
    <tr><td>iLovePDF</td><td>Limited</td><td>No</td><td>25 MB</td><td>Retained on servers</td></tr>
    <tr><td>Adobe</td><td>Very limited</td><td>Yes</td><td>Varies</td><td>Adobe cloud</td></tr>
  </tbody>
</table>

<h2>The Bottom Line</h2>
<p>For unrestricted free editing with privacy: <a href="/tool/edit-pdf">PrivaTools</a>. For the best direct text editing (with limits): Sejda. For no-limits without caring about privacy: PDF24. Everything else either costs money, limits you to a handful of tasks, or both.</p>
    `,
  },

  // ─── v1.3.0 SEO additions ──────────────────────────────────────────────
  {
    slug: "ai-pdf-summarizer-browser-2026",
    title: "AI PDF Summarizer: How to Summarize Long PDFs in Your Browser (2026 Guide)",
    description:
      "How AI-powered PDF summarizers work, why running them in the browser matters, and a step-by-step walkthrough of summarizing a 100-page PDF without any upload — entirely on your device.",
    publishedAt: "2026-05-15",
    readTime: "9 min read",
    author: "PrivaTools Team",
    tldr:
      "Browser-side summarizers (PrivaTools Summarize PDF using distilbart-cnn in WebAssembly) keep your PDF local — verify with DevTools → Network. Cloud summarizers (Smallpdf, Adobe AI) upload it. A 100-page PDF summarises in 3–6 minutes locally on a modern laptop.",
    relatedTools: ["summarize-pdf", "smart-redact", "pdf-to-text"],
    tags: ["AI", "PDF", "Privacy", "How-To"],
    body: `
<p>Long PDFs are everywhere — research papers, contracts, legal filings, technical docs, financial reports. Reading them end-to-end is rarely the highest-value use of your time. AI summarization promises to give you the gist in seconds. But there's a catch most people miss: <strong>uploading a PDF to a cloud AI service hands the entire document to that service</strong>, often forever.</p>

<p>This guide explains how AI PDF summarization actually works, why browser-side summarization changes the privacy equation, and how to summarize a long PDF — even a 100-page one — without any data leaving your computer.</p>

<h2>What Is an AI PDF Summarizer?</h2>
<p>An AI PDF summarizer takes the text content of a PDF and produces a shorter version that preserves the key information. Modern summarizers fall into two architectures:</p>
<ul>
  <li><strong>Extractive</strong>: pulls out the most "important" sentences from the source verbatim. Fast, factually faithful, but choppy.</li>
  <li><strong>Abstractive</strong>: generates new sentences that paraphrase the source. Reads more naturally, but can hallucinate details that aren't in the original.</li>
</ul>
<p>The best 2026 summarizers are abstractive transformers — variants of BART, T5, or distilled GPT-style models — that have been fine-tuned on news, scientific papers, and dialog corpora.</p>

<h2>Why Browser-Side Summarization Matters</h2>
<p>Most "free" AI PDF summarizers operate the same way under the hood:</p>
<ol>
  <li>You upload the PDF to their servers.</li>
  <li>The text is extracted and run through a model in their data center.</li>
  <li>The summary is shown to you.</li>
  <li>Your PDF is retained — sometimes "for 24 hours", sometimes indefinitely, sometimes used to train future models.</li>
</ol>
<p>Read the privacy policies. Phrases like "we may use your content to improve our services" almost always mean your document is now training data.</p>
<p>For most public documents that doesn't matter. For confidential ones — medical records, legal drafts, internal strategy memos, financial statements — it absolutely does.</p>
<p>Browser-side summarization works differently:</p>
<ol>
  <li>The model itself is downloaded into your browser the first time you visit (usually 200–500 MB, cached in IndexedDB).</li>
  <li>The PDF text is extracted in JavaScript using pdf.js.</li>
  <li>The transformer runs in WebAssembly inside your browser tab.</li>
  <li>The summary is generated locally; no network calls leave your machine after the model loads.</li>
</ol>
<p>You can verify this by opening DevTools → Network and watching: after the model is cached, no requests fire while summarization runs.</p>

<h2>How It Works Technically: distilbart in the Browser</h2>
<p>PrivaTools' <a href="/tool/summarize-pdf">Summarize PDF</a> tool uses Hugging Face's <code>distilbart-cnn-12-6</code> model, a distilled version of BART trained on the CNN/DailyMail summarization dataset. It runs via the <code>@huggingface/transformers</code> JavaScript SDK, which compiles the model graph to WebAssembly.</p>
<p>The pipeline for a 100-page PDF roughly looks like:</p>
<ol>
  <li><strong>Extract text page-by-page</strong> with pdf.js. Output: ~80,000–150,000 characters.</li>
  <li><strong>Chunk at sentence boundaries</strong> to fit the model's 1024-token context window. Output: 80–150 chunks.</li>
  <li><strong>Summarize each chunk</strong> independently (~2–4 seconds per chunk on a modern laptop).</li>
  <li><strong>Stitch the chunk summaries together</strong>. For very long docs, run a <em>second pass</em> over the joined summaries to produce a coherent overview.</li>
</ol>
<p>Total time on a 2026 laptop: ~3–6 minutes for a 100-page PDF, almost entirely CPU-bound. On a phone, expect 10–20 minutes — slow but doable.</p>

<h2>Step-by-Step: Summarize a PDF Privately</h2>
<ol>
  <li>Open the <a href="/tool/summarize-pdf">Summarize PDF tool</a>.</li>
  <li>Drag your PDF into the upload area (or click to browse).</li>
  <li>Wait for the model to download on first use (one-time, ~250 MB).</li>
  <li>Choose a summary length — short, medium, or long.</li>
  <li>Click <strong>Summarize</strong> and watch progress per chunk.</li>
  <li>Copy the summary or download it as a text file.</li>
</ol>
<p>If you're privacy-paranoid (good!), <kbd>Cmd+Shift+P</kbd> → "Open file" while DevTools is on the Network tab. After the model is cached, drop your PDF, summarize, and confirm no request carries your document content.</p>

<h2>When NOT to Use Browser-Side Summarization</h2>
<p>Local summarization has tradeoffs:</p>
<ul>
  <li><strong>You're stuck with smaller models.</strong> distilbart is a fraction the size of GPT-4 or Claude — quality is good but not best-in-class.</li>
  <li><strong>First-load is slow.</strong> The model download (~250 MB) takes 30–90s on a typical connection. After caching, subsequent uses are instant.</li>
  <li><strong>Mobile browsers struggle</strong> with very long documents. Stick to desktop for 50+ page PDFs.</li>
  <li><strong>Non-English content</strong> needs different models. distilbart-cnn is English-only.</li>
</ul>
<p>If quality matters more than privacy and the document is non-sensitive, cloud services like Claude or GPT-4 still beat browser-side models. But for anything you wouldn't paste into a stranger's terminal: keep it local.</p>

<h2>Browser AI Beyond Summarization</h2>
<p>A related split architecture powers <a href="/tool/smart-redact">Smart Redact</a>: a BERT-based named-entity recognition model scans for names, emails, phone numbers, and SSNs in your browser, then proposes redactions you can accept or reject. When you apply them, the PDF and approved strings go to the isolated backend so PyMuPDF can permanently remove the underlying content.</p>
<p>Expect 2026 to bring more of this — translation, classification, semantic search — all running in 200–500 MB browser-cached models. The privacy story keeps getting better.</p>

<h2>FAQ</h2>
<h3>Is browser-side AI as accurate as ChatGPT or Claude?</h3>
<p>Not yet, no. Cloud-hosted frontier models are 50–100x larger and produce better summaries on average. But distilbart is good enough for most professional use — and the privacy guarantee is something cloud services can't offer.</p>

<h3>Does my data really stay private?</h3>
<p>Yes — for browser-side tools like PrivaTools' summarizer. The model loads once via a CDN; after that, all inference runs in WebAssembly inside your tab. Verify with DevTools → Network. No backend processes the file.</p>

<h3>Can I summarize an encrypted PDF?</h3>
<p>Not directly. First <a href="/tool/unlock-pdf">unlock the PDF</a> with the password, then summarize.</p>

<h3>How long does the model take to download?</h3>
<p>First visit: ~30–90 seconds depending on connection. The model is cached in IndexedDB and reused on subsequent visits.</p>
    `,
  },

  {
    slug: "ilovepdf-alternatives-2026",
    title: "10 Best iLovePDF Alternatives in 2026 (Free, Private, Open-Source)",
    description:
      "iLovePDF is popular but it's not free, it uploads your files, and it shows ads. Here are 10 alternatives ranked by features, privacy, and price.",
    publishedAt: "2026-05-15",
    readTime: "12 min read",
    author: "PrivaTools Team",
    tldr:
      "Top iLovePDF alternatives in 2026: PrivaTools (221 tools, MIT open source, no quotas), Stirling-PDF (self-host only), PDF24 (free but uploads), Sejda (best text editor, 3 tasks/hour free). Avoid Smallpdf if you'll exceed 2 tasks/day.",
    relatedTools: ["merge-pdf", "compress-pdf", "split-pdf", "edit-pdf"],
    tags: ["Comparison", "PDF", "Alternatives", "iLovePDF"],
    body: `
<p>iLovePDF processes 50+ million PDFs a month, which makes it one of the most popular PDF tool suites on the web. But its free tier is heavily restricted, every file uploads to their servers, the UI is plastered with ads, and a free account is required for anything non-trivial. If any of those bother you, you're not alone — and you have great alternatives.</p>

<p>This guide ranks the 10 best iLovePDF alternatives in 2026, ordered by overall value. We weighted privacy, true free-tier limits, feature breadth, and whether the tool is open source.</p>

<h2>What's Wrong with iLovePDF?</h2>
<ul>
  <li><strong>Heavily limited free tier</strong> — large files require a Premium account ($4/month or $48/year).</li>
  <li><strong>Files upload to their servers</strong> — every operation sends your document to Spain, where it's retained "for 2 hours".</li>
  <li><strong>Ads everywhere</strong> on the free tier, including pop-ups and remarketing pixels.</li>
  <li><strong>Account required</strong> for many operations including OCR and batch processing.</li>
  <li><strong>Not open source</strong> — you have to trust their privacy claims.</li>
</ul>

<h2>1. PrivaTools — Most Tools, Truly Free, Open Source</h2>
<p><strong>Free:</strong> Yes (no quotas) · <strong>Privacy:</strong> Open source, files auto-deleted · <strong>Self-host:</strong> Yes · <strong>Tools:</strong> 221 tools</p>
<p>PrivaTools is the comprehensive open-source alternative. It includes everything iLovePDF does (merge, split, compress, convert, OCR, sign, redact) and a lot it doesn't (video tools, audio tools, AI summarization in your browser, smart redaction with NER, JWT decoder, regex tester). The entire stack is MIT-licensed; you can audit the code or self-host it on Docker.</p>
<p>Files are processed in an isolated container and deleted immediately on response — no retention period, no upload caps beyond 500 MB per file, no watermarks, no ads, no account ever.</p>
<p><strong>Best for:</strong> Privacy-conscious users, professionals handling confidential documents, organizations wanting on-premises file tooling.</p>
<p><strong>Try:</strong> <a href="/tool/merge-pdf">Merge</a> · <a href="/tool/compress-pdf">Compress</a> · <a href="/tool/ocr-pdf">OCR</a> · <a href="/tool/edit-pdf">Edit</a> · <a href="/tool/summarize-pdf">AI Summarize</a></p>

<h2>2. Stirling-PDF — Best Self-Hosted</h2>
<p><strong>Free:</strong> Yes (self-host) · <strong>Privacy:</strong> Self-hosted only · <strong>Tools:</strong> ~50</p>
<p>Stirling-PDF is a Java/Spring-based self-hosted PDF toolkit. Tool count is smaller (PDF-only), but it has a polished UI and a no-code workflow builder. Has no public demo — you need to spin it up via Docker yourself.</p>
<p><strong>Best for:</strong> Java/Spring shops that want enterprise PDF processing on their own infrastructure.</p>

<h2>3. PDF24 — Most Tools (95+), Free Forever, But Uploads</h2>
<p><strong>Free:</strong> Yes · <strong>Privacy:</strong> Files uploaded to their servers · <strong>Tools:</strong> 95+</p>
<p>PDF24 is genuinely free forever with the largest pure-PDF tool set on the web. The catch: every operation uploads your file to their German servers. They claim to delete after a few hours but you have to trust that.</p>
<p><strong>Best for:</strong> Users who want every conceivable PDF tool and don't care about cloud processing.</p>

<h2>4. Sejda — Best Text Editing</h2>
<p><strong>Free:</strong> 3 tasks/hour, 50 MB cap · <strong>Privacy:</strong> Files retained 2 hours · <strong>Tools:</strong> ~35</p>
<p>Sejda's text-editor for PDFs is exceptional — it actually edits text content rather than overlaying. Free tier limits to 3 tasks/hour or 50 MB files, whichever comes first. Premium ($7.50/mo) unlocks all of it.</p>
<p><strong>Best for:</strong> Occasional users who need to edit existing PDF text.</p>

<h2>5. Smallpdf — Premium UX, Premium Price</h2>
<p><strong>Free:</strong> 2 tasks/day · <strong>Privacy:</strong> Files retained · <strong>Tools:</strong> 30+</p>
<p>Smallpdf has the slickest UI of any PDF tool. They've also added AI features (Chat with PDF, Translate PDF). Free tier is the most restrictive in this list — 2 tasks per day before you're prompted to upgrade ($9/month).</p>
<p><strong>Best for:</strong> Users willing to pay for polish.</p>

<h2>6. PDFescape — Free Browser Editor</h2>
<p><strong>Free:</strong> Yes, 10 MB cap, 100 pages · <strong>Privacy:</strong> Uploads · <strong>Tools:</strong> ~15</p>
<p>PDFescape was one of the first browser-based PDF editors and still works fine. Limits are tight (10 MB, 100 pages) and the UI feels dated, but the free tier is generous in tasks-per-day.</p>

<h2>7. Adobe Acrobat Online</h2>
<p><strong>Free:</strong> Very limited · <strong>Privacy:</strong> Adobe cloud · <strong>Tools:</strong> 20+</p>
<p>The industry standard. Most tools are paywalled — you'll hit a "Sign in to continue" wall fast. Quality is excellent if you have an Acrobat subscription (~$23/month).</p>

<h2>8. CloudConvert</h2>
<p><strong>Free:</strong> 25 conversions/day · <strong>Privacy:</strong> Uploads · <strong>Tools:</strong> Format conversion</p>
<p>Specialist: file format conversion across 200+ formats including PDF. Not a full PDF editor. Generous free tier (25 conversions/day) before paid plans kick in.</p>

<h2>9. Foxit PDF Editor Online</h2>
<p><strong>Free:</strong> Very limited · <strong>Privacy:</strong> Foxit cloud · <strong>Tools:</strong> 15+</p>
<p>Foxit makes a credible Acrobat alternative on desktop. Their online tools are basic and most useful features push to the desktop app or a paid Cloud plan.</p>

<h2>10. DocHub</h2>
<p><strong>Free:</strong> Limited · <strong>Privacy:</strong> Account required · <strong>Tools:</strong> Form filler + e-sign focus</p>
<p>DocHub specializes in form filling and electronic signatures rather than PDF manipulation. If that's your use case, it's worth a look. Otherwise, skip.</p>

<h2>Quick Comparison</h2>
<table>
  <thead>
    <tr><th>Tool</th><th>Free?</th><th>Account?</th><th>Privacy</th><th>Tools</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>PrivaTools</strong></td><td>Yes (no quotas)</td><td>No</td><td>Open source · deleted on response</td><td>221 tools</td></tr>
    <tr><td>Stirling-PDF</td><td>Yes (self-host)</td><td>No</td><td>You host</td><td>~50</td></tr>
    <tr><td>PDF24</td><td>Yes</td><td>No</td><td>Uploaded</td><td>95+</td></tr>
    <tr><td>Sejda</td><td>3 tasks/hr</td><td>No</td><td>2hr retention</td><td>~35</td></tr>
    <tr><td>Smallpdf</td><td>2 tasks/day</td><td>No</td><td>Retained</td><td>30+</td></tr>
    <tr><td>PDFescape</td><td>10 MB cap</td><td>No</td><td>Uploaded</td><td>~15</td></tr>
    <tr><td>Adobe</td><td>Very limited</td><td>Yes</td><td>Adobe cloud</td><td>20+</td></tr>
    <tr><td>CloudConvert</td><td>25/day</td><td>No</td><td>Uploaded</td><td>200+ formats</td></tr>
    <tr><td>Foxit</td><td>Very limited</td><td>Yes</td><td>Foxit cloud</td><td>15+</td></tr>
    <tr><td>DocHub</td><td>Limited</td><td>Yes</td><td>Account</td><td>Form-fill</td></tr>
  </tbody>
</table>

<h2>The Bottom Line</h2>
<p>If privacy and tool breadth matter most: <strong>PrivaTools</strong> wins. If you want pure-PDF on a cloud you don't mind: <strong>PDF24</strong>. If you only need to edit text occasionally: <strong>Sejda</strong>. Everything else is a worse trade-off in 2026.</p>
    `,
  },

  {
    slug: "redact-pdf-permanently-guide",
    title: "How to Redact a PDF Properly (Don't Use Black Boxes)",
    description:
      "Drawing black boxes over text doesn't redact anything — the text is still under there. Here's how to actually remove sensitive content from a PDF so it can't be recovered.",
    publishedAt: "2026-05-15",
    readTime: "8 min read",
    author: "PrivaTools Team",
    tldr:
      "Real redaction permanently removes the underlying content using a redaction annotation + apply step (PyMuPDF, Acrobat Pro). Black-rectangle annotations don't — the text remains and copy-pastes straight through. Always verify with text extraction.",
    relatedTools: ["redact-pdf", "smart-redact", "strip-metadata", "view-exif", "sanitize-pdf"],
    tags: ["PDF", "Privacy", "Redaction", "Security"],
    body: `
<p>Public redaction failures are embarrassingly common. Lawyers, governments, and corporations have all leaked confidential information by "redacting" PDFs with black rectangles drawn on top of the text — text that is still right there, copy-pasteable to anyone with five minutes of curiosity.</p>

<p>Real redaction permanently removes the underlying content. Done correctly, the original data is unrecoverable from the redacted file. This guide explains how to do it right, what tools to use, and the common mistakes that have leaked everything from witness names to corporate financials.</p>

<h2>The #1 Redaction Mistake (and How It Leaks)</h2>
<p>The most common "redaction" mistake is drawing a black rectangle over sensitive text using a PDF annotation tool. To the eye, the text is hidden. But:</p>
<ul>
  <li>Copy/paste the page → the underlying text is still in the clipboard.</li>
  <li>Print to a new PDF → the rectangle may not flatten and the text re-appears.</li>
  <li>Open in any text-extracting tool → the redacted strings come out plaintext.</li>
</ul>
<p>This has caused multiple public disasters: court filings with witness identities leaked, government documents with classified information exposed, and corporate filings with the names of investigated executives accidentally published.</p>

<h2>How Real Redaction Works</h2>
<p>Proper redaction does two things together:</p>
<ol>
  <li><strong>Visually obscures the area</strong> with an opaque block (typically black or white).</li>
  <li><strong>Permanently removes the underlying content</strong> — the text glyphs, the image pixels, the XMP metadata, and any other instance of the data.</li>
</ol>
<p>The technical operation is a "redaction annotation" followed by a "redaction apply" step. The PDF standard supports both. PyMuPDF, Adobe Acrobat Pro, and Foxit PhantomPDF all implement this correctly. Many "free PDF editor" web tools do not.</p>

<h2>Method 1: Manual Redaction (Best for Specific Boxes)</h2>
<p>Use this when you know exactly where the sensitive content is — a specific paragraph, a name, a signature image.</p>
<ol>
  <li>Open <a href="/tool/redact-pdf">PrivaTools Redact PDF</a>.</li>
  <li>Upload your PDF. Each page renders as a thumbnail.</li>
  <li>Click and drag a rectangle over each area you want to permanently remove.</li>
  <li>Choose redaction color (usually black; sometimes white for "blackline" review).</li>
  <li>Click <strong>Redact</strong>. The tool applies real PyMuPDF redactions and returns a file where the content under each rectangle is unrecoverable.</li>
</ol>
<p>Verify the result: open the redacted PDF in any reader, try to copy text from a redacted area — nothing should be in the clipboard.</p>

<h2>Method 2: Smart Redact (Text-Based, Best for Bulk)</h2>
<p>Use this when sensitive content is spread throughout a document and you want every occurrence redacted automatically.</p>
<p><a href="/tool/smart-redact">Smart Redact</a> runs a BERT named-entity-recognition (NER) model in your browser to find every name, email, phone number, address, SSN, credit card, and similar entity. You review the proposed list, accept or reject each, and the backend applies real redactions to every matching location across the document.</p>
<ol>
  <li>Upload your PDF.</li>
  <li>Wait for the NER model to scan (a few seconds for typical docs).</li>
  <li>Review the suggested redactions grouped by entity type (Names · Emails · Phones · SSNs · Locations · Orgs).</li>
  <li>Uncheck false positives.</li>
  <li>Click <strong>Redact all</strong>.</li>
</ol>
<p>Because NER runs in the browser (~250 MB BERT model, cached after first use), the PDF content never leaves your machine before redaction.</p>

<h2>Verifying a Redaction Worked</h2>
<p>Three checks every time:</p>
<ol>
  <li><strong>Copy/paste test.</strong> Try to select text behind a redaction rectangle. If anything ends up in your clipboard, the redaction failed.</li>
  <li><strong>Text extraction test.</strong> Run <a href="/tool/pdf-to-text">PDF to Text</a> on the redacted file. Search for the sensitive strings. They should not appear.</li>
  <li><strong>Metadata test.</strong> Run <a href="/tool/metadata">View Metadata</a>. The XMP block may still contain hints (author name, file path, original title). Strip them with <a href="/tool/strip-metadata">Strip Metadata</a> after redacting.</li>
</ol>
<p>If all three pass, the redaction is real.</p>

<h2>Common Redaction Pitfalls</h2>
<h3>1. Redacting only the visible text, not the OCR layer</h3>
<p>Scanned PDFs often have an invisible OCR text layer underneath the rendered image. Redacting the visible pixels doesn't touch the OCR layer. Solution: redact in a tool that applies both visually and to the text layer (PyMuPDF does this; many web tools don't).</p>

<h3>2. Forgetting embedded thumbnails</h3>
<p>Some PDF readers embed a thumbnail image of each page. Drawing a black box over the rendered page doesn't update the thumbnail. Solution: re-save with <code>--garbage=4</code> (qpdf) or use a redaction tool that rebuilds embedded resources.</p>

<h3>3. Filenames and metadata</h3>
<p>If the file is named "Witness_John_Smith_Statement.pdf", redacting "John Smith" inside the document doesn't help. Rename the file and strip the XMP metadata.</p>

<h3>4. Linked content</h3>
<p>Hyperlinks pointing to <code>mailto:</code> addresses, embedded attachments, and external file references can leak data even when the visible text is redacted. Run <a href="/tool/sanitize-pdf">Sanitize PDF</a> to flatten links and embedded files.</p>

<h3>5. Image-based content that LOOKS like text</h3>
<p>If text is part of an image (a screenshot, a stamped signature), drawing over it works — the image pixels are replaced. But the original image may still be embedded if you didn't apply redaction. Always use the redaction-apply step, not just an annotation.</p>

<h2>Should You Redact in the Cloud?</h2>
<p>Most "online redact PDF" tools upload your document to their servers, apply redaction, and return the result. For routine business documents that's fine. For documents that are themselves sensitive (court filings, medical records, regulatory submissions) — the redaction is supposed to protect — sending the un-redacted file to a third party defeats the entire purpose.</p>
<p>That's why <a href="/tool/redact-pdf">PrivaTools Redact</a> processes your file inside an isolated container that auto-deletes after response, and <a href="/tool/smart-redact">Smart Redact</a> runs NER detection in your browser before the backend applies the approved redactions. The unredacted content never persists.</p>

<h2>FAQ</h2>
<h3>Is a redaction reversible?</h3>
<p>If done correctly with a real redaction tool, no — the underlying content is removed from the PDF file. If done by drawing a rectangle annotation on top, yes — anyone with five minutes and a copy-paste shortcut can recover it.</p>

<h3>What's the difference between "redact" and "blackout"?</h3>
<p>"Blackout" usually refers to the visual style. "Redaction" is the technical operation of permanently removing content. Many tools use the words interchangeably — check what they actually do.</p>

<h3>Does PrivaTools Smart Redact see my document?</h3>
<p>Only briefly, for the final apply step. The detection (NER) runs entirely in your browser. The backend never stores your PDF.</p>

<h3>Can I redact images, not just text?</h3>
<p>Yes — image content under the redaction rectangle is replaced with the solid color, and the original image data is removed from the file structure.</p>
    `,
  },

  {
    slug: "online-pdf-tools-tracking-you",
    title: "Why Most Online PDF Tools Are Tracking You (And What to Do About It)",
    description:
      "A look at what actually happens when you upload a PDF to a 'free' online tool — the trackers, the retention windows, the third-party pixels — and how to stay private.",
    publishedAt: "2026-05-15",
    readTime: "10 min read",
    author: "PrivaTools Team",
    tldr:
      "Most free online PDF tools log your IP + file hash, fire 5–10 third-party trackers per visit, and retain files for hours-to-indefinitely. Use open-source tools (PrivaTools, Stirling-PDF) where the data flow is auditable.",
    relatedTools: ["smart-redact", "strip-metadata", "summarize-pdf"],
    tags: ["Privacy", "PDF", "Security", "Tracking"],
    body: `
<p>The PDF tool market is worth several billion dollars. None of the leading "free" services make their money from selling subscriptions — they make it from advertising, data licensing, and conversion funnels. Your file becomes the product.</p>

<p>This isn't tinfoil-hat paranoia. It's the straightforward business model documented in their own privacy policies. This article walks through what happens when you drag a PDF onto a typical free online tool, what gets logged, what gets shared, and what you can do about it.</p>

<h2>What Happens When You Upload a PDF</h2>
<p>The journey of a typical upload to a major "free" PDF tool goes something like this:</p>
<ol>
  <li>You drag a file onto the upload area.</li>
  <li>The browser sends the file to the tool's server (often via S3 multipart upload).</li>
  <li>The server logs: your IP address, browser fingerprint, file size, file hash, filename, and inferred device type.</li>
  <li>The file is queued for processing on a worker. If the tool is a thin wrapper around an open-source library, the open-source binary processes the file and returns the result.</li>
  <li>The processed file is written to a download bucket. You get a temporary URL.</li>
  <li>The "delete after 2 hours" policy is enforced — usually. Sometimes it's lifecycle policies on the bucket, sometimes it's a scheduled job, sometimes it's "best effort". The original file is what's deleted, not necessarily the logs, the hashes, the file metadata, or the analytics events.</li>
  <li>Trackers fire: Google Analytics, Facebook Pixel, LinkedIn Insight, sometimes specialist ad networks. They get your IP, screen size, referrer, and any user IDs the site has assigned.</li>
</ol>
<p>That's the BEST case. The WORST case is files that get retained indefinitely, used for ML training, or sold in aggregate to data brokers.</p>

<h2>What's In Their Privacy Policies (You Should Read Them)</h2>
<p>Some real language pulled from major PDF tool privacy policies (paraphrased for length):</p>
<ul>
  <li><strong>"We retain content for as long as necessary to provide our services."</strong> Translation: indefinitely, at our discretion.</li>
  <li><strong>"We may use your content to improve our services."</strong> Translation: training data.</li>
  <li><strong>"We share data with third-party providers."</strong> Translation: AWS, GCP, Cloudflare, plus ad networks.</li>
  <li><strong>"We may retain logs and metadata."</strong> Translation: even after we 'delete' your file, we still know you used the tool, what kind of document it was, and how often.</li>
</ul>
<p>None of this is illegal. Most of it is in the privacy policy you clicked "Accept" on without reading. But it adds up to a meaningful loss of privacy that most users never notice.</p>

<h2>The Cookies and Pixels</h2>
<p>Visit a major PDF tool homepage. Open browser DevTools → Network. Filter by "Doc" to see the trackers:</p>
<ul>
  <li><code>google-analytics.com/collect</code> — page-view + event analytics.</li>
  <li><code>googletagmanager.com</code> — orchestrates other tags.</li>
  <li><code>doubleclick.net</code> — Google's ad network.</li>
  <li><code>facebook.com/tr/</code> — Facebook conversion pixel.</li>
  <li><code>linkedin.com/li.lms-analytics</code> — LinkedIn Insight tag.</li>
  <li><code>hotjar.com</code> or <code>fullstory.com</code> — session replay (yes, they record what you click).</li>
  <li><code>intercom.io</code> — chat widget that captures your interactions.</li>
</ul>
<p>By the time you've uploaded a file, 5-10 third parties have your IP, browser fingerprint, and a signal that you were doing something with PDFs.</p>

<h2>The "Open Source" Test</h2>
<p>A simple test for whether a tool actually does what it claims: <strong>is the source code public?</strong></p>
<ul>
  <li>If yes, you can audit what happens to your file.</li>
  <li>If no, you have to take their word for it.</li>
</ul>
<p>The major PDF tool vendors (iLovePDF, Smallpdf, PDF24, Sejda, Adobe Acrobat Online) are all closed source. The open-source alternatives include:</p>
<ul>
  <li><strong>PrivaTools</strong> — MIT-licensed full-stack, both online and self-hosted.</li>
  <li><strong>Stirling-PDF</strong> — Java/Spring; self-host only.</li>
  <li><strong>Mozilla pdf.js</strong> — viewer only.</li>
  <li><strong>qpdf / pdftk</strong> — command line.</li>
</ul>

<h2>What Privacy-Respecting Tools Look Like</h2>
<p>A genuinely privacy-respecting PDF tool has these properties:</p>
<ol>
  <li><strong>Open source.</strong> You can read the code.</li>
  <li><strong>No account required.</strong> No identity to log against.</li>
  <li><strong>Minimal logging.</strong> Aggregate metrics, not request-level identifiable logs.</li>
  <li><strong>Aggressive deletion.</strong> Files removed immediately after response, not "after 2 hours".</li>
  <li><strong>Browser-side processing where possible.</strong> Tools that don't need a server should run in WebAssembly.</li>
  <li><strong>No third-party trackers.</strong> Or, if any, anonymized analytics with explicit disclosure.</li>
  <li><strong>Self-host option.</strong> So you can run the tools on your own infrastructure if you don't want to trust ANY hosted service.</li>
</ol>

<h2>How PrivaTools Handles It</h2>
<p>For full transparency, here's exactly what happens when you use <a href="/">PrivaTools</a>:</p>
<ul>
  <li><strong>Files are processed inside an isolated Docker container.</strong> The container has no network egress; it can't phone home.</li>
  <li><strong>Files are deleted immediately after the HTTP response.</strong> No "2 hours" retention. The cleanup is a background task that fires within seconds.</li>
  <li><strong>No account, ever.</strong> The site has no login mechanism.</li>
  <li><strong>Only first-party aggregate page-view telemetry.</strong> The browser sends a small <code>/api/analytics/pageview</code> beacon instead of loading Google scripts; DNT/GPC, local opt-out, and standard blockers stop it.</li>
  <li><strong>No third-party ad pixels, no remarketing, no session replay.</strong></li>
  <li><strong>Source code is MIT-licensed</strong> at <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools">github.com/deadpoolrulesmarvel1-svg/privatools</a>. Audit it yourself.</li>
  <li><strong>Browser-side tools run entirely in your browser where possible.</strong> Files never reach our servers for tools like <a href="/tool/summarize-pdf">Summarize</a>, <a href="/tools/jwt-decoder">JWT Decoder</a>, <a href="/tools/regex-tester">Regex Tester</a>, <a href="/tools/password-generator">Password Generator</a>, and more. Smart Redact scans in your browser first, then uses the isolated backend only to apply approved permanent redactions.</li>
  <li><strong>Self-hostable.</strong> <code>docker compose up --build</code> and you're running your own instance.</li>
</ul>

<h2>What You Can Do Right Now</h2>
<ol>
  <li><strong>Use browser-side tools when possible.</strong> Look for "client-side" or "browser-only" badges.</li>
  <li><strong>Install uBlock Origin.</strong> Blocks the ad pixels and analytics from firing.</li>
  <li><strong>Read privacy policies.</strong> Search them for "retain", "share", "improve our services". The honest ones are short and specific.</li>
  <li><strong>Self-host the tools you use most.</strong> Open-source projects make this trivial.</li>
  <li><strong>Don't upload anything you wouldn't want stored.</strong> If it's truly sensitive (medical, legal, financial), use a desktop tool or a self-hosted instance.</li>
</ol>

<h2>FAQ</h2>
<h3>Are the trackers actually a problem if I'm not doing anything secret?</h3>
<p>The trackers themselves aren't dangerous. The aggregation problem is. Every site sees a slice; advertisers and data brokers stitch them together. You don't get to see your composite profile or correct it.</p>

<h3>Is "we delete after 2 hours" enough?</h3>
<p>It's better than retaining indefinitely. It's worse than not uploading in the first place. Two hours is plenty of time for a misconfigured backup, a debugging engineer, or an internal log query to copy the file somewhere it won't be deleted.</p>

<h3>What's the safest way to use online PDF tools?</h3>
<p>In order of safety: (1) use a desktop tool, (2) self-host an open-source one, (3) use a browser-side tool that doesn't upload, (4) use an open-source online tool with aggressive deletion, (5) use any free closed-source tool with no caveats about retention.</p>
    `,
  },

  {
    slug: "heic-conversion-guide-2026",
    title: "How to Convert HEIC to PDF, JPG, and PNG on Any Device (2026)",
    description:
      "Apple's HEIC format is space-efficient but incompatible with most software. Here's how to convert HEIC to PDF, JPG, or PNG online, on Mac, on Windows, and in batch.",
    publishedAt: "2026-05-15",
    readTime: "7 min read",
    author: "PrivaTools Team",
    tldr:
      "Fastest cross-platform: PrivaTools (HEIC to PDF / JPG / PNG online). Mac: Preview → File → Export. Windows 11: install HEIF Image Extensions from Microsoft Store. CLI: brew install libheif + heif-convert. Always strip EXIF before sharing publicly.",
    relatedTools: ["heic-to-pdf", "heic-to-jpg", "heic-to-png", "image-converter", "remove-exif"],
    tags: ["HEIC", "Image", "Conversion", "How-To"],
    body: `
<p>If you've ever tried to email a photo from your iPhone to someone on Windows, you've met HEIC — Apple's High Efficiency Image Container format. It cuts file sizes in half compared to JPEG, but most non-Apple software can't open it. Photos arrive as broken thumbnails or won't import at all.</p>

<p>This guide covers every way to convert HEIC: online tools, native Mac, native Windows, batch conversion, and what you lose along the way.</p>

<h2>What Is HEIC, Anyway?</h2>
<p>HEIC is Apple's wrapper around the HEIF image format, which itself wraps HEVC-encoded image data. Compared to JPEG, HEIC files are typically:</p>
<ul>
  <li><strong>40–60% smaller</strong> at equivalent visual quality.</li>
  <li><strong>10-bit color</strong> (vs. JPEG's 8-bit) — better for HDR and pro photography.</li>
  <li><strong>Capable of storing depth maps</strong> for Portrait Mode and effects.</li>
  <li><strong>Supports image sequences</strong> (Live Photos), animations, and alpha channels.</li>
</ul>
<p>The catch: HEIF/HEIC depends on HEVC, which is patent-encumbered. That's the main reason Windows, Android, Linux, and many web tools have been slow to support it.</p>

<h2>Method 1: Convert HEIC Online (Browser)</h2>
<p>The fastest, most universal approach. No software install.</p>

<h3>HEIC → PDF</h3>
<ol>
  <li>Open <a href="/tool/heic-to-pdf">HEIC to PDF</a>.</li>
  <li>Drag one or many HEIC files into the upload area.</li>
  <li>Choose page size (Letter or A4) and orientation.</li>
  <li>Click Convert. You get a single PDF with one HEIC per page.</li>
</ol>

<h3>HEIC → JPG</h3>
<ol>
  <li>Open <a href="/tools/heic-to-jpg">HEIC to JPG</a>.</li>
  <li>Drag your HEIC.</li>
  <li>Choose JPEG quality (default 85 is fine for most use).</li>
  <li>Click Convert and download.</li>
</ol>

<h3>HEIC → PNG</h3>
<ol>
  <li>Open <a href="/tools/heic-to-png">HEIC to PNG</a>.</li>
  <li>Drag your HEIC.</li>
  <li>Click Convert.</li>
</ol>
<p>PNG is lossless but produces files 3–5x larger than JPG. Use PNG if you need transparency or are doing further editing.</p>

<h2>Method 2: Mac (Built-In, Free)</h2>
<p>macOS handles HEIC natively. To convert:</p>
<ol>
  <li>Open the HEIC in Preview.</li>
  <li>File → Export.</li>
  <li>Choose JPEG, PNG, or PDF as the format.</li>
  <li>Click Save.</li>
</ol>
<p>For batch: select multiple HEICs in Finder → right-click → <em>Quick Actions</em> → <em>Convert Image</em> → choose format. macOS Sonoma (14) and later have this built in.</p>

<h2>Method 3: Windows (HEIF Extensions or Online)</h2>
<p>Windows 11 supports HEIC if you install the Microsoft "HEIF Image Extensions" from the Store (free, despite the upsell to a $0.99 paid version). After installing:</p>
<ol>
  <li>Open the HEIC in the Photos app.</li>
  <li>Click "..." → Save as → choose JPEG or PNG.</li>
</ol>
<p>For batch, the easiest path on Windows is still the online tool above.</p>

<h2>Method 4: iPhone Settings (Stop Generating HEIC in the First Place)</h2>
<p>If you'd rather your iPhone produce JPEG directly:</p>
<ol>
  <li>Settings → Camera → Formats.</li>
  <li>Choose "Most Compatible" (instead of "High Efficiency").</li>
</ol>
<p>Future photos will be JPEG. Existing HEICs need to be converted.</p>

<h2>Method 5: Command Line (Batch + Scripts)</h2>
<p>For large batches or automation, command line is fastest:</p>
<pre><code>brew install libheif imagemagick   # macOS, one time
for f in *.heic; do
  heif-convert "$f" "\${f%.heic}.jpg"
done</code></pre>
<p>Or with ImageMagick:</p>
<pre><code>magick mogrify -format jpg *.heic</code></pre>

<h2>Privacy Note</h2>
<p>HEIC files contain extensive EXIF metadata: GPS location, camera model, capture time, even depth maps. Before sharing converted files publicly, strip the metadata:</p>
<ul>
  <li>Use <a href="/tools/remove-exif">Remove EXIF</a> after converting.</li>
  <li>Or view what's in there first with <a href="/tools/view-exif">View EXIF Data</a>.</li>
</ul>
<p>For sensitive photos, the online converters worth using are the ones that auto-delete files after conversion (e.g., PrivaTools) rather than retaining them on their servers.</p>

<h2>FAQ</h2>
<h3>Does converting HEIC to JPG lose quality?</h3>
<p>Slightly, since HEIC supports 10-bit color and JPEG only supports 8-bit. For most viewing and printing the loss is imperceptible. For pro photography work, convert HEIC to PNG or TIFF instead.</p>

<h3>What's the difference between HEIC and HEIF?</h3>
<p>HEIF is the container format (defined by MPEG); HEIC is Apple's specific implementation/extension. In practice the terms are interchangeable.</p>

<h3>Why doesn't my email client show HEIC previews?</h3>
<p>Most email clients (Gmail web, Outlook desktop) can't decode HEIC. Recipients see a generic attachment icon. Always convert to JPG before emailing.</p>

<h3>Is HEIC the future of digital photography?</h3>
<p>Probably not. AVIF (a newer royalty-free format) is gaining traction and is supported in Chrome, Firefox, and Safari. Expect AVIF to gradually replace HEIC over the next few years.</p>
    `,
  },

  {
    slug: "decode-jwt-tokens-safely-guide",
    title: "How to Decode a JWT Token Safely (and What Each Part Means)",
    description:
      "JWT tokens are everywhere in modern web auth. Here's how they're structured, how to decode them, what each claim means, and why you should never paste a real JWT into a random online decoder.",
    publishedAt: "2026-05-15",
    readTime: "8 min read",
    author: "PrivaTools Team",
    tldr:
      "A JWT is header.payload.signature, each base64url-encoded JSON. Decoding reveals the claims; verifying needs the issuer's key. Use a browser-side decoder (PrivaTools JWT Decoder) — never paste production JWTs into a server-side decoder.",
    relatedTools: ["jwt-decoder", "base64", "regex-tester", "hash-generator"],
    tags: ["JWT", "Developer", "Security", "How-To"],
    body: `
<p>If you've worked with modern web auth, you've seen tokens that look like this:</p>
<pre><code>eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxNzMwMDAwMDAwfQ.signature</code></pre>
<p>That's a JWT — JSON Web Token. It's the standard format for stateless authentication across REST APIs, OAuth flows, and microservice mesh systems. JWTs are not encrypted; they're just signed. Decoding them is trivial. Verifying their signature requires the issuer's secret or public key.</p>

<p>This guide explains the JWT structure, how to decode one, what each standard claim means, and how to decode JWTs without leaking them to a random online service.</p>

<h2>The Three Parts of a JWT</h2>
<p>Every JWT has three dot-separated parts:</p>
<pre><code>HEADER.PAYLOAD.SIGNATURE</code></pre>
<p>Each part is <strong>base64url-encoded</strong>. Base64url is regular base64 with two character swaps (<code>+</code> → <code>-</code>, <code>/</code> → <code>_</code>) and no padding. Some implementations are picky about the padding; most aren't.</p>

<h3>1. Header</h3>
<p>The header tells you the signing algorithm and the token type:</p>
<pre><code>{
  "alg": "HS256",
  "typ": "JWT"
}</code></pre>
<p>Common <code>alg</code> values:</p>
<ul>
  <li><strong>HS256, HS384, HS512</strong> — HMAC with SHA-2. Symmetric: same secret signs and verifies.</li>
  <li><strong>RS256, RS384, RS512</strong> — RSA. Asymmetric: private key signs, public key verifies.</li>
  <li><strong>ES256, ES384, ES512</strong> — ECDSA. Asymmetric, smaller signatures than RSA.</li>
  <li><strong>EdDSA</strong> — Ed25519 / Ed448. Modern asymmetric, fast.</li>
  <li><strong>none</strong> — DANGER. No signature. Most libraries refuse to accept these now.</li>
</ul>

<h3>2. Payload (Claims)</h3>
<p>The payload is the JSON object you actually care about. It contains "claims" — assertions about an entity. Decoding shows something like:</p>
<pre><code>{
  "sub": "user-42",
  "iat": 1730000000,
  "exp": 1730003600,
  "iss": "auth.example.com",
  "aud": "api.example.com",
  "scope": "read:profile write:profile"
}</code></pre>
<p>Standard claims (defined by RFC 7519):</p>
<ul>
  <li><code>iss</code> (issuer): who created and signed the token.</li>
  <li><code>sub</code> (subject): who the token is about. Usually a user ID.</li>
  <li><code>aud</code> (audience): which service(s) should accept the token.</li>
  <li><code>iat</code> (issued at): Unix timestamp of creation.</li>
  <li><code>exp</code> (expires at): Unix timestamp after which the token is invalid.</li>
  <li><code>nbf</code> (not before): Unix timestamp before which the token isn't valid yet.</li>
  <li><code>jti</code> (JWT ID): unique token identifier (for revocation tracking).</li>
</ul>
<p>Everything else (roles, scopes, custom permissions) is application-specific.</p>

<h3>3. Signature</h3>
<p>The signature is computed over <code>base64url(header) + "." + base64url(payload)</code> using the algorithm specified in the header and the issuer's secret (HS*) or private key (RS*/ES*). It's there so a recipient can verify the token wasn't tampered with — given the right key.</p>
<p><strong>The signature does NOT make the token confidential.</strong> Anyone can decode header and payload. The signature only proves the token came from someone who has the signing key.</p>

<h2>How to Decode a JWT</h2>
<h3>Online (Browser-Side, Safe)</h3>
<p>Paste your JWT into <a href="/tools/jwt-decoder">PrivaTools JWT Decoder</a>. The token is decoded entirely in JavaScript inside your browser — never sent to any server. You'll see the header, payload (with iat/exp converted to ISO 8601), and signature.</p>

<h3>Command Line</h3>
<pre><code># With jq
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq

# With Python
python3 -c "import sys,base64,json
parts = sys.argv[1].split('.')
pad = lambda s: s + '=' * (-len(s) % 4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(pad(parts[1]))), indent=2))" "$TOKEN"</code></pre>

<h3>What NOT to Do: Public Online Decoders</h3>
<p>There are many "JWT decoder" sites that send your token to their server. Some log the token. A logged production JWT is an instant authentication bypass — anyone with the log file can impersonate the user until the token expires.</p>
<p>Always use a decoder that processes the token client-side. Verify by opening DevTools → Network and confirming no outgoing request fires when you paste a token.</p>

<h2>Common Mistakes</h2>
<h3>1. Trusting an unsigned token</h3>
<p>An attacker can construct any JWT they want with <code>alg: none</code> and no signature. Many JWT libraries used to accept these. Always validate the algorithm matches what your service expects.</p>

<h3>2. Confusing decoding with verification</h3>
<p>Decoding shows you what the token claims. <strong>Verification</strong> proves the claims are authentic. You need the issuer's key to verify. A decoded-but-not-verified token tells you nothing trustworthy.</p>

<h3>3. Leaking tokens in URLs</h3>
<p>JWTs in URL query strings get logged everywhere — browser history, server access logs, analytics, CDNs. Always pass them in the <code>Authorization: Bearer</code> header.</p>

<h3>4. Long-lived tokens</h3>
<p>If your <code>exp</code> is days or weeks in the future, a single token theft is a long-lived compromise. Use short-lived access tokens (5–15 minutes) plus refresh tokens for sessions.</p>

<h3>5. Storing JWTs in localStorage</h3>
<p>localStorage is accessible to any JavaScript on the page. XSS = token theft. Use HttpOnly cookies for browser-side session tokens, or in-memory storage with a sliding refresh.</p>

<h2>How to Verify a JWT (Beyond Decode)</h2>
<p>Verifying requires:</p>
<ol>
  <li>The signing algorithm from the header.</li>
  <li>The corresponding key (secret for HS*, public key for RS*/ES*).</li>
  <li>Recomputing the signature over header.payload with that key.</li>
  <li>Comparing the recomputed signature against the one in the token.</li>
</ol>
<p>Use a library — never roll your own. Common picks: <code>jsonwebtoken</code> (Node), <code>PyJWT</code> (Python), <code>jjwt</code> (Java), <code>github.com/golang-jwt/jwt</code> (Go).</p>

<h2>FAQ</h2>
<h3>Is the JWT signature reversible?</h3>
<p>No. It's a one-way hash. You can verify it given the key but you can't extract the key from a signature alone (without a brute force attack on a weak secret).</p>

<h3>Can I decode a JWT without the secret?</h3>
<p>Yes. Header and payload are just base64-encoded JSON. The secret is only needed for verification.</p>

<h3>Are JWTs encrypted?</h3>
<p>By default, no. They're signed but not encrypted. There IS a sibling spec called JWE (JSON Web Encryption) that adds encryption, but it's much less commonly used.</p>

<h3>Is it safe to log JWT payloads in my server logs?</h3>
<p>It's safer to log the <code>sub</code> claim (user ID) and the <code>jti</code> claim (token ID) but NOT the full token. The full token would let anyone with log access impersonate the user.</p>
    `,
  },
  {
    slug: "how-local-first-works",
    title: "How Local-First File Tools Actually Work",
    description:
      "Your browser can parse, render and rewrite most file formats on its own. Where the local/server line really sits — and why some jobs still need one.",
    publishedAt: "2026-08-14",
    readTime: "6 min read",
    tldr:
      "Most file operations — merging PDFs, converting images, rewriting metadata — are pure computation your browser can do locally, so the file never leaves your machine. Only jobs needing native code (full OCR models, office-suite conversion, heavy video transcodes) require a server, and an honest tool tells you which is which before you add a file.",
    relatedTools: ["merge-pdf", "image-converter", "strip-metadata", "ocr-pdf"],
    tags: ["Engineering", "Privacy"],
    author: "Lakshya Lodha",
    body: `
<p>Most of what a file tool does — parsing pages, reordering them, rewriting metadata, re-encoding an image — is computation, and your browser is a very capable computer. When you merge two PDFs on <a href="/tool/merge-pdf">our merge tool</a>, a library running in your tab reads both files from memory, builds a new document, and hands it back to you. No network request exists in that story, which is why the network tab stays empty.</p>

<h2>What a browser can genuinely do</h2>
<p>Modern browsers ship a full PDF object model, image codecs, WebAssembly, and workers with near-native throughput. That covers the overwhelming majority of everyday file work:</p>
<ul>
  <li><strong>PDF structure work</strong> — merge, split, reorder, rotate, delete pages, stamp text, fill forms. These rewrite the document tree; no pixel math required.</li>
  <li><strong>Image work</strong> — resize, crop, convert between formats, strip EXIF. Codecs compiled to WebAssembly run at speeds users can't distinguish from a server.</li>
  <li><strong>Text and developer work</strong> — hashing, encoding, formatting, diffing. These were never a server's job to begin with.</li>
</ul>
<p>When a tool in this class "uploads" your file anyway, that is an architecture choice made for the operator's benefit — telemetry, lock-in, upsell — not a technical requirement.</p>

<h2>The honest boundary</h2>
<p>Some work needs native code the browser can't carry. Full OCR models with language packs, faithful office-suite conversion (a headless LibreOffice is a gigabyte of layout engine), and heavy video transcodes all outgrow what can reasonably ship to a tab. Those tools <em>should</em> exist — refusing to build them just sends people to services that pretend everything is local.</p>
<p>Our rule for that class: say so up front, before a file is added; run the job in isolated temporary storage on a disclosed server; delete everything when the job ends. The tool page carries an amber "uses our server" chip precisely so you never find out after the fact.</p>

<h2>How to verify any of this</h2>
<p>Don't take a tool's word for it — including ours. Open your browser's developer tools, watch the network panel, and run the tool on a scrap file. A local-first tool produces zero upload requests. A cloud tool produces a POST with your file in it within seconds. Sixty seconds of looking beats any privacy policy.</p>

<h2>The rule we build by</h2>
<p>If a job can run on your device, it must. The server is a fallback we disclose, never a default we hide. That single rule decides more about a file tool's privacy than every policy page combined — because it removes the need to trust anyone with the files that never left.</p>
`,
  },
  {
    slug: "what-deleted-means",
    title: "What “Deleted After Use” Means on Our Servers",
    description:
      "A promise you can't verify from a network tab deserves a precise definition. This is ours, mechanism by mechanism.",
    publishedAt: "2026-07-02",
    readTime: "4 min read",
    tldr:
      "For PrivaTools server jobs, a file exists exactly as long as the job does: written to isolated temporary storage, processed, streamed back, removed. No results bucket, no retention window, no recoverable copy — and most of the catalogue never touches a server at all.",
    relatedTools: ["ocr-pdf", "pdf-to-word", "compress-pdf"],
    tags: ["Trust", "Privacy"],
    author: "Lakshya Lodha",
    body: `
<p>"We delete your files" is the least verifiable claim on the internet. You can watch a network tab prove a local tool uploads nothing; you cannot watch a server's disk. So a promise about server-side deletion deserves a precise, mechanical definition — here is ours.</p>

<h2>The lifecycle of a server job</h2>
<ol>
  <li>Your file is written to <strong>isolated temporary storage</strong> — a per-request working directory on our one disclosed server (Mumbai, India), on a volume that exists for scratch work.</li>
  <li>The tool processes it there. Nothing about the job is written to any other volume, database, or log — filenames included.</li>
  <li>The result streams back to your browser in the same response.</li>
  <li>The working directory is removed. A janitor process additionally sweeps the temp volume by age as a belt-and-braces measure, so even a crashed job's leftovers don't outlive it for long.</li>
</ol>
<p>There is no results bucket, no "keep for 2 hours so you can re-download" window, and no copy we could recover later — even if you asked us to. Re-running a tool re-uploads the file because we genuinely don't have it.</p>

<h2>What we deliberately don't have</h2>
<ul>
  <li><strong>No third-party storage.</strong> Files never touch S3, GCS, or any cloud bucket. One server, one temp volume.</li>
  <li><strong>No content logging.</strong> Request logs carry tool, timing and status — never file contents or names.</li>
  <li><strong>No third-party analytics anywhere</strong> — one first-party pageview count (opt-out honored), and nothing that could tie a person to a document.</li>
</ul>

<h2>The better answer is not needing the promise</h2>
<p>We'd rather you not have to trust any of this — which is why most of the catalogue runs locally in your browser, and why every tool that doesn't says so before you add a file. When the file never leaves your machine, "deleted after use" isn't a promise. It's just true by construction.</p>
`,
  },
  {
    slug: "reading-privacy-policies",
    title: "Reading a File Tool’s Privacy Policy in 60 Seconds",
    description:
      "Four questions cut through any policy: where files go, how long they stay, who else runs code on the page, and what's behind the free tier.",
    publishedAt: "2026-05-21",
    readTime: "5 min read",
    tldr:
      "Skip the preamble and ask four things of any file tool: Where do files go? How long do they stay? Whose code runs on the page? What does 'free' actually include? The answers — usually buried mid-policy — tell you who the product really serves.",
    relatedTools: ["strip-metadata", "compress-pdf"],
    tags: ["Guides", "Privacy"],
    author: "Lakshya Lodha",
    body: `
<p>Privacy policies are written to be skimmed past. But for a site that handles your documents, four specific answers matter more than every other paragraph combined — and you can find all four in about a minute with Ctrl-F.</p>

<h2>1. Where do files go?</h2>
<p>Search for <em>"upload"</em>, <em>"process"</em>, <em>"server"</em>. If uploading is the default, everything else in the policy is damage control. The best answer is that most files never leave your browser at all — and a tool that works that way will usually say so loudly, because it's the hard part.</p>

<h2>2. How long do they stay?</h2>
<p>Search for <em>"delete"</em>, <em>"retain"</em>, <em>"hours"</em>. "Deleted after N hours" is a retention policy, not deletion — your file sits on their disk for that whole window, downloadable by anyone with the link or the access. The honest gold standard is per-job deletion: the file exists only while it's being processed.</p>

<h2>3. Whose code runs on the page?</h2>
<p>Search for <em>"third party"</em>, <em>"analytics"</em>, <em>"partners"</em>. Analytics scripts and unpinned CDN-loaded tools see more than most policies admit — a script injected into the page while you hold a sensitive document is inside the room, whatever the data-sharing section says. A strict content-security policy and self-hosted code are the structural fix.</p>

<h2>4. What does "free" actually include?</h2>
<p>Search for <em>"premium"</em>, <em>"limit"</em>, <em>"tasks"</em>. Daily task caps and Pro-gated quality settings tell you who the product is really for: the free tier is the funnel, and your documents are the foot traffic. Free-with-no-catch does exist, but it needs a different funding model — ours is simply that the owner pays for it.</p>

<h2>Ask these four of us, too</h2>
<p>Our answers: local-first by default; server jobs deleted per-job; no third-party scripts on tool pages; free means the whole catalogue, no caps. And because answers are cheap, the <a href="/security">Trust page</a> shows you how to verify each one from your own browser.</p>
`,
  },
  {
    slug: "privatools-vs-ilovepdf",
    title: "PrivaTools vs iLovePDF (2026): The Fine Print, Compared",
    description:
      "iLovePDF is the biggest name in online PDF tools. We compared free tiers, file handling, limits and privacy line by line — here's where each one wins.",
    publishedAt: "2026-08-20",
    updatedAt: "2026-09-01",
    readTime: "8 min read",
    tldr:
      "iLovePDF is a polished, mature suite whose free tier has task limits, Premium-gated settings, and server-side processing with time-limited retention. PrivaTools is fully free with no caps, runs most tools in your browser so files never upload, and deletes server-job files per-job. Choose iLovePDF for its desktop/mobile apps and workflow ecosystem; choose PrivaTools when price, limits, or file privacy decide it.",
    relatedTools: ["merge-pdf", "compress-pdf", "pdf-to-word", "edit-pdf"],
    tags: ["Comparison", "PDF"],
    author: "Lakshya Lodha",
    body: `
<p>iLovePDF is probably the first name anyone meets when they search for a PDF tool, and it earns much of that position: the suite is mature, fast, and pleasant to use. This comparison isn't about pretending otherwise. It's about the fine print — what the free tier actually includes, where your file physically goes, and how long it stays there — checked against each site's own public pages in August 2026.</p>

<h2>The short verdict</h2>
<p><strong>Choose iLovePDF</strong> if you want native desktop and mobile apps, a large workflow ecosystem, and don't mind an account and Premium for the heavier settings. <strong>Choose PrivaTools</strong> if you want every tool free without caps, or you're handling documents that shouldn't be uploaded anywhere at all.</p>

<h2>Side by side</h2>
<table>
  <thead><tr><th>On the free tier</th><th>PrivaTools</th><th>iLovePDF</th></tr></thead>
  <tbody>
    <tr><td>Price for everything</td><td>Free, all of it</td><td>Freemium — Premium tier for full access</td></tr>
    <tr><td>Task limits</td><td>None</td><td>Limits on some tools</td></tr>
    <tr><td>Settings behind paywall</td><td>Never</td><td>Some (e.g. stronger compression)</td></tr>
    <tr><td>Where files go</td><td>Local-first; disclosed server for heavy jobs</td><td>Uploaded to their servers</td></tr>
    <tr><td>Retention</td><td>Deleted per-job</td><td>Time-limited retention window</td></tr>
    <tr><td>Account walls</td><td>Never for tools</td><td>For some features</td></tr>
    <tr><td>Ads &amp; third-party scripts</td><td>None</td><td>Analytics</td></tr>
  </tbody>
</table>

<h2>Where your file actually goes</h2>
<p>This is the deepest difference, because it isn't a pricing decision — it's architecture. iLovePDF processes files on its servers: every merge, every compression, every conversion means your document travels to their infrastructure and lives there for the retention window their policy describes. That's a normal, defensible design; it's how almost every tool site works.</p>
<p>PrivaTools inverts the default. A merge, split, rotate or image conversion runs <em>in your browser tab</em> — open the network panel while using <a href="/tool/merge-pdf">Merge PDF</a> and you'll watch nothing upload. Only jobs that genuinely need native code (OCR, office conversion, heavy video) use our one disclosed server, marked with an amber chip before you add a file, and deleted when the job ends.</p>
<p>For a holiday itinerary, this difference is academic. For a medical record, a term sheet, or an unreleased manuscript, it's the whole decision.</p>

<h2>What does the free tier actually include?</h2>
<p>iLovePDF's free tier is generous for casual use, but it is a funnel by design: some tools carry task limits, the strongest compression and OCR settings sit behind Premium, and batch sizes are capped. None of that is hidden — it's just easy to miss until the dialog appears mid-task.</p>
<p>PrivaTools has no premium tier to funnel toward. Every tool in the catalogue, every setting, batch and pipeline included, is free with a 500&nbsp;MB per-file cap and no daily quota. The trade is transparency about why: the site is owner-funded and sells nothing, which also means no team of hundreds and no SLA — <a href="/status">the status page</a> says exactly what "best effort" means.</p>

<h2>Where iLovePDF is simply better</h2>
<p>Honesty cuts both ways. iLovePDF ships real desktop apps for Windows and Mac and full mobile apps — if you need offline batch work inside a corporate machine's policies, that's a genuine advantage (our answer, an installable PWA with cached tools, is lighter but younger). Its Workflows product automates multi-step jobs with a team behind it. And its sheer brand ubiquity means tutorials for everything.</p>

<h2>The bottom line</h2>
<p>Both suites will merge your PDF in five seconds. The differences live in the fine print: what free includes, and where the file spends those five seconds. If those two lines matter to you, that's the comparison — and it's why our <a href="/compare">comparison page</a> checks every cell against each competitor's own public pages, dated, so you can verify them yourself.</p>
<p><em>Sources: ilovepdf.com public tool, pricing and policy pages, read August 2026. Corrections welcome via <a href="/support">Support</a>.</em></p>
`,
  },
  {
    slug: "privatools-vs-smallpdf",
    title: "PrivaTools vs Smallpdf (2026): Free Tiers Under a Microscope",
    description:
      "Smallpdf pioneered the clean one-task-one-page PDF site. We compared its free tier, limits and file handling against PrivaTools, line by line.",
    publishedAt: "2026-08-24",
    updatedAt: "2026-09-01",
    readTime: "7 min read",
    tldr:
      "Smallpdf is the most polished PDF suite on the web, but its free tier caps daily tasks and gates stronger compression behind Pro, and every file processes on its servers with time-limited retention. PrivaTools is uncapped and free, local-first so most files never upload, with per-job deletion for server tools. Pick Smallpdf for polish and integrations; pick PrivaTools for zero limits and files that stay on your machine.",
    relatedTools: ["compress-pdf", "pdf-to-word", "esign-pdf", "merge-pdf"],
    tags: ["Comparison", "PDF"],
    author: "Lakshya Lodha",
    body: `
<p>Smallpdf more or less invented the modern PDF-tool website: one task per page, a big friendly dropzone, and an interface calm enough to trust. Twenty-something tools later it remains the reference for polish. The question this comparison answers is narrower: what does its free tier actually let you do, and what happens to your file when you drop it — versus doing the same job on PrivaTools. Everything below was checked against each site's own public pages in August 2026.</p>

<h2>The short verdict</h2>
<p><strong>Choose Smallpdf</strong> for its refined editor, e-signing workflow, and integrations (Dropbox, Google Drive, browser extensions) — if the daily free-task cap fits your usage or Pro fits your budget. <strong>Choose PrivaTools</strong> when you'd hit those caps, need a setting Smallpdf gates behind Pro, or are handling files that shouldn't leave your machine.</p>

<h2>Side by side</h2>
<table>
  <thead><tr><th>On the free tier</th><th>PrivaTools</th><th>Smallpdf</th></tr></thead>
  <tbody>
    <tr><td>Price for everything</td><td>Free, all of it</td><td>Freemium — Pro tier</td></tr>
    <tr><td>Daily task limits</td><td>None</td><td>Limited free tasks</td></tr>
    <tr><td>Settings behind paywall</td><td>Never</td><td>Moderate &amp; Strong compression are Pro</td></tr>
    <tr><td>Where files go</td><td>Local-first; disclosed server for heavy jobs</td><td>Uploaded to their servers</td></tr>
    <tr><td>Retention</td><td>Deleted per-job</td><td>Time-limited</td></tr>
    <tr><td>Account walls</td><td>Never for tools</td><td>For some features</td></tr>
    <tr><td>Ads &amp; third-party scripts</td><td>None</td><td>Analytics</td></tr>
  </tbody>
</table>

<h2>What does compression cost on each?</h2>
<p>Compression is Smallpdf's signature tool, and it's excellent — but the free tier offers its basic level, with Moderate and Strong compression marked Pro. That's a legitimate business model; it's also the exact pattern worth learning to spot, because the setting you actually came for is the one behind the gate.</p>
<p><a href="/tool/compress-pdf">PrivaTools compression</a> exposes every level to everyone — the model isn't a funnel, so there's nothing to gate. The same applies across the catalogue: if a tool has a setting, you have the setting.</p>

<h2>Where do your files go — and what does the meter cost?</h2>
<p>Smallpdf processes on its servers with a time-limited retention window, and meters free usage per day. Neither is sinister — but a meter changes how a tool feels: every task spends something. PrivaTools has no meter to spend and, for most tools, no upload to weigh: browser-local jobs leave the network panel empty, and the server-backed minority delete per-job on one disclosed machine.</p>

<h2>Where Smallpdf is simply better</h2>
<p>Its e-sign product is a genuinely complete signing workflow with an audit trail. Its editor's annotation UX is arguably the smoothest in the category. Cloud-storage integrations are first-class, and the mobile apps are mature. If your documents already live in Drive and polish is the priority, Smallpdf is a fine answer — this page exists for the days the meter, the gate, or the upload is the thing that matters.</p>

<h2>The bottom line</h2>
<p>Smallpdf sells convenience and finish, and prices them honestly. PrivaTools removes the price and, wherever physics allows, removes the upload too. Check both claims yourself — their pricing page, and our <a href="/security">network-tab test</a> — and the right tool for your Tuesday becomes obvious.</p>
<p><em>Sources: smallpdf.com public tool, pricing and policy pages, read August 2026. Corrections welcome via <a href="/support">Support</a>.</em></p>
`,
  },
  {
    slug: "privatools-vs-sejda",
    title: "PrivaTools vs Sejda (2026): The 3-Tasks-an-Hour Question",
    description:
      "Sejda's PDF editor is the best free one on the web — for three tasks an hour. We compared its limits, retention and privacy with PrivaTools.",
    publishedAt: "2026-08-27",
    updatedAt: "2026-09-01",
    readTime: "7 min read",
    tldr:
      "Sejda offers the web's best free PDF editor with unusually transparent limits: 3 tasks per hour, 200 pages/50 MB per file, files deleted after 2 hours. PrivaTools has no task caps, a 500 MB limit, browser-local processing for most tools and per-job deletion for the rest. Use Sejda for occasional heavy editing; use PrivaTools for volume, larger files, or documents that shouldn't upload.",
    relatedTools: ["edit-pdf", "compress-pdf", "split-pdf", "fill-form"],
    tags: ["Comparison", "PDF"],
    author: "Lakshya Lodha",
    body: `
<p>Sejda deserves more credit than it gets. Its web PDF editor — real text editing, not annotation overlays — is the best free one available, and its limits are stated with a transparency most competitors avoid: three tasks per hour, up to 200 pages or 50&nbsp;MB per document, files deleted after two hours. This comparison takes that honesty seriously and measures both sides with the same ruler, from each site's own public pages as of August 2026.</p>

<h2>The short verdict</h2>
<p><strong>Choose Sejda</strong> when you need its genuinely excellent in-document text editing a few times a week and your files fit its caps. <strong>Choose PrivaTools</strong> for anything high-volume or large, for batch and pipeline work, or when a file shouldn't spend two hours on someone's server.</p>

<h2>Side by side</h2>
<table>
  <thead><tr><th>On the free tier</th><th>PrivaTools</th><th>Sejda</th></tr></thead>
  <tbody>
    <tr><td>Price for everything</td><td>Free, all of it</td><td>Freemium — daily caps, paid lifts them</td></tr>
    <tr><td>Task limits</td><td>None</td><td>3 tasks / hour</td></tr>
    <tr><td>File size cap</td><td>500 MB per file</td><td>50 MB / 200 pages</td></tr>
    <tr><td>Where files go</td><td>Local-first; disclosed server for heavy jobs</td><td>Uploaded to their servers</td></tr>
    <tr><td>Retention</td><td>Deleted per-job</td><td>“Deleted after 2 hours”</td></tr>
    <tr><td>Account walls</td><td>Never for tools</td><td>For some features</td></tr>
    <tr><td>Ads &amp; third-party scripts</td><td>None</td><td>Analytics</td></tr>
  </tbody>
</table>

<h2>What three tasks an hour really means</h2>
<p>A task meter is fine until the moment it isn't: a scanned contract that needs splitting, rotating, compressing and a signature blows through an hour's allowance in one sitting. Sejda's meter is honest about being a meter — but volume work is simply outside its free tier's design. PrivaTools doesn't meter; <a href="/batch">batch</a> runs one tool across a folder of files, and <a href="/pipeline">pipeline</a> chains steps in one pass, both free.</p>

<h2>“Deleted after 2 hours” vs deleted after the job</h2>
<p>Sejda states its retention plainly, and two hours is short by industry standards. It is still a window: for that period your document exists on their infrastructure. PrivaTools' server-backed tools delete per-job — the file exists only while being processed — and the majority of the catalogue never uploads at all, which is the only retention policy that needs no trust: watch the network tab and see for yourself.</p>

<h2>Where Sejda is simply better</h2>
<p>The editor. Editing existing text inside a PDF — matching fonts, reflowing a line — is hard, and Sejda's implementation is the best free one on the web; our own <a href="/tool/edit-pdf">Edit PDF</a> covers overlay-style edits, whiteout, shapes and stamps, but for deep in-place text surgery Sejda wins today. Its desktop app also mirrors the web suite for offline work. Credit where due.</p>

<h2>The bottom line</h2>
<p>Sejda is what a fair freemium product looks like: real capability, plainly stated caps. PrivaTools is what a no-tier product looks like: everything free, and the privacy question answered structurally instead of contractually. Occasional deep edits — Sejda. Everything, every day, without uploads — that's what we built.</p>
<p><em>Sources: sejda.com public tool, pricing and policy pages, read August 2026. Corrections welcome via <a href="/support">Support</a>.</em></p>
`,
  },
  {
    slug: "privatools-vs-ihatepdf",
    title: "PrivaTools vs ihatepdf (2026): When Both Sides Are Private",
    description:
      "ihatepdf processes everything in your browser — the same privacy bet we make. So the comparison comes down to catalogue depth, heavy jobs and the details.",
    publishedAt: "2026-08-30",
    updatedAt: "2026-09-01",
    readTime: "6 min read",
    tldr:
      "ihatepdf is a genuinely private, free, browser-only PDF suite — files never upload by its stated, network-tab-verifiable design, the same architecture PrivaTools uses for most tools. The differences: PrivaTools spans 200+ tools across PDF, image, video, audio and developer work, handles server-class jobs (OCR, office conversion) with disclosed per-job deletion, loads no third-party scripts, and adds batch, pipelines and an installable offline app.",
    relatedTools: ["merge-pdf", "ocr-pdf", "pdf-to-word", "image-compressor"],
    tags: ["Comparison", "PDF"],
    author: "Lakshya Lodha",
    body: `
<p>Most comparisons on this blog contrast a local-first architecture with an upload-everything one. This one can't: ihatepdf processes files in your browser, exactly the way most of our catalogue does. Files never reach its servers — a claim you can verify in its network tab the same way you can in ours. When both sides make the same privacy bet, the comparison moves to what's built on top of it. As always, everything here comes from each site's public pages as of August 2026.</p>

<h2>The short verdict</h2>
<p><strong>ihatepdf</strong> is a clean, free, honest browser-only PDF toolkit — if your needs fit inside "PDF jobs a browser can do," it serves them well. <strong>PrivaTools</strong> covers that same ground and then keeps going: 221 tools across file types, server-class jobs done with disclosed per-job deletion, batch and pipeline automation, and no third-party scripts.</p>

<h2>Side by side</h2>
<table>
  <thead><tr><th></th><th>PrivaTools</th><th>ihatepdf</th></tr></thead>
  <tbody>
    <tr><td>Price</td><td>Free, all of it</td><td>Free</td></tr>
    <tr><td>Task limits</td><td>None</td><td>None</td></tr>
    <tr><td>Where files go</td><td>Local-first; disclosed server for heavy jobs</td><td>Stays in browser</td></tr>
    <tr><td>Heavy jobs (OCR, office conversion)</td><td>Yes — server-backed, deleted per-job</td><td>Limited to what a browser can do</td></tr>
    <tr><td>Beyond PDF</td><td>Image, video, audio, archive, developer tools</td><td>PDF-focused</td></tr>
    <tr><td>Ads &amp; third-party scripts</td><td>None</td><td>Analytics</td></tr>
    <tr><td>Automation</td><td>Batch + multi-step pipelines</td><td>Per-tool</td></tr>
  </tbody>
</table>

<h2>What can a browser-only suite not do?</h2>
<p>Committing to never touching a server is a clean promise with a real cost: some jobs just don't fit. Accurate OCR needs full recognition models; converting a .docx to a faithful PDF needs an actual office layout engine; a 4K video transcode would set a laptop's fans on fire. A browser-only suite must either skip those tools or ship diminished versions of them.</p>
<p>Our answer is a middle path: keep everything local that can be local, and run the exceptions on <a href="/security">one disclosed server</a> with per-job deletion — labeled with an amber chip before you ever add a file. You always know which kind of tool you're holding.</p>

<h2>How much further does the catalogue go?</h2>
<p>PrivaTools' catalogue runs past two hundred tools: alongside the PDF suite sit image conversion and compression, video and audio work, archives, and a bench of developer utilities — one bookmark instead of five. Two smaller distinctions worth naming plainly: our pages load <strong>no third-party scripts</strong> — the only telemetry is a first-party pageview count that honors DNT/GPC and an opt-out (ihatepdf loads standard third-party analytics — normal, but a script on the page is a script on the page), and the whole site installs as an offline-capable app with cached tools.</p>

<h2>Respect where due</h2>
<p>ihatepdf demonstrates the point this whole site is built on: browser-local file tools are practical, fast and free to run, which is exactly why upload-first suites deserve the scrutiny. We consider it the most honest of our competitors — this comparison exists because "which private one?" is a question people actually ask, not because one of us is hiding something.</p>

<h2>The bottom line</h2>
<p>If both tools do your job locally, use whichever feels better — you've already won. The days PrivaTools earns the bookmark are the ones that need OCR at 2am, a folder of HEICs converted, a pipeline run on twelve contracts, or simply a page with no third-party scripts watching you work.</p>
<p><em>Sources: ihatepdf.cv public pages, read August 2026. Corrections welcome via <a href="/support">Support</a>.</em></p>
`,
  },
  {
    slug: "chat-with-pdf-free-private",
    title: "How to Chat With a PDF for Free — Without Uploading It",
    description:
      "Ask questions about any PDF using your own AI key: the text is extracted in your browser and each question goes straight to the provider you choose, never through PrivaTools. Costs, honest limits, and how it compares with hosted chat services.",
    publishedAt: "2026-09-01",
    readTime: "8 min read",
    tldr:
      "PrivaTools Chat with PDF extracts the text in your browser with pdf.js and sends each question straight to the AI provider you pick, using your own API key — free, no subscription, no middleman holding your document. It needs a selectable text layer (run OCR on scans first) and reads the first ~100,000 characters.",
    relatedTools: ["chat-with-pdf", "ocr-pdf", "summarize-pdf", "pdf-to-text"],
    tags: ["AI", "PDF", "Privacy", "How-To"],
    author: "Lakshya Lodha",
    body: `
<p>"Chat with a PDF" is one of the most-searched file tasks of 2026, and nearly every site offering it works the same way: you upload the document to their servers, their backend calls an AI model, and a subscription meter decides how many questions you get. <a href="/tool/chat-with-pdf">PrivaTools Chat with PDF</a> inverts that design. The text is extracted inside your browser, each question travels straight from your tab to the AI provider you chose, and the meter is your own API account — which, for a typical question, means a fraction of a cent rather than a monthly plan.</p>

<h2>How does chatting with a PDF work without an upload middleman?</h2>
<p>PrivaTools Chat with PDF is built on a bring-your-own-key (BYOK) architecture. When you add a PDF, Mozilla's pdf.js — the same engine Firefox uses to display PDFs — extracts the text layer page by page inside the browser tab. When you ask a question, the browser sends that text and your question directly to the AI provider you configured: Anthropic, OpenAI, Google Gemini, Mistral, Groq, Together AI, DeepSeek, OpenRouter, or any self-hosted OpenAI-compatible endpoint such as Ollama. The request carries your own API key, which is stored encrypted at rest on your device, with a session-only mode for borrowed machines. PrivaTools servers never receive the document, the question, or the key — there is deliberately no server fallback for this tool, because a conversational answer needs a real LLM and we don't proxy documents. Follow-up questions keep recent turns of the conversation, so you can dig into an answer naturally.</p>
<p>One detail worth knowing: the document is passed to the model inside a delimited fence with an instruction that whatever appears inside is data, not direction. A PDF containing text like "ignore previous instructions" gets quoted, not obeyed.</p>

<h2>What does it cost to chat with a PDF this way?</h2>
<p>The tool is free — no account, no task meter, no premium tier. What you pay is your provider's normal API rate for the tokens each question uses, billed to your own account. In practice that is startlingly small: a question against a full-length contract typically costs a fraction of a cent on current budget-tier models, and at most a few cents on frontier models. Some providers offer free API tiers, which work here too, and pointing the self-hosted option at Ollama on your own machine makes the marginal cost zero.</p>
<p>Compare the hosted model: a chat-with-PDF subscription bills the same every month whether you ask three questions or three hundred. With your own key you pay per question asked, and for individual use the arithmetic rarely adds up to a dollar a month.</p>

<h2>Why is bring-your-own-key more private than a hosted chat service?</h2>
<p>With a hosted chat-with-PDF service, your document passes through — and usually rests on — a middleman's infrastructure: they receive the file, keep it around to answer follow-up questions, and their privacy policy governs retention, staff access, and whether your content improves their models. Bring-your-own-key removes the middleman entirely. The only parties are your browser and the AI provider you chose, under the API terms of your own account — terms you or your company may already have vetted for other work. There is no second retention policy stacked on top, no extra set of servers holding a copy, and nothing for PrivaTools to see, store, or train on. And if even one provider is one too many, the self-hosted option sends the text to an endpoint on your own machine, where it never crosses the internet at all.</p>

<h2>Step by step</h2>
<ol>
  <li>Open <a href="/tool/chat-with-pdf">Chat with PDF</a>.</li>
  <li>Paste an API key once. The AI hub in the top bar manages keys for every provider and stores them encrypted on your device.</li>
  <li>Drop your PDF — extraction runs in the tab with a per-page progress bar.</li>
  <li>Ask anything: deadlines, obligations, definitions, "summarize section 4", "what does clause 7 mean for the tenant". Follow-ups keep the thread.</li>
  <li>Copy out any answer, or clear the chat and load the next document.</li>
</ol>

<h2>What are the honest limits?</h2>
<ul>
  <li><strong>It needs a text layer.</strong> pdf.js can only extract text that exists as text. A scanned PDF is photographs of pages — run it through <a href="/tool/ocr-pdf">OCR PDF</a> first, then chat with the result. The tool detects the situation and says so rather than answering from nothing.</li>
  <li><strong>Very long documents are truncated.</strong> The model receives the first ~100,000 characters — roughly 60–100 pages of typical text. When a document runs longer, the tool tells the model it is seeing only the beginning, and instructs it to flag, rather than guess, when an answer may sit past the cutoff.</li>
  <li><strong>You need a key.</strong> There is no bundled model behind this tool — that is the design, not a gap: routing your document through PrivaTools servers to reach an LLM would undo the entire privacy story. If you want zero setup, <a href="/tool/summarize-pdf">Summarize PDF</a> ships a free on-device model.</li>
  <li><strong>Answers are only as good as the model you picked.</strong> A small free-tier model will miss nuance a frontier model catches. Same tool, your choice of brain.</li>
</ul>

<h2>How does it compare with ChatPDF, Adobe AI Assistant, and Humata?</h2>
<p>These services answer the same need with a different architecture: hosted processing, their choice of model, and a subscription above the free tier. We can't audit their internals, so the table sticks to each vendor's own published design rather than guessed numbers.</p>
<table>
  <thead><tr><th></th><th>PrivaTools Chat with PDF</th><th>ChatPDF</th><th>Adobe AI Assistant</th><th>Humata</th></tr></thead>
  <tbody>
    <tr><td>Where the PDF goes</td><td>Text extracted in your tab; questions go only to the provider you chose</td><td>Uploaded to their servers</td><td>Processed in Adobe's cloud</td><td>Uploaded to their cloud</td></tr>
    <tr><td>Price model</td><td>Free tool; you pay your provider per question</td><td>Free tier with limits, subscription above it</td><td>Paid add-on subscription on top of Acrobat</td><td>Free tier with limits, subscription tiers above</td></tr>
    <tr><td>Who picks the model</td><td>You — eight hosted providers, or self-hosted</td><td>They do</td><td>Adobe does</td><td>They do</td></tr>
    <tr><td>Account required</td><td>No</td><td>For full use</td><td>Yes (Adobe ID)</td><td>Yes</td></tr>
  </tbody>
</table>
<p>None of this makes the hosted services dishonest — subscriptions fund real engineering, and Adobe's assistant is genuinely well integrated with Acrobat. The difference is structural: they are services your document must visit; this is a tool your document passes through on its way to a provider you already trust.</p>

<h2>The bottom line</h2>
<p>If you're going to let an AI read a document, the list of parties who see it matters more than any feature. With bring-your-own-key chat, that list has one entry — the provider you chose — and the bill is your API meter, not another subscription. Bring a key, drop a PDF, ask.</p>
<p><a href="/tool/chat-with-pdf">Chat with your PDF now — free, no account, straight to your provider →</a></p>
`,
  },
  {
    slug: "ai-pdf-tools-no-upload-byok",
    title: "AI PDF Tools, No Upload Required: Your Own Key or On-Device Models",
    description:
      "PrivaTools runs AI two ways without an upload middleman: your own API key, sent browser-to-provider, or free on-device models that download once and then work offline. What each tool uses, model sizes, and how to verify it all in DevTools.",
    publishedAt: "2026-09-01",
    readTime: "7 min read",
    tldr:
      "There are two ways to run AI on a document privately: bring your own API key, so text goes straight from your browser to a provider you already trust, or run a free on-device model that downloads once and then works offline. PrivaTools' five AI tools use both; the AI hub in the top bar manages keys and models.",
    relatedTools: ["chat-with-pdf", "summarize-pdf", "translate-pdf", "smart-redact", "remove-background"],
    tags: ["AI", "Privacy", "Engineering"],
    author: "Lakshya Lodha",
    body: `
<p>The typical "AI PDF tool" is an upload box with a model behind it: your document goes to the vendor's servers, their backend calls the AI, and their privacy policy — not physics — is what stands between your contract and someone else's training run. PrivaTools takes a different approach, and it isn't one trick but two. This page explains both, because knowing which one a tool uses is the whole privacy story.</p>

<h2>What are the two ways to run AI privately?</h2>
<p><strong>Way one: bring your own key (BYOK).</strong> You paste an API key from a provider you already trust — Anthropic, OpenAI, Google Gemini, Mistral, Groq, Together AI, DeepSeek, OpenRouter, or a self-hosted OpenAI-compatible endpoint such as Ollama. The key is stored encrypted at rest on your device, and every request goes directly from your browser to that provider. PrivaTools never proxies the call, so there is no middleman server that could log, retain, or train on the text: the parties involved are your browser and your provider, full stop.</p>
<p><strong>Way two: on-device models.</strong> The tool downloads a free, open model into the browser's cache — once — and runs it inside the tab with WebAssembly. After that download it works offline: the document is processed on your own CPU, no key, no account, no per-use cost.</p>
<p>Both are managed from one place: the <strong>AI hub</strong> in the top bar. Its first tab holds keys per provider, with a session-only mode for borrowed machines; its second lists every on-device model with its real size on this device, a download button so you can fetch weights ahead of a flight, and a remove button that frees the space.</p>

<h2>Which PrivaTools tools use which?</h2>
<table>
  <thead><tr><th>Tool</th><th>Free on-device engine</th><th>With your own key</th></tr></thead>
  <tbody>
    <tr><td><a href="/tool/chat-with-pdf">Chat with PDF</a></td><td>— (a real conversation needs a full LLM)</td><td>Any provider answers questions about the document</td></tr>
    <tr><td><a href="/tool/summarize-pdf">Summarize PDF</a></td><td>DistilBART summarizer (English)</td><td>Stronger frontier-model summaries</td></tr>
    <tr><td><a href="/tool/translate-pdf">Translate PDF</a></td><td>OPUS-MT — English to and from 24 languages</td><td>Any language, source auto-detected</td></tr>
    <tr><td><a href="/tool/smart-redact">Smart Redact</a></td><td>Regex passes + a BERT NER model find PII locally</td><td>Better name and organisation coverage</td></tr>
    <tr><td><a href="/tools/remove-background">Remove Background</a></td><td>RMBG-1.4 matting model</td><td>— (its alternative is our server engine)</td></tr>
  </tbody>
</table>
<p>Smart Redact deserves a plain sentence, because it layers the two ways deliberately. Its regex passes — emails, phone numbers, SSNs, card numbers — always run locally, with no model and no network. If you opt into a key for better name coverage, the values those local passes already caught are masked out of the text before anything is sent: the tool that hunts your most sensitive strings is built so those exact strings are the ones a provider never receives. Applying the redactions is its one server step — the PDF and your approved list go to the isolated backend so PyMuPDF can remove the content for real, permanently, and the job's files are deleted when it ends.</p>

<h2>How big are the on-device models?</h2>
<p>Model weights are the cost of way two, and it is a one-time cost per device. Everything downloads from the Hugging Face CDN the first time a tool needs it (or ahead of time from the AI hub), lands in the browser's cache, and stays until you remove it:</p>
<table>
  <thead><tr><th>Model</th><th>Powers</th><th>One-time download</th></tr></thead>
  <tbody>
    <tr><td>DistilBART CNN</td><td>Summarize PDF</td><td>~250&nbsp;MB</td></tr>
    <tr><td>BERT NER</td><td>Smart Redact's name/organisation detection</td><td>~250&nbsp;MB</td></tr>
    <tr><td>OPUS-MT</td><td>Translate PDF</td><td>~107&nbsp;MB per language pair</td></tr>
    <tr><td>RMBG-1.4</td><td>Remove Background</td><td>~44&nbsp;MB</td></tr>
  </tbody>
</table>
<p>The AI hub reports the true size of everything cached and deletes any model in one click. None of it needs an account, because the cache belongs to your browser profile, not to us.</p>

<h2>When should you pick which?</h2>
<p>Pick the <strong>on-device engine</strong> when the document must not travel: it is free, works offline after the first download, and needs no key. Its honest ceiling is quality and language — DistilBART summarizes English only, small models miss nuance a frontier model catches, and a phone with little storage may not want 250&nbsp;MB of weights.</p>
<p>Pick <strong>your own key</strong> when quality or language coverage matters more, when you already pay a provider whose data terms you've vetted, or when the job outgrows a small model. It costs whatever your provider bills for the tokens — typically a fraction of a cent per operation — and the text does leave the tab: to that one provider, and no one else.</p>
<p>Pick <strong>a self-hosted endpoint</strong> when you want both at once: point the key panel at Ollama on your own machine and you get bigger-than-browser models with traffic that ends at localhost.</p>

<h2>How do you verify any of this in DevTools?</h2>
<p>Don't take this article's word for it — the network panel is the audit. Open your browser's developer tools, switch to the Network tab, and run the tool on a scrap file. An on-device tool shows the model download on first run — requests to huggingface.co — and after that, processing produces no request carrying your document; switch to airplane mode and it still works. A BYOK tool shows exactly one destination when you ask it to run: your provider's API domain, such as api.anthropic.com or api.openai.com, or your own server's address if you self-host. A server-backed PrivaTools tool shows a request to privatools.me — and tells you so before you add the file, with an amber chip on the tool page. Sixty seconds of watching that panel beats every privacy policy ever written, ours included.</p>

<h2>The bottom line</h2>
<p>"AI" and "private" stopped being opposites the moment models could run from a browser cache or answer to your own key. The right question for any AI file tool in 2026 is the one this page answers for ours: <em>who, exactly, receives my document?</em> Here the answer is either "no one" or "the provider you chose" — and the network panel will show you which, live.</p>
`,
  },
  {
    slug: "remove-background-without-uploading",
    title: "Remove an Image Background Without Uploading It Anywhere",
    description:
      "PrivaTools' Background Remover can run the RMBG-1.4 model in your browser — a ~44 MB one-time download that then works offline — with a server engine as the no-download alternative. How that compares with remove.bg's upload model.",
    publishedAt: "2026-09-01",
    readTime: "6 min read",
    tldr:
      "PrivaTools removes image backgrounds two ways: on this device, where the RMBG-1.4 model (~44 MB, downloaded once) runs in your browser and then works offline, or on our server with no download, processed in isolation and deleted after the job. Both are free at full resolution — unlike upload-based services whose free tiers limit output resolution.",
    relatedTools: ["remove-background", "image-converter", "image-compressor", "remove-exif"],
    tags: ["Image", "AI", "Privacy", "How-To"],
    author: "Lakshya Lodha",
    body: `
<p>Product shots, profile photos, passport pictures, design cutouts — background removal is the most-reached-for AI image job there is, and the famous way to do it is to upload your photo to a service and download the cutout. That trade is no longer necessary. <a href="/tools/remove-background">PrivaTools' Background Remover</a> can run the model in your browser: the photo stays on your machine, and after a one-time download the tool works with no connection at all.</p>

<h2>How does background removal run in a browser?</h2>
<p>The on-device engine uses RMBG-1.4, an open background-removal model from BRIA, running inside the tab through WebAssembly. The first time you choose "On this device", the ~44&nbsp;MB model downloads from the Hugging Face CDN and is cached by your browser — the same download-once arrangement PrivaTools uses for its summarizer, translator, and PII detector. From then on the pipeline is entirely local: the image is scaled to the model's 1024×1024 working resolution, the model predicts a matte — a per-pixel map of subject versus background — and that matte is composited into the original image's alpha channel at the photo's full resolution. The result is a PNG with real transparency, computed on your own hardware. Turn the network off after the first download and the tool keeps working, which is also the simplest proof of where the work happens.</p>

<h2>Step by step</h2>
<ol>
  <li>Open <a href="/tools/remove-background">Background Remover</a>.</li>
  <li>Choose where the AI runs: <strong>On our server</strong> (no download, fastest first run) or <strong>On this device</strong> (one ~44&nbsp;MB download, then offline).</li>
  <li>Drop JPEG, PNG, or WebP images — several at once if you like, each with its own status.</li>
  <li>Download the results: one image saves as a transparent PNG; several pack into a single ZIP.</li>
</ol>

<h2>When is the server engine the better choice?</h2>
<p>The server engine runs a U²-Net-family model on our backend, and it earns its place three ways. First run speed: there is no 44&nbsp;MB download, so the first cutout arrives sooner. Low-powered devices: matte prediction is real CPU work, and an older phone or a storage-tight laptop is happier letting the server carry it. And difficult images: the two engines are genuinely different models, so tricky edges — flyaway hair, fur, glass — can come out differently; when one leaves a rough edge, trying the other is free and often settles it. Choosing the server does mean the photo travels to our one disclosed server — the tool says exactly that before you add a file — where it is processed in isolated temporary storage and deleted when the job ends. No account, no retention window, no third-party cloud.</p>

<h2>How does this compare with remove.bg?</h2>
<p>remove.bg is the category's household name, and its quality reputation is earned. The differences are architecture and pricing model, so the table sticks to each side's own published design — no guessed numbers.</p>
<table>
  <thead><tr><th></th><th>PrivaTools Background Remover</th><th>remove.bg</th></tr></thead>
  <tbody>
    <tr><td>Where the photo goes</td><td>Stays on your device (browser engine), or one disclosed server with per-job deletion</td><td>Uploaded to their servers</td></tr>
    <tr><td>Price</td><td>Free — both engines, full resolution</td><td>Free tier limits output resolution; full resolution is tied to paid credits and subscriptions</td></tr>
    <tr><td>Account</td><td>None</td><td>Required for full-resolution work</td></tr>
    <tr><td>Works offline</td><td>Yes, after the one-time model download</td><td>No</td></tr>
    <tr><td>Ecosystem</td><td>Part of a free 200-plus-tool file suite</td><td>API, desktop apps, and design-tool plugins</td></tr>
  </tbody>
</table>
<p>Where remove.bg is simply better: integrations and specialisation. Its API, desktop apps, and design-tool plugins slot into production workflows, and years of tuning exactly one job show in its consistency across awkward subjects. If you process hundreds of non-sensitive product shots inside a design pipeline, it is a reasonable choice. The days this page exists for are the other ones: a photo you'd rather not upload, a batch you'd rather not meter, or full resolution without a plan.</p>

<h2>What about the metadata in your photos?</h2>
<p>Whatever happens to the cutout, the original photo still carries its EXIF block — capture time, camera model, sometimes GPS coordinates. If originals are heading anywhere public, strip them with <a href="/tools/remove-exif">Remove EXIF</a> first. And when the cutout needs a different format or a smaller file, <a href="/tools/image-converter">Image Converter</a> and <a href="/tools/image-compressor">Image Compressor</a> finish the job — no account for any of it, like everything else here.</p>

<h2>The bottom line</h2>
<p>Background removal was one of the last everyday image jobs that seemed to require someone else's cloud. It doesn't anymore: a 44&nbsp;MB model in your browser cache does the work on your machine, free and offline, with a server engine one click away for the days you'd rather skip the download. The photo only travels if you pick the engine that travels.</p>
<p><a href="/tools/remove-background">Remove a background now — free, full resolution, no account →</a></p>
`,
  },
  {
    slug: "transcribe-audio-free-no-upload",
    title: "Transcribe Audio to Text Free — Without Uploading the Recording",
    description:
      "Run OpenAI's Whisper model inside your browser to transcribe meetings, interviews, and voice notes for free — the recording never uploads. Timestamps, .txt and .srt export, an own-key option for higher accuracy, and the honest limits of both paths.",
    publishedAt: "2026-09-01",
    readTime: "8 min read",
    tldr:
      "Open PrivaTools Transcribe Audio, choose the free on-device engine, and OpenAI's Whisper model — Tiny at ~41 MB or Base at ~74 MB — transcribes the recording inside your browser with timestamps, exporting .txt or .srt. Nothing uploads. For higher accuracy, add your own OpenAI or Groq key and the audio goes browser-to-provider directly.",
    relatedTools: ["transcribe-audio", "audio-trim", "audio-converter", "subtitle-converter"],
    tags: ["AI", "Audio", "Privacy", "How-To"],
    author: "Lakshya Lodha",
    body: `
<p>Transcription is the file task with the most to leak: interviews under embargo, medical dictation, legal notes, a founder thinking out loud. The famous services all answer it the same way — upload the audio to their cloud, wait, and trust. <a href="/tools/transcribe-audio">PrivaTools Transcribe Audio</a> answers it differently: a speech-recognition model downloads into your browser once, the recording is transcribed on your own machine, and the only thing that ever moves over the network is the model coming down.</p>

<h2>How does transcription run in your browser?</h2>
<p>PrivaTools Transcribe Audio runs OpenAI's Whisper speech-recognition model inside the browser tab through transformers.js — the same WebAssembly arrangement that powers the site's summarizer and translator. The first time you transcribe, the model downloads once from the Hugging Face CDN — ~41&nbsp;MB for Whisper Tiny, ~74&nbsp;MB for Whisper Base — and is cached by your browser; the AI hub in the top bar shows the real size and removes it in one click. From then on the pipeline is entirely local: the Web Audio API decodes your file to 16&nbsp;kHz mono, the model reads it in 30-second chunks with a five-second overlap so words at chunk borders aren't cut, and every segment arrives with start and end timestamps. The recording itself never leaves the tab — turn the connection off after the first download and transcription keeps working, which is also the simplest proof.</p>

<h2>Step by step</h2>
<ol>
  <li>Open <a href="/tools/transcribe-audio">Transcribe Audio</a>.</li>
  <li>Choose the engine: <strong>On this device</strong> (free, Whisper in the browser) or <strong>Your own key</strong> (higher accuracy through a provider you choose).</li>
  <li>For on-device, pick a model size — Tiny (~41&nbsp;MB) or Base (~74&nbsp;MB). The download happens once and is cached.</li>
  <li>Drop the audio — anything your browser can decode: MP3, WAV, M4A, OGG and friends.</li>
  <li>Read the transcript with timestamps, copy it, or download it as .txt or .srt.</li>
</ol>

<h2>Tiny or Base — which Whisper model should you pick?</h2>
<p>Start with Tiny. At ~41&nbsp;MB it downloads fastest, transcribes fastest, and handles clearly recorded speech — a phone memo, a podcast, a quiet meeting — well enough that you may never switch. Base, at ~74&nbsp;MB, is noticeably better where Tiny stumbles: accents, crosstalk, room echo, quieter voices. Both are cached after the first download and both work offline afterwards, so the practical answer is to try Tiny on a real recording and step up only if the transcript makes you wince. The models sit alongside the site's other on-device AI in the AI hub in the top bar, which shows their true size on this device and deletes either in one click.</p>

<h2>How do you get subtitles out of a recording?</h2>
<p>Because Whisper emits start and end times for every segment, the tool can hand you a ready-made <strong>.srt subtitle file</strong> instead of a wall of text — one numbered cue per segment, standard enough to drop straight into a video editor, a media player, or a caption uploader. For video, pull the soundtrack out first with <a href="/tools/extract-audio">Extract Audio</a>, transcribe it, then attach the result with <a href="/tools/add-subtitles">Add Subtitles to Video</a>. If a player insists on VTT or another format, <a href="/tools/subtitle-converter">Subtitle Converter</a> switches between them — in the browser, like the rest of the chain.</p>

<h2>When should you use your own API key instead?</h2>
<p>The Tiny and Base models are the small end of the Whisper family, and honesty requires saying so: a hosted frontier transcription model will beat them on names, jargon, heavy accents, and messy audio. That is what the tool's second engine is for. Add your own API key — OpenAI, Groq, or any self-hosted OpenAI-compatible server — and the audio goes directly from your browser to that provider's transcription API, never through PrivaTools. The key is stored encrypted on your device, the bill is your provider's normal API rate on your own account, and the privacy trade is explicit: one provider you chose sees the audio, instead of no one. It is the right choice when accuracy matters more than absolute locality — publishing an interview, minuting a meeting that matters — and the wrong one for audio that must not travel at all.</p>

<h2>What are the honest limits?</h2>
<ul>
  <li><strong>Long recordings are slow locally.</strong> Whisper in a browser runs on your CPU: expect processing time on the order of the recording's own length, not seconds. A ten-minute memo is fine; a three-hour board meeting is a job to start before lunch — or a case for the key engine.</li>
  <li><strong>Provider APIs cap uploads around 25&nbsp;MB.</strong> The hosted transcription endpoints reject larger files, so trim long recordings with <a href="/tools/audio-trim">Audio Trimmer</a> or shrink them to a compact format with <a href="/tools/audio-converter">Audio Converter</a> first. The on-device engine has no such cap — only your patience.</li>
  <li><strong>No speaker labels.</strong> Whisper transcribes what was said, not who said it. Services built around meetings do diarisation; this tool does not pretend to.</li>
  <li><strong>Small models miss things.</strong> Product names, technical terms, and thick accents are where Tiny and Base show their size, and English is their strongest language. The transcript is editable text — read it before you ship it.</li>
</ul>

<h2>How does this compare with Otter.ai-style hosted transcription?</h2>
<p>Otter and its peers are meeting products, not just transcribers, and the comparison should say so plainly. The table sticks to how each side is designed — no guessed numbers.</p>
<table>
  <thead><tr><th></th><th>PrivaTools Transcribe Audio</th><th>Hosted services (Otter-style)</th></tr></thead>
  <tbody>
    <tr><td>Where the audio goes</td><td>Stays in your browser — or browser-to-provider with your own key</td><td>Uploaded to their cloud</td></tr>
    <tr><td>Price model</td><td>Free on-device; own key billed at your provider's API rate</td><td>Subscription; free plans metered in transcription minutes</td></tr>
    <tr><td>Account</td><td>None</td><td>Required</td></tr>
    <tr><td>Works offline</td><td>Yes, after the one-time model download</td><td>No</td></tr>
    <tr><td>Speaker labels &amp; meeting bots</td><td>No</td><td>Yes — their real specialty</td></tr>
  </tbody>
</table>
<p>If you live in meetings and want an assistant that joins calls, labels speakers, and files summaries into a workspace, the hosted products earn their subscription. If what you have is a recording and what you want is the text — without the recording joining a corpus somewhere — a model in your own browser answers the question with no counterparty at all.</p>

<h2>The bottom line</h2>
<p>Speech-to-text was the classic "sorry, that needs the cloud" feature, and it simply isn't true anymore. A ~41&nbsp;MB model in your browser cache turns recordings into timestamped, exportable text with nobody listening in, and your own API key is one paste away when a harder recording needs a bigger model. Either way, the subscription is not part of the deal.</p>
<p><a href="/tools/transcribe-audio">Transcribe a recording now — free, no account, nothing uploads →</a></p>
`,
  },
  {
    slug: "ocr-scanned-pdf-free-three-ways",
    title: "OCR a Scanned PDF Free: Three Engines, and When Each Wins",
    description:
      "PrivaTools OCR PDF ships three engines: server Tesseract with searchable-PDF output, in-browser tesseract.js where nothing uploads, and vision AI through your own key for hard scans. A decision guide, with a trade-off table.",
    publishedAt: "2026-09-01",
    readTime: "8 min read",
    tldr:
      "PrivaTools OCRs scanned PDFs three ways, all free: the default server engine (Tesseract — multi-file queue, searchable-PDF output, deleted per job), an in-browser engine (tesseract.js — nothing uploads, text output), and a vision-AI engine that reads hard scans with your own GPT-4o, Claude, or Gemini-class key. Pick by scan quality and privacy need.",
    relatedTools: ["ocr-pdf", "image-ocr", "pdf-to-text", "chat-with-pdf"],
    tags: ["PDF", "OCR", "AI", "How-To"],
    author: "Lakshya Lodha",
    body: `
<p>A scanned PDF is photographs of paper wearing a .pdf extension: you can look at it, but you cannot search it, copy from it, or feed it to anything that reads text. OCR fixes that — and because no single OCR approach wins on every document, <a href="/tool/ocr-pdf">PrivaTools OCR PDF</a> ships three engines behind one page. This guide is the decision: which engine, for which scan, and why.</p>

<h2>What are the three engines?</h2>
<p>No single OCR approach wins on every scan, which is why one tool page holds three genuinely different machines. The default <strong>server engine</strong> runs Tesseract in PrivaTools' isolated backend: it takes a queue of files, reads seventeen installed languages, offers 150/200/300 DPI precision presets, and is the only engine that outputs a searchable PDF — your original scan with an invisible text layer underneath, so it still looks like the paper but behaves like text. The <strong>in-browser engine</strong> runs tesseract.js inside your tab through WebAssembly: language data downloads once from a CDN and caches locally, page images never upload, and the output is the extracted text. The <strong>vision-AI engine</strong> sends page images to a GPT-4o, Claude, or Gemini-class model using your own API key — dramatically better on hard scans, with pages travelling browser-to-provider and never through PrivaTools.</p>

<h2>When does the server engine win?</h2>
<p>Most of the time, which is why it is the default. It is the only engine that produces a <strong>searchable PDF</strong> — for archiving, filing, or anything a human still needs to view as the original page, that output format settles the question by itself. It is also the volume engine: files process as a queue with per-file status and retry, big documents run without the 50-page cap the client-side engines carry, and three DPI presets (Fast at 150, Balanced at 200, Precise at 300) trade speed against fidelity on low-quality scans. The trade is stated on the page before you add a file: the PDF travels to PrivaTools' one disclosed server, is processed in isolated temporary storage, and is deleted when the job ends — no account, no retention window, no third-party cloud.</p>

<h2>When does the in-browser engine win?</h2>
<p>When the document must not travel, full stop. Medical records, unredacted contracts, anything under NDA: the in-browser engine renders each page locally at roughly 144&nbsp;DPI, runs Tesseract compiled to WebAssembly on them inside your tab, and never sends a page image anywhere. The only network traffic is infrastructure — the OCR engine itself and the language pack you pick download from a CDN on first use, then cache, so the second run needs nothing new. The costs are real and worth stating: it reads one file at a time, up to 50 pages per run, output is text rather than a searchable PDF, and it is the slowest of the three on long documents. For a page you could not email, that is usually a fine price.</p>

<h2>When does the vision-AI engine win?</h2>
<p>On the scans the other two lose: handwriting, skewed phone photos of paper, coffee-stained fax-era copies, dense tables, mixed-language pages. Tesseract reads print; a vision model reads the page the way you do. Paste your own API key — Anthropic, OpenAI, Google Gemini, or any of the eight supported providers — and each page image goes directly from your browser to that provider, never through PrivaTools, billed at your provider's normal rate on your own account. Accuracy on hard material is in a different class; the trade is that a provider you chose sees the pages, and output is text rather than a searchable PDF. For genuinely difficult one-off documents, it is the engine that actually works.</p>

<h2>Side by side</h2>
<table>
  <thead><tr><th></th><th>Server (default)</th><th>In-browser</th><th>Vision AI (your key)</th></tr></thead>
  <tbody>
    <tr><td>Do pages upload?</td><td>Yes — one disclosed server, deleted per job</td><td>No — OCR runs in your tab</td><td>To your chosen provider only</td></tr>
    <tr><td>Accuracy class</td><td>Solid on clean print</td><td>Same Tesseract family, slower</td><td>Best — handles handwriting and messy scans</td></tr>
    <tr><td>Searchable-PDF output</td><td>Yes</td><td>No — text only</td><td>No — text only</td></tr>
    <tr><td>Languages</td><td>17 installed packs</td><td>Packs download once, then cached</td><td>Whatever the model reads — effectively very broad</td></tr>
    <tr><td>Files per run</td><td>Multi-file queue, no page cap</td><td>One file, up to 50 pages</td><td>One file, up to 50 pages</td></tr>
    <tr><td>Cost</td><td>Free</td><td>Free</td><td>Free tool; provider bills your key</td></tr>
  </tbody>
</table>

<h2>What should you do with a really hard scan?</h2>
<p>Work up the ladder. First rerun the server engine on the Precise preset — 300&nbsp;DPI rescues more marginal scans than people expect, especially small print and light toner. If the text still comes back garbled, the scan is probably beyond pattern-matching OCR: switch to the vision engine and let a model that understands layout read it. If the source is a photo rather than a PDF — a whiteboard, a receipt, a book page — <a href="/tools/image-ocr">Image OCR</a> offers the same three-engine choice for single images. And once any engine has given the document real text, the rest of the toolbox opens: pull clean text with <a href="/tool/pdf-to-text">PDF to Text</a>, interrogate it with <a href="/tool/chat-with-pdf">Chat with PDF</a>, or hand it to <a href="/tool/translate-pdf">Translate PDF</a>.</p>

<h2>The bottom line</h2>
<p>OCR stopped being one technology, and treating it as one setting is why scanned PDFs still defeat people. Clean scans in volume want the server engine and its searchable PDFs. Documents that cannot travel want Tesseract running in your own tab. The genuinely hard scans want a vision model on your own key. All three live on one free page, and the page tells you what each one does with your file before you drop it.</p>
<p><a href="/tool/ocr-pdf">OCR a scanned PDF now — free, three engines, no account →</a></p>
`,
  },
  {
    slug: "translate-pdf-free-private",
    title: "Translate a PDF for Free — Without Uploading It",
    description:
      "PrivaTools Translate PDF runs OPUS-MT translation models inside your browser — about 107 MB per language pair, downloaded once — or translates between 30 languages through your own AI key with automatic source detection. What each path sends, and the one Save-as-PDF caveat.",
    publishedAt: "2026-09-01",
    readTime: "7 min read",
    tldr:
      "PrivaTools Translate PDF extracts text with pdf.js and translates it on your device with OPUS-MT models — ~107 MB per language pair, downloaded once, English-centric pairs, free. Your own AI key unlocks 30 languages in any direction with source auto-detect. Only the optional Save-as-PDF step sends text to a server — the translation, never the original file.",
    relatedTools: ["translate-pdf", "ocr-pdf", "summarize-pdf", "chat-with-pdf"],
    tags: ["PDF", "AI", "Privacy", "How-To"],
    author: "Lakshya Lodha",
    body: `
<p>Document translation is a strange corner of the free-tools market: Foxit, Nitro, LightPDF, and TinyWow all offer it, and all of them do it by sending your document to their servers. <a href="/tool/translate-pdf">PrivaTools Translate PDF</a> does the work in the opposite place. The text is extracted in your browser, a translation model runs in your browser, and the result appears in your browser — the document you dropped never leaves your machine.</p>

<h2>How does a PDF get translated inside a browser?</h2>
<p>The pipeline has three local stages. Mozilla's pdf.js — the engine Firefox uses to display PDFs — extracts the text layer in the tab. That text is chunked so sentences stay intact, then fed through an OPUS-MT model: open translation models from the Helsinki-NLP research group, converted to ONNX and run through transformers.js on WebAssembly, the same arrangement behind the site's summarizer and transcriber. Each language pair is its own model, roughly 107&nbsp;MB, downloaded from the Hugging Face CDN the first time you use that pair and cached by your browser afterwards — the AI hub in the top bar shows what is installed and frees the space in one click. After that download the pair works offline, costs nothing per run, and involves no account and no API key. Translation quality is what a compact specialist model delivers: strong on straightforward prose, more literal than a frontier LLM on idiom.</p>

<h2>Which language pairs are free on-device?</h2>
<p>The on-device catalogue is English-centric and deliberately asymmetric, because the models are: 24 languages translate into English — including Japanese, Korean, Polish, Turkish, and Thai — and English translates out into 19, across the major European languages plus Arabic, Hindi, Chinese, Vietnamese, and Indonesian. A pair appears in the picker only if its model actually exists with verified weights, because a direction that fails after a 107&nbsp;MB download is the worst possible way to find out. The same honesty explains what is missing: non-English pairs like German to French are not offered on-device, since they would need two chained models with compounded errors. That job belongs to the other engine.</p>

<h2>What does your own AI key add?</h2>
<p>Paste an API key from any of the eight supported providers — or a self-hosted OpenAI-compatible endpoint such as Ollama — and the translation engine changes character. The language list grows to 30, any direction, German to French included, and the source language is detected automatically, so a document you cannot identify is itself a fair input. Idiom, tone, and terminology come out the way a frontier model renders them rather than a compact specialist model. The text travels browser-to-provider directly — PrivaTools is not in the path — and the cost is your provider's normal token rate on your own account, which for typical documents is small change rather than a subscription.</p>

<h2>Step by step</h2>
<ol>
  <li>Open <a href="/tool/translate-pdf">Translate PDF</a>.</li>
  <li>Pick the engine: on-device OPUS-MT (free) or your own key (30 languages, auto-detect).</li>
  <li>Drop the PDF. On-device, choose source and target; the model downloads on first use with a progress bar.</li>
  <li>Read the translation, copy it, or download it as text.</li>
  <li>Optionally, click <strong>Save as PDF</strong> for a typeset PDF — read the caveat below first.</li>
</ol>

<h2>What does Save as PDF actually send?</h2>
<p>Everything up to the final step happens on your device: extraction, the model run, the translated text, and the copy button all live in the tab. The one exception is explicit and opt-in. The browser bundle ships no PDF writer, so the <strong>Save as PDF</strong> button posts the translated text to PrivaTools' text-to-PDF renderer — the same isolated backend other server tools use, with per-job deletion — and returns a typeset PDF. What that request contains is the translation you are looking at, and nothing else: the original document is never part of it, and if you skip the button, the request never exists at all. The tool says this at the point of use rather than burying it in a policy page. If even translated text should not travel, use the copy button or the text download and the job ends entirely on your machine.</p>

<h2>What are the honest limits?</h2>
<ul>
  <li><strong>It needs a text layer.</strong> A scanned PDF is pictures of words; run it through <a href="/tool/ocr-pdf">OCR PDF</a> first, then translate the result.</li>
  <li><strong>Output is translated text, not a re-typeset lookalike.</strong> The tool translates the document's words; it does not rebuild fonts, columns, and figures in place. For reading and working, that is usually the point — for print-faithful layout in another language, you are in professional-DTP territory, not free-tool territory.</li>
  <li><strong>Compact models are literal.</strong> OPUS-MT handles contracts, manuals, and correspondence well; marketing copy and idiom read better through the key engine — or through <a href="/tool/chat-with-pdf">Chat with PDF</a>, which can translate and explain in the same conversation.</li>
  <li><strong>Pairs add up on disk.</strong> Each on-device pair is ~107&nbsp;MB. The AI hub lists every cached model with its real size and removes any of them in one click.</li>
</ul>

<h2>The bottom line</h2>
<p>Translation was the file task everyone assumed needed a cloud — the models were too big, the languages too many. The honest sentence is now shorter: a 107&nbsp;MB model in your browser translates the common pairs free and offline, your own key covers 30 languages when coverage or nuance matters, and the original document stays on your machine in both cases. Read the one caveat, then stop uploading things just to read them.</p>
<p><a href="/tool/translate-pdf">Translate a PDF now — free, on-device, no account →</a></p>
`,
  },
  {
    slug: "bring-your-own-ai-key-guide",
    title: "Bring Your Own AI Key: The 10-Minute Setup Guide",
    description:
      "What bring-your-own-key means, where all eight supported providers issue API keys, the self-hosted Ollama path, where the key is stored, what tasks really cost, and how to verify with DevTools that requests go straight from your browser to your provider.",
    publishedAt: "2026-09-01",
    readTime: "9 min read",
    tldr:
      "Bring your own key means PrivaTools' AI tools run on an API key you created at a provider you already trust. Paste it once into the AI hub; it is stored encrypted on your device, every request goes browser-to-provider directly, and a typical task costs a fraction of a cent on your own meter instead of a subscription.",
    relatedTools: ["chat-with-pdf", "summarize-pdf", "translate-pdf", "smart-redact", "ocr-pdf"],
    tags: ["AI", "Privacy", "How-To"],
    author: "Lakshya Lodha",
    body: `
<p>Every AI subscription is the same bet: that you will use enough of it, every month, to beat the meter. For file tasks — summarize this, translate that, read this scan — the arithmetic rarely works, and the subscription usually rides along with an upload. There is a third way between paying monthly and running everything locally: bring your own key. Ten minutes of setup, and the AI tools on this site run on your own account, at your chosen provider, with no middleman. Here is the whole thing, start to finish.</p>

<h2>What does bring your own key actually mean?</h2>
<p>Bring your own key (BYOK) means the AI features on this site run on an API key you created yourself, at a provider you already trust — instead of on a bundled model behind our servers. Paste the key once into the AI hub in the top bar and it is stored encrypted at rest on your device; from then on, every AI request travels directly from your browser to that provider's API. PrivaTools is not in the path: there is no proxy server that could log the text, no second privacy policy stacked on your provider's, and nothing for us to retain or train on. The parties who see your document are exactly the parties you chose — one hosted provider, or none at all if you point the same panel at a model running on your own machine. That is the whole idea, and the network tab can verify it.</p>

<h2>Why is it cheaper than a subscription?</h2>
<p>Because API pricing is metered by the token — a unit of text — and file tasks use surprisingly few of them. Summarizing a report, translating a letter, asking a contract a question: on current budget-tier models each of these typically costs a fraction of a cent, and even frontier models put most single-document tasks at a few cents. You pay exactly that, exactly when you use it, and nothing in the months you don't. A subscription charges the same whether you touched it or not; a key charges for the work. Several providers even run free API tiers with rate limits, which work here unchanged — and the self-hosted path below takes the marginal cost to zero. For an individual's document workload, it is genuinely hard to spend a dollar a month.</p>

<h2>Where does each provider issue keys?</h2>
<p>Every provider follows the same shape: create an account, open the console, generate a key, copy it once. Plain-text addresses, no affiliate anything:</p>
<table>
  <thead><tr><th>Provider</th><th>Keys are issued at</th></tr></thead>
  <tbody>
    <tr><td>Anthropic (Claude)</td><td>console.anthropic.com/settings/keys</td></tr>
    <tr><td>OpenAI</td><td>platform.openai.com/api-keys</td></tr>
    <tr><td>Google Gemini</td><td>aistudio.google.com/apikey</td></tr>
    <tr><td>OpenRouter</td><td>openrouter.ai/keys</td></tr>
    <tr><td>Groq</td><td>console.groq.com/keys</td></tr>
    <tr><td>Mistral</td><td>console.mistral.ai</td></tr>
    <tr><td>DeepSeek</td><td>platform.deepseek.com</td></tr>
    <tr><td>Together AI</td><td>api.together.ai</td></tr>
  </tbody>
</table>
<p>OpenRouter deserves a footnote: it routes to many models from many labs, so one key there is the closest thing to a universal key. Groq and Google are popular starting points because both run free tiers at the time of writing.</p>

<h2>The ten-minute setup, step by step</h2>
<ol>
  <li>Create a key at your provider (table above). Most consoles ask for billing details; some free tiers don't.</li>
  <li>Open the <strong>AI hub</strong> in the top bar of any PrivaTools page — the same panel that manages the on-device models.</li>
  <li>Pick the provider, paste the key, choose a model. Done: every AI tool on the site now sees it.</li>
  <li>On a shared or borrowed machine, switch on <strong>session-only mode</strong> first — the key is then held for the current session and never saved to the device; close the tab and it is gone.</li>
  <li>Open <a href="/tool/chat-with-pdf">Chat with PDF</a>, drop any PDF, and ask it something. If an answer comes back, you are wired up.</li>
</ol>

<h2>What about self-hosted models — Ollama and friends?</h2>
<p>The ninth entry in the provider list is not a company: any server that speaks the OpenAI-compatible API works, which covers Ollama, vLLM, LM Studio, and most of the self-hosting ecosystem. Run Ollama on your own machine, point the AI hub at your local address, and the provider receiving your documents is your own hardware — traffic ends at localhost, marginal cost is zero, and it works with no internet connection at all. It is the option for the strictest reading of private: bigger models than a browser tab can hold, with the party count at zero.</p>

<h2>Where does the key live, and what is the honest caveat?</h2>
<p>The key is stored on your device, encrypted at rest with the same wrapping-key arrangement the site's password vault uses, and it never appears in a URL. The honest caveat, which the interface states rather than papers over: an API key cannot be locked away as thoroughly as a vault password, because it has to be readable to go into a request header when you run a task. Encrypted on your device at rest; readable at the moment of use. If that trade is wrong for a machine you don't control, session-only mode exists, and the hub deletes any stored key in one click. Rotating or revoking the key at your provider's console works instantly too — it is your key, at your account, under your control.</p>

<h2>How do you verify it with DevTools?</h2>
<p>Open your browser's developer tools, switch to the Network tab, and run any AI task. You should see exactly one destination for the request that carries your text: your provider's API domain — api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, or your own server's address if you self-host. No privatools.me request carrying the document, no third-party scripts, no beacon. Two details reward the close reader: the key rides in a request header, never in the URL, and the site's Content-Security-Policy permits connections to AI providers only on the AI tool pages themselves — on every other page of the site, the browser is instructed to refuse those origins outright. A policy you can read in the response headers beats a promise in a policy page.</p>

<h2>Which PrivaTools tools use the key?</h2>
<ul>
  <li><a href="/tool/chat-with-pdf">Chat with PDF</a> — ask questions of any text-layer PDF; built key-only by design.</li>
  <li><a href="/tool/summarize-pdf">Summarize PDF</a> — frontier-quality summaries; a free on-device model is the alternative.</li>
  <li><a href="/tool/translate-pdf">Translate PDF</a> — 30 languages with source auto-detect; on-device pairs are the alternative.</li>
  <li><a href="/tool/smart-redact">Smart Redact</a> — better name and organisation coverage; the local detection passes run regardless, and values they catch are masked out before anything is sent.</li>
  <li><a href="/tool/ocr-pdf">OCR PDF</a> and <a href="/tools/image-ocr">Image OCR</a> — vision-model reading for hard scans.</li>
  <li><a href="/tools/transcribe-audio">Transcribe Audio</a> — provider transcription APIs (OpenAI, Groq, or self-hosted) beyond the in-browser Whisper models.</li>
</ul>

<h2>The bottom line</h2>
<p>Bring-your-own-key is the unglamorous answer to the AI-subscription question: pay your model provider for tokens, keep the middleman count at zero, and let the network tab audit the whole story. Ten minutes, one paste, and the meter finally belongs to you.</p>
<p><a href="/tool/chat-with-pdf">Set up a key and try it on a PDF — free, no account →</a></p>
`,
  },
  {
    slug: "batch-process-files-free",
    title: "Batch-Process Files for Free: 25 at a Time, No Quotas",
    description:
      "Around 160 of PrivaTools' 221 tools take up to 25 files per run — per-file status, retry-failed, one ZIP. The /batch page swallows folder drops, /pipeline chains tools into one pass, and none of it is metered. How it works, honestly.",
    publishedAt: "2026-09-01",
    readTime: "7 min read",
    tldr:
      "Around 160 of PrivaTools' 221 tools accept up to 25 files per run, with per-file status, a retry-failed button, and one ZIP download — free, no quotas, no account. The /batch page handles bigger folder drops through any batchable tool, and /pipeline chains steps so one drop runs several tools in sequence.",
    relatedTools: ["compress-pdf", "batch-compress-pdf", "image-compressor", "image-converter"],
    tags: ["Productivity", "PDF", "Image", "How-To"],
    author: "Lakshya Lodha",
    body: `
<p>The moment a file task becomes twenty file tasks is the moment most free tools stop being free: a meter appears, a subscription is suggested, or you feed a queue one file at a time like a parking meter. PrivaTools took the opposite bet — volume is the normal case. Most tools on the site take a stack of files in one run, a dedicated <a href="/batch">batch page</a> takes folders, and a <a href="/pipeline">pipeline builder</a> chains tools together. None of it is metered, and none of it needs an account.</p>

<h2>How does multi-file processing work on a normal tool page?</h2>
<p>Around 160 of PrivaTools' 221 tools accept up to 25 files in one run, straight on the tool page. Drop them together and each file becomes a row with its own status — queued, running, done, or failed — processed a few at a time so a big queue doesn't stampede the server. When everything finishes, one file downloads directly, and several package into a single ZIP; there is no meter deciding whether you have runs left, because there is no meter. A failed file doesn't sink the batch either: successful results stay put, and a retry button reruns only the failures. The whole arrangement is free, with no account, no watermark, and no daily quota — the hard limits are 25 files per run, the 500&nbsp;MB size cap per file, and nothing else. For the days 25 isn't enough, keep reading.</p>

<h2>What happens when one file out of twenty fails?</h2>
<p>The thing that should happen: nothing, to the other nineteen. Each file carries its own status and its own error message, so a password-protected straggler or a corrupt download fails alone, visibly, with the reason attached. The finished results stay exactly where they are, and the <strong>Retry failed</strong> button reruns only the failures — fix the file, or simply try again on a flaky connection, without re-processing the ones that worked. It is a small design decision that determines whether batch tools are trustworthy: an all-or-nothing batch that dies at file 19 of 20 teaches you to process files one at a time, which defeats the point of having a batch tool at all.</p>

<h2>When should you use the /batch page instead?</h2>
<p>When the drop is bigger than a tool page comfortably holds, or when choosing the tool is the step you want last. The <a href="/batch">Batch</a> page is a CI-style dashboard: pick any one of the batchable tools — compression, conversion, rotation, watermarking, metadata stripping, and most other per-file jobs across PDF and image alike — then drag a whole folder onto it. Every file becomes a row with live status, failures retry individually, runs can go parallel or one-by-one, and a recent-batches panel remembers what you ran. Converting a phone's worth of HEICs with <a href="/tools/heic-to-jpg">HEIC to JPG</a>, shrinking a quarter's scans with <a href="/tool/compress-pdf">Compress PDF</a>, squeezing a website's images with <a href="/tools/image-compressor">Image Compressor</a> — folder in, ZIP out.</p>

<h2>How do pipelines chain tools together?</h2>
<p>Batch runs one tool across many files; <a href="/pipeline">Pipeline</a> runs many tools in sequence. You assemble the chain visually — file in, step 01, step 02, step 03, result out — dragging steps to reorder them, and the classic example is contract prep: <a href="/tool/merge-pdf">merge</a> → <a href="/tool/compress-pdf">compress</a> → <a href="/tool/watermark">watermark</a> → <a href="/tool/sign-pdf">sign</a>, one click, one output. Chains save under a name and reload later, so a team's document routine becomes a button rather than a checklist. Between the two pages the whole shape of repetitive file work is covered: same tool, many files — or many tools, one flow.</p>

<h2>How do quota-based suites handle the same job?</h2>
<p>By design, differently: the freemium model needs the meter. Task allowances per day or per hour — Sejda, to its credit, states its cap plainly at 3 tasks per hour — with a subscription to lift them; some ad-funded suites add a CAPTCHA in front of every task; and because those suites are upload-first, a 25-file batch means 25 files resting on someone else's infrastructure under someone else's retention policy. None of this is villainy — servers cost money, and meters are how freemium funds them — but it does mean the free tier is specifically not built for the day you arrive with a folder. That day is the one this page is about.</p>

<h2>Why is it free with no quotas — what is the catch?</h2>
<p>The unexciting answer is architecture. Most PrivaTools tools do their work in your browser, so your batch spends your CPU, not ours — quotas exist to protect servers, and for those tools there is no server to protect. The tools that do need one run on a single disclosed server with per-job deletion, funded as part of the project rather than per task. The pages load no third-party scripts and carry no ads, so there is no engagement math pushing toward meters either. The limits that do exist are physical and stated: 25 files per run on tool pages, 500&nbsp;MB per file, and your own machine's patience on the biggest local jobs.</p>

<h2>The bottom line</h2>
<p>Volume is where file tools reveal their real pricing model. Here the answer stays the same at one file or twenty-five: free, per-file status, retry what failed, one ZIP at the end — with <a href="/batch">/batch</a> when it is a folder and <a href="/pipeline">/pipeline</a> when it is a process. Bring the whole stack.</p>
<p><a href="/batch">Run a batch now — free, no quotas, no account →</a></p>
`,
  },
  {
    slug: "chatpdf-alternatives-private",
    title: "ChatPDF Alternatives That Don't Keep Your Documents",
    description:
      "Hosted chat-with-PDF services work by holding your file: upload, retention, their model, a subscription above the free tier. Here are the private alternatives — bring-your-own-key chat, an on-device summarizer, or a model on your own machine — with honest pros for both sides.",
    publishedAt: "2026-09-01",
    readTime: "7 min read",
    tldr:
      "ChatPDF-style services hold your document: it uploads to their servers, stays for follow-up questions, and a subscription sits above the free tier. The private alternative keeps the file out of a middleman's hands: PrivaTools Chat with PDF extracts text in your browser and sends questions straight to an AI provider you choose — or to a model on your own machine.",
    relatedTools: ["chat-with-pdf", "summarize-pdf", "ocr-pdf", "translate-pdf"],
    tags: ["AI", "PDF", "Comparison", "Privacy"],
    author: "Lakshya Lodha",
    body: `
<p>Search for "chat with PDF" and the results are a crowd of near-identical services: ChatPDF, Humata, AskYourPDF, and dozens more. They work, and people like them — but every one of them works by taking custody of your document. If the documents you want to interrogate are contracts, medical records, or anything a client trusted you with, "works" is only half the question. This page maps the alternatives that answer the other half, and stays honest about what the hosted services still do better.</p>

<h2>How do hosted chat-with-PDF services actually work?</h2>
<p>Every hosted chat-with-PDF service — ChatPDF, Humata, AskYourPDF, and the many lookalikes — is built on the same wrapper architecture. You upload the document to their servers; they index it and keep it so follow-up questions work across sessions; their backend forwards your questions to an AI model they selected; and a free tier with limits sits under a subscription that lifts them. None of that is a scandal — it is simply what the design requires — but it means your document now lives under a second company's retention policy, staff-access rules, and terms about model training, stacked on top of whatever the underlying AI provider does. The product you are paying for is convenience plus custody: they hold your file so that you need no setup. A private alternative is any design that delivers the chat without the custody.</p>

<h2>What is genuinely good about the hosted model?</h2>
<p>Credit where due, because it is real. Zero setup: no API key, no configuration — sign up and drop a file. Persistence: documents and chat history follow your account across devices, which custody is what makes possible. Long documents: hosted services index your file and retrieve the relevant parts per question, so a 500-page manual is comfortable territory. And polish: dedicated apps, integrations, team features. For public documents — manuals, textbooks, published research — the custody trade costs you little and the convenience is genuine. The problem is narrower than the marketing on either side admits: it is specifically the documents that should not rest on a third party's infrastructure, which for anyone who works with clients is most of the interesting ones.</p>

<h2>What does a private alternative look like?</h2>
<p>Any design that delivers the chat without the custody. <a href="/tool/chat-with-pdf">PrivaTools Chat with PDF</a> does it with bring-your-own-key architecture: the PDF's text is extracted inside your browser tab with pdf.js, and each question travels directly from your browser to an AI provider you configured with your own API key — Anthropic, OpenAI, Google Gemini, Mistral, Groq, Together AI, DeepSeek, OpenRouter, or a self-hosted endpoint. PrivaTools servers never receive the document, the question, or the key; there is no second company holding your file, and no subscription — you pay your provider's per-token rate, typically a fraction of a cent per question. The strictest version points the same tool at Ollama on your own machine, where the provider is your own hardware and nothing crosses the internet. And when the job is a summary rather than a conversation, <a href="/tool/summarize-pdf">Summarize PDF</a> runs a free model entirely on-device — no key at all.</p>

<h2>Side by side: custody versus your own key</h2>
<p>Architecture, not a scoreboard — we cannot audit anyone's internals, so the table sticks to each model's own published design, with no guessed quotas or prices.</p>
<table>
  <thead><tr><th></th><th>Hosted chat services</th><th>PrivaTools Chat with PDF</th><th>Self-hosted (Ollama)</th></tr></thead>
  <tbody>
    <tr><td>Where the document goes</td><td>Uploaded to their servers</td><td>Text extracted in your tab; questions go only to your chosen provider</td><td>Nowhere — stays on your machine</td></tr>
    <tr><td>Who holds it afterwards</td><td>They do, under their retention policy</td><td>No one — PrivaTools stores nothing server-side</td><td>You do</td></tr>
    <tr><td>Who picks the model</td><td>They do</td><td>You — eight providers, or your own endpoint</td><td>You</td></tr>
    <tr><td>Price model</td><td>Free tier with limits; subscription above it</td><td>Free tool; your provider bills per question</td><td>Free; your hardware does the work</td></tr>
    <tr><td>Account</td><td>Yes</td><td>No</td><td>No</td></tr>
    <tr><td>Setup</td><td>None — their real advantage</td><td>Paste an API key once (~10 minutes)</td><td>Install and run a local model</td></tr>
  </tbody>
</table>

<h2>What trade-offs do you accept by going private?</h2>
<p>Four honest ones. You need a key: ten minutes once, but a real step — the <a href="/blog/bring-your-own-ai-key-guide">setup guide</a> walks through every provider. The PDF needs a text layer: scanned documents go through <a href="/tool/ocr-pdf">OCR PDF</a> first, where hosted services often OCR silently for you. Very long documents are truncated: the model sees roughly the first 100,000 characters — about 60–100 pages — and is instructed to say so rather than guess past the cutoff, whereas hosted retrieval pipelines handle 500-page documents gracefully. And there is no synced history: conversations are not stored on anyone's account, because there is no account — which is precisely the feature, seen from the other side.</p>

<h2>The bottom line</h2>
<p>The chat-with-PDF category quietly bundles two products: the AI conversation, and the custody of your document. The hosted services sell them together and are genuinely convenient; the private alternatives unbundle them. Ask your questions through your own key — or your own machine — and the list of parties holding your document drops to the one you chose, or to zero. For the documents that made you hesitate before uploading, that is the whole point.</p>
<p><a href="/tool/chat-with-pdf">Chat with a PDF privately — free, no account, no middleman →</a></p>
`,
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

/**
 * Reverse-lookup: posts that explicitly list a tool slug in their
 * `relatedTools` field. Used by the tool-page "Related articles" sidebar
 * for internal linking + AI engine entity-graph.
 *
 * Computed once at module load (small N), sorted by published date desc.
 */
const _postsByTool: Record<string, BlogPost[]> = (() => {
  const m: Record<string, BlogPost[]> = {};
  for (const p of blogPosts) {
    for (const slug of p.relatedTools || []) {
      (m[slug] ||= []).push(p);
    }
  }
  for (const k of Object.keys(m)) {
    m[k].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  }
  return m;
})();

export function postsForTool(slug: string, limit = 4): BlogPost[] {
  return (_postsByTool[slug] || []).slice(0, limit);
}
