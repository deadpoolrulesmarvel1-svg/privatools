import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const PERMS = [
    { key: "allow_print", label: "Allow Printing", desc: "Users can print the document" },
    { key: "allow_copy", label: "Allow Copying Text", desc: "Users can select and copy text content" },
    { key: "allow_modify", label: "Allow Modifications", desc: "Users can edit the document content" },
    { key: "allow_annotate", label: "Allow Annotations", desc: "Users can add comments and highlights" },
];

export function PermissionsUI() {
    const [file, setFile] = useState<File | null>(null);
    const [ownerPassword, setOwnerPassword] = useState("");
    const [permissions, setPermissions] = useState({
        allow_print: true, allow_copy: true, allow_modify: false, allow_annotate: true,
    });
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const toggle = (key: string) => setPermissions(p => ({ ...p, [key]: !p[key as keyof typeof p] }));

    const process = async () => {
        if (!file) return;
        setStatus("processing");
        setError(null);
        try {
            const res = await uploadFile("/set-permissions", file, {
                owner_password: ownerPassword || "",
                ...permissions,
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "Failed");
            setStatus("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const name = file ? file.name.replace(/\.pdf$/i, "_permissions.pdf") : "permissions.pdf";
            downloadBlob(resultBlob, name);
        }
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <Shield size={32} className="mx-auto mb-3 text-emerald-400" />
                <h2 className="text-lg font-bold text-foreground mb-1">Permissions Set!</h2>
                <p className="text-sm text-muted-foreground mb-6">Your PDF has been secured with the specified permissions</p>
                <div className="flex justify-center gap-3 flex-wrap">
                    <Button className="glow-primary" onClick={handleDownload}><Download size={15} /> Download</Button>
                    <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}>Process another</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* File drop */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
                onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}
            >
                <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop PDF here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
            </div>

            {file && (
                <>
                    {/* Owner password */}
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-foreground">Owner Password</label>
                        <input type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)}
                            placeholder="Set owner password (required to change permissions later)"
                            className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-accent/50 focus:outline-none" />
                        <p className="text-[10px] text-muted-foreground/80">Leave blank for a default owner password</p>
                    </div>

                    {/* Permission toggles */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-foreground">Document Permissions</label>
                        <div className="space-y-1">
                            {PERMS.map(p => (
                                <div key={p.key} onClick={() => toggle(p.key)}
                                    className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all",
                                        permissions[p.key as keyof typeof permissions]
                                            ? "border-emerald-500/30 bg-emerald-500/5"
                                            : "border-border bg-card hover:bg-secondary/30")}>
                                    <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all",
                                        permissions[p.key as keyof typeof permissions]
                                            ? "border-emerald-500 bg-emerald-500"
                                            : "border-muted-foreground/85")}>
                                        {permissions[p.key as keyof typeof permissions] && (
                                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{p.label}</p>
                                        <p className="text-[10px] text-muted-foreground">{p.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <Button onClick={process} disabled={status === "processing"} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Applying…</> : "Set Permissions"}
                </Button>
            )}
        </div>
    );
}
