"""Extract images from PDF using PyMuPDF native extraction (fast, no roundtrip)."""
import logging
import zipfile

from ..utils.cleanup import open_pdf_document
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)


def extract_images(input_path: str) -> str:
    """Extract all images from a PDF using PyMuPDF's native extraction.

    Uses doc.extract_image() which returns raw bytes directly,
    avoiding the pikepdf → PIL → bytes roundtrip.
    """
    zip_path = temp_output("extracted_images", "zip")

    doc = open_pdf_document(input_path)
    image_count = 0

    try:
        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            for page_num in range(len(doc)):
                page = doc[page_num]
                image_list = page.get_images(full=True)

                for img_index, img_info in enumerate(image_list):
                    xref = img_info[0]
                    try:
                        img_data = doc.extract_image(xref)
                        if not img_data:
                            continue

                        image_bytes = img_data["image"]
                        ext = img_data["ext"]  # "png", "jpeg", etc.
                        if ext == "jpeg":
                            ext = "jpg"

                        image_count += 1
                        filename = f"page{page_num + 1}_img{img_index + 1}.{ext}"
                        zf.writestr(filename, image_bytes)
                    except (RuntimeError, ValueError, KeyError) as exc:
                        # One bad image shouldn't bring down the whole extraction —
                        # users still get the rest. RuntimeError covers PyMuPDF's
                        # "object not found" on broken xrefs.
                        logger.debug(
                            "extract_images: skipped page=%d img=%d xref=%d (%s)",
                            page_num + 1, img_index + 1, xref, exc,
                        )
                        continue
    finally:
        doc.close()
    logger.info("extract_images: extracted %d image(s)", image_count)
    return str(zip_path)
