import json

import pikepdf

from ..utils.cleanup import NO_PAGES_MESSAGE, safe_open_pdf
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output


def add_bookmarks(input_path: str, bookmarks_json: str) -> str:
    output_path = temp_output("bookmarked", "pdf")

    try:
        bookmarks_data = json.loads(bookmarks_json)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"Invalid bookmarks JSON: {exc.msg}") from exc

    with safe_open_pdf(input_path) as pdf:
        total_pages = len(pdf.pages)
        if not total_pages:
            # There is no page for a bookmark to point at.
            raise ValidationError(NO_PAGES_MESSAGE)

        with pdf.open_outline() as outline:
            outline.root.clear()
            for item in bookmarks_data:
                title = str(item.get("title", "")).strip()
                page_num = int(item.get("page", 1))
                if not title:
                    continue
                # Clamp page number to valid range
                page_num = max(1, min(page_num, total_pages))
                outline_item = pikepdf.OutlineItem(title, page_num - 1)
                outline.root.append(outline_item)

        pdf.save(str(output_path))

    return str(output_path)
