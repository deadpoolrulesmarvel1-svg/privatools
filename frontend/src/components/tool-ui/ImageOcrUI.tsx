import { useState, useCallback } from "react";
import { Upload, ScanText, Trash2, Copy, Download, Loader2, AlertCircle, Check, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uploadFileGetJson, uploadFile, downloadBlob } from "@/lib/api";

interface OcrResult { text: string; language: string; characters: number; }
interface ImgFile { file: File; preview: string; }

const LANGUAGES = [
    { code: "eng", label: "English" },
    { code: "fra", label: "French" },
    { code: "deu", label: "German" },
    { code: "spa", label: "Spanish" },
    { code: "ita", label: "Italian" },
    { code: "por", label: "Portuguese" },
    { code: "chi_sim", label: "Chinese (Simplified)" },
    { code: "chi_tra", label: "Chinese (Traditional)" },
    { code: "jpn", label: "Japanese" },
    { code: "kor", label: "Korean" },
    { code: "ara", label: "Arabic" },
    { code: "hin", label: "Hindi" },
    { code: "rus", label: "Russian" },
];

export function ImageOcrUI() {
    const [imgFile, setImgFile] = useState<ImgFile | null>(null);
    const [lang, setLang] = useState("eng");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<OcrResult | null>(null);
    const [copied, setCopied] = useState(false);

    const handleFiles = useCallback((fileList: FileList) => {
        const f = fileList[0];
        if (f) setImgFile({ file: f, preview: URL.createObjectURL(f) });
    }, []);

    const clear = () => { setImgFile(null); setResult(null); setStatus("idle"); setError(null); };

    const process = async () => {
        if (!imgFile) return;
        setStatus("processing"); setError(null); setResult(null);
        try {
            const data = await uploadFileGetJson<OcrResult>("/image-ocr", imgFile.file, { lang, output: "json" });
            setResult(data);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "OCR failed");
            setStatus("idle");
        }
    };

    const copyText = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(result.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const downloadTxt = async () => {
        if (!imgFile) return;
        try {
            const res = await uploadFile("/image-ocr", imgFile.file, { lang, output: "txt" });
            const blob = await res.blob();
            downloadBlob(blob, "extracted_text.txt");
        } catch (e: any) {
            setError(e.message || "Download failed");
        }
    };

    return (
        <div className="space-y-5">
            {/* Upload area */}
            {!imgFile ? (
                <label
                    className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-14 cursor-pointer hover:border-accent/40 hover:bg-secondary/50 transition-all"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); e.dataTransfer.files && handleFiles(e.dataTransfer.files); }}
                >
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                        <Upload size={22} className="text-muted-foreground" />
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-medium text-foreground">Drop an image here</p>
                        <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WebP, BMP, TIFF supported</p>
                    </div>
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif" className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
                </label>
            ) : (
                <div className="relative rounded-xl border border-border bg-card overflow-hidden">
                    <img src={imgFile.preview} alt={imgFile.file.name} className="w-full max-h-64 object-contain bg-secondary/30" />
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <div>
                            <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{imgFile.file.name}</p>
                            <p className="text-xs text-muted-foreground">{(imgFile.file.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <button onClick={clear} className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Trash2 size={15} />
                        </button>
                    </div>
                </div>
            )}

            {/* Settings */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Languages size={15} className="text-primary" /> OCR Settings
                </h3>
                <div className="space-y-2">
                    <Label className="text-sm text-foreground">Language</Label>
                    <select
                        value={lang}
                        onChange={e => setLang(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                        {LANGUAGES.map(l => (
                            <option key={l.code} value={l.code}>{l.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {/* Result */}
            {result && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                        <div className="flex items-center gap-2">
                            <ScanText size={15} className="text-primary" />
                            <span className="text-sm font-semibold text-foreground">Extracted Text</span>
                            <span className="text-xs text-muted-foreground">({result.characters} characters)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button onClick={copyText} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                                {copied ? <><Check size={12} className="text-emerald-400" /> Copied</> : <><Copy size={12} /> Copy</>}
                            </button>
                            <button onClick={downloadTxt} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                                <Download size={12} /> Download .txt
                            </button>
                        </div>
                    </div>
                    <textarea
                        readOnly
                        value={result.text}
                        className="w-full min-h-[200px] bg-background text-sm text-foreground p-4 font-mono resize-y focus:outline-none"
                        placeholder="No text detected..."
                    />
                </div>
            )}

            {/* Button */}
            {status === "done" ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
                    <p className="text-sm font-semibold text-emerald-400 mb-3">Text extracted successfully!</p>
                    <Button variant="outline" onClick={clear}>Extract from another image</Button>
                </div>
            ) : (
                <Button className="w-full" disabled={!imgFile || status === "processing"} onClick={process}>
                    {status === "processing"
                        ? <><Loader2 size={14} className="animate-spin mr-2" />Extracting text…</>
                        : <><ScanText size={14} className="mr-2" />Extract Text from Image</>}
                </Button>
            )}
        </div>
    );
}
