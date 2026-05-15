import { Link } from "react-router-dom";
import { Shield, ArrowLeft } from "lucide-react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <nav className="mb-8">
          <Link
            to="/about"
            className="flex items-center gap-1.5 text-xs font-mono-meta text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={12} /> ABOUT
          </Link>
        </nav>

        <article className="blog-prose">
          <header className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={18} className="text-primary" />
              <span className="category-tag text-xs">LEGAL</span>
            </div>
            <h1 className="font-heading text-3xl sm:text-4xl font-black text-foreground leading-tight mb-4">
              Privacy Policy
            </h1>
            <p className="font-mono-meta text-xs text-muted-foreground">
              Last updated: May 15, 2026
            </p>
          </header>

          <h2>The Short Version</h2>
          <p>
            <strong>Your files are private.</strong> They are processed in temporary memory and
            deleted immediately after the response is delivered. We never read, inspect, store,
            or share their contents.
          </p>
          <p>
            <strong>We do collect anonymous pageview telemetry</strong> via Google Analytics 4
            (with IP anonymization enabled) so we can see which tools are popular and prioritize
            improvements. No personal data, no behavioural profiling, no advertising — just
            aggregate counts. You can disable it with any standard tracking blocker (uBlock Origin,
            Privacy Badger, browser DNT) and the site works identically. If you want zero
            telemetry, self-host the open-source build via Docker.
          </p>

          <h2>1. Files You Upload</h2>
          <p>
            When you use a server-side tool (e.g., Merge PDF, Compress PDF), your file is uploaded
            to our processing server over an encrypted HTTPS connection. Here is exactly what happens:
          </p>
          <ul>
            <li><strong>Processing:</strong> Your file is held in temporary server memory (RAM) only for the duration of processing. It is never written to disk or permanent storage.</li>
            <li><strong>Deletion:</strong> The moment processing completes and your result is delivered, the original file and the output are purged from memory. This typically takes less than one second after download.</li>
            <li><strong>No inspection:</strong> Our servers process raw bytes. We never read, analyze, index, or inspect the contents of your files. We have no knowledge of what you upload.</li>
            <li><strong>No retention:</strong> We do not retain copies, backups, thumbnails, or metadata from your files. Once deleted, they are unrecoverable.</li>
          </ul>

          <h2>2. Client-Side Tools</h2>
          <p>
            A growing number of tools run <strong>entirely in your browser</strong> using JavaScript
            and (in some cases) WebAssembly. Your data never leaves your device — not even
            temporarily. You can verify by opening browser DevTools → Network and watching for
            requests during processing.
          </p>
          <ul>
            <li><strong>Developer utilities</strong>: JSON / XML Formatter, Text Diff, Base64
              Encoder, Hash Generator, CSV ↔ JSON Converter, Markdown ↔ HTML Converter,
              JWT Decoder, Regex Tester, Timestamp Converter, URL Encoder, Word Counter,
              Color Converter, UUID Generator, Lorem Ipsum Generator, Password Generator.</li>
            <li><strong>Browser-side AI</strong>: Summarize PDF (distilbart-cnn-12-6) and Smart
              Redact (BERT-base-NER) run AI models <em>in your browser</em> via the
              @huggingface/transformers WebAssembly runtime. The models (~250 MB) are downloaded
              once from the Hugging Face CDN and cached in your browser's IndexedDB storage.
              After the model is cached, summarization and PII detection happen offline — your
              PDF content never touches our server.</li>
            <li><strong>Subtitle Converter</strong>: SRT ↔ VTT ↔ ASS conversion happens entirely
              in your browser.</li>
          </ul>
          <p>
            On first visit to a browser-side AI tool, your browser fetches the model from
            <code> huggingface.co</code> and <code>cdn.jsdelivr.net</code> over HTTPS. Hugging Face
            sees that <em>someone</em> requested the model file (the request includes your IP and
            user agent, as with any web request); they do not see the content you intend to
            summarise or redact. Subsequent uses of the tool, including processing your file, run
            entirely offline from the cached model.
          </p>

          <h2>3. Information We Do Not Collect</h2>
          <p>We do not collect:</p>
          <ul>
            <li>Names, email addresses, or account credentials (no accounts exist)</li>
            <li>Personally identifiable information (your IP address is anonymized before it reaches Google)</li>
            <li>Browser fingerprints or canvas-based device identifiers</li>
            <li>Behavioural profiles, session recordings, or remarketing audiences</li>
            <li>Advertising cookies or tracking pixels from ad networks</li>
            <li>File metadata, filenames, or content from uploaded files</li>
          </ul>
          <p>
            We <em>do</em> collect aggregate pageview counts via Google Analytics 4 — see Section 5 for
            details and how to opt out.
          </p>

          <h2>4. Server Infrastructure</h2>
          <p>
            PrivaTools runs on Oracle Cloud Infrastructure (ARM-based, 24 GB RAM). The server is
            located in a single data center and is maintained by the PrivaTools team. We use HTTPS
            with HSTS for all connections. Our server does not log request bodies or file contents.
            Standard web server access logs (timestamps, HTTP status codes, request paths) may be
            retained for up to 7 days for operational debugging, but these logs never contain file
            data or personally identifiable information.
          </p>

          <h2>5. Third-Party Services</h2>
          <p>
            PrivaTools uses the following third-party services:
          </p>
          <ul>
            <li><strong>Google Analytics (GA4):</strong> We use Google Analytics to understand how visitors use the site — which tools are popular, how people find us, and general usage patterns. Google Analytics collects anonymized page view data, browser type, and approximate location (country-level). It does not have access to your uploaded files. You can opt out using a <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">browser extension</a>.</li>
            <li><strong>Google Fonts:</strong> Typography is loaded via Google Fonts. Google may collect anonymized usage data through font requests.</li>
          </ul>
          <p>
            No advertising networks, remarketing scripts, or user profiling tools are used.
          </p>

          <h2>6. Open Source Transparency</h2>
          <p>
            The entire PrivaTools codebase — frontend and backend — is open source under the MIT
            license at{" "}
            <a href="https://github.com/taiyeba-dg/privatools" target="_blank" rel="noopener noreferrer">
              github.com/taiyeba-dg/privatools
            </a>
            . You can audit every line of code that handles your files. If you prefer maximum privacy,
            you can self-host the entire application using Docker.
          </p>

          <h2>7. Children's Privacy</h2>
          <p>
            PrivaTools does not knowingly collect any information from anyone, including children
            under 13. Since we collect no personal data and require no accounts, there is no
            age-specific data to protect.
          </p>

          <h2>8. Changes to This Policy</h2>
          <p>
            If we change this privacy policy, we will update the "Last updated" date at the top of
            this page. Since we collect no user data, we have no way to notify you directly — we
            recommend checking this page periodically if privacy is a concern.
          </p>

          <h2>9. Contact</h2>
          <p>
            If you have questions about this privacy policy or how PrivaTools handles your files,
            contact us at{" "}
            <a href="mailto:hello@privatools.me">hello@privatools.me</a> or open an issue on{" "}
            <a href="https://github.com/taiyeba-dg/privatools/issues" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>.
          </p>
        </article>
      </main>

      <EditorialFooter />
    </div>
  );
}
