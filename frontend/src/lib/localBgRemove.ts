/**
 * On-device background removal — BRIA RMBG-1.4 through transformers.js.
 *
 * Same local-first arrangement as Summarize/Translate/Smart Redact: the
 * ~44 MB ONNX model downloads from the Hugging Face CDN once, caches in the
 * browser, and every image after that is processed without leaving the tab.
 *
 * RMBG-1.4 is not a stock pipeline task, so this loads AutoModel/AutoProcessor
 * with the model's documented preprocessing (1024×1024, mean 0.5, std 1.0) and
 * composites the predicted matte into the source image's alpha channel.
 */

type Loaded = {
    model: { (inputs: Record<string, unknown>): Promise<{ output: unknown }> };
    processor: (img: unknown) => Promise<{ pixel_values: unknown }>;
    RawImage: {
        fromBlob(b: Blob): Promise<{ width: number; height: number }>;
        fromTensor(t: unknown): { resize(w: number, h: number): Promise<{ data: Uint8Array | Uint8ClampedArray }> };
    };
};

let loadedPromise: Promise<Loaded> | null = null;

export const BG_MODEL_ID = "briaai/RMBG-1.4";

export function loadBgModel(onProgress?: (pct: number) => void): Promise<Loaded> {
    if (!loadedPromise) {
        loadedPromise = (async () => {
            const { AutoModel, AutoProcessor, RawImage, env } = await import("@huggingface/transformers");
            env.allowLocalModels = false;
            env.allowRemoteModels = true;
            const progress_callback = (info: { status: string; progress?: number }) => {
                if (info.status === "progress" && typeof info.progress === "number") {
                    onProgress?.(Math.min(100, Math.max(0, Math.round(info.progress))));
                } else if (info.status === "ready") {
                    onProgress?.(100);
                }
            };
            const model = await AutoModel.from_pretrained(BG_MODEL_ID, {
                // The repo has no model_type transformers.js knows; its README
                // documents exactly this custom-config loading path.
                config: { model_type: "custom" } as never,
                progress_callback,
            });
            const processor = await AutoProcessor.from_pretrained(BG_MODEL_ID, {
                config: {
                    do_normalize: true,
                    do_pad: false,
                    do_rescale: true,
                    do_resize: true,
                    image_mean: [0.5, 0.5, 0.5],
                    feature_extractor_type: "ImageFeatureExtractor",
                    image_std: [1, 1, 1],
                    resample: 2,
                    rescale_factor: 0.00392156862745098,
                    size: { width: 1024, height: 1024 },
                } as never,
            });
            return { model, processor, RawImage } as unknown as Loaded;
        })();
        loadedPromise.catch(() => { loadedPromise = null; });
    }
    return loadedPromise;
}

/** Remove the background of one image entirely in the browser → PNG blob. */
export async function removeBackgroundLocal(
    file: File,
    onModelProgress?: (pct: number) => void,
): Promise<{ blob: Blob; outName?: string }> {
    const { model, processor, RawImage } = await loadBgModel(onModelProgress);

    const image = await RawImage.fromBlob(file) as { width: number; height: number };
    const { pixel_values } = await processor(image);
    const { output } = await model({ input: pixel_values });

    // output: [1, 1, 1024, 1024] matte in 0..1 → resize to source dims.
    const matte = await (RawImage.fromTensor(
        (output as Array<{ mul(n: number): { to(t: string): unknown } }>)[0].mul(255).to("uint8"),
    )).resize(image.width, image.height);

    // Composite: source pixels + matte as alpha.
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    const bitmap = await createImageBitmap(file);
    ctx.drawImage(bitmap, 0, 0, image.width, image.height);
    bitmap.close();
    const px = ctx.getImageData(0, 0, image.width, image.height);
    const alpha = matte.data;
    for (let i = 0; i < alpha.length; i++) px.data[i * 4 + 3] = alpha[i];
    ctx.putImageData(px, 0, 0);

    const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob(b => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"),
    );
    const stem = file.name.replace(/\.[^.]+$/, "") || "image";
    return { blob, outName: `nobg_${stem}.png` };
}
