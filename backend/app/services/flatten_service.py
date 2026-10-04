import re

import fitz  # PyMuPDF

from ..utils.cleanup import process_pdf
from ..utils.filenames import temp_output

# What each scope bakes into the page: annotations, form fields, or both.
SCOPES = {
    "all": {"annots": True, "widgets": True},
    "annotations": {"annots": True, "widgets": False},
    "forms": {"annots": False, "widgets": True},
}


def _keep_layers(doc: fitz.Document) -> None:
    """Keep what gets baked on the layer it belongs to.

    MuPDF bakes an annotation's appearance without the annotation's /OC
    (optional content) entry, so markup on a hidden layer would become
    permanently visible. A form XObject can carry /OC itself, so each
    appearance stream about to be baked gets the /OC of its annotation.
    """
    for page in doc:
        for xref, _type, _id in page.annot_xrefs():
            kind, layer = doc.xref_get_key(xref, "OC")
            if kind not in ("xref", "dict"):
                continue
            kind, normal = doc.xref_get_key(xref, "AP/N")
            if kind == "xref":
                streams = [normal.split()[0]]
            elif kind == "dict":  # one stream per state, as on a checkbox
                streams = re.findall(r"(\d+) \d+ R", normal)
            else:
                continue
            for stream in streams:
                doc.xref_set_key(int(stream), "OC", layer)


def flatten_pdf(input_path: str, scope: str = "all") -> str:
    """Bake annotations, form fields or both into the page content.

    MuPDF draws each one into the page from its appearance, creating the
    appearance first where there is none (as for a field filled by Fill Form),
    and then removes it. Baking the fields also removes the AcroForm, so the
    result is no longer a fillable form. Links stay clickable, and hidden
    annotations are dropped rather than drawn.
    """
    output_path = temp_output("flattened", "pdf")

    def bake(doc: fitz.Document) -> None:
        _keep_layers(doc)
        doc.bake(**SCOPES[scope])
        doc.save(str(output_path), garbage=4, deflate=True, clean=True)

    # A locked, damaged or pageless PDF is refused in the standard words; work
    # that fails on a repaired one is refused as damaged, never redone on a
    # rebuild that may have left pages out (utils.cleanup.process_pdf).
    process_pdf(input_path, bake, rebuild=False)

    return str(output_path)
