import { useCallback, useEffect, useState } from "react";
import { MediaBatchStudio, MediaField, MediaChoices, MediaBusy } from "./media/MediaStudio";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { removeBackgroundLocal } from "@/lib/localBgRemove";

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
const isImg = (file: File) => IMG_EXTS.some(extension => file.name.toLowerCase().endsWith(extension));

export function BackgroundRemoverUI() {
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [engine, setEngine] = useState<"server" | "local">("server");
    const [modelPct, setModelPct] = useState<number | null>(null);
    const canProcess = proc.entries.length > 0 && phase !== "processing";
    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/remove-background", outputSuffix: "nobg", outputExt: "png",
            concurrency: 1,
            ...(engine === "local" ? { localProcess: (file: File) => removeBackgroundLocal(file, setModelPct) } : {}),
        }, retry);
        setModelPct(null);
        setPhase("done");
    }, [proc, engine]);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canProcess) { event.preventDefault(); void process(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);
    return <MediaBatchStudio proc={proc} phase={phase} title="Make the subject stand out." accepts=".jpg,.jpeg,.png,.webp,.bmp" kind="image"
        // Reviewed before it is kept ("Inspect hair, transparent objects and fine edges"): the download stays a choice.
        action="Remove backgrounds" canProcess={canProcess} onRun={retry => { void process(retry); }} onDownload={() => proc.downloadAll("backgrounds_removed")} downloaded={false}
        onReset={() => { proc.reset(); setPhase("idle"); setModelPct(null); }} filter={isImg}
        note={engine === "local" ? "Your images stay on this device. Transparent PNG at the original dimensions." : "Images upload when you run the tool. Transparent PNG at the original dimensions."}
        options={<><MediaField label="Where to process"><MediaChoices label="Background removal engine" value={engine} onChange={setEngine}
            options={[{ value: "server", label: "On the server", detail: "Uploads for processing" }, { value: "local", label: "On this device", detail: "Keeps your images here" }]} /></MediaField>
            <p className="ms-caption">{engine === "local" ? "U²-Net-P downloads from this site: 4.4 MB plus the AI runtime. Browser processing supports up to 40 megapixels. No image is sent to an AI provider." : "U²-Net-P runs on the PrivaTools server. Images are deleted after the download response; an automatic cleanup handles abandoned jobs."}</p>
            <p className="ms-caption">Works best with a clear subject. Inspect hair, transparent objects and fine edges before using the result. You can queue images and download completed results together.</p>
            <a className="ms-caption" href="/models/NOTICE.txt" target="_blank" rel="noreferrer">Model credits &amp; license</a>
            {modelPct != null && <MediaBusy label={modelPct < 100 ? "Preparing browser model" : "Model ready · removing background"} done={Math.round(modelPct)} total={100} />}
        </>} />;
}
