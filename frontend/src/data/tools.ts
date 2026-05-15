import {
  FileText, Merge, Scissors, BookOpen, Layout, Trash2, Download,
  PenTool, Stamp, AlignLeft, Hash, Tag, Bookmark,
  Minimize2, Layers, ScanLine, Wrench, Maximize2, RotateCw, Palette, Crop,
  Shield, Unlock, EyeOff, DatabaseZap, MessageSquareOff, Info,
  Code, Image, FileBox,
  Table, FileImage, Presentation, Type, FileOutput,
  Shuffle, GitCompare, ImageDown, FormInput, Grid2x2, ScanText, Copy, QrCode, Archive,
  FileX2, ScissorsSquare, BookMarked, Link2, ClipboardList, Eraser, Moon,
  BadgeCheck, ShieldCheck, Sparkles, Code2, FileSpreadsheet,
  Highlighter, PenLine, Shapes, Braces, FileCode, GalleryVerticalEnd, Droplets,
  ArrowDownUp, BookOpenCheck,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

export type Category = "organize" | "edit" | "optimize" | "security" | "to-pdf" | "from-pdf" | "advanced";

export interface Tool {
  slug: string;
  icon: LucideIcon;
  name: string;
  description: string;
  longDescription: string;
  category: Category;
  clientOnly?: boolean;
  accepts: string;
  outputLabel: string;
}

export const tools: Tool[] = [
  // ── Organize & Manage ──────────────────────────────────────────────────────
  {
    slug: "merge-pdf", icon: Merge, name: "Merge PDF",
    description: "Combine multiple PDFs into one",
    longDescription: "Merge PDF files online for free — combine multiple PDF documents into a single file in seconds. Drag, drop, and reorder pages before merging. No file size limits, no sign-up, no watermarks. Your files are processed securely and never stored.",
    category: "organize", accepts: ".pdf", outputLabel: "merged.pdf",
  },
  {
    slug: "split-pdf", icon: Scissors, name: "Split PDF",
    description: "Split by selecting specific page ranges",
    longDescription: "Split PDF online for free — divide a PDF into separate files by page range. Extract specific pages or split every page into individual PDFs. No installation, no registration required. Privacy-first: files are never stored on our servers.",
    category: "organize", accepts: ".pdf", outputLabel: "split pages",
  },
  {
    slug: "split-by-bookmarks", icon: BookOpen, name: "Split by Bookmarks",
    description: "Split at pages where bookmarks point to",
    longDescription: "Split PDF by bookmarks or chapters automatically. Detect table of contents entries and create separate PDFs for each section. Ideal for splitting textbooks, manuals, and reports. Free, private, no sign-up.",
    category: "organize", accepts: ".pdf", outputLabel: "split chapters",
  },
  {
    slug: "split-by-size", icon: Maximize2, name: "Split by Size",
    description: "Split into parts based on a max file size",
    longDescription: "Split large PDFs into smaller files by maximum file size. Perfect for email attachments with size limits. Set your target size (e.g., 10 MB) and automatically split into compliant chunks. Free online tool, no registration.",
    category: "organize", accepts: ".pdf", outputLabel: "split files",
  },
  {
    slug: "split-in-half", icon: ScissorsSquare, name: "Split in Half",
    description: "Split each page in half — for two-up scans &amp; booklets",
    longDescription: "Split each PDF page in half down the middle (or across the middle) — perfect for un-imposing scanned booklets, two-up scans, and side-by-side documents that need to be one page per side. Choose vertical (left+right) or horizontal (top+bottom).",
    category: "organize", accepts: ".pdf", outputLabel: "split-in-half.pdf",
  },
  {
    slug: "organize-pages", icon: Layout, name: "Organize Pages",
    description: "Reorder, delete, or rotate pages visually",
    longDescription: "Rearrange PDF pages online — drag and drop page thumbnails to reorder, delete, rotate, or duplicate pages visually. Free PDF page organizer with no watermarks. Preview every page before saving.",
    category: "organize", accepts: ".pdf", outputLabel: "organized.pdf",
  },
  {
    slug: "delete-pages", icon: Trash2, name: "Delete Pages",
    description: "Remove specific pages from a PDF",
    longDescription: "Remove pages from PDF online for free. Select specific pages or ranges to permanently delete. Preview thumbnails and choose exactly which pages to remove. No sign-up, no watermarks, files never stored.",
    category: "organize", accepts: ".pdf", outputLabel: "trimmed.pdf",
  },
  {
    slug: "extract-pages", icon: Download, name: "Extract Pages",
    description: "Extract specified pages to a new document",
    longDescription: "Extract pages from PDF online — save specific pages as a new PDF file. Select individual pages or ranges to pull out while keeping the original document intact. Free, fast, and private.",
    category: "organize", accepts: ".pdf", outputLabel: "extracted.pdf",
  },

  // ── Edit PDF Content ────────────────────────────────────────────────────────
  {
    slug: "edit-pdf", icon: PenTool, name: "Edit PDF",
    description: "Edit text and images directly inside the PDF",
    longDescription: "Edit PDF online for free — modify text, images, and content directly inside your PDF. Add new text blocks, replace images, and make changes without converting to Word first. Full-featured PDF editor with no watermarks.",
    category: "edit", accepts: ".pdf", outputLabel: "edited.pdf",
  },
  {
    slug: "sign-pdf", icon: Stamp, name: "Sign PDF",
    description: "Add a visual signature image to a PDF",
    longDescription: "Add signature to PDF online for free. Draw, type, or upload your signature image and place it anywhere on the document. Create legally-binding electronic signatures without printing. No account required.",
    category: "edit", accepts: ".pdf", outputLabel: "signed.pdf",
  },
  {
    slug: "watermark", icon: Layers, name: "Watermark",
    description: "Add text or image watermark over PDF pages",
    longDescription: "Add watermark to PDF online for free. Apply text or image watermarks to every page with full control over opacity, position, rotation, and font size. Protect your documents from unauthorized use. No sign-up needed.",
    category: "edit", accepts: ".pdf", outputLabel: "watermarked.pdf",
  },
  {
    slug: "header-footer", icon: AlignLeft, name: "Header & Footer",
    description: "Add headers and footers to specified pages",
    longDescription: "Add headers and footers to PDF online. Insert custom text, dates, page numbers, or company information in the header and footer of your PDF pages. Free tool with flexible formatting options.",
    category: "edit", accepts: ".pdf", outputLabel: "headerfooter.pdf",
  },
  {
    slug: "page-numbers", icon: Hash, name: "Page Numbers",
    description: "Insert custom page numbers in your chosen format",
    longDescription: "Add page numbers to PDF online for free. Choose from multiple formats (1,2,3 / i,ii,iii / A,B,C), set starting page and number, position, font, and optional prefix. No watermarks, no sign-up.",
    category: "edit", accepts: ".pdf", outputLabel: "numbered.pdf",
  },
  {
    slug: "bates-numbering", icon: Tag, name: "Bates Numbering",
    description: "Add Bates Numbers for legal document indexing",
    longDescription: "Add Bates numbering to PDF for legal document indexing. Apply sequential Bates stamps with custom prefix, suffix, and start number to single or batches of PDFs. Essential for legal discovery and court filings. Free online tool.",
    category: "edit", accepts: ".pdf", outputLabel: "bates.pdf",
  },
  {
    slug: "bookmarks", icon: Bookmark, name: "Bookmarks",
    description: "Add or edit bookmarks to navigate large files",
    longDescription: "Add bookmarks to PDF online — create, rename, reorder, and nest bookmarks for easier navigation in large documents. Build a clickable table of contents for your PDF. Free, no software installation.",
    category: "edit", accepts: ".pdf", outputLabel: "bookmarked.pdf",
  },

  // ── Optimize & Fix ──────────────────────────────────────────────────────────
  {
    slug: "compress-pdf", icon: Minimize2, name: "Compress PDF",
    description: "Reduce the file size of your PDF",
    longDescription: "Compress PDF online for free — reduce PDF file size by up to 90% without losing quality. Choose from light, balanced, or extreme compression levels. Preview estimated savings before downloading. No file limits, no sign-up.",
    category: "optimize", accepts: ".pdf", outputLabel: "compressed.pdf",
  },
  {
    slug: "flatten-pdf", icon: GalleryVerticalEnd, name: "Flatten PDF",
    description: "Flatten forms and annotations into PDF content",
    longDescription: "Flatten PDF online — permanently merge interactive form fields, annotations, and layers into static page content. Essential for submitting filled forms, preventing further edits, and ensuring consistent display. Free tool.",
    category: "optimize", accepts: ".pdf", outputLabel: "flattened.pdf",
  },
  {
    slug: "deskew-pdf", icon: ScanLine, name: "Deskew PDF",
    description: "Straighten scanned pages that are slightly tilted",
    longDescription: "Deskew scanned PDF pages online for free. Automatically detect and correct the tilt angle of scanned documents so text appears perfectly straight and readable. Ideal for fixing wonky scans. No installation required.",
    category: "optimize", accepts: ".pdf", outputLabel: "deskewed.pdf",
  },
  {
    slug: "repair-pdf", icon: Wrench, name: "Repair PDF",
    description: "Attempt to fix corrupted PDF files",
    longDescription: "Repair corrupted PDF files online for free. Fix damaged, broken, or unreadable PDFs that won't open in standard PDF readers. Recover content from corrupted documents. No software download needed.",
    category: "optimize", accepts: ".pdf", outputLabel: "repaired.pdf",
  },
  {
    slug: "resize-pdf", icon: Maximize2, name: "Resize PDF",
    description: "Change the physical dimensions of the pages",
    longDescription: "Resize PDF pages online — change page dimensions to A4, Letter, Legal, or custom sizes. Scale content to fit new page sizes while maintaining aspect ratio. Free PDF page resizer with no watermarks.",
    category: "optimize", accepts: ".pdf", outputLabel: "resized.pdf",
  },
  {
    slug: "rotate-pdf", icon: RotateCw, name: "Rotate PDF",
    description: "Rotate all or specific pages in the PDF",
    longDescription: "Rotate PDF pages online for free — rotate individual pages or all pages by 90°, 180°, or 270°. Fix sideways or upside-down scanned documents instantly. Preview each page before saving. No sign-up required.",
    category: "optimize", accepts: ".pdf", outputLabel: "rotated.pdf",
  },
  {
    slug: "grayscale-pdf", icon: Palette, name: "Grayscale PDF",
    description: "Convert a colorful PDF to black and white",
    longDescription: "Convert PDF to grayscale online for free — turn color PDFs into black and white. Save ink when printing, reduce file size, or prepare documents for monochrome printing. Multiple conversion modes available.",
    category: "optimize", accepts: ".pdf", outputLabel: "grayscale.pdf",
  },
  {
    slug: "crop-pdf", icon: Crop, name: "Crop PDF",
    description: "Trim the margins or change the visible area",
    longDescription: "Crop PDF online for free — trim margins, remove white space, or change the visible area of PDF pages. Draw a crop box to remove unwanted borders. Perfect for removing headers, footers, or excess whitespace.",
    category: "optimize", accepts: ".pdf", outputLabel: "cropped.pdf",
  },

  // ── Security & Privacy ──────────────────────────────────────────────────────
  {
    slug: "protect-pdf", icon: Shield, name: "Protect PDF",
    description: "Encrypt a PDF with a password or set permissions",
    longDescription: "Password protect PDF online for free — encrypt your PDF with AES-256 encryption. Set open passwords, permission passwords, and control printing, copying, and editing access. Military-grade security, no sign-up.",
    category: "security", accepts: ".pdf", outputLabel: "protected.pdf",
  },
  {
    slug: "unlock-pdf", icon: Unlock, name: "Unlock PDF",
    description: "Remove password protection from a PDF",
    longDescription: "Remove password from PDF online for free. Unlock password-protected PDFs you own by entering the correct password. Remove restrictions on printing, copying, and editing. Fast, secure, no software required.",
    category: "security", accepts: ".pdf", outputLabel: "unlocked.pdf",
  },
  {
    slug: "redact-pdf", icon: EyeOff, name: "Redact PDF",
    description: "Permanently black out sensitive content",
    longDescription: "Redact PDF online for free — permanently black out sensitive information including names, addresses, SSNs, and confidential text. WARNING: Redaction is irreversible — content is fully erased from the file, not just hidden.",
    category: "security", accepts: ".pdf", outputLabel: "redacted.pdf",
  },
  {
    slug: "strip-metadata", icon: DatabaseZap, name: "Strip Metadata",
    description: "Remove embedded metadata for privacy",
    longDescription: "Remove metadata from PDF online — strip author name, creation date, GPS coordinates, software info, and all hidden metadata for maximum privacy before sharing documents. Free, instant, no sign-up.",
    category: "security", accepts: ".pdf", outputLabel: "stripped.pdf",
  },
  {
    slug: "delete-annotations", icon: MessageSquareOff, name: "Delete Annotations",
    description: "Remove all comments, highlights, and annotations",
    longDescription: "Remove all annotations from PDF online — delete highlights, comments, sticky notes, drawings, and markup from your documents. Clean up reviewed PDFs before final distribution. Free and private.",
    category: "security", accepts: ".pdf", outputLabel: "clean.pdf",
  },
  {
    slug: "metadata", icon: Info, name: "Metadata",
    description: "View and edit document metadata",
    longDescription: "View and edit PDF metadata online for free — read and modify Title, Author, Subject, Keywords, Creator, and Producer fields. See exactly what information is embedded in your PDF before sharing.",
    category: "security", accepts: ".pdf", outputLabel: "metadata.pdf",
  },

  // ── Convert to PDF ──────────────────────────────────────────────────────────
  {
    slug: "html-to-pdf", icon: Code, name: "HTML to PDF",
    description: "Convert web pages or HTML code into a PDF",
    longDescription: "Convert HTML to PDF online for free. Paste a URL or upload an HTML file and render it as a pixel-perfect, print-ready PDF document. Preserves CSS styles, images, and layout. No installation required.",
    category: "to-pdf", accepts: ".html,.htm", outputLabel: "webpage.pdf",
  },
  {
    slug: "image-to-pdf", icon: Image, name: "Image to PDF",
    description: "Convert JPG, PNG, or other images into a PDF",
    longDescription: "Convert images to PDF online for free — combine JPG, PNG, TIFF, WebP, or BMP images into a single PDF document. Set page size, orientation, margins, and image quality. Bulk convert multiple images at once.",
    category: "to-pdf", accepts: ".jpg,.jpeg,.png,.tiff,.bmp,.webp,.heic,.heif", outputLabel: "images.pdf",
  },
  {
    slug: "jpg-to-pdf", icon: FileImage, name: "JPG to PDF",
    description: "Convert JPG / JPEG photos into a single PDF",
    longDescription: "Convert JPG to PDF online for free — combine one or many JPEG photos into a single PDF document with adjustable page size, orientation, and margins. Bulk convert phone photos, scans, or screenshots in seconds. No file size limit, no watermarks, no sign-up.",
    category: "to-pdf", accepts: ".jpg,.jpeg", outputLabel: "images.pdf",
  },
  {
    slug: "png-to-pdf", icon: FileImage, name: "PNG to PDF",
    description: "Convert PNG images into a single PDF document",
    longDescription: "Convert PNG to PDF online for free — turn one or more PNG images into a single PDF, preserving transparency-aware backgrounds. Bulk convert screenshots, design exports, or charts. No quality loss, no watermark, no sign-up.",
    category: "to-pdf", accepts: ".png", outputLabel: "images.pdf",
  },
  {
    slug: "heic-to-pdf", icon: FileImage, name: "HEIC to PDF",
    description: "Convert iPhone HEIC photos into a single PDF",
    longDescription: "Convert HEIC to PDF online for free — turn iPhone HEIC / HEIF photos into a standard PDF document. Combine multiple HEIC photos into one PDF without first converting them to JPG. Perfect for receipts, scans, and travel documents from iOS.",
    category: "to-pdf", accepts: ".heic,.heif", outputLabel: "images.pdf",
  },
  {
    slug: "webp-to-pdf", icon: FileImage, name: "WebP to PDF",
    description: "Convert modern WebP images into a PDF",
    longDescription: "Convert WebP to PDF online for free — turn one or more Google WebP images into a single PDF document. Faster downloads, smaller files, but most viewers still expect PDF — convert in seconds with no quality loss.",
    category: "to-pdf", accepts: ".webp", outputLabel: "images.pdf",
  },
  {
    slug: "tiff-to-pdf", icon: FileImage, name: "TIFF to PDF",
    description: "Convert TIFF / TIF scans into a single PDF",
    longDescription: "Convert TIFF to PDF online for free — combine multi-page TIFF scans, fax images, or archival photos into one PDF. Ideal for healthcare, legal, and government workflows that ship TIFF but need PDF for distribution.",
    category: "to-pdf", accepts: ".tiff,.tif", outputLabel: "images.pdf",
  },
  {
    slug: "bmp-to-pdf", icon: FileImage, name: "BMP to PDF",
    description: "Convert Windows BMP bitmaps into a PDF",
    longDescription: "Convert BMP to PDF online for free — turn legacy Windows bitmap images into a standard PDF document for sharing. Combine multiple BMPs into one PDF or convert each individually. No file size limits.",
    category: "to-pdf", accepts: ".bmp", outputLabel: "images.pdf",
  },
  {
    slug: "gif-to-pdf", icon: FileImage, name: "GIF to PDF",
    description: "Convert GIF images into a single PDF",
    longDescription: "Convert GIF to PDF online for free — turn one or more GIF images into a PDF document. The first frame of animated GIFs is used. Combine memes, screenshots, and graphics into a single PDF.",
    category: "to-pdf", accepts: ".gif", outputLabel: "images.pdf",
  },
  {
    slug: "svg-to-pdf", icon: FileImage, name: "SVG to PDF",
    description: "Convert SVG vector graphics into PDF",
    longDescription: "Convert SVG to PDF online for free — turn vector SVG icons, logos, charts, and diagrams into a high-quality PDF. Each SVG becomes one page; line art stays crisp at any zoom level. Perfect for sharing design exports without losing quality.",
    category: "to-pdf", accepts: ".svg", outputLabel: "vectors.pdf",
  },
  {
    slug: "odt-to-pdf", icon: FileText, name: "ODT to PDF",
    description: "Convert OpenDocument (ODT) into PDF",
    longDescription: "Convert ODT to PDF online for free — turn OpenDocument Text files (LibreOffice / OpenOffice / Google Docs exports) into a polished PDF with all styles, fonts, and layouts preserved. Powered by LibreOffice in the background.",
    category: "to-pdf", accepts: ".odt", outputLabel: "document.pdf",
  },
  {
    slug: "office-to-pdf", icon: FileBox, name: "Office to PDF",
    description: "Convert Word, Excel, or PowerPoint to PDF",
    longDescription: "Convert Word, Excel, and PowerPoint to PDF online for free. Upload any Microsoft Office document (.docx, .xlsx, .pptx) and get a perfectly formatted PDF with all styles, fonts, and layouts preserved.",
    category: "to-pdf", accepts: ".doc,.docx,.xls,.xlsx,.ppt,.pptx", outputLabel: "document.pdf",
  },

  // ── Convert from PDF ────────────────────────────────────────────────────────
  {
    slug: "pdf-to-excel", icon: Table, name: "PDF to Excel",
    description: "Best-effort table/text extraction into a spreadsheet",
    longDescription: "Convert PDF to Excel online for free — extract tables and data from PDF documents into editable XLSX spreadsheets. Best-effort extraction works great for invoices, financial reports, and tabular data.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "spreadsheet.xlsx",
  },
  {
    slug: "pdf-to-image", icon: FileImage, name: "PDF to Image",
    description: "Convert each PDF page into an image file",
    longDescription: "Convert PDF to images online for free — render each page as a high-resolution JPG or PNG image. Choose DPI (up to 300), color mode, and output format. Perfect for thumbnails, previews, and social media.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "pages.zip",
  },
  {
    slug: "pdf-to-tiff", icon: FileImage, name: "PDF to TIFF",
    description: "Convert PDF into a multi-page TIFF image",
    longDescription: "Convert PDF to TIFF online for free — export your PDF as a single multi-page TIFF image, ideal for archival, fax, healthcare, and legal workflows that require TIFF. All pages bundle into one .tif file with deflate compression.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "pages.tif",
  },
  {
    slug: "pdf-to-bmp", icon: FileImage, name: "PDF to BMP",
    description: "Render PDF pages as Windows BMP bitmaps",
    longDescription: "Convert PDF to BMP online for free — render each page as a Windows BMP bitmap. Useful for legacy software and older Windows tooling that doesn't accept modern image formats.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "pages.zip",
  },
  {
    slug: "pdf-to-gif", icon: FileImage, name: "PDF to GIF",
    description: "Render PDF pages as GIF images",
    longDescription: "Convert PDF to GIF online for free — render each page as a GIF image. Great for embedding PDF page snapshots in chat apps, forums, or wikis where GIFs are first-class.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "pages.zip",
  },
  {
    slug: "pdf-to-svg", icon: FileImage, name: "PDF to SVG",
    description: "Convert PDF pages into editable SVG vectors",
    longDescription: "Convert PDF to SVG online for free — turn each PDF page into a true SVG vector that scales infinitely without quality loss. Perfect for design workflows, web embedding, and editing in Illustrator, Inkscape, or Figma.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "pages.zip",
  },
  {
    slug: "pdf-to-jpg", icon: FileImage, name: "PDF to JPG",
    description: "Render PDF pages as JPG photos",
    longDescription: "Convert PDF to JPG online for free — render each PDF page as a high-quality JPG image. Choose DPI (up to 300) for the resolution. Perfect for thumbnails, social media previews, or photo-style sharing.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "pages.zip",
  },
  {
    slug: "pdf-to-png", icon: FileImage, name: "PDF to PNG",
    description: "Render PDF pages as PNG images (transparency-friendly)",
    longDescription: "Convert PDF to PNG online for free — render each PDF page as a PNG image. PNGs preserve sharp edges and transparency, making them ideal for screenshots, charts, and design exports.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "pages.zip",
  },
  {
    slug: "pdf-to-pptx", icon: Presentation, name: "PDF to PowerPoint",
    description: "Convert each PDF page into a PowerPoint slide image",
    longDescription: "Convert PDF to PowerPoint online for free — create a PPTX presentation where each page becomes a slide. Great for presenting PDF content in meetings. Each page is rendered as a high-quality slide image.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "slides.pptx",
  },
  {
    slug: "pdf-to-text", icon: Type, name: "PDF to Text",
    description: "Extract all text from a PDF file",
    longDescription: "Extract text from PDF online for free — pull all readable text content from your PDF into a clean plain-text document. Works with both text-based and searchable PDFs. No sign-up, instant results.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "content.txt",
  },
  {
    slug: "pdf-to-word", icon: FileOutput, name: "PDF to Word",
    description: "Convert PDF content to an editable Word draft",
    longDescription: "Convert PDF to Word online for free — extract text, paragraphs, and images into an editable DOCX document. Note: complex layouts may require some manual cleanup after conversion. No watermarks, no file limits.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "document.docx",
  },

  // ── Miscellaneous & Advanced ────────────────────────────────────────────────
  {
    slug: "alternate-mix", icon: Shuffle, name: "Alternate Mix",
    description: "Mix pages of two or more PDFs alternately",
    longDescription: "Alternate mix PDF pages online — interleave pages from two or more PDFs for duplex scanning workflows. Combine front-side and back-side scans into the correct page order. Free tool, no sign-up.",
    category: "advanced", accepts: ".pdf", outputLabel: "mixed.pdf",
  },
  {
    slug: "compare-pdf", icon: GitCompare, name: "Compare PDF",
    description: "Visually compare two PDF documents",
    longDescription: "Compare two PDFs online for free — upload two versions of a document and get a visual diff highlighting every text change, addition, and deletion. Essential for contract review, version control, and proofreading.",
    category: "advanced", accepts: ".pdf", outputLabel: "comparison.pdf",
  },
  {
    slug: "extract-images", icon: ImageDown, name: "Extract Images",
    description: "Extract all embedded images from the PDF",
    longDescription: "Extract images from PDF online for free — detect and download all embedded images from your PDF as individual PNG or JPEG files. Get all photos, logos, and graphics out of any PDF document.",
    category: "advanced", accepts: ".pdf", outputLabel: "images.zip",
  },
  {
    slug: "fill-form", icon: FormInput, name: "Fill Form",
    description: "Fill out interactive PDF forms and save them",
    longDescription: "Fill PDF forms online for free — open interactive PDF forms, fill in all text fields, checkboxes, and dropdowns, then save the completed document. No Adobe Acrobat needed. Your PDF must have existing form fields.",
    category: "advanced", accepts: ".pdf", outputLabel: "filled.pdf",
  },
  {
    slug: "nup", icon: Grid2x2, name: "N-Up PDF",
    description: "Print multiple pages per sheet",
    longDescription: "Print multiple PDF pages per sheet online — arrange 2, 4, 6, or 9 pages onto a single sheet for booklet-style printing. Save paper and create handouts. Free N-Up PDF tool with no watermarks.",
    category: "advanced", accepts: ".pdf", outputLabel: "nup.pdf",
  },
  {
    slug: "ocr-pdf", icon: ScanText, name: "OCR PDF",
    description: "Extract text or create a searchable PDF using OCR",
    longDescription: "OCR PDF online for free — convert scanned documents into searchable, selectable text using Tesseract OCR. Supports 100+ languages including English, Hindi, Spanish, French, and more. Output as searchable PDF or plain text.",
    category: "advanced", accepts: ".pdf", outputLabel: "searchable.pdf",
  },
  {
    slug: "overlay", icon: Copy, name: "Overlay PDF",
    description: "Overlay one PDF onto another (e.g., letterhead)",
    longDescription: "Overlay PDF pages online — layer one PDF document on top of another. Perfect for adding letterhead, branded backgrounds, or watermark stamps to existing PDFs. Free, private, no installation required.",
    category: "advanced", accepts: ".pdf", outputLabel: "overlaid.pdf",
  },
  {
    slug: "qr-code", icon: QrCode, name: "QR Code PDF",
    description: "Generate QR codes and add them to PDF pages",
    longDescription: "Add QR code to PDF online for free — generate a QR code from any URL or text and stamp it onto your PDF pages at a chosen position and size. Perfect for adding links, contact info, or payment details.",
    category: "advanced", accepts: ".pdf", outputLabel: "qrcode.pdf",
  },
  {
    slug: "pdf-to-pdfa", icon: Archive, name: "PDF to PDF/A",
    description: "Convert to PDF/A format for long-term archiving",
    longDescription: "Convert PDF to PDF/A online for free — create ISO-standardized archival documents for long-term digital preservation. Essential for legal compliance, government records, and permanent document storage.",
    category: "advanced", accepts: ".pdf", outputLabel: "archive.pdfa",
  },

  // ── Document Cleanup & Structure ────────────────────────────────────────────
  {
    slug: "remove-blank-pages", icon: FileX2, name: "Remove Blank Pages",
    description: "Scan and delete entirely blank or near-blank pages",
    longDescription: "Remove blank pages from PDF online for free. Automatically scan and delete entirely blank or near-blank pages from scanned documents. Clean up your PDFs by removing empty fillers and scan artifacts.",
    category: "organize", accepts: ".pdf", outputLabel: "cleaned.pdf",
  },
  {
    slug: "auto-crop", icon: ScissorsSquare, name: "Remove Margins",
    description: "Auto-trim white space/margins around text on all pages",
    longDescription: "Remove PDF margins online — auto-detect and trim white space around text on all pages. Ideal for reading PDFs on e-readers, tablets, or phones where screen space is limited. Free auto-crop tool.",
    category: "optimize", accepts: ".pdf", outputLabel: "cropped.pdf",
  },

  // ── New Conversions ─────────────────────────────────────────────────────────
  {
    slug: "pdf-to-epub", icon: BookMarked, name: "PDF to EPUB",
    description: "Convert a PDF into the EPUB format for e-readers",
    longDescription: "Convert PDF to EPUB online for free — transform PDF documents into reflowable e-book format compatible with Kindle, Kobo, Apple Books, and all modern e-reader devices. Read your PDFs anywhere.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "book.epub",
  },
  {
    slug: "markdown-to-pdf", icon: Code2, name: "Markdown / Config to PDF",
    description: "Convert .md, .json, .yaml, or .toml files to PDF",
    longDescription: "Convert Markdown to PDF online for free. Upload .md, .json, .yaml, or .toml files and render them as beautifully formatted, structured PDF documents — locally and instantly. Perfect for documentation.",
    category: "to-pdf", accepts: ".md,.markdown,.json,.yaml,.yml,.toml", outputLabel: "document.pdf",
  },
  {
    slug: "csv-to-pdf", icon: FileSpreadsheet, name: "CSV to PDF",
    description: "Generate table-style or invoice PDFs from CSV data",
    longDescription: "Convert CSV to PDF online for free — upload a CSV spreadsheet and generate a cleanly formatted PDF with tables, invoices, or report layouts. Instant conversion, no sign-up, free to use.",
    category: "to-pdf", accepts: ".csv", outputLabel: "table.pdf",
  },
  {
    slug: "word-to-pdf", icon: FileText, name: "Word to PDF",
    description: "Convert .docx Word documents to PDF",
    longDescription: "Convert Word to PDF online for free — upload .docx documents and convert them to high-quality PDFs preserving headings, bold, italic text, images, and paragraph formatting. No Microsoft Office needed.",
    category: "to-pdf", accepts: ".docx", outputLabel: "converted.pdf",
  },
  {
    slug: "excel-to-pdf", icon: Table, name: "Excel to PDF",
    description: "Convert .xlsx spreadsheets to PDF",
    longDescription: "Convert Excel to PDF online for free — upload .xlsx spreadsheets and convert all sheets into a formatted PDF with headers, grid lines, and automatic column sizing. No Microsoft Office required.",
    category: "to-pdf", accepts: ".xlsx", outputLabel: "converted.pdf",
  },
  {
    slug: "pptx-to-pdf-convert", icon: Presentation, name: "PowerPoint to PDF",
    description: "Convert .pptx presentations to PDF",
    longDescription: "Convert PowerPoint to PDF online for free — upload .pptx presentations and get a high-quality PDF preserving slide dimensions, text, headings, and formatting. No Microsoft Office required.",
    category: "to-pdf", accepts: ".pptx", outputLabel: "converted.pdf",
  },
  {
    slug: "txt-to-pdf", icon: Type, name: "Text to PDF",
    description: "Convert plain text .txt files to PDF",
    longDescription: "Convert text to PDF online for free — upload .txt files and get a cleanly formatted PDF with monospace font, word wrap, and proper pagination. Instant conversion, no sign-up required.",
    category: "to-pdf", accepts: ".txt", outputLabel: "converted.pdf",
  },
  {
    slug: "stamp-pdf", icon: Stamp, name: "PDF Stamp",
    description: "Add CONFIDENTIAL, DRAFT, or custom stamps",
    longDescription: "Add stamps to PDF online for free — apply CONFIDENTIAL, DRAFT, APPROVED, COPY, VOID, or custom text stamps to any page. Adjustable opacity, position, and size. No sign-up, no watermarks.",
    category: "edit", accepts: ".pdf", outputLabel: "stamped.pdf",
  },
  {
    slug: "esign-pdf", icon: PenLine, name: "E-Sign PDF",
    description: "Quick draw-and-place signature on any PDF",
    longDescription: "E-sign PDF online for free — draw your signature with mouse or finger, then place it on any page. The simplest way to electronically sign documents without printing. No account needed.",
    category: "edit", accepts: ".pdf", outputLabel: "signed.pdf",
  },
  {
    slug: "extract-tables", icon: Table, name: "PDF Table Extractor",
    description: "Extract tables from PDF pages to CSV",
    longDescription: "Extract tables from PDF to CSV online for free. Automatically detect and extract tabular data from invoices, reports, and financial statements into clean, editable CSV spreadsheet format.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "tables.csv",
  },
  {
    slug: "pdf-to-markdown", icon: Code2, name: "PDF to Markdown",
    description: "Extract PDF content as clean Markdown format",
    longDescription: "Convert PDF to Markdown online for free — extract content with automatic heading detection, bold text preservation, and clean formatting. Perfect for converting documents to web content, wikis, and documentation.",
    category: "from-pdf", accepts: ".pdf", outputLabel: "document.md",
  },
  {
    slug: "whiteout-pdf", icon: Eraser, name: "White-Out / Eraser",
    description: "Cover content on PDF with white boxes",
    longDescription: "White-out content in PDF online — place white rectangles over text, images, or any content to permanently hide it. Works like digital correction tape. Free erasure tool for quick coverups.",
    category: "edit", accepts: ".pdf", outputLabel: "whiteout.pdf",
  },
  {
    slug: "annotate-pdf", icon: Highlighter, name: "Annotate PDF",
    description: "Add highlights, underlines, and sticky notes",
    longDescription: "Annotate PDF online for free — add highlights, underlines, strikethrough, and sticky notes with customizable colors. Perfect for reviewing documents, studying, and collaborative feedback. No software needed.",
    category: "edit", accepts: ".pdf", outputLabel: "annotated.pdf",
  },
  {
    slug: "highlight-pdf", icon: Highlighter, name: "Highlight PDF",
    description: "Highlight every match of a word or phrase",
    longDescription: "Highlight PDF online for free — search for any word or phrase and apply a real PDF Highlight annotation to every occurrence at once. Pick from yellow, green, pink, blue, orange, or any custom hex color. Works on multi-page documents and preserves the highlight as a fully-editable annotation in any PDF reader.",
    category: "edit", accepts: ".pdf", outputLabel: "highlighted.pdf",
  },
  {
    slug: "summarize-pdf", icon: Sparkles, name: "Summarize PDF (AI)",
    description: "Local AI summary — your PDF never leaves your browser",
    longDescription: "Summarize PDF online with AI — without uploading. PrivaTools runs the summarization model entirely in your browser via WebAssembly, so your document never touches a third-party server like OpenAI or Anthropic. Choose short, medium, or long summaries. First load downloads the ~250 MB model and caches it for next time.",
    category: "advanced", clientOnly: true, accepts: ".pdf", outputLabel: "summary.txt",
  },
  {
    slug: "smart-redact", icon: ShieldCheck, name: "Smart Redact (AI)",
    description: "Local AI auto-detects PII — names, emails, phones, SSNs",
    longDescription: "Smart Redact PDF online with AI — without uploading. Local NER + regex passes scan your document in the browser to flag people, organizations, locations, emails, phone numbers, SSNs, and credit cards. Review the suggestions, uncheck anything you want to keep, and the chosen strings are sent to your own server (or the demo) for real PyMuPDF redaction — permanent removal, not just a black overlay.",
    category: "security", clientOnly: false, accepts: ".pdf", outputLabel: "redacted.pdf",
  },
  {
    slug: "add-shapes", icon: Shapes, name: "Add Shapes to PDF",
    description: "Draw rectangles, circles, lines, and arrows",
    longDescription: "Add shapes to PDF online — draw rectangles, circles, lines, and arrows with custom colors, fill, and stroke width. Perfect for technical drawings, callouts, and visual annotations. Free tool.",
    category: "edit", accepts: ".pdf", outputLabel: "shapes.pdf",
  },
  {
    slug: "set-permissions", icon: Shield, name: "PDF Permissions",
    description: "Control print, copy, and edit permissions",
    longDescription: "Set PDF permissions online — control who can print, copy, edit, or annotate your PDF documents. Apply granular access controls with owner password protection. Free, no software installation.",
    category: "security", accepts: ".pdf", outputLabel: "permissions.pdf",
  },
  {
    slug: "add-attachment", icon: FileBox, name: "Add Attachment",
    description: "Embed any file inside a PDF document",
    longDescription: "Embed files inside a PDF online — attach images, documents, spreadsheets, or any file as an embedded attachment that recipients can extract. Perfect for sending supplementary materials.",
    category: "edit", accepts: ".pdf", outputLabel: "with_attachment.pdf",
  },
  {
    slug: "json-to-pdf", icon: Braces, name: "JSON to PDF",
    description: "Format JSON data as a styled PDF document",
    longDescription: "Convert JSON to PDF online for free — upload a JSON file and get a beautifully formatted PDF with syntax highlighting, key-value coloring, and proper indentation. Perfect for API documentation.",
    category: "to-pdf", accepts: ".json", outputLabel: "document.pdf",
  },
  {
    slug: "xml-to-pdf", icon: FileCode, name: "XML to PDF",
    description: "Convert XML data to a formatted PDF document",
    longDescription: "Convert XML to PDF online for free — upload an XML file and render it as a clean, indented PDF with tag colorizing and proper structure. Great for data exports and technical documentation.",
    category: "to-pdf", accepts: ".xml", outputLabel: "document.pdf",
  },
  {
    slug: "epub-to-pdf", icon: BookOpen, name: "EPUB to PDF",
    description: "Convert e-books from EPUB to PDF format",
    longDescription: "Convert EPUB to PDF online for free — transform e-books into paginated PDF documents preserving text content. Compatible with all PDF readers and printers. No Kindle or e-reader required.",
    category: "to-pdf", accepts: ".epub", outputLabel: "book.pdf",
  },
  {
    slug: "rtf-to-pdf", icon: FileText, name: "RTF to PDF",
    description: "Convert Rich Text Format files to PDF",
    longDescription: "Convert RTF to PDF online for free — upload Rich Text Format files and get a cleanly formatted PDF with preserved formatting, fonts, and layout. Instant conversion, no software needed.",
    category: "to-pdf", accepts: ".rtf", outputLabel: "document.pdf",
  },

  // ── Advanced Editing ────────────────────────────────────────────────────────
  {
    slug: "add-hyperlinks", icon: Link2, name: "Add Hyperlinks",
    description: "Draw clickable hyperlink areas over text or images",
    longDescription: "Add clickable links to PDF pages online — draw invisible hyperlink areas over any text or image and attach URLs. Perfect for making static PDFs interactive with navigation links. No software needed.",
    category: "edit", accepts: ".pdf", outputLabel: "linked.pdf",
  },
  {
    slug: "form-creator", icon: ClipboardList, name: "Form Creator",
    description: "Add text fields, checkboxes, radios, and dropdowns to PDFs",
    longDescription: "Create fillable PDF forms online for free — add text fields, checkboxes, radio buttons, dropdowns, and signature fields to any PDF. Build professional forms without Adobe Acrobat. Free form builder.",
    category: "advanced", accepts: ".pdf", outputLabel: "form.pdf",
  },
  {
    slug: "transparent-background", icon: Droplets, name: "Transparent Background",
    description: "Convert near-white PDF backgrounds to transparency",
    longDescription: "Make PDF background transparent online — remove white backgrounds from PDF pages to create overlays. Each page is rasterized and near-white pixels are made transparent. Free conversion tool.",
    category: "edit", accepts: ".pdf", outputLabel: "transparent.pdf",
  },
  {
    slug: "invert-colors", icon: Moon, name: "Invert Colors",
    description: "Invert PDF colors for a dark mode reading experience",
    longDescription: "Invert PDF colors online for free — flip the color scheme for dark mode reading. Multiple modes: full inversion, text-only, and warm night tint. Reduce eye strain when reading PDFs at night.",
    category: "optimize", accepts: ".pdf", outputLabel: "inverted.pdf",
  },

  // ── Security & Forensics ────────────────────────────────────────────────────
  {
    slug: "pdfa-validator", icon: BadgeCheck, name: "PDF/A Validator",
    description: "Run basic PDF/A indicator checks",
    longDescription: "Validate PDF/A compliance online for free. Run basic PDF/A indicator checks and metadata warnings. Lightweight heuristic check to verify your documents meet archival standards before submission.",
    category: "security", accepts: ".pdf", outputLabel: "report",
  },
  {
    slug: "verify-signature", icon: ShieldCheck, name: "Verify Digital Signature",
    description: "Inspect signature fields in a PDF",
    longDescription: "Verify PDF digital signatures online — inspect signature fields and certificate information in signed PDF documents. Check if your PDFs were properly signed. Free verification tool.",
    category: "security", accepts: ".pdf", outputLabel: "verification report",
  },
  {
    slug: "sanitize-pdf", icon: Sparkles, name: "Sanitize Document",
    description: "Aggressively clean hidden data, JS, and layers",
    longDescription: "Sanitize PDF online — aggressively remove all hidden data, JavaScript, embedded files, form fields, layers, and metadata for maximum security before sharing. Essential for high-security document workflows.",
    category: "security", accepts: ".pdf", outputLabel: "sanitized.pdf",
  },

  // ── Page Order ─────────────────────────────────────────────────────────────
  {
    slug: "reverse-pdf", icon: ArrowDownUp, name: "Reverse PDF",
    description: "Reverse the page order of a PDF document",
    longDescription: "Reverse PDF page order online for free — flip the sequence so the last page becomes the first. Useful for reversing scan batches, fixing print order, or creating countdown-style documents.",
    category: "organize", accepts: ".pdf", outputLabel: "reversed.pdf",
  },
  {
    slug: "booklet-pdf", icon: BookOpenCheck, name: "PDF Booklet",
    description: "Rearrange pages for booklet printing",
    longDescription: "Create PDF booklets online for free — rearrange pages for saddle-stitch booklet printing. Pages are reordered so that when printed double-sided and folded in half, they form a perfect booklet.",
    category: "organize", accepts: ".pdf", outputLabel: "booklet.pdf",
  },
  {
    slug: "batch-compress-pdf", icon: Minimize2, name: "Batch Compress PDF",
    description: "Compress multiple PDFs at once in parallel",
    longDescription: "Batch compress PDFs online for free — upload up to 50 PDF files and compress them all in parallel. Choose light, balanced, or extreme compression. Download all results as a single ZIP. Powered by 4-core parallel processing for speed.",
    category: "optimize", accepts: ".pdf", outputLabel: "compressed_pdfs.zip",
  },
  {
    slug: "pdf-page-counter", icon: Hash, name: "PDF Page Counter",
    description: "Count pages in multiple PDFs instantly",
    longDescription: "Count PDF pages online for free — upload up to 100 PDF files and instantly see the page count for each file plus the total. Perfect for print quotes, document audits, and project planning. No sign-up required.",
    category: "advanced", accepts: ".pdf", outputLabel: "page counts",
  },
];

export const toolBySlug = Object.fromEntries(tools.map(t => [t.slug, t]));

export const categoryMeta: Record<Category, { label: string; accent: string; iconBg: string; iconColor: string }> = {
  organize: { label: "Organize", accent: "text-blue-400", iconBg: "bg-blue-500/10", iconColor: "text-blue-400" },
  edit: { label: "Edit", accent: "text-violet-400", iconBg: "bg-violet-500/10", iconColor: "text-violet-400" },
  optimize: { label: "Optimize", accent: "text-teal-400", iconBg: "bg-teal-500/10", iconColor: "text-teal-400" },
  security: { label: "Security", accent: "text-rose-400", iconBg: "bg-rose-500/10", iconColor: "text-rose-400" },
  "to-pdf": { label: "To PDF", accent: "text-emerald-400", iconBg: "bg-emerald-500/10", iconColor: "text-emerald-400" },
  "from-pdf": { label: "From PDF", accent: "text-amber-400", iconBg: "bg-amber-500/10", iconColor: "text-amber-400" },
  advanced: { label: "Advanced", accent: "text-indigo-400", iconBg: "bg-indigo-500/10", iconColor: "text-indigo-400" },
};
