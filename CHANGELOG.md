# Changelog

All notable changes to PrivaTools are documented in this file, newest first.
Dates are the tag dates. Release notes for recent tags are also on the
[GitHub Releases](https://github.com/ethereaglehq/privatools/releases) page.
Tool totals in older entries describe that release; the live catalogue is at
[privatools.me/tools](https://privatools.me/tools).

## [Unreleased]

Nothing yet.

## [2.7.33] — 2026-10-05 — Old release images removed after each deploy

### Deploy

- After a deploy ends with the new release serving, `--rollback` included, the zero-downtime rollout removes old PrivaTools release images from the server. Until now they piled up at about 3.4 GB each and filled its disk. It keeps the newest three (`KEEP_IMAGES`), every container's image and the release recorded for `--rollback`. It removes images by name only, never forced or pruned, and never touches another project's image. A failure there never changes the deploy's result. It takes effect once the server runs this release's rollout: through the production rollout runbook where the zero-downtime rollout isn't installed yet, otherwise by reinstalling the scripts with `install-auto-deploy.sh` (`deploy/README.md`, "Image retention"). Its first run there removes v2.7.30. (#356)

## [2.7.32] — 2026-10-05 — No more silently shortened PDFs

### Tools

- A PDF cut short, by an interrupted download for example, is no longer turned into a shorter PDF without a word. Every PDF tool now refuses it and says how many of its pages could be read, for example "only 4 of its 6 pages", and advises downloading the file again, or Repair PDF to save the pages that survive. (#349)
- Repair PDF saves the pages that can be read and says how many of the file's pages it saved, for example "4 of its 6 pages were saved." (#349)
- PDF to Word and PDF to Excel no longer call a valid blank PDF damaged. (#349)

### For API users

- PDF routes answer a damaged PDF that lost pages with 400 `invalid_request` and the words above, where they answered 200 with the surviving pages. The v1 async jobs report it as `job_input_damaged`. (#349)

## [2.7.31] — 2026-10-05 — Form Creator finds a form's fields

### Tools

- Form Creator can find the fields of a PDF drawn as a form, such as a printed form or a Word form exported to PDF. "Detect fields" proposes text, date, checkbox and signature fields, named after their labels, from the lines, boxes, table cells and checkboxes the page draws. You accept, edit or reject each one before the form is made: detection can miss fields or propose wrong ones. It doesn't work on scans, and it reads up to 50 pages. The PDF is uploaded when you press "Detect fields", and deleted afterwards. (#352)
- Form Creator: text typed into a field on a turned page now reads upright, and the form's fields follow the page's reading order from one to the next. (#352)

### For API users

- `/api/form-creator/detect` is new: it returns proposed fields for a PDF drawn as a form. `/api/form-creator` takes `reading_order=true` to add fields in reading order; by default they are added in the order sent, as before. (#352)

## [2.7.30] — 2026-10-04 — No more freezes while translating, and Pipeline steps fixed

### Tools

- Translate PDF and Subtitle Translator no longer freeze the page while the translation model loads or works, because the model now runs in a background worker. The page used to stop responding for 4 to 7 seconds, Cancel included; now it answers at once, and the translations are the same as before. (#348)
- The Pipeline's Repair PDF, Bates Numbering and PDF to PDF/A steps work again. Each had failed every time with "Processing failed", even on intact files. (#350)

## [2.7.29] — 2026-10-04 — Damaged PDFs told apart from scans, and more damage named

### Tools

- PDF to Word and PDF to Excel: a PDF cut short whose pages came out blank now says the PDF is damaged and points to Repair PDF, instead of sending it to OCR. Scans still get the OCR advice, and PDF to Word no longer says "OCR couldn't read this PDF" when no OCR ran. (#345)
- Bookmarks, QR Code (placing a code on a PDF), Booklet and Web Optimize say "This PDF has no pages." for a PDF without pages, instead of failing with "Processing failed". QR Code also refuses a page the PDF doesn't have with the reason. (#345)
- A PDF with bytes overwritten in its page tree or in a page's content: 33 more tools say the PDF is damaged and point to Repair PDF, instead of "Processing failed. Please try again." (#345)
- Subtitle Generator no longer offers files over 200 MB to Extract Audio, Audio Converter or Cut / Trim, which take 200 MB, and its guide says so. A recording that runs a moment past 3 hours, or past 15 minutes for Ogg, Opus and FLAC, as encoders pad them, is now taken instead of refused. (#345)

### For API users

- PDF routes answer 400 `invalid_request` "This PDF appears to be corrupt or invalid." instead of 500 `processing_failed` for two more kinds of damage: a page tree or a page's content stream that can't be read. `/api/v1/bookmarks`, `qr-code`, `booklet` and `web-optimize` answer a PDF with no pages with 400. (#345)
- Background jobs (`/api/v1/jobs`, where enabled) whose input PDF can't be read, or needs a password, now fail with `error.code` `job_input_damaged` or `job_input_password_protected`, with a message that says which, instead of `job_processing_failed`. Don't retry them unchanged: the same file fails the same way. `job_processing_failed` still means a failure of the job itself. (#345)

## [2.7.28] — 2026-10-04 — The last seven tools join the shared design

### Tools

- Split PDF, Split by Text, Unlock PDF, Alternate & Mix, Overlay, HTML to PDF and URL to PDF now work like every other tool. A file the tool can't take is refused with advice, and the result says plainly whether it worked. "Try again" appears only when another attempt can help. The result downloads once by itself, with a "Download again" button, and the page says where your file goes. (#343)

### Accessibility

- Alternate & Mix and Overlay can now be used with the keyboard; before, neither file could be chosen without a mouse. Each file slot is labelled with its role, swapping the two files is announced, and focus stays in place after a file is chosen or removed. Automated accessibility checks of all seven screens find no problems. (#343)

## [2.7.27] — 2026-10-04 — Voice Noise Remover

### New tool

- Voice Noise Remover takes steady background noise out of a speech recording on your device: hum, fans, traffic or room hiss. The file never leaves your browser. RNNoise runs in the page, served from PrivaTools, and the cleaned sound comes back as a WAV that you can compare with the original before you download it. A strength control blends the cleaned sound with the original. It is made for speech, not music, and it reduces noise rather than recreating the voice. MP3, WAV, M4A, MP4, MOV, WebM and MKV files are read a minute at a time, up to 60 minutes of mono or 30 of stereo; OGG, Opus, FLAC and AAC files up to 15 minutes. (#341)

## [2.7.26] — 2026-10-04 — Smart Redact on scanned pages, and damaged PDFs on every tool

### Privacy

- Smart Redact could leave part of a secret visible on a scanned page whose hidden text layer runs upside down. This happened if PDF Table Extractor or PDF to Excel was running on the server at the same moment, or had earlier failed on a damaged file: those tools change a setting inside the PDF library that Smart Redact shares. They now never run at the same time as Smart Redact, and the setting can't be left behind. If you used Smart Redact on scanned pages before this release, check that each redacted area is fully covered. (#340)

### Tools

- Every PDF tool says "This PDF is damaged…" for a PDF cut short, by an interrupted download for example, and asks for the password for a locked one, instead of "Processing failed. Please try again." 49 tools answered a cut-short PDF that way, and 29 a locked one. (#340)

### For API users

- PDF routes answer 400 for a cut-short PDF, and 400 with the password message for a locked one, where they answered 500. On the v1 API these move from 500 `processing_failed` to 400 `invalid_request`, and the units charged are unchanged. (#340)

## [2.7.25] — 2026-10-04 — Damaged PDFs named as damaged, and PDF Table Extractor fixed

### Tools

- Every PDF tool says "This PDF is damaged…" for a file that only starts like a PDF (it stops after its first line, or holds no PDF objects), where most answered "Processing failed". Watermark PDF, E-Sign and Stamp PDF also say when a PDF is damaged, needs a password or has no pages. A PDF cut short after its page list is reported as damaged by E-Sign, Stamp PDF, Highlight, Smart Redact, PDF to SVG, Split in Half, PDF to Long Image, Invert Colors, Deskew, PDF to Image, Auto Crop and PDF to PowerPoint. (#336)
- PDF Table Extractor says when a PDF has no ruled table. Since v1.5.2 it had failed with "Processing failed" on every such file. (#336)
- Stamp PDF takes page ranges such as 1,3,5-8, as its Pages box suggests, and refuses a page the PDF doesn't have, naming the valid range, instead of stamping every page. (#336)
- Photo Collage says what is wrong with a picture it can't read, and Split by Text points a picture to Image to PDF and then OCR PDF as soon as it is chosen. (#336)
- A page range of commas only says it selects no pages, instead of "This PDF has no pages". (#336)
- PDF to Markdown converts up to five files a minute from one address, like the other heavy tools; more can be tried a minute later. (#336)
- Video and audio tools answer a fault on the server's side, such as a full disk, with "Processing failed. Please try again." and a retry, instead of blaming the file. (#336)

### For API users

- More PDF routes answer 400 with the reason for a damaged PDF, and `/api/extract-tables` answers 400 when the PDF has no ruled table. `/api/pdf-to-markdown` takes five requests a minute from one address; requests with a v1 API key count against that key's own quota instead. (#336)

## [2.7.24] — 2026-10-04 — Subtitle Translator

### New tool

- Subtitle Translator translates an SRT or VTT file and gives back the same format, with every cue's number and timing unchanged. It runs on your device with the models Translate PDF uses, which translate English into a set of languages and a set of languages into English (about 107 MB per language pair, downloaded once from Hugging Face). With your own AI key it takes any pair, and the text goes from your browser to your provider. Nothing goes to PrivaTools. A sentence that runs across cues is translated whole and put back across the same cues, and song lines, positioning tags and VTT notes and styles are kept. You check and edit the result beside the original before you download it, and cues that couldn't be translated are marked. (#334)

### Tools

- Translate PDF no longer cuts off long Chinese, Japanese, Korean or Thai passages without saying so, because it now splits text by the model's own token count. The page also no longer freezes for long stretches while it translates. (#334)

## [2.7.23] — 2026-10-04 — Clear errors instead of "Processing failed"

### Tools

- A file that isn't audio or video, given to any video or audio tool, now says "This file isn't a video or audio file this tool can read." instead of "Processing failed. Please try again." A fault on the server's side is still reported as the server's. (#332)
- Video Converter, Video Resizer, Video to PDF, Video Thumbnail, GIF to MP4 and Audio Merge say when the server ran out of time, instead of "Processing failed", and their guides say what the page shows. (#332)
- Highlight PDF, Smart Redact and PDF to SVG say when a PDF is damaged, has no pages or needs a password. (#332)
- Image tools say "This image can't be read: its data stops early or is broken" for broken WebP, TIFF, HEIC, AVIF, BMP and PNG files that used to fail with "Processing failed"; so do Merge Images, Sign PDF, Remove Background, Watermark PDF's picture and E-Sign's uploaded signature. An image too large to process gets the same answer on every tool, and E-Sign now accepts a CMYK JPEG signature. (#332)
- A cut-off picture is refused the same way on every request, instead of sometimes converting with blank pixels (a broken HEIC came back black). HTML to PDF, given HTML, and URL to PDF now leave out a cut-off PNG, GIF, BMP or TIFF picture, or a PNG whose data is broken, instead of drawing what they could of it; a cut-off JPEG is still embedded. (#332)
- A typing mistake in a page range now says so, instead of "One of the page numbers is outside this PDF". (#332)
- A picture dropped on Smart Redact, Add Hyperlinks, PDF to Excel, PDF Table Extractor or Highlight PDF is pointed to Image to PDF and then OCR PDF, since those tools need a PDF with text in it. (#332)
- Bates Numbering says that several files are numbered as one run, and Transcribe Audio's key panel lists only the providers that can transcribe. (#332)
- With your own OpenAI key, the suggested models are gpt-4o and gpt-4o-mini; o3-mini, which OpenAI shuts down on 23 October, is gone. (#332)

### Privacy

- URL to PDF no longer writes the address it converts, query string included, into the server's logs, and HTML to PDF no longer copies a picture embedded in your HTML into them when it leaves the picture out. (#332)

### For API users

- Routes that answered 500 now answer with the reason: 400 for input a media tool can't read, for an unreadable picture and for a damaged PDF on the PDF routes named above; 413 for a picture too large to process; 503 when FFmpeg is missing on the server; and 504 for a conversion that ran out of time. (#332)

### Other

- In the Air experience, "--", "->" and "<-" show as typed in all text and form fields, instead of as one dash or arrow; code and preformatted text show no ligatures in either experience. (#332)

## [2.7.22] — 2026-10-03 — PDF to Markdown, ready for LLMs

### Tools

- PDF to Markdown now gives structured Markdown. Paragraphs are joined from their lines, headings take their levels from the document's own type sizes, and ruled tables become GitHub tables. Lists keep their nesting, code stays in fenced blocks, and links and superscripts are kept. Pictures get a placeholder with their alt text or caption. Pages set in columns are read one column after the other, and Hebrew and Arabic are read right to left. You can add page markers, leave out running headers and footers, and split the result into chunks by heading or by size, as a ZIP or one file. Pages with no text layer are named, with a pointer to OCR PDF. Each file is converted on the server in a capped worker, up to 1,000 pages, and a scanned, locked, damaged or oversized file gets a message saying why. (#328)

### For API users

- `/api/pdf-to-markdown` returns structured Markdown instead of one paragraph per line with `---` between pages. Page markers and header and footer removal are opt-in (`page_markers=true`, `remove_headers_footers=true`), and `chunk` and `chunk_output` split the result. A PDF with no text layer answers 422 instead of an empty 200, and refusals answer 4xx instead of 500. (#328)

## [2.7.21] — 2026-10-03 — Fixes for Word to PDF, Transcribe Audio, Bates Numbering and more

### Tools

- Word to PDF says how many Word equations it left out, with a link to Office to PDF, which keeps them, and its guide says so too. An equation in a text box is counted once. (#330)
- Transcribe Audio offers only providers that can transcribe, each with a model it serves. DeepSeek, which has no speech-to-text service, is no longer offered. Together AI, Mistral and OpenRouter are asked for models they serve instead of OpenAI's `whisper-1`, and Together AI is asked to detect the spoken language, which it otherwise takes to be English. (#330)
- A picture dropped on PDF to Text, PDF to Word, Chat with PDF, Summarize, Translate or the AI Token Counter is pointed to Image OCR, which reads its text, instead of Image to PDF, whose PDF would have no text to read. (#330)
- Bates Numbering matters now move on after each stamped file and each production set; before, the matter never moved. A stamp from a typed Start moves the matter to where that stamp stopped, and never back. A stamp with another prefix or number of digits leaves the matter where it is, and the result says so. (#330)
- Rotate PDF calls a PDF it can't open damaged, instead of blaming a page number. (#330)
- Batch no longer shows a file count on its run button when nothing is left to run. (#330)

### Other

- Pages no longer log a Content Security Policy violation on every load, and the PDF tools that read files in the browser no longer log one for PDFs that contain PostScript functions. (#330)

## [2.7.20] — 2026-10-03 — Equations survive Office to PDF

### Tools

- Office to PDF now keeps the equations in Word documents. Before, each one came out as a blank space in the PDF, with no warning, because the server's LibreOffice had no Math module. ODT to PDF also lays out LibreOffice Math formulas again when a file stores them without a drawing. (#327)

## [2.7.19] — 2026-10-03 — AI Token Counter

### New tool

- AI Token Counter counts the tokens a text or file uses with current AI models.
  - **GPT counts** are exact and made on your device, with the o200k_base and cl100k_base tokenizers. The page names the models each one covers.
  - **Claude and Gemini counts** come from Anthropic's and Google's own counting services, using your own API key, and only when you ask. The text goes from your browser straight to that provider, and Anthropic describes its count as an estimate. Without a key, the page shows no Claude or Gemini number.
  - **Input:** paste text, or choose a text, Markdown, CSV, JSON, code, PDF or Word file. Files are read in the browser.
  - **Cost and splitting:** enter prices to see the cost, and split long text into chunks of a set number of tokens. (#323)

## [2.7.18] — 2026-10-03 — Saved passwords survive "This session only"

### Tools

- Turning on "This session only" in an AI tool's key settings no longer deletes the key that encrypts the passwords saved in My Stuff. It used to, and after the page was reloaded those passwords could not be read. It now removes only the saved AI keys. Passwords already made unreadable this way can't be recovered; save them again. (#324)

## [2.7.17] — 2026-10-03 — Subtitle Generator

### New tool

- Subtitle Generator makes SRT and VTT subtitles from a video or audio file, on your device. The sound is read in the browser and Whisper writes the captions; nothing is uploaded. Whisper Base (about 74 MB) or Tiny (about 41 MB) downloads once from Hugging Face, with the engine that runs it from jsDelivr. You check and edit the captions beside the playing video, then download SRT or VTT. Most MP4 and MOV files, and WebM, MKV, MP3, M4A and WAV, are read a minute at a time, up to 3 hours. Other formats are read whole, up to 15 minutes. (#319)

### Tools

- Transcribe Audio no longer freezes the page while Whisper runs. It lets you choose the spoken language; it used to transcribe everything as English. Cancel now stops it. (#319)

### Other

- The frontend dependency audit accepts a listed, expiring exception for an advisory that has no fix: braces, which Tailwind CSS 3 uses only while the site is built. The exception expires on 2026-11-15, and any other high or critical advisory still fails the build. (#320)

## [2.7.16] — 2026-10-02 — Every tool ends the same honest way

### Tools

- Twenty-four more tools now end a run the way the rest do. When a file fails, the page says so and offers "Choose a different file" first, with no before-and-after receipt. When some files fail, it says how many finished and why the others didn't. "Try again" appears only when another attempt could work, and it re-sends only those files. These tools include Bates Numbering, Remove Bates Numbers, Crop, Header & Footer, Highlight, Page Numbers, Protect, Permissions, Stamp, Watermark, PDF to Image, PDF to Excel, PDF to PowerPoint, PDF to Text and Split by Size. Batch and Pipeline offer a retry only for a failure another attempt could fix. (#317)
- One rule for downloads: a finished result downloads once by itself, as one file or one ZIP for several, and the page then offers "Download again". Merge PDF now follows it. Split PDF, Unlock PDF and Image to PDF gain "Download again". Editors such as Sign, Edit, Redact and Fill Form keep their own download button, and Bates Numbering's "Download ZIP again" now works. (#317)
- Add Subtitles to Video, Favicon Generator, Image Color Palette, Photo Collage, Merge Images, Remove Image Watermark, View EXIF Data and the trim tools now have their run button in the action bar. (#317)
- Where the file goes is now exact for Fill Form, which uploads when you select "Detect form fields", and for tools that take a link or text instead of a file. (#317)

### Accessibility

- Sign PDF's editor fields have labels.
- The AI tools' option panels meet the contrast minimum in Play's dark theme, and so does Page Numbers' chosen position.
- On phones, the JSON / XML Formatter's output can be reached with the keyboard. (#317)

## [2.7.15] — 2026-10-02 — Tool pages that get to the point

### Tools

- Every tool page now opens with the tool's name and what it does, followed by the tool itself. Air and Play show it in the same order: the file box, its options, the button that runs it, then the result. On many tools, the run button, the number of files and where they go now sit together in one action bar. Once a file is chosen, that bar stays in view; on phones it sits at the bottom of the screen. (#315)
- Each tool says where your file goes, in words beside the file box instead of a small badge. The answer is one of: this device, temporary processing on the PrivaTools server, your own AI provider, or your choice. Organize Pages and Remove Watermark say that the PDF is uploaded as soon as you choose it, to draw thumbnails and to look for watermarks. OCR PDF and Image OCR say you choose between the server, your AI key and this browser. (#315)

### Accessibility

- Tool pages follow one heading outline. Controls you tab to are not hidden under the action bar at 200% zoom or on phones. At higher zoom, the bar stays in the page instead of covering it. (#315)

## [2.7.14] — 2026-10-02 — Honest failures, clearer refusals, easier keyboard use

### Tools

- When a file fails, the page says so. It shows a warning, no before-and-after receipt, and "Choose a different file" first. "Try again" appears only when another attempt could work: a dropped connection, a timeout, too many requests or a server error. The message says which. When some files finish and others fail, the page says how many finished and gives the reason for each failure. PDF to Word and OCR PDF no longer show a success mark when they fail. (#312)
- A file of the wrong type, dropped or chosen, is no longer ignored or sent to the server. The page names it and says what the tool takes. When another tool does the same job or converts the file, it points there. Merge PDF leaves out a file that isn't a valid PDF, and says so, instead of asking for a password. (#312)
- Some image tools couldn't read a file that isn't an image, or an image whose data stops early or is broken. They now say so, instead of failing with a server error and offering "Try again". This covers Image Format Converter, WebP to JPG, Image Compressor, HEIC to JPG, Favicon Generator, Image Watermark, Remove EXIF Data, View EXIF Data and Image OCR. (#313)

### Accessibility

- A visible "Skip to main content" link. Controls you tab to are no longer hidden under the sticky header at 200% zoom or on phones. After a run, focus moves to the result, unless you are using something else, such as the search dialog. Search announces how many results it found.
- Text on Play's coloured backgrounds, Smart Redact's labels, the search placeholder and the edges of form fields now meet the contrast minimums in light and dark. (#312)

## [2.7.13] — 2026-10-02 — Gemini Watermark Remover

### New tool

- Gemini Watermark Remover takes the visible sparkle logo off images made with Google Gemini and Nano Banana. It runs in your browser, so the images are not uploaded. Each image is checked for the logo, the logo's size, position and strength are fitted, and Gemini's blend is reversed using calibrated masks. The result is then checked against the picture around it; where a clean result can't be confirmed, which happens more often with copies that were compressed again, resized or sharpened, the image is left unchanged and the page says so. PNG and lossless WebP stay lossless; JPEG and lossy WebP are saved again at quality 95. SynthID, Google's invisible watermark, stays in the image, the file's metadata (including any Content Credentials) is kept, and no label is added or removed. (#293)

## [2.7.12] — 2026-10-01 — HEIC reader update

### Other

- HEIC to JPG and the other tools that read HEIC and HEIF photos on the server use pillow-heif 1.8.0 with libheif 1.23.4, which fixes a crash on files whose metadata names an item type that isn't valid UTF-8. The web server moves to uvicorn 0.54.0, whose changes are to HTTP/2, which PrivaTools doesn't use. (#303)

## [2.7.11] — 2026-10-01 — Video and audio previews

### Tools

- Video and audio tools now play their result in the page before you download it. The site's security policy blocked every one of these previews on privatools.me, so the player stayed empty; downloads were not affected. (#307)

## [2.7.10] — 2026-10-01 — Media downloads that don't say where they were recorded

### Tools

- Video Converter, Video Resizer, Compress Video, Trim Media, Audio Trim, Mute Video, Video Speed, Reverse Video, Extract Audio, Audio Converter, Merge Audio, Add Subtitles and GIF to MP4 no longer copy a recording's location, device, date or other identifying tags into the file you download. Rotation still applies, audio and subtitle languages are kept, and chapters stay where the timeline is unchanged. Song tags such as title, artist and album are not carried over either; cover art stays in MP3 and FLAC. Every media tool now goes through one shared rule, so new ones get it automatically. (#305)

## [2.7.9] — 2026-10-01 — Chat with PDF on every provider, honest conversions, faster video merges

### Tools

- Chat with PDF, Translate PDF and the other bring-your-own-key AI tools work with Groq and OpenRouter, which had answered every request with "not found" since the feature shipped: requests now go to the paths those providers serve. Default models the providers retired are replaced (Gemini, DeepSeek, OpenRouter, Together and Groq), and Claude's default is now Claude Sonnet 5.5, since Sonnet 4.5 retires on 30 November. When a provider refuses the key, the model or the request's size, the page says which; when Claude declines or stops before finishing, the page says so instead of showing a partial answer as a whole one. (#290)
- JSON to PDF and XML to PDF refuse invalid, oversized or too deeply nested files with a message saying why instead of "Processing failed", read files saved with a byte-order mark, in UTF-16 or in legacy encodings, read valid UTF-8 as UTF-8 whatever the file declares, and no longer double-space indented files. Very large files are bounded so one file can't tie up the server. (#290)
- Merge Videos no longer copies the first clip's location, device and date tags into the merged video. A merge that runs out of time says so instead of failing silently, and leaves no partial file behind. (#290)
- Merge Videos joins clips recorded alike (same codec, size and frame rate, from MP4 or MOV) without re-encoding the picture, so long phone videos merge in seconds instead of timing out; sound is re-encoded and aligned at every join. Clips that were trimmed without re-encoding, or that differ, still go through the full re-encode. iPhone clips stay HEVC, which some browsers can't play; the page says so and points to Video Converter for an H.264 copy. (#292)

### Other

- Dependency updates: the CodeQL actions, the Python base image digest, and six frontend packages including Vite 8.3.1 and Vitest 5.0.2. (#297, #298, #299)

## [2.7.8] — 2026-10-01 — Security updates

### Other

- Security updates for advisories published this week: pyjwt 2.15.0 (CVE-2026-101918) and urllib3 2.8.0 (CVE-2026-97687, CVE-2026-97688, CVE-2026-97689) on the server, and brace-expansion 1.1.21 and 2.1.7 (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p) in the frontend build. Nothing else changed. (#301)

## [2.7.7] — 2026-09-28 — Hidden Text Checker

### New tool

- Hidden Text Checker finds text a PDF hides from readers but machines still read: invisible text, text with zero opacity or the same colour as what lies behind it, text too small to read, text outside the visible page, text in switched-off layers, text under filled shapes or pictures (a failed redaction), hidden comments and form fields, blank glyphs, and Unicode tag characters. It is for screening résumés, papers and contracts for hidden AI prompts, and for checking a redacted document before you share it. Each finding is marked on the page and listed with its text and reason, and the report can be downloaded. The PDF is checked on the server in an isolated, time- and memory-limited process and deleted when the check ends; a file it can't fully check says so and names the pages. The page lists what it can't detect. (#294)

## [2.7.6] — 2026-09-28 — PDF tools that stop failing on locked, turned, cropped, oversized and damaged files

### Tools

- A password-protected PDF gets a clear "this PDF needs its password" message instead of "Processing failed", in PDF to Image, Invert Colors, Deskew, PDF to EPUB, PDF to PowerPoint, Transparent Background, PDF to Long Image and the other tools this release touches. A PDF with no pages, or one too damaged to read, is refused with a message saying so, instead of an empty result. (#291)
- Split in Half cuts each page as it is shown, including turned and cropped pages and pages whose box doesn't start at the corner, which used to fail; a horizontal cut now puts the top half first. (#291)
- Auto Crop works on scans stored turned and on pages with an offset box, and crops already-cropped pages correctly. (#291)
- Pages larger than the render limit are drawn at the largest size that fits instead of failing, and each request has a processing budget, so a small file can't demand hours of work; a request past it is refused with a message. (#291)
- A PDF cut short by an interrupted download is rebuilt and processed with the pages that survive. (#291)
- PDF to EPUB writes books e-readers open, pictures included, each with its own identifier. The PDF/A Validator no longer calls a document title required, and reports unreadable XMP metadata instead of failing. A one-page PDF to Image download is named as an image, not a ZIP. N-up refuses a PDF with no pages instead of failing. (#291)

## [2.7.5] — 2026-09-25 — Bates numbers that are really removed, and a count you can trust

### Tools

- Remove Bates Numbers finds stamps in the margins of pages stored turned (`/Rotate`) or cropped, where it used to miss them while reporting them removed. On a scan whose text layer lies under the picture, it whitens the number in the picture as well as removing the text. The count it shows is the number of stamps that actually left the file; a stamp it can't remove (one drawn as a stamp annotation or a form field) or Bates-shaped text it leaves in place is reported, and a batch names the files that still have one. A stamp drawn twice counts once. Links and comments that only cross a stamp are kept. (#288)
- A run in which every file fails says that no file was made instead of reporting 0 stamps removed. A file whose margins would take far too long to check is refused with a message asking for the stamps' prefix. (#288)
- The guide says exactly where each mode looks and what changes, including that text printed under a stamp loses the characters it covers and that nearby words can shift slightly where a stamp was removed. (#288)

### For API users

- `/bates-remove` counts a stamp drawn twice in one place once, returns `X-Bates-Remaining` and `X-Bates-Elsewhere` beside `X-Bates-Removed`, and answers 422 when the work would be far out of proportion to the file. All three headers are exposed cross-origin. (#288)

### Known issues

- Bates Numbering places its stamp for the page as stored, not as shown, on landscape pages turned a quarter, so the stamp lands inside the page. Without a prefix, Remove Bates Numbers reports these stamps rather than removing them.

## [2.7.4] — 2026-09-25 — Deleted pages that are really gone

### Tools

- Delete Pages removes the pages you list from the file, not only from its list of pages. Before, a deleted page stayed inside the output, with its text and images, whenever something in the file still pointed at it: a bookmark, a link, a named destination, a form field, a comment, an accessibility tag, an article thread or the document's opening action. Bookmarks, links, form fields and tags that point at pages you keep still work; bookmarks and links that led only to deleted pages are removed. (#280)
- Extract Pages, Organize Pages, every Split mode and Merge with page ranges no longer carry the form fields, comments, thread beads or accessibility text of the pages they leave out, and links on the pages they copy that use named destinations now work. Remove Blank Pages no longer pulls a removed page back in through a shared form field. (#280)
- Remove Blank Pages keeps bookmarks, links, form fields and tags, and no longer copies shared fonts and images into every page: a 3 MB file it used to return as 540 MB now comes back at 3.2 MB. (#280)
- The Delete Pages guide says exactly what is removed and what stays: data kept for the document as a whole, such as its metadata, attachments, layers and scripts, is left as it is. (#280)

### For API users

- `/delete-pages`, `/extract-pages`, `/organize-pages`, `/split`, `/split-by-bookmarks`, `/split-by-size`, `/split-by-text`, `/merge` with page ranges and `/remove-blank-pages` can answer 422 when they can't produce an output that is safe to return: a file whose structure would take more work to clean than its size allows, or an output that would still contain a removed page. Deleting every page, and Split by Text with a term the file doesn't contain, answer 400 instead of 500. (#280)

## [2.7.3] — 2026-09-25 — Boxes that land where you draw them on turned pages, answers the page can read

### Tools

- Redact PDF, White-Out and the other tools you draw on (Annotate, Shapes, Sign, eSign, Edit PDF, Crop and Form Creator) put what you draw where you drew it on pages stored turned (`/Rotate`) or whose visible area doesn't start at the page's corner, as in many scans and in pages turned by our Rotate tool. Before, a box drawn on such a page could land off the page or on other content, so Redact and White-Out could leave visible the text you meant to hide; on a page turned 270°, Redact removed a different line. `/Rotate` values that viewers read differently (−90, 450, 80, 90.0) are read the way the preview shows them. This closes the known issue listed under 2.7.2. (#285)
- White-Out, Annotate, Shapes and Edit PDF refuse a page number past the end of the PDF instead of returning the file unchanged. On turned pages, Annotate's highlights, underlines and strikethroughs follow the text under the box. (#285)
- On privatools.me, where the API has its own address, the page can now read the answers it was missing: the download's file name, Redact's withholding log, match and stamp counts, and the details of unexpected server errors, which used to show as "Couldn't reach the server". Pages that process a queue of files name their downloads the same way as the other pages. (#282)
- Pages that send several files in one request, such as Merge, refuse a selection over the total they state before uploading anything. A failed upload over 10 MB is no longer sent again automatically. (#282)

### For API users

- `/crop` takes `margins_from=shown` to measure its margins on the page as shown; without it, nothing changes. `/whiteout-pdf`, `/annotate-pdf`, `/add-shapes` and `/edit-pdf` answer 400 for a page number that isn't a whole number within the PDF. (#285)
- Every answer to an allowed origin carries the same CORS headers, errors included. `/api` exposes the headers the site reads (`Content-Disposition`, `X-Request-ID`, `X-Compressed-Size`, `X-Target-Met`, `X-Redaction-Report`, `X-Redact-Hits`, `X-Highlight-Hits`, `X-Bates-Manifest`, `X-Bates-Removed`) and no longer exposes `X-Original-Size` or `X-Stripped-Items`; `/api/v1` exposes these as well as its own. (#282)

### Deploy

- nginx's own 413, 502, 503 and 504 answers on the API host can carry CORS headers for the site's origins, so the page can show a too-large upload or a timeout for what it is. This is applied by hand on the server with the runbook in `deploy/api-subdomain-split.md`; until then, those answers reach the page as network errors. (#282)

### Known issues

- Remove Bates Numbers leaves the numbers on pages turned 90° while reporting them removed; a fix is next.
- Stamp, Page Numbers and Header/Footer place their marks as if the page were not turned, and Form Creator's field text follows the page as stored.

## [2.7.2] — 2026-09-24 — Redact the page you chose, uploads sent once

### Tools

- Redact PDF blacks out the page you chose. From v1.6.0 until this release, the page counted pages from 1 and the route from 0, so a box on page 1 of a PDF with several pages blacked out the same area of page 2 and left page 1 as it was, a box on the last page was refused, and every one-page PDF was refused. The route still counts from 0 and the page now converts. A contract test holds each of the 16 tools that send page numbers to what its route expects. The guide now says what redaction removes and what it leaves: a line or shape that reaches past a box, form fields and most comments over a box, and replacement text for screen readers. (#283)
- Pages that take one file upload it once. Every single-file page used to send the file twice in one request, so a file over about 250 MB was refused by the 500 MB request cap and every upload took twice as long. The guides, comparison pages, About page and README now state the real limits. (#279)
- Pages no longer give up after 60 seconds while a file is still uploading. A request that carries a file waits while the upload moves, then for the server's own five-minute limit; one that makes no progress for six minutes ends as a timeout. Over HTTP/2, Chrome can still restart a slow upload by itself. (#281)

### For API users

- `/redact` counts `page` from 0, as before. Its OpenAPI description now says so, and says that coordinates start at the top-left corner of the page's visible area (its CropBox), before any `/Rotate`. (#283)
- The website now sends each upload under the field its route reads: `files` for the routes that take several files, `file` for the rest. Routes are unchanged. (#279)

### Known issue

- On pages stored rotated (`/Rotate`), common in scans, a box drawn in Redact, White-Out and the other tools that draw on a page preview lands off the page, so nothing on the page is covered. A fix is in progress; until it ships, check redacted scans before sharing them.

## [2.7.1] — 2026-09-24 — Sanitize and Verify Signature that work, faster Image to PDF, truthful analytics

### Tools

- Sanitize PDF removes document JavaScript, every automatic action (`/AA`), embedded files, sound, video and 3D content, XFA, XMP and the document information fields. Wherever an action can fire, only in-document navigation, form reset and http, https or mailto links survive. Form fields keep their values and stay fillable; content in hidden layers is deleted and visible layers become page content; an owner password that only restricts printing or copying is kept. It runs in a separate, memory-capped process: layered content over 6 MiB decoded is refused with a 413, layered content that can't be decoded with a 400, and a password-protected upload gets a 400 instead of a 500. (#269)
- Verify Signature finds every signature field, including empty ones, and checks each signature offline: whether the signed bytes are unchanged, whether the signature matches its certificate, whether it covers the whole file and what was saved afterwards. SHA-1, MD5 and MD2 signatures are reported as `weak`, never `valid`. It never checks trust or revocation. (#269)
- Image to PDF takes up to 100 images in one PDF instead of 50, still within 200 MB in total, and is far faster: 100 phone photos take about 5 s of CPU instead of about two minutes, and memory follows one page instead of the whole document. New limits keep the worst case bounded: 750 megapixels of images that have to be decoded per PDF (HEIC counts half), and per image 50 MP for WebP, 100 MP for HEIC, 120 MP for colour TIFF and 178 MP overall. Refusals name the uploaded file and say why. (#270, #274)
- Image to PDF turns sideways phone photos upright from their EXIF orientation, and removes EXIF (including GPS location), XMP, IPTC, comments and thumbnails from JPEGs before embedding them, without re-encoding. 16-bit grayscale images no longer come out almost white, lossless and arithmetic-coded JPEGs no longer render black, and files that aren't one of the accepted formats, whatever they are named, get a 400. (#274, #276)
- PNG to PDF and TIFF to PDF say that transparency isn't kept and that only a TIFF's first page is used. (#275)
- The .env Validator's report never contains values or fragments of them, including lines of a pasted private key. (#273)

### Pages

- The 14 comparison pages are rewritten with facts checked against each vendor's own pages on 2026-09-24, each with a sourced side-by-side table, including remove.bg's announced closure on 1 December 2026. (#272)
- The 21 thinnest tool guides are deepened with claims checked against the code, and registry copy is corrected on six tools. (#273)
- Privacy, Terms and Security fit phone screens instead of running off the right edge, and Trust, Status, API and Compare no longer scroll sideways at tablet widths. (#277)

### Analytics

- The first page view of a page load records the referring site's origin and the five `utm_` tags, with values filtered to keep out phone numbers, identifiers and tokens; every other part of the address is still dropped. Browsers that identify themselves as automated send nothing. Failed and partial tool runs carry an `error_kind` category (too_large, rate_limited, bad_input, timeout, server, network, browser, provider) and never the error text. The Privacy page, llms.txt and the runbook describe all of this. (#271)

### For API users

- `/verify-signature` keeps `has_signatures` and `signatures`; each signature's `status` is now `valid`, `weak`, `modified`, `invalid`, `unsigned` or `unchecked` instead of `detected`, with `digest_algorithm` and a reason. (#269)
- `/sanitize-pdf` can return 413 for layered content over 6 MiB decoded and 400 for undecodable layered content. `/image-to-pdf` takes 1–100 files and returns 413 only for pixel limits and 400 for unreadable or unsupported files. (#269, #270, #274)

### Other

- ReportLab no longer ASCII85-encodes streams, so PDFs from the ReportLab-based tools are typically 10–20% smaller and faster to make, with identical text and rendering. (#274)
- New dependencies: pyhanko 0.37.0 and pyhanko-certvalidator 0.32.1, with their locked transitive packages. (#269)

## [2.7.0] — 2026-09-24 — Tools that match their pages, current dependencies, deploy tooling

### Tool fixes

- Rotate Image and Flip Image apply a photo's EXIF orientation before turning or flipping it, so a phone photo stored sideways no longer comes out on its side. They keep the DPI and an RGB colour profile; other EXIF, XMP and the JPEG comment are still left out. (#210)
- View EXIF lists exposure time, aperture, ISO, lens and capture time, shows exposure as photographers write it (`1/160`), decodes text fields, and returns the other metadata instead of a 500 when the EXIF block is damaged. (#210)
- Flatten bakes annotations, form fields or both into the page, chosen by `scope` (`all` by default, `annotations` or `forms`). It used to return 500 for any PDF with annotations and only made form fields read-only. (#219)
- Form Creator turns a radio entry into a real radio group instead of returning 500. Field names must now be unique across field types, and each radio option counts toward the 300-field limit. (#219)
- Fill Form shows the chosen radio option, ticks checkboxes whose widget is separate from the field and detects radio options; a radio value that is not one of the options returns 400. It also sets `/NeedAppearances`, which never worked on pikepdf 8. (#219, #182)
- Video Speed accepts its whole range, 0.25× to 4×, and changes the speed of videos without an audio track. (#223)
- Merge Videos merges clips of different sizes: each clip is scaled to fit the first clip's frame as players show it, centred between black bars. Merging two or more clips without audio no longer returns 500. (#223)
- WebM output encodes in about the CPU time of MP4 instead of seven to eleven times as long, so roughly three minutes of 720p fits the three-minute processing limit instead of 15–20 seconds. At the unchanged 1 Mbit/s target the quality is slightly lower, and WebM trims come out larger. (#223)

### Tool copy

- Tool copy was checked sentence by sentence against the code and corrected where it described features, defaults, limits or behaviour the code does not have: every non-PDF tool outside the most popular 50 (#186), every PDF tool outside them (#204), and the top-50 PDF tools that #204 had not re-checked (#222). Copy narrowed around the bugs above came back with their fixes. (#210, #219, #223)
- Tool-page structured data says where each tool's files go (the browser, or temporary server storage removed after the response) instead of promising immediate deletion, and `llms.txt` and `llms-full.txt` describe the default-on Google Analytics. (#206)
- The server-rendered Privacy page, read by crawlers and without JavaScript, now describes the default-on Google Analytics instead of the old opt-in policy, and its date matches the September 17 change. The tools list, Privacy and Terms no longer promise immediate deletion, and Terms no longer claims there are no usage limits. The Summarize PDF model is labelled at its measured size, about 275 MB. (#243)

### Errors and headers

- Every 5xx from the website's routes now carries the same short, status-keyed message as `/api/v1` instead of the text the service raised; the original detail is logged under the response's request id. (#211)
- 413 and 504 responses carry the same security headers as every other response. (#211)

### For API users

- `/api/v1` error bodies are unchanged. The fixed tools above are all in the v1 catalogue, so `flatten`, `form-creator`, `fill-form`, `video-speed`, `video-merge`, `rotate-image`, `flip-image` and `view-exif` change behaviour as described, including new 400s from Form Creator and Fill Form validation. (#210, #219, #223)
- PDFs that ReportLab writes whole, from TXT, JSON, XML, RTF, EPUB, Word, Excel, PowerPoint, images, video frames or a QR code, now carry `Creator: anonymous` and `Producer: ReportLab PDF Library - (opensource)`; pages render identically. (#221)

### Dependencies

- Python: pikepdf 8.12.0 → 10.13.0.post1, pypdf 6.19.0, pillow-heif 1.7.0 and cairosvg 2.9.1 (security releases), pyjwt 2.14.0 (security release; Clerk key fetching refuses redirects), onnxruntime 1.30.0, reportlab 5.0.1, rembg 2.0.85, uvicorn 0.53.0, anyio 4.15.1, slowapi 0.1.10, cryptography 50.0.1, numpy 2.5.3; pytest 9.1.1 for development. (#182, #208, #218, #221, #220, #265)
- The Python dependencies are now `requirements*.in` sources compiled by `uv pip compile` into the hashed `requirements*.txt` locks, which Dependabot's `uv` ecosystem can regenerate; Python minor and patch updates arrive as one grouped PR. (#208)
- Base images: `python:3.12-slim` and the `node:26-slim` build stage move to current digests, and Dependabot proposes digest refreshes of the current Python tag again. (#203, #185, #263)
- The on-device AI tools run transformers.js 4.3.0. Its runtime files stay in the browser's HTTP cache, so the AI hub lists and deletes only model files. (#209)
- Frontend: onnxruntime-web 1.30.0 for background removal, sonner 2.0.8, next-themes 0.4.6, react-router-dom 7.18.4, Radix dialog and tooltip, and dev tooling (typescript-eslint 8.70.0, eslint-plugin-react-refresh 0.5.7, @vitejs/plugin-react-swc 4.3.3). (#192, #194, #134, #217, #230, #190, #226, #216, #212)
- Frontend, continued: lucide-react 1.47.0, whose icons are hidden from screen readers by default and slightly redrawn in places, with the removed GitHub mark kept as a local icon; zod 4.6.5, which adds about 11 KB (gzip) to the code every page loads; Clerk, Radix and tailwind-merge minor and patch releases, the Vite build tools and tailwindcss 3.4.19; TypeScript 5.9.3, @types/node 26 to match the Node 26 the image and CI run, and globals 17. (#246, #258, #255, #240, #241, #267, #245, #257)
- Tests run on vitest 5, jsdom 30.0.1 and jest-dom 7 with the same 949 tests. (#256)
- Dependabot groups npm minor and patch updates into one PR per weekly run; majors stay separate. (#244)
- Unused frontend packages and three dead `components/ui` wrappers are removed, among them recharts, react-hook-form, cmdk, vaul and date-fns; `esbuild` becomes a direct dev dependency. The production bundle is unchanged apart from 242 bytes of CSS. Earlier bumps of removed packages went with them. (#205, #235; #137, #140, #142, #146, #215)
- Held in `.github/dependabot.yml`, each with its reason: React 19, eslint-plugin-react-hooks 7, ESLint 10, Tailwind CSS 4 with tailwind-merge 3, TypeScript 6 and 7, pdf.js 6 and pdf.js 5.x minors (every release from 5.6.83 until 6.2.108 has a high-severity advisory, so the site stays on 5.5.207), and jsdom 30.1, which breaks vitest 5.0.1's test environment. (#225, #231, #236, #247, #260, #255, #267)

### CI

- CodeQL runs `init`, `analyze` and `upload-sarif` on v4.38.1, grouped so they update together. (#183, #266)
- cosign-installer v4.1.2 keeps signing with cosign v2.6.5, the signature format the server's verification reads. (#184)
- The Python audit reads the hashed runtime lock itself (`pip-audit -r requirements.txt --disable-pip`). (#208)
- The frontend audit and build job runs on Node 26 instead of Node 20, which is past end of life. (#254)
- Workflow actions updated: dependency-review-action 5.0.0, upload-artifact 7.0.1, github-script 9.0.0 and the docker login, metadata, buildx and build-push actions. (#143, #145, #199, #224, #198, #200, #201, #202)

### Deploy

- Zero-downtime deploy tooling: the next release starts beside the live one on a spare port, host nginx switches to it only after it passes readiness and real-page checks, and the old container drains and hands over the job queue before it stops. It takes effect only when the production rollout runbook in `deploy/README.md` installs it on the server; until then the existing deploy, which replaces the container and then waits for readiness, keeps running. (#207)

### Docs

- The documentation catches up with v2.6.1: changelog entries for every release since 1.6.0, the README checked against the code, the required checks in CONTRIBUTING, a complete docs index and status notes on the 2026-09-17 plans. (#197)
- A second pass records this release's changes, the dependency layout and held majors in CLAUDE.md, and corrects storage, quota and upload-limit wording in the README, CONTRIBUTING, SECURITY and the API guide. (#242)

## [2.6.1] — 2026-09-18 — Accurate tool copy, lighter pages, stricter CI

### Content

- Tool guides for 92 tools stop claiming more than the product does: storage wording matches the privacy policy (temporary per-request storage, response cleanup plus a background sweep), and unverifiable competitor pricing, invented timings and roadmap promises are removed. (#176)
- The guides of the 50 most popular tools (by registry `popularity` rank) are rewritten from their real UI and backend routes. (#176)
- False fragments in registry descriptions, search titles and meta descriptions are corrected on 21 tools: for example, Sign PDF places an image rather than a certificate signature, Video to GIF has no clip-range control, and PNG to JPG usually turns transparent areas black, not white. Two backend tests guard against retention and browser-only overclaims. (#176)

### Performance

- Blog data loads only on blog routes, about 41 KB gzip less on every other page. Tool pages read their guide links from the generated `frontend/src/data/tool-blog-links.json`, and the bundle check fails if blog data reaches the entry chunk, a preloaded chunk or anything they import statically. (#173)

### Backend

- The server-rendered homepage and `/tools` lists follow the registry's popularity order, as the client does, and JSON-LD subcategories come from each tool's registry category. (#174)
- The fallback tool names and descriptions come from the generated tool manifest (the committed `frontend/public/tool-content.json`, or the build's copy in the image) instead of a hand-kept copy that had drifted on most tools. A checkout without a build reads the committed manifest, and the app refuses to start when no manifest is readable. (#179, #181)
- The HEIF opener is registered once at startup. Hardening only: HEIC decoding was not broken in production. (#177)

### CI

- A pull request fails when a tool's copy changes without moving its `lastReviewed`, or when more than 25 dates move without `[bulk-review]`. (#175)
- The frontend job fails when committed `npm run gen:llms` output is stale. (#178)
- The image job boots the built image through `docker-compose.yml` and checks `/readyz` (including the build SHA), a 404 for an unknown tool, that the app user can read the tool manifest, the homepage tool count, two tool pages and the sitemap. Releases gate on it. (#180)

## [2.6.0] — 2026-09-18 — Visible tool guides, search titles, sitemap signals

### SEO and content

- Every tool page shows a guide under the tool: "How to use" steps, every FAQ answer written out, and "Mentioned in our guides" links when a guide mentions the tool. Steps and FAQ stay authored in `backend/app/tool_content.py` and export to `frontend/src/data/tool-guide/<slug>.json` through `scripts/seo/export-tool-guides.py`, replacing `tool-faq.json`. (#170)
- The server-rendered tool body carries only what visitors see (summary, intro, steps, full FAQ, guide links, three related tools, last-reviewed line), chosen as the client chooses them; the TL;DR, trust paragraph, templated depth sections, eight-item related list and CTA copy are removed, and guide text is HTML-escaped. (#170)
- Every tool has a hand-written `seoTitle` (40–60 characters, no brand suffix) and `metaDescription` (120–160 characters). Server and client take the tab title, H1, social titles and description from them; `tool-registry.test.ts` enforces the rules. (#171)
- Every sitemap URL has a `<priority>`: home 1.0, `/tools` 0.9, tools listed in `sitemap-priority.json` 0.8, other tools 0.6, blog and compare 0.5, other pages 0.4. (#172)
- Each tool's `lastReviewed` date drives its sitemap `lastmod`, the visible "Last reviewed" line and JSON-LD `dateModified`; unused constants are removed from `routes/sitemap.py`. (#172)

### Frontend

- Long tool headings fit on phones. (#171)

## [2.5.0] — 2026-09-17 — Default-on analytics and tool usage events; docs and scripts reorganized

### Analytics

- Google Analytics collects for every visitor by default; the switch on the Privacy page is the only opt-out. The consent record, regional policy and Do Not Track / Global Privacy Control checks are removed. `GET /api/analytics/policy` answers `default_on` whenever `GA_BROWSER_TAG_ENABLED=true`, so browsers holding the earlier opt-in bundle switch on; `GA_TRUSTED_COUNTRY_HEADER` and `GA_DEFAULT_ON_COUNTRIES` are removed. (#169)
- Every React Router navigation sends a page view. (#169)
- A new `tool_run` event per tool use carries `tool_slug`, `tool_category`, `run_mode`, `outcome` and `file_count`, never file names, sizes or contents. A test fails when a tool UI calls the backend without reporting. (#169)

### Docs

- Documentation and scripts moved into topic folders with `docs/README.md` and `scripts/README.md` indexes (for example, `scripts/local-backend.py` is now `scripts/dev/local-backend.py`); README, CLAUDE.md, PRODUCT.md and the frontend README describe Air and Play. (#167)

## [2.4.1] — 2026-09-14 — Account settings and security controls

- Account settings open from the header and footer, with persistent navigation between Settings & security and API keys & usage, and improved layouts across Air/Play, light/dark and mobile. (release, #166)
- Passwordless accounts can set a password inline; password, username and passkey changes go through Clerk's identity re-verification when Clerk requires it. (release, #166)
- Clearer active and revoked API key states; request activity sits above starter tips on mobile. (release)
- Account deletion verifies the identity before backend cleanup and warns when cleanup cannot be confirmed. (release, #166)

## [2.4.0] — 2026-09-14 — API playground, integration starters and account activity

- Run a sample PDF merge, compression or text extraction from the API page and inspect the status, request ID, result and allowance change. (release, #165)
- Downloadable Python and JavaScript clients, n8n workflows and a Postman collection. Clients support background jobs, bounded retries, recovery after connection loss and deletion after a successful local save. (release, #165)
- API key settings show the current allowance, seven days of request totals and recent request metadata, excluding document contents, filenames, credentials and query strings. (release, #165)
- Processing limits and one-hour result retention are unchanged. (release)

## [2.3.1] — 2026-09-14 — Debian OS advisories patched; image scan enforced

- Debian runtime packages are upgraded to clear nine high-severity advisories; the Docker build fails below the reviewed security floor. (#164)
- A release is signed and published only after a clean ARM64 image scan with no fixable HIGH/CRITICAL findings. (#164)
- The image scan targets the published ARM64 image. (#163)

## [2.3.0] — 2026-09-14 — Free API discovery, shared limits and durable PDF jobs

- A searchable reference for 147 API operations, a v1-only OpenAPI schema, current costs and limits, and request templates. (#162)
- Request admission and quota reservations are shared across web workers in SQLite, quotas count actual request-body bytes, validation refunds still apply, and retry and error information is consistent. (#162)
- Optional key-scoped background jobs for merge, compress, grayscale and PDF text extraction: idempotent retries share one charge, results can be downloaded repeatedly for one hour or deleted, and one job supervisor runs beside the two web workers within the existing 4 GB / 1.8 CPU limits. Jobs are disabled by default. (#162)

## [2.2.1] — 2026-09-14 — Clean URL navigation

- App navigation uses clean paths; legacy `#/…` bookmarks convert in place without extra history entries. (#161)
- Opening the Dev API page directly at `/api` works (nginx configuration). (#160)

## [2.2.0] — 2026-09-14 — Air and Play, Clerk, browser AI and analytics

### Product

- The Air and Play experiences cover the tool workspace, account pages, guides and comparisons, with persistent light/dark controls and improved mobile navigation. (#159)
- Clerk accounts with username, passkey and Google sign-in; file tools stay available to guests. (#159)
- Verified browser background removal and offline assets, specialist tool interfaces, explicit model progress, PWA improvements, updated branding and crawlable content manifests. (#159)
- Consent-aware Google browser analytics, opt-in by default; a deployment could enable default-on for a reviewed list of countries. Default-on for everyone from 2.5.0. (#159)
- The release pipeline verifies signed immutable images and keeps a rollback path. (#159)

### Security

- WeasyPrint 69.0 → 70.0 (a security release); HTML and URL rendering keep SSRF validation through a fetcher that never hands HTTP, redirect or file URLs to WeasyPrint's default. (027e92b)
- Vulnerable frontend build and test dependencies updated (vitest 4, sharp 0.35.4). (a48a453)
- Static files are served only from an inventory of files found in the build, so a request path never becomes a filesystem path; clean installs are reproducible. (c7f4997)
- Blog articles render through React from an allowlist of tags instead of raw HTML, and file previews accept only same-origin `blob:` URLs. (cdbe060)

## [2.1.8] — 2026-09-06 — Bounce rate measures sessions

- The beacon sends GA4's `session_engaged` flag (after ten seconds or a second page view), so bounce rate is no longer pinned at 100%. (#158)

## [2.1.7] — 2026-09-06 — First release under ethereaglehq

- The account rename is followed through 83 references in 26 files; this is the first release built, signed and deployed under the new GHCR namespace and cosign identity. (tag, #157)

## [2.1.6] — 2026-09-06 — Rename-safe deploy, correct X handle, automatic releases

- Deploy accepts the old and new GitHub owner for the image namespace and the cosign identity; verification stays fail-closed. (#156)
- Organization structured data and `rel=me` links point at the live X handle. (#155)
- Every tag publishes a GitHub Release once its image is built, scanned and signed. (#154)

## [2.1.5] — 2026-09-06 — Analytics measures real time on page

- Foreground time is accumulated and sent as GA4 `user_engagement` on `visibilitychange`/`pagehide`; the server's engagement floor drops from 100 ms to 1 ms; event names are an allowlist; navigation page views no longer carry the previous page's title. (#153, release)
- A synthetic production probe runs every 30 minutes (homepage, `/readyz` dependencies, a real merge round trip, per-path CSP) and opens or comments on one tracking issue on failure. (release, 2463788, 484b8dd)

## [2.1.4] — 2026-09-02 — GA4 events carry a session

- Beacon events carry a GA4 session id and real time-on-view; the backend replaces an invalid id with a fresh one instead of dropping the event. (001e8ba)

## [2.1.3] — 2026-09-02 — X profile linked

- The X account is linked from the footer, About and Organization `sameAs`; the footer gains a Source link. (a385d72)
- Dependabot alerts cleared: browserslist 4.28.8 and postcss-selector-parser 6.1.4, both build-time only. Unused shell components removed. (3442d8a, 61e7d10)

## [2.1.2] — 2026-09-02 — Releases gated on tests

- `release.yml` calls `test.yml`: no green suite, no image. (73fa653)
- Social sign-in stays GitHub only; Google and Apple are also disabled in the Clerk dashboard. (tag, 73fa653)

## [2.1.1] — 2026-09-02 — Conversion How-Tos meet the three-step guard

- The 26 conversion How-Tos added in 2.1.0 get the third step the catalog test requires. (ef09c08)

## [2.1.0] — 2026-09-02 — How-To and FAQ for every tool

- Tools that had no How-To steps (32) or no FAQ (6) get hand-written copy; the FAQ export is regenerated from Python. (47aab55)

## [2.0.14] — 2026-09-02 — Legacy 404 URLs redirect

- Six URLs Google still held as 404s now return 301: four `/tool/` vs `/tools/` mix-ups, `/tool/e-sign-pdf` → `/tool/esign-pdf` and `/batchprocess` → `/batch`. (27300e8)

## [2.0.13] — 2026-09-02 — OG cards noindexed; page views sent

- `/api/og-image` responses carry `X-Robots-Tag: noindex`. (e1e6af1)
- The browser sends one page view per view (none were sent before), honouring Do Not Track, GPC and the local opt-out; compose passes `GA4_MEASUREMENT_ID` and `GA4_API_SECRET` to the container. (e1e6af1)

## [2.0.12] — 2026-09-01 — Spent OAuth verification fix

- A spent OAuth verification, such as one left in a bookmarked return URL, no longer sends the visitor to Clerk's hosted Account Portal. (bd90586)

## [2.0.11] — 2026-09-01 — Finished OAuth stays on site

- A completed GitHub sign-up no longer bounces to Clerk's hosted portal: the callback runs only while the flow is unfinished, and an "already signed in" reply is ignored. (3f269cc)

## [2.0.10] — 2026-09-01 — Exact OAuth return detection

- The OAuth return is recognised by a marker the sign-in adds rather than inferred from Clerk's state, and the callback waits until Clerk has fully loaded. (c314368)

## [2.0.9] — 2026-09-01 — OAuth sign-in completes

- Returning from GitHub completes sign-in, and a signed-in visitor is no longer shown the login form when account state was read before Clerk was ready. (1735d9b)

## [2.0.8] — 2026-09-01 — Sign-in from every page; arm64-only release images

- Account links go to the `/account` path, whose CSP allows Clerk, so sign-in works from every page; stale `#/account` links are rewritten. (47482da)
- Release images build natively on arm64 with a layer cache; the amd64 image is no longer published. (1a4a650)

## [2.0.7] — 2026-09-01 — Blocked clerk-js explained

- When a browser extension blocks clerk-js, the account page says so, disables the sign-in controls and notes that every tool works without an account. (4af1b6a)

## [2.0.6] — 2026-09-01 — New logo; models fetched on arrival

- New logo mark and icons, including a real maskable icon; a tool that needs an on-device model fetches it on arrival unless the browser asks to save data; a global button reset no longer strips styled controls. (4d0ca21)

## [2.0.5] — 2026-09-01 — GitHub button, guarded Clerk calls, AI hub on phones

- GitHub brand button; account actions taken before Clerk loads fail with a clear message; the AI hub fits phones; model download progress no longer shows 99% before the weights start. (df0499f)

## [2.0.4] — 2026-09-01 — Account page is just the sign-in card

- `/account` shows only the sign-in card; social buttons appear only for providers configured in Clerk (GitHub); model download progress no longer runs backwards. (d680d5f)

## [2.0.3] — 2026-09-01 — Light by default; Clerk password recovery

- Light is the default theme for first-time visitors; password recovery under Clerk works through a two-step email code instead of throwing; OTP code inputs; restyled home and auth card. (8168cd5)

## [2.0.2] — 2026-09-01 — On-device models unblocked

- On-device model weights load in production (`connect-src` now names the Hugging Face CDN the weights redirect to); the auth card gains social sign-in buttons and a password strength meter. (f189b15)

## [2.0.1] — 2026-09-01 — Clerk live

- Clerk accounts go live; the sign-in page shows the free-tier limits, a copyable curl example and links to the API reference, security page and catalogue. (tag, f02fa3e)

## [2.0.0] — 2026-09-01 — Daylight is the product

### Breaking

- Daylight replaces the UI. The Signature, Aurora, Carbon and Structured skins, the design-import toolchain and the skin dock are removed. (#150)

### Added

- Chat with PDF: the PDF's text is extracted in the browser and questions go to the visitor's own AI provider. (#150)
- Transcribe Audio: Whisper runs in the browser, or the visitor's own OpenAI, Groq or self-hosted key is used; transcripts download as text or SRT. (#150)
- Remove Background gains an on-device engine (BRIA RMBG-1.4). OCR PDF and Image OCR gain an in-browser Tesseract engine and a bring-your-own-key vision engine, and Translate PDF gains a bring-your-own-key engine. (#150)
- An AI hub in the top bar manages bring-your-own-key settings and on-device models. (#150)
- Multi-file queues: tools on the shared runners take up to 25 files, and 36 more tools process several files at once, with per-file status, retry and a ZIP download. (#150)
- The PDF editor gains pen and arrow tools and an edits panel. (#150)
- A true-black midnight theme, vault import with sample entries, a PWA install prompt, and a blog grown to 31 posts. (#150)

### Changed

- Daylight renders the real tool components, accounts, vault and path routing; counts come from the registry. (#150)

### Fixed

- Multi-file runs through `useMultiFileProcessor` processed zero files. (#150)
- PDFs with up to 1024 bytes before the `%PDF-` header, which ISO 32000 allows, are no longer rejected as invalid. (#150)

## [1.11.1] — 2026-08-27 — Tool URLs in Aurora and Carbon

- Fixed: every tool URL rendered the homepage in Aurora and Carbon. (#149)
- Clerk production configuration is plumbed through the build and compose, so activation needs only keys; see `deploy/clerk-production.md`. (#133)

## [1.11.0] — 2026-08-23 — Sign in with Google, GitHub or Apple

- OAuth sign-in through Clerk, shown only where Clerk is configured; the sign-in page is rebuilt as one centred column. (#132)
- The count guard matches the shape of a count rather than one phrasing. (#132)
- In Carbon and Structured, the theme control repaints immediately instead of after a reload. (#131)
- Production still ran with Clerk unconfigured. (tag)

## [1.10.0] — 2026-08-23 — Clerk (opt-in), UI corrections, BYOK in Smart Redact

- Accounts can use Clerk behind a key check: without a publishable key nothing changes and the SDK is not downloaded. Sessions are verified with JWKS, and a signed `user.deleted` webhook removes API keys. (#126, #130)
- Smart Redact supports bring-your-own-key, with the document fenced and provider egress allowed on that page. (#129)
- In the ported designs: a reachable light/dark control on mobile, counts from the registry, the wrong `privatools.io` domain fixed in twelve places, and demo toggles and design-review routes removed. (#127)
- Fixed: `/account`, `/account/keys`, `/my-stuff/vault`, `/status` and `/support` returned HTTP 404. (#125)
- Dependencies: setup-qemu-action v4.2.0 and @radix-ui/react-slot 1.3.3; Clerk session verification adds pyjwt 2.13.0 and cryptography 50.0.0. (#124, #128, #126)

## [1.9.0] — 2026-08-23 — Frontend revamp, accounts, read-only container

- The default Signature design is rebuilt: new typefaces and palette, a two-tier header in place of the tool-tree sidebar, a footer tool index, and tool FAQs visible on tool pages. (#122)
- Three ported skins (Aurora, Carbon, Structured); Signature stays the default. (#122)
- Accounts with scrypt hashing on a thread pool, per-account lockout and recovery codes as the only way back in. (#122)
- Versioned `/api/v1` behind user-issued keys with a daily free quota; Bearer tokens accepted; requests rejected in validation are refunded. (#122)
- Bring-your-own-key AI foundation, used by Summarize PDF; the CSP allows provider egress on that page only, and document text is fenced with a random per-call id. (#117, #118, #122)
- New: PDF accessibility checker (PDF/UA and WCAG 2.2), on-device Translate PDF, continuous multi-file Bates numbering and Bates removal, redaction exemption codes with a withholding log, compression profiles and target size. (#120)
- Fixed: grayscale rasterised every PDF; merge and extract-pages destroyed accessibility structure; Flate images never compressed. (#120)
- The container runs on a read-only root filesystem; `/app/data` is created in the image so the first signup works; accounts backup added. (#122, #123)
- The installed deploy unit no longer overrides the deploy gate and rollback check with `/api/health`, so both use `/readyz`. (#122)
- react-router 6 → 7 and esbuild ≥ 0.28.1, clearing all Dependabot alerts. (#121)

## [1.8.1] — 2026-08-21 — Two tool pages returned 404

- `/tool/remove-watermark` and `/tools/remove-image-watermark` were missing from the backend tool tables and returned 404; a parity test now holds the registries together. (9df4033)

## [1.8.0] — 2026-08-21 — Untrusted-input parsers, Python 3.12

- Security: Pillow 12.3.0 (15 advisories), pypdf 6.16.1 (2), rembg 2.0.81 (2); pip-audit runs without ignore flags. (d234336, bf62928)
- Python 3.10 → 3.12; fastapi 0.141.1, uvicorn 0.52.3, pymupdf 1.28.2, mistune 3.3.4; high and critical npm advisories cleared; CodeQL at zero; the password generator's RNG no longer has modulo bias. (bf62928, 9918f4d, decfa00, 623a381)
- opencv-python-headless and numpy are declared directly, with a contract test for directly imported modules. (bf62928)
- PR CI builds the image; base images are pinned by digest and tracked by Dependabot; release write permissions are scoped to the job. (#116, 438fc39, 4acc082)
- Frontend build base node 26-slim; Dependabot bumps of CI actions and Radix packages. (#100, #102, #107, #109, #110, #113–#115)

## [1.7.0] — 2026-08-21 — Local-first personalization, watermark removal, pipeline round-trip

- Device-local encrypted password vault, named Bates counters, an asset library, remembered settings on 57 tools and `/my-stuff` to see and erase it all; no accounts. (6163307)
- Visible watermark removal for PDFs and images. (6163307)
- The pipeline runs the whole chain in one request, with 17 chainable steps instead of 2. (6163307)
- Fixed: search-engine verification files were corrupted by the runtime config injector, which broke Google Search Console verification. (3cf12e4)
- Dependabot bumps of CI actions (first release on docker/build-push-action v7 and setup-buildx-action v4) and Radix packages. (#16, #19, #55–#61)

## [1.6.13] — 2026-08-21 — Compress PDF and Bates Numbering no longer crash on upload

- A missing TooltipProvider crashed both tools as soon as a file was queued; broken since 1.6.0, which removed the root provider to trim the first-paint path. (1d14cb0)

## [1.6.12] — 2026-06-29 — Deploy rollback and request-timeout leaks

- Auto-deploy restores the previous image when the health gate fails and records the failed target. (#96)
- `run_bounded` gets its own bounded thread pool, and LibreOffice/qpdf subprocesses are killed on cancellation. (#98)
- A `process_pdf_upload` lifecycle helper, first used by grayscale. (#97)

## [1.6.11] — 2026-06-29 — Hashed lockfiles and deploy reliability

- Runtime dependencies install from fully hashed lockfiles with `--require-hashes` in the image and CI. (#94)
- The Docker healthcheck and the deploy script's default gate use `/readyz`; the recurring stuck image pull is fixed. (#95)
- Remaining PDF routes in `new_tools` stream uploads to disk. (#93)

## [1.6.10] — 2026-06-29 — Streaming uploads, readiness and observability

- Uploads stream to disk with first-chunk validation (office-to-pdf, video/audio/subtitle routes). (#88–#90)
- `/readyz` checks free disk and returns `build_sha`. (#87)
- Uvicorn logs join the JSON stream; in-flight gauge; janitor RSS heartbeat. (#86)
- The 14 floating native parsers are pinned to exact versions. (#91)
- nginx: per-IP connection limit on `/api/`, and a documented Cloudflare real-IP block. (#92)

## [1.6.9] — 2026-06-29 — Security response surface

- Production disables `/api-docs` and `/openapi.json`; 5xx `HTTPException` details are replaced with a generic message; CSV injection guard in table extraction. (#82)
- Native thread pools pinned to one thread; the URL-fetch connection cache is thread-local. (#83)
- office-to-pdf removes its intermediate copy on every path. (#84)
- Releases scan the built image before signing (report-only at this point). (#85)

## [1.6.8] — 2026-06-29 — Bounded heavy work

- `run_bounded` caps concurrent heavy work with one process-wide semaphore (`MAX_CONCURRENT_HEAVY`). (#81)
- Rate limits on the remaining media routes; batch compress off the event loop; a page cap on OCR. (#79)
- Auto-deploy verifies the cosign signature (fail-closed) and retries a failed pull. (#80)

## [1.6.7] — 2026-06-29 — Deep-research P0 fixes

- Fixed a cross-user leak: concurrent merges shared one output path. (#75)
- A crafted PDF can no longer exhaust memory through page rendering (about 100 MP cap on every render). (#77)
- Rate limits on the eight heaviest PDF and image routes. (#78)
- `TMPDIR=/app/temp` and Docker log rotation. (#76)
- Tests for API-key auth, error-status mapping and the SSRF DNS branch. (#74)

## [1.6.6] — 2026-06-29 — Security-property tests

- Tests prove redaction removes text, protect encrypts, unlock decrypts, metadata stripping clears fields and archive extraction rejects zip-slip. (#72)
- office-to-pdf file copies run off the event loop. (#73)

## [1.6.5] — 2026-06-29 — Backend correctness and SSRF hardening

- URL fetches with no Content-Type no longer bypass the allowlist. (#71)
- Correct media types for video and audio outputs; audio-trim rejects start ≥ end; embed-qr-in-pdf validates the page. (#71)

## [1.6.4] — 2026-06-29 — Backend audit fixes

- Fixed: split-by-size silently dropped pages; SVG conversions could read local files or internal URLs; image OCR had no timeout; video-merge turned 400/413 into 500; a compare leak. (#69)
- More CPU-bound handlers run off the event loop. (#70)

## [1.6.3] — 2026-06-29 — Flag-gated api.privatools.me split

- `PUBLIC_API_BASE_URL` moves the SPA's API traffic to a DNS-only host so the apex can sit behind Cloudflare without capping 500 MB uploads; off by default. (#68)

## [1.6.2] — 2026-06-29 — GEO citability; release deploys wait for the signed image

- Knowledge-graph topics and a citable homepage facts block; a GEO runbook for the account-gated steps. (#66)
- A release deploy waits for the signed image instead of racing a local build. (#67)

## [1.6.1] — 2026-06-29 — Deploy the signed image

- Auto-deploy pulls the signed GHCR image built per tag instead of rebuilding on the VM, with deploy-failure alerting. (#65)

## [1.6.0] — 2026-06-29 — Security and reliability hardening, CI test gate, deploy gate, PDF to Long Image

### Security

- url-to-pdf and html-to-pdf validate every WeasyPrint sub-resource and re-validate redirects. (#46)
- Rate limiting keys on the rightmost `X-Forwarded-For` entry (the one nginx appends) and covers the expensive routes that had no limit; archive extraction is capped by the real decompressed size; image, media and archive uploads are size-checked while being read. (#46)
- Nonce-based `script-src` CSP, build-time SRI, HSTS/COOP/COEP/CORP headers, `security.txt`, `SECURITY.md` and a `/security` page; self-hosted fonts; analytics through a first-party proxy with Do Not Track, GPC and local opt-out. (#1, #30)

### Reliability

- 96 route-to-service calls moved off the event loop into the thread pool; pikepdf/Pillow leaks closed; an empty-PDF booklet returns 400. (#46)
- Fixed: right after 1.5.2 deployed, `TrustedHostMiddleware` rejected every request; allowed hosts now fall back to the hostnames in `ALLOWED_ORIGINS`, and `/readyz` no longer fails when Ghostscript is absent. (512b336)

### New

- PDF to Long Image. (#52)
- Edit PDF rebuilt: select, move and resize edits, undo/redo, line, circle and image tools, keyboard shortcuts and page thumbnails. (dccc92e)
- Eight browser-only developer tools and 26 conversion alias pages. (#1)
- Developer pipeline API (templates, validation, a `compress-pdf → strip-metadata` runner), shareable `/pipeline?p=` recipes, optional `X-API-Key` gating, a local `privatools` CLI and a Manifest V3 extension skeleton. (#1)

### Performance and SEO

- Brotli for HTML and assets, fewer preloads, a prehydration brand shell and a faster mobile first paint. (#22–#28)
- Server-rendered content restored (routes had served an empty shell since 18 June); no self-canonical on 404s; a `/tools` hub; per-tool sitemap dates; MIT `LICENSE` file added. (#45, #50, #51)
- Top-50 tool pages carry at least 800 words of server-rendered content, enforced by a test; "Last reviewed" badges; tool-count claims aligned. (#1, #53, #29)

### CI and deploy

- Backend and frontend tests run on every pull request. (#48)
- A security workflow (npm and pip audits, CodeQL, OpenSSF Scorecard, Trivy), a tag-triggered release workflow that pushes cosign-signed images to GHCR, and Dependabot. (#1)
- GitHub Actions pinned to commit SHAs; the security workflow repaired and its write scopes narrowed. (#46, #31, #32)
- A systemd timer on the Oracle VM checks for a new deploy target every minute, rebuilds, and waits for `/api/health` to report the new build SHA; the nginx config redirects `www` to the apex. (505d473, 83c092a, 5ef8779, 19aa2ec)
- Auto-deploy gains a release-tag gate. (#47)
- Container: loopback-only bind, `cap_drop: ALL`, `no-new-privileges`, 4 GB memory, 1.8 CPUs, 512 PIDs. (#46, #63, #64)
- The `backend/requirements.txt` mirror is removed; `.env.example` domains and upload limit are aligned. (#46, #47)

### UI

- Persistent mobile bottom navigation and 44 px touch targets. (#1)
- Privacy copy corrected: server tools use isolated temporary per-request storage rather than memory only, and the Smart Redact and Summarize PDF banners no longer overstate what stays local. (70e0821, 3965d6b, #46)

## [1.5.2] — 2026-05-20 — Workshop UI overhaul + production hardening

### Frontend

- Workshop UI overhaul completed: ~180 files now use signal-green § / Fraunces / corner-marks aesthetic
- `friendlyError` + Cmd+Enter + `<kbd>⌘↵</kbd>` hint backfilled across all 68 stateful tool-UIs (was 39)
- Sticky reading-progress + TOC on blog/legal pages with hand-rolled rAF smooth-scroll
- Inline synonyms on all 179 tools (powers Cmd+K fuzzy search)
- PDF.js + Hugging Face Transformers now truly lazy-loaded
- Removed dead `@tanstack/react-query` and `EditorialMasthead`/`EditorialFooter` imports
- Multi-file support on 12 tools via shared `useMultiFileProcessor` + queue + pure-JS STORE-mode zip writer (`lib/zip.ts`)
- **ErrorBoundary** (class component, 208 LOC) wrapping app root AND each tool — one tool's render crash no longer white-screens the shell. Workshop-styled fallback + Reload/Go-home buttons + dev-only stack trace.
- **ToolSkeleton** suspense fallback replaces the blank-screen lazy-chunk load
- **useFocusTrap** hook + applied to NameDialog (PipelinePage); ShortcutsHelp/OnboardingTour/CommandPalette already had complete focus traps from earlier rounds
- Memory-leak audit: 6 fixes (object-URL revokes via `downloadBlob` helper in MarkdownHtmlUI + CsvJsonUI; stale-closure unmount cleanup in MergeImagesUI + ImageCompressorUI; AbortController unmount aborts on PipelinePage + BatchPage). Full inventory: 100 `addEventListener`, 8 rAF, 25 setTimeout, 22 object URLs — all paired with cleanup.
- Persistence: useFormPersist (400ms debounced localStorage envelope), useOnline, useGlobalErrorHandler, BatchResumeBanner for crash recovery
- Service worker: SWR app shell + last-10-tool-routes cache + `/api/*` bypass; CACHE_VERSION = "v1.5.0"
- First-run welcome card + sample files (`public/samples/`) + first-success toast
- 12 new keyframe animations (copy-flash, dragging, queue-row-enter, processing-pulse, dropzone-landed, button-press-ring, underline-reveal, toc-rail-marker) — all respect `prefers-reduced-motion`

### Backend

- 12 typed exceptions matching frontend `friendlyError` patterns (PdfEncryptedError, PageRangeError, FileTooLargeError, ToolTimeoutError, ExternalToolError, …)
- N-up orientation parameter (side / stack)
- QR code FG/BG colors + logo embed
- Create-ZIP compression level (0–9)
- Round 1 security: XXE (defusedxml), zip-slip, SSRF, command-injection, path-traversal
- **Round 2 security**: CRLF/header injection in 21 routes via centralized `safe_stem`/`safe_header_filename` helpers; MIME magic-byte validation (PNG/JPEG/GIF/BMP/TIFF/WEBP/HEIC + ZIP); tempfile race fixed (atomic `mkstemp` w/ 0600 perms); SSRF expanded to CGNAT, TEST-NET, IPv6 link-local, IPv4-mapped, IPv6-translation ranges; cache-control `no-store` on every `/api/*` dynamic output; ReDoS fix in phase7 timestamp regex; `TrustedHostMiddleware` with env-driven allowlist
- **Resource caps**: `Image.MAX_IMAGE_PIXELS = 150M` (decompression-bomb guard) + `DecompressionBombError` → 413 handler; tesseract timeout 90s; ffmpeg/LibreOffice/Ghostscript subprocess timeouts verified; per-IP rate limiting via slowapi (`@limiter.limit("5/minute")`) on `/api/ocr`, `/api/smart-redact`, `/api/pdf-to-word`, `/api/pdf-to-excel`, `/api/url-to-pdf`, `/api/extract-audio`; `UploadSizeLimitMiddleware` enforces `MAX_UPLOAD_MB` (default 500 MB) both at Content-Length pre-check and during streaming
- **Observability**: JSON structured logger (`utils/logging.py`) + `contextvars` propagation so every log line auto-tags `request_id`; `AccessLogMiddleware` logs one INFO per request with `duration_ms`, WARNING for `>5s`; `RequestTimeoutMiddleware` returns 504 with friendly message after 120s; all `print()` removed from `app/`
- **Health endpoints**: `/healthz` (liveness, always 200) + `/readyz` (readiness — checks pikepdf/fitz/PIL importability + tessdata path + temp-dir writable)
- **`X-Request-ID`** on every response
- **Shared utils**: `route_helpers.py` (safe_stem, read_upload, unique_arcname), `cleanup.py` (temp-file cleanup, MIME validation, content sniffing), `health.py`, `logging.py`, `caching.py` (ETag/304/Vary + 7d cache on OG images + 1h on sitemap), `filenames.py` (`temp_output` consolidating 113 call sites), `images.py` (`open_image_safe` context manager), `page_range.py`, `colors.py`, `exceptions.py`
- `/api/<unknown>` returns JSON 404 (not SPA HTML shell)
- Test count: 197 passed, 40 skipped (integration-gated), 0 failed (was 118 at round-3 start; +79 in this release)

### SEO + meta

- Tool title length: 174 over-60 → 0; tool descriptions: 113 over-160 → 0
- Sitemap: 202 → 213 URLs (added 11 `/compare/<competitor>` pages, real blog `publishedAt` dates, per-tool priority bumping)
- Static `public/sitemap.xml` written at build time + matching backend `/sitemap.xml` route (parity verified)
- All 179 tool pages have `SoftwareApplication` JSON-LD with inline `creator`. `aggregateRating` deliberately omitted (would violate Google's structured-data guidelines without a real review corpus).
- Per-competitor `reviewRating` on `/compare/*` pages with `ratingExplanation`
- `TOOL_LAST_REVIEWED` per-tool dict (44 entries) drives sitemap lastmod
- NotFound page: `noindex,nofollow` via React `useNoIndexMeta()` hook AND backend SSR for unknown paths
- FAQ depth (6–8 Q&A) on top 20 tools
- llms-full.txt (66 KB) verbose per-tool reference

### Deploy

- `deploy/nginx.conf` — TLS 1.2/1.3, HSTS preload-ready (2yr), strict CSP, security headers, gzip + brotli (commented), `/assets` 1yr immutable, `/sw.js` no-store, API proxy with 120s timeouts and 110MB body limit
- `deploy/privatool-backend.service` — systemd unit with hardening (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `MemoryMax=4G`, `CPUQuota=300%`, `TimeoutStopSec=60` for graceful shutdown)
- `deploy/deploy.sh` — minimal-blast-radius: git fetch + reset + frontend build + systemd restart + nginx reload + `/healthz` smoke check
- `deploy/README.md` — one-time setup + day-2 ops + rollback + troubleshooting
- `.env.example` — every tunable (APP_VERSION, MAX_UPLOAD_BYTES, TESSDATA_PREFIX, TRUSTED_HOSTS, ALLOWED_ORIGINS, LOG_LEVEL, EXPENSIVE_RATE_LIMIT)

## [1.5.1] — 2026-05-16 — UX polish + a11y + AEO/GEO push

### 🆕 New tools (2) — total now 179

- **Rotate Image** (`/tools/rotate-image`) — 90 / 180 / 270 / arbitrary angle via Pillow `Transpose` + `rotate(expand=True)`. Canvas auto-expands so nothing is cropped at non-right angles. Transparency preserved for PNG and WEBP.
- **Flip Image** (`/tools/flip-image`) — horizontal or vertical mirror.

### 🔍 SEO / AEO / GEO

- **Blog index, About, Compare hub, Privacy, Terms, Pipeline, Batch** — 7 pages that had no JSON-LD now have proper schema (`Blog` + `BlogPosting` list, `AboutPage` + `FAQPage`, `CollectionPage` + `ItemList`, `WebPage`, `WebApplication`, `BreadcrumbList`).
- **Homepage `FAQPage`** added with 6 voice-friendly Q&As, matched by visible SSR `<h3>/<p>` so Google's FAQ rich-result rules hold.
- **Homepage SSR** now explicitly surfaces **Pipeline** and **Batch** as differentiators that no competitor offers free.
- **`llms-full.txt`** (66 KB) added alongside `/llms.txt`. Verbose per-tool reference, architecture explainer, and citation-ready statements for AI crawlers. `robots.txt` advertises both.
- Stale "152+ / 90+ / 105 / 141+" tool counts swept across `LandingPage`, `ComparePage`, `DynamicHead`, `opensearch.xml`, `manifest.json`, and the Foxit compare meta — all now use dynamic counts or the current canonical number.

### ♿ Accessibility

- **Real skip-link** in `EditorialMasthead` (`sr-only focus:not-sr-only`) jumping to `#main-content`. `id="main-content"` added to `<main>` across all 12 page components. Index.html SSR fallback skip-link harmonised to the same target.
- **`inputMode="numeric"`** added to all 48 `type="number"` inputs across 19 tool components → triggers numeric keypad on mobile.

### 🐛 Bugs

- **File inputs across 60+ components** now reset `e.target.value = ""` in `onChange`. Re-selecting the same file after clearing it (X button or post-process) used to silently no-op because the browser short-circuits `onChange` on identical values.
- **404 page rebuilt** with a fuzzy match over all 179 tools against the requested URL's last segment — surfaces a top-6 "Did you mean…" list and a Cmd-K trigger. Tool count is now dynamic.

### ⌨️ UX

- **Command Palette: category chips** (PDF / Image / Video-Audio / Dev / Docs / Archive) shown on the right of each result for disambiguation when two tools share a name. Hidden on mobile to keep rows uncluttered.
- **Cmd-K synonyms** added for `rotate-image` (turn / spin / tilt / sideways) and `flip-image` (mirror / unmirror / selfie / reflect).

## [1.5.0] — 2026-05-15 — Phase 7: competitor-gap tools

### 🆕 New tools (6) — total now 177

Six tools competitors offer that PrivaTools didn't:

- **Mute Video** — stream-copy strips the audio track (lossless, instant) — MP4 / MOV / WebM / MKV / AVI
- **Reverse Video** — plays backwards with audio reversed in sync, output H.264 + AAC
- **Video Speed Changer** — 0.25× (slow-mo) to 4× (hyperlapse), audio pitch-corrected via FFmpeg's `atempo` so it doesn't sound chipmunk-y
- **Audio Trimmer** — standalone audio cutter, lossless stream-copy on MP3 / WAV / AAC / FLAC / OGG / M4A
- **Image Color Palette** — extract dominant colours from any image with HEX codes, `rgb()` values, and coverage percentages (octree quantisation)
- **Pixelate / Blur Image** — mosaic pixelation or Gaussian blur with adjustable strength for privacy-safe sharing (block faces, license plates, addresses)

### ⌨️ Discoverability

- **Command Palette rewrite** — multi-token fuzzy scoring with 6-tier rank (exact name → prefix → slug-exact → contains → synonym phrase → multi-token AND) plus a popularity tie-breaker. `SYNONYMS` map tripled from 39 entries to 145+. Result cap 12 → 16. Verified 16/18 (89%) fuzzy match rate on test queries.

### 💬 UX

- **Human-readable HTTP errors** in `lib/api.ts` — `describeError()` maps 413 / 415 / 422 / 429 / 502 / 503 / 504 each to tailored user-facing copy instead of `Request failed (500)`. The error card got a "Try again" + "Copy error" affordance.
- **Filename preservation** across server-side tools — output filenames are derived from the source name + a suffix (`document.pdf` → `document_compressed.pdf`), not generic `output.pdf`.

### 🔍 SEO / AEO / GEO

- **Hand-written TL;DRs expanded from 30 to 141 tools** with voice-friendly, 1-2 sentence answers tagged `data-speakable`.
- **HowTo JSON-LD** added to every tool's `@graph` with 3 step entries each.
- **`dateModified` dynamic** — uses `date.today()` so all tool pages show today's date as last-reviewed.
- **sitemap `lastmod` = today** for all evergreen content (tool pages, blog index, compare, etc.) so search engines see fresh signals.

### ♿ Accessibility

- **Colour contrast** bumped to WCAG-AA across compare / blog / tool pages: `text-green-600` → `text-green-700 dark:text-green-400`, `text-red-500` → `text-red-700 dark:text-red-400`, accent badges from `bg-accent/15 text-accent` to `bg-accent/25 text-foreground border-accent/40`.
- **Sidebar headings** changed from `<h3>` to `<h2>` for correct heading order on tool pages.
- **Form labels** added with `htmlFor` / `id` pairs and `aria-label` on the YAML-to-JSON textarea and password-generator input.
- **Icon-only `<a>`** on the blog "next post" arrow gained `aria-label="Read {title}"`.

### 📱 Mobile

- **CategoryToolNav overflow** — changed from `min-w-0 max-w-full` (didn't clip on certain viewports) to `-mx-4 sm:mx-0 overflow-hidden` edge-to-edge scroll pattern.
- **Wide markdown tables** in blog posts get `display: block; overflow-x: auto` so they don't horizontal-scroll the whole page.

## [1.4.0] — 2026-05-12 — Converter aliases + browser-only utilities

### 🆕 New tools (20+)

**Image converter aliases** (each is its own SEO landing page hitting the unified `image-converter` backend):

JPG ↔ PNG · JPG → WebP · PNG → WebP · TIFF → JPG/PNG · BMP → JPG/PNG · GIF → JPG/PNG

**Audio / video converter aliases:**

M4A → MP3 · MP4 → MP3 · MOV → MP4 · AVI → MP4 · WebM → MP4 · MP4 → WebM

**Browser-only dev tools:**

YAML ↔ JSON · Case Converter (camelCase ↔ snake_case ↔ kebab-case ↔ PascalCase ↔ CONSTANT_CASE ↔ Title Case ↔ sentence case)

### 🔍 SEO

- Each alias gets a dedicated landing page with its own meta, TLDR, HowTo, and FAQ — surfaces in long-tail "convert X to Y" searches without duplicating backend code.

## [1.3.0] — 2026-05-15 — SEO / AEO / GEO sweep

### 🔍 SEO (technical)

- **robots.txt rewritten** with explicit allows for every major AI crawler: GPTBot, ChatGPT-User, OAI-SearchBot, Google-Extended, GoogleOther, PerplexityBot, Perplexity-User, ClaudeBot, anthropic-ai, Claude-Web, Claude-SearchBot, cohere-ai, Cohere-Web, CCBot, Applebot, Applebot-Extended, Meta-ExternalAgent/Fetcher, FacebookBot, Mistral-AI, YouBot, Diffbot, PetalBot. Yandex/Baidu/DDG explicitly allowed. Aggressive crawlers (Bytespider, AhrefsBot, SemrushBot, MJ12bot, DotBot) blocked.
- **Google Search Console verification fix**: SPA middleware was intercepting `/google*.html` paths and returning index.html shell instead of the 53-byte verification token. Now passes through (`/google`, `/BingSiteAuth`, `/yandex`, `/baidu_verify`).
- **Schema upgrades** (`seo_meta.py`):
  - Tool pages: `WebApplication` → `SoftwareApplication` with richer fields (`applicationSubCategory`, `browserRequirements`, `isAccessibleForFree`, `softwareVersion`, full `Offer` with `availability` + `category`)
  - Homepage: new `ItemList` schema enumerating 25 featured tools as `SoftwareApplication`s
  - Organization: enriched with `alternateName`, `foundingDate`, `license`, `description`, `ImageObject` logo, `ContactPoint`
  - Blog posts: author upgraded from `Organization` to `Person` with `sameAs` + `worksFor`; added `image`, `keywords`, `mainEntityOfPage`
  - Compare pages: `Article` → `["Article", "Review"]` with `mainEntityOfPage` + `author`

### 🎙️ AEO (Answer Engine Optimisation)

- **`speakable` JSON-LD** added to FAQ entries on tool pages, blog posts, and compare pages — gives voice assistants and featured-snippet pickers an explicit "read this aloud" target.
- **TL;DR / Key facts boxes** on every blog post (15/15). Short, snippet-optimised summary at the top of each article, with `.post-tldr` CSS class referenced by the `speakable` selector.
- **Visible author byline** with semantic `<time>` elements (E-E-A-T signal).

### 🤖 GEO (Generative Engine Optimisation)

- **`llms.txt` substantially enriched** (now ~30 KB):
  - Quick-answer comparison matrix (PrivaTools vs 7 competitors)
  - "What makes PrivaTools different (for AI citation)" section with three architectural commitments + auditable source paths
  - Auto-generated section with the 10 most-recent blog posts including their TL;DRs (parsed from `blog.ts`)
  - Inline FAQ section with 7 direct-answer Q&As
  - All competitor comparison links with one-liner verdicts

### 🔗 Internal linking

- **Auto-derived "Related articles" sidebar** on every tool page (PDF + non-PDF) from each post's `relatedTools` field — replaces a stale hand-maintained map.
- **"Tools mentioned in this article" panel** at the bottom of every blog post (15/15), with cards linking to the specific tools each post references.
- All 15 blog posts now have a `relatedTools` array — distributes link equity + gives AI engines a clean entity graph.

### 📊 By the numbers

- AI crawlers explicitly allowed: 21 (was 9)
- TL;DR boxes on blog posts: 15/15
- Blog post → tool internal links: 15 posts × avg 4 tools = ~60 new internal links
- JSON-LD types emitted: SoftwareApplication, BreadcrumbList, FAQPage, BlogPosting, Article+Review, Organization, WebSite, Person, ImageObject, ItemList, SpeakableSpecification, ContactPoint, Offer

## [1.2.1] — 2026-05-15 — SEO content push

### 📝 6 new long-form blog posts (~17,000 words of new content)

- **AI PDF Summarizer: How to Summarize Long PDFs in Your Browser (2026 Guide)** — explains browser-side distilbart, step-by-step walkthrough, what cloud summarizers do with your data
- **10 Best iLovePDF Alternatives in 2026 (Free, Private, Open-Source)** — full comparison matrix, ranked
- **How to Redact a PDF Properly (Don't Use Black Boxes)** — proper redaction technique, common pitfalls, verification steps
- **Why Most Online PDF Tools Are Tracking You (And What to Do About It)** — privacy-policy analysis, tracker breakdown, the open-source test
- **How to Convert HEIC to PDF, JPG, and PNG on Any Device (2026)** — online + Mac + Windows + CLI + iPhone settings
- **How to Decode a JWT Token Safely (and What Each Part Means)** — JWT structure, claims reference, why public decoders are unsafe

### 🔍 Rich-result schemas added

- **HowTo + FAQPage JSON-LD** for 18 additional tools: highlight-pdf, summarize-pdf, smart-redact, split-in-half, pdf-to-svg, pdf-to-html, pdf-to-rtf, web-optimize-pdf, split-by-text, view-exif, jwt-decoder, regex-tester, timestamp-converter, batch-compress-pdf, pdf-page-counter, webp-to-jpg, webp-to-png, heic-to-png — for richer Google SERPs.
- All 6 new blog posts wired into seo_meta `_BLOG_POSTS` for BlogPosting + Article JSON-LD.

### 📊 Numbers

- HowTo coverage: 42 → **60** tools (39% of 152 → 76% of high-traffic tools)
- FAQ coverage: 42 → **60** tools
- Blog posts: 9 → **15**
- Words of content on the site: roughly doubled

## [1.2.0] — 2026-05-15

### 🆕 New tools (11) — total now 152

**PDF**
- **Web Optimize PDF** — `qpdf --linearize` for fast byte-range / first-page-fast-render serving
- **Split by Text** — split a PDF at every page containing a search keyword (with case-sensitive toggle)
- **PDF to HTML** — full HTML export preserving fonts and positioning
- **PDF to RTF** — Rich Text Format extraction, opens in WordPad / Pages / Word / LibreOffice

**Image**
- **View EXIF Data** — counterpart to Remove EXIF; inspect GPS / camera / timestamps / IPTC / XMP metadata as JSON
- **WebP to JPG** — SEO landing page hitting the existing image-converter
- **WebP to PNG** — same, target PNG
- **HEIC to PNG** — same, HEIC input

**Browser-only dev utilities**
- **JWT Decoder** — paste a JWT, see header + payload + signature + expiry status (decoded entirely client-side)
- **Regex Tester** — live JavaScript RegExp tester with match highlighting and capture groups
- **Timestamp Converter** — Unix epoch ↔ ISO 8601 ↔ UTC ↔ local ↔ relative ("in 3 days")

### 🐛 Bug fixes

- **office-to-pdf no longer 500s.** The LibreOffice path was failing with "User installation could not be completed" because the container's appuser had no `$HOME`. Each call now gets its own per-conversion `-env:UserInstallation` profile dir under `/tmp`.

### 🛠️ Backend

- New router `v12_tools.py` with `/api/web-optimize`, `/api/split-by-text`, `/api/pdf-to-html`, `/api/pdf-to-rtf`, `/api/view-exif`
- `pdf-to-html` uses PyMuPDF's HTML exporter; `pdf-to-rtf` does its own minimal RTF generation with Unicode escapes; `view-exif` uses PIL's getexif + GPS sub-IFD

## [1.1.0] — 2026-05-04

### 🆕 New tools (33)

**PDF**
- Image-to-PDF variants: JPG, PNG, HEIC, WebP, TIFF, BMP, GIF, SVG, ODT
- PDF-to-image variants: JPG, PNG, TIFF, BMP, GIF, SVG
- Split in Half — split each page horizontally or vertically (for two-up scans)
- Highlight PDF — yellow-highlight every match of a phrase
- Summarize PDF (AI) — local distilbart, runs in your browser via WebAssembly
- Smart Redact (AI) — local BERT-NER auto-detects PII (names, emails, phones, SSNs)
- Batch Compress PDF — compress up to 50 PDFs in parallel
- PDF Page Counter — count pages across up to 100 PDFs at once

**Video & Audio**
- Video to PDF — extract frames as PDF pages
- Video Converter — MP4/WebM/MOV/AVI/MKV via FFmpeg
- Video Resizer — change resolution/aspect ratio
- Video Thumbnail — extract poster frames at any timestamp
- Video Merge — concatenate clips
- GIF to MP4 — animated GIF → smaller, smoother MP4
- Burn Subtitles — embed .srt or .vtt into MP4
- Audio Converter — MP3/WAV/OGG/FLAC/AAC with bitrate control
- Audio Merge — concatenate audio tracks
- Image Upscaler — 2x or 4x with Lanczos resampling

**Browser-only utilities**
- Subtitle Converter — SRT ↔ VTT ↔ ASS in browser
- Password Generator — cryptographically-secure with custom rules
- UUID Generator — bulk v4 UUIDs
- Lorem Ipsum — placeholder text by paragraph/sentence/word
- Word Counter — live word/character/sentence/reading-time
- Color Converter — HEX ↔ RGB ↔ HSL with picker
- URL & JWT Encoder — percent-encode + JWT decode

### 🎨 Redesign
- Linear/Vercel/Smallpdf-inspired complete UI overhaul (monochrome primary + amber accent)
- 21 custom per-tool SVG illustrations replacing generic icons (Merge, Compress, Rotate, Sign, Watermark, Convert, OCR, Highlight, Lock, Unlock, Summarize, ImageCompress, RemoveBg, VideoToGif, QrCode, Hash, Base64, PageCounter, MergeMedia, etc.)
- Animated SVG hero artwork with floating category chips orbiting a shield
- Animated Pipeline diagram (CSS-keyframed file particle drifting through stages)
- Asymmetric homepage hero, 88px H1, search-shaped CTA opening ⌘K
- Dropzone-style skeleton loaders

### ⌨️ UX
- ⌘K palette: synonym scoring (typing "join" finds Merge, "shrink" finds Compress, "md5" finds Hash, etc.)
- Onboarding tour for first-time visitors (5 cards — keyboard-dismissible)
- Reduced-motion compliance — global safety net disables decorative animations
- Light + dark themes both at zero accessibility violations (axe-core verified)

### ♿ Accessibility
- WCAG-AA color contrast across all routes in both themes
- Proper landmark structure: every page wrapped in `<main>` with aria-labelled `<section>` children
- ARIA dialog semantics on CommandPalette + OnboardingTour
- All sliders forward `aria-label` to the Radix thumb
- Focus rings via `:focus-visible`
- 0 serious + 0 moderate axe violations across 6 audited routes × 2 themes

### 🔍 SEO / AI Discoverability
- llms.txt auto-generated from data files at build time (always in sync, currently 141 tools)
- Per-tool SEO meta on all 141 tools (title + 140-160 char description)
- Dynamic OG images per route via `/api/og-image?p=<path>`
- robots.txt allows GPTBot/Claudebot/Perplexity, blocks aggressive crawlers
- JSON-LD: Organization, Person, BlogPosting, BreadcrumbList, ItemList

### 🛠️ Backend
- Mtime-keyed SEO HTML cache → frontend deploys no longer need a worker restart
- 17 Tesseract language packs baked into image
- rembg model pre-warmed at build time (`/tmp/u2net`, NUMBA_DISABLE_JIT)
- Memory-safety caps on collage, json-to-pdf, split-by-size, compare
- video-merge auto-detects audio tracks (anullsrc padding for silent inputs)
- 6 dedicated UIs replacing single-file GenericUI fallback for batch/multi-file tools
- 94/94 endpoints pass regression sweep

## [1.0.0] — 2026-03-05

### 🚀 Launch

**90+ privacy-first file tools** — all processing happens locally.

### PDF Tools (70+)
- Organize: Merge, Split, Split by Bookmarks, Split by Size, Organize Pages, Delete Pages, Extract Pages, Alternate Mix, Overlay, Repair
- Edit: Edit PDF, Sign, E-Sign, Watermark, Stamp, Header/Footer, Page Numbers, Bates Numbering, Fill Form, Bookmarks, Add Hyperlinks, White-Out, Annotate, Add Shapes, Add Attachment
- Optimize: Compress, Flatten, Grayscale, Deskew, Crop, Auto Crop, Resize, Remove Blank Pages, Invert Colors
- Security: Protect, Unlock, Redact, Strip Metadata, Delete Annotations, Sanitize, Permissions, Verify Signature
- Convert to PDF: Image, HTML, Word, Excel, PowerPoint, TXT, Markdown, CSV, EPUB, RTF, JSON, XML
- Convert from PDF: Image, Text, Word, Excel, PPTX, EPUB, Markdown, Extract Tables

### Non-PDF Tools (16)
- Image: Compressor, Converter, Remove EXIF, Resize & Crop
- Video/Audio: Video→GIF, Extract Audio, Trim Media, Compress Video
- Developer: JSON/XML Formatter, Text Diff, Base64, Hash Generator
- Archive: Extract Archive, Create ZIP
- Document: CSV↔JSON, Markdown→HTML

### App Features
- ⌘K Command Palette with keyboard navigation
- History / Recent Tools tracking
- Dark/Light mode toggle with persistence
- Batch Process — apply one tool to many files
- PDF Pipeline — chain tools sequentially
- PWA support — install as desktop/mobile app
- Per-tool SEO (dynamic meta tags)
- Dynamic sitemap.xml
- Custom 404 page
