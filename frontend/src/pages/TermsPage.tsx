import { Link } from "react-router-dom";
import { FileText, ArrowLeft } from "lucide-react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main id="main-content" className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
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
              <FileText size={18} className="text-primary" />
              <span className="category-tag text-xs">LEGAL</span>
            </div>
            <h1 className="font-heading text-3xl sm:text-4xl font-black text-foreground leading-tight mb-4">
              Terms of Service
            </h1>
            <p className="font-mono-meta text-xs text-muted-foreground">
              Last updated: March 29, 2026
            </p>
          </header>

          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using PrivaTools (<a href="https://privatools.me">privatools.me</a>),
            you agree to these Terms of Service. If you do not agree, do not use the service.
            PrivaTools is provided as a free, open-source tool suite and may be used without
            creating an account.
          </p>

          <h2>2. Description of Service</h2>
          <p>
            PrivaTools provides browser-based file processing tools for PDF, image, video, and
            developer workflows. Files are processed on our server in temporary memory and
            immediately deleted after processing. Some tools run entirely in your browser with
            no server interaction. The service is free, has no usage limits, and requires no
            registration.
          </p>

          <h2>3. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the service to process files that violate applicable laws</li>
            <li>Attempt to access, tamper with, or disrupt the server infrastructure</li>
            <li>Use automated scripts to overload the service (reasonable API usage is fine)</li>
            <li>Redistribute the service under a different name while claiming original authorship</li>
          </ul>
          <p>
            The MIT license grants you full rights to fork, modify, and self-host the PrivaTools
            codebase for any purpose.
          </p>

          <h2>4. File Processing</h2>
          <p>
            Files you upload are processed in temporary server memory and deleted immediately
            after your result is delivered. We do not retain, inspect, or back up your files.
            See our <Link to="/privacy">Privacy Policy</Link> for full details on file handling.
          </p>

          <h2>5. No Warranty</h2>
          <p>
            PrivaTools is provided "as is" without warranty of any kind, express or implied.
            We do not guarantee that the service will be uninterrupted, error-free, or that
            processing results will be perfect for every file. You are responsible for verifying
            output files meet your requirements before relying on them.
          </p>

          <h2>6. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, PrivaTools and its contributors shall not
            be liable for any indirect, incidental, special, consequential, or punitive damages
            arising from your use of the service, including but not limited to data loss, file
            corruption, or service unavailability.
          </p>

          <h2>7. Intellectual Property</h2>
          <p>
            The PrivaTools codebase is open source under the{" "}
            <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer">
              MIT License
            </a>
            . You retain all rights to the files you upload and the outputs you download. We claim
            no ownership or license over your content.
          </p>

          <h2>8. Service Availability</h2>
          <p>
            We aim to keep PrivaTools available 24/7, but we do not guarantee uptime. The service
            may be temporarily unavailable due to maintenance, updates, or infrastructure issues.
            If the hosted service is unavailable, you can always self-host using the open-source
            codebase.
          </p>

          <h2>9. Changes to Terms</h2>
          <p>
            We may update these terms at any time. Changes take effect when posted to this page
            with an updated "Last updated" date. Continued use of the service after changes
            constitutes acceptance.
          </p>

          <h2>10. Contact</h2>
          <p>
            For questions about these terms, contact us at{" "}
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
