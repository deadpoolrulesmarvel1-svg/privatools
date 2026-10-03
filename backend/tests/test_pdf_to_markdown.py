"""PDF to Markdown: what the conversion keeps, how it is bounded, and the route.

Every input is a synthetic PDF from markdown_pdfs.py. The conversion runs in
the worker module; the route tests run it through the real worker process.
"""

from __future__ import annotations

import io
import json
import re
import resource
import subprocess
import sys
import time
import zipfile

import fitz  # PyMuPDF
import pytest

from backend.app.services import _pdf_markdown_worker as worker
from backend.app.services import pdf_to_markdown_service as service
from backend.app.utils import cleanup

from . import markdown_pdfs as fx


def md(data: bytes, **options) -> str:
    """The Markdown for ``data`` as one file."""
    result = worker.convert(fitz.open(stream=data, filetype="pdf"), worker.Options(**options))
    return worker._md(result.blocks)


def report(data: bytes, **options) -> dict:
    return worker.convert(fitz.open(stream=data, filetype="pdf"), worker.Options(**options)).report


def in_order(text: str, *parts: str) -> bool:
    positions = [text.find(p) for p in parts]
    return all(p >= 0 for p in positions) and positions == sorted(positions)


# ── Structure ────────────────────────────────────────────────────────────────

def test_headings_take_their_levels_from_type_size():
    out = md(fx.headings(), page_markers=False)
    assert out == (
        "# Annual Garden Survey\n\n"
        f"{fx.HEADINGS_TEXT['body']}\n\n"
        "## Results by crop\n\n"
        "### Tomatoes\n\n"
        f"{fx.HEADINGS_TEXT['second']}\n"
    )


def test_two_columns_read_left_column_first():
    out = md(fx.two_columns(), page_markers=False)
    assert in_order(out, "# Field Notes on Urban Beekeeping", "## Rooftop hives", *fx.COLUMN_PARAGRAPHS[:2],
                    "## City forage", *fx.COLUMN_PARAGRAPHS[2:])
    # Each paragraph is whole: its lines joined, not one paragraph per line.
    for paragraph in fx.COLUMN_PARAGRAPHS:
        assert f"\n{paragraph}\n" in out


def test_columns_drawn_line_by_line_across_still_read_down_each_column():
    """The file draws a left line, then a right line, row by row: drawing order is not reading order."""
    out = md(fx.two_columns_drawn_across(), page_markers=False)
    assert in_order(out, *fx.COLUMN_PARAGRAPHS)
    for paragraph in fx.COLUMN_PARAGRAPHS:
        assert paragraph in out


def test_three_columns_read_in_order():
    out = md(fx.three_columns(), page_markers=False)
    assert in_order(out, "# Three Column Newsletter", *fx.COLUMN_TEXT)
    for paragraph in fx.COLUMN_TEXT:
        assert f"\n{paragraph}\n" in out


def test_columns_ten_points_apart_read_one_after_the_other():
    out = md(fx.narrow_gutter(), page_markers=False)
    numbers = [int(n) for n in re.findall(r"Sentence (\d{3})", out)]
    assert numbers == list(range(1, fx.NARROW_GUTTER_SENTENCES + 1))
    assert in_order(out, "# A Study of Narrow Gutters", "## 1 Introduction", "## 2 Method", "## 3 Results")


def test_a_table_across_two_columns_ends_one_stretch_of_columns_and_starts_another():
    out = md(fx.columns_around_table(), page_markers=False)
    assert in_order(out, fx.COLUMN_TEXT[0], fx.COLUMN_TEXT[2], "| Hive | District | Colonies |",
                    fx.COLUMN_TEXT[1], fx.COLUMN_TEXT[3])


def test_a_ruled_table_becomes_a_github_table_with_its_header():
    out = md(fx.ruled_table(), page_markers=False)
    table = "\n".join([
        "| Name | Role | Started |",
        "| --- | --- | --- |",
        "| Ada Lovelace | Analyst | 1843 |",
        "| Grace Hopper | Compiler engineer | 1944 |",
        "| Katherine Johnson | Mathematician | 1953 |",
    ])
    assert f"{fx.TABLE_BEFORE}\n\n{table}\n\n{fx.TABLE_AFTER}" in out
    # The cells' words are in the table, not repeated as paragraphs.
    assert out.count("Grace Hopper") == 1


def test_a_table_ruled_only_across_is_a_table_too():
    out = md(fx.rules_only_table(), page_markers=False)
    assert "| Name | Role | Started |\n| --- | --- | --- |\n| Ada Lovelace | Analyst | 1843 |" in out
    assert "| Katherine Johnson | Mathematician | 1953 |" in out


def test_a_cell_that_wraps_stays_one_cell():
    out = md(fx.table_with_wrapped_cells(), page_markers=False)
    assert f"| Ingest | {fx.WRAPPED_ROWS[0][1]} |" in out
    assert f"| Publish | {fx.WRAPPED_ROWS[1][1]} |" in out


def test_a_table_printed_sideways_is_read_along_its_text():
    out = md(fx.sideways_table(), page_markers=False)
    assert "| Name | Role | Started |\n| --- | --- | --- |\n| Ada Lovelace | Analyst | 1843 |" in out
    assert in_order(out, fx.TABLE_BEFORE, "| Name |", fx.TABLE_AFTER)


def test_a_page_turned_by_its_rotate_key_is_read_as_shown():
    assert md(fx.turned_page(), page_markers=False) == md(fx.headings(), page_markers=False)


def test_nested_lists_keep_their_marks_and_levels():
    out = md(fx.nested_lists(), page_markers=False)
    assert "- Tent\n- Sleeping bag\n  - Liner\n  - Pillow\n- Stove" in out
    assert ("1. Check the forecast\n2. File a route plan\n   - a. Share it with a friend\n"
            "   - b. Leave a copy in the car\n3. Pack the car") in out


def test_a_lone_letter_at_a_line_start_is_a_sentence_not_a_list():
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "A. Smith wrote the first survey of the allotments.", fontsize=11)
    out = md(doc.tobytes(), page_markers=False)
    assert out == "A. Smith wrote the first survey of the allotments.\n"


def test_code_keeps_its_lines_and_indentation_in_a_fence():
    out = md(fx.code_block(), page_markers=False)
    assert f"{fx.CODE_INTRO}\n\n```\n{fx.CODE_BLOCK}\n```" in out
    assert "Call `greet()` with no name to see the fallback." in out


def test_links_keep_their_addresses():
    out = md(fx.links(), page_markers=False)
    assert (f"Read [the setup guide]({fx.LINK_URL}) before you start, or write to "
            f"[the help desk]({fx.LINK_MAIL}) if something fails.") in out


def test_a_link_that_wraps_onto_the_next_line_stays_one_link():
    out = md(fx.wrapped_link(), page_markers=False)
    assert ("read [the long installation guide that wraps onto the next line of this narrow paragraph]"
            "(https://example.com/a-long-guide) and then carry on.") in out


def test_a_link_to_a_script_keeps_its_text_but_not_the_link():
    out = md(fx.unsafe_link(), page_markers=False)
    assert out == "Click here to continue reading.\n"
    assert "javascript" not in out


def test_bold_and_italic_are_kept_and_markdown_characters_are_escaped():
    out = md(fx.inline_styles(), page_markers=False)
    assert out == "Some words are **bold**, some are *italic*, and one is ***both***. A price of 5 \\* 3 stays as it is.\n"


def test_text_that_looks_like_markdown_stays_text():
    out = md(fx.markdown_lookalikes(), page_markers=False)
    assert "\\# is the symbol" in out and "\\> greater-than" in out
    assert "Use \\<script> tags" in out


def test_table_cells_and_list_items_are_escaped_as_paragraphs_are():
    """A cell's asterisks and a list item's leading hash would otherwise turn into emphasis and a heading."""
    doc = fitz.open()
    page = doc.new_page()
    top = 80
    for r in range(3):
        page.draw_line((72, top + r * 20), (472, top + r * 20))
    for x in (72, 272, 472):
        page.draw_line((x, top), (x, top + 40))
    page.insert_text((76, top + 14), "Rule", fontname="hebo", fontsize=10)
    page.insert_text((276, top + 14), "Example", fontname="hebo", fontsize=10)
    page.insert_text((76, top + 34), "Multiply", fontsize=10)
    page.insert_text((276, top + 34), "*a* times *b*", fontsize=10)
    # PyMuPDF's built-in Helvetica cannot draw U+2022, so these items use a hyphen.
    page.insert_text((72, 180), "-", fontsize=10)
    page.insert_text((86, 180), "# of entries counted at the gate", fontsize=10)
    page.insert_text((72, 196), "-", fontsize=10)
    page.insert_text((86, 196), "Entries refused", fontsize=10)
    out = md(doc.tobytes(), page_markers=False)
    assert "| Multiply | \\*a\\* times \\*b\\* |" in out
    assert "- \\# of entries counted at the gate\n- Entries refused" in out


def test_a_picture_becomes_a_placeholder_with_its_caption():
    out = md(fx.image_with_caption(), page_markers=False)
    assert f"The chart counts registered hives in each district.\n\n[Image: {fx.FIGURE_CAPTION}]\n\n" in out
    assert out.count(fx.FIGURE_CAPTION) == 1


def test_a_tagged_picture_becomes_a_placeholder_with_its_alternative_text():
    out = md(fx.tagged_figure(), page_markers=False)
    assert f"[Image: {fx.FIGURE_ALT}]" in out


def test_book_paragraphs_split_at_their_indents_and_rejoin_hyphenated_words():
    out = md(fx.indented_paragraphs(), page_markers=False)
    paragraphs = out.strip().split("\n\n")
    assert len(paragraphs) == 2
    assert "the next paragraph, which also begins" in paragraphs[0]


def test_labels_beside_their_values_stay_rows():
    out = md(fx.form_labels(), page_markers=False)
    for label, value in fx.FORM_ROWS:
        assert f"**{label}** {value}" in out


def test_a_table_laid_out_with_spaces_keeps_its_rows_together():
    out = md(fx.borderless_table(), page_markers=False)
    for day, hours in fx.OPENING_HOURS:
        assert f"{day} {hours}" in out


def test_a_sidebar_beside_running_text_is_read_before_it():
    out = md(fx.resume_sidebar(), page_markers=False)
    assert in_order(out, "# Jane Placeholder", "Skills", *fx.SKILLS, "Experience", fx.EXPERIENCE)
    assert fx.EXPERIENCE in out


def test_a_diagonal_watermark_is_left_out_and_does_not_shift_heading_levels():
    out = md(fx.watermarked(), page_markers=False)
    assert "DRAFT" not in out
    assert out == md(fx.headings(), page_markers=False)


# ── Pages, headers and footers ───────────────────────────────────────────────

def test_page_markers_come_before_each_page_and_can_be_left_out():
    out = md(fx.headers_and_footers())
    assert [int(n) for n in re.findall(r"<!-- page (\d+) -->", out)] == [1, 2, 3, 4]
    assert out.startswith("<!-- page 1 -->\n\n# Sales")
    assert "<!--" not in md(fx.headers_and_footers(), page_markers=False)


def test_repeated_headers_and_footers_are_removed_and_named():
    out = md(fx.headers_and_footers())
    assert fx.RUNNING_HEADER not in out and fx.RUNNING_FOOTER not in out
    assert "Page 2 of 4" not in out
    for title, text in fx.REPORT_SECTIONS:
        assert f"# {title}\n\n{text}" in out
    facts = report(fx.headers_and_footers())
    assert facts["headersFootersRemoved"] == 4
    assert fx.RUNNING_HEADER in facts["removedLines"] and "Page 1 of 4" in facts["removedLines"]
    # One example of a line that changes only its number.
    assert sum(line.startswith("Page ") for line in facts["removedLines"]) == 1


def test_repeated_headers_and_footers_can_be_kept():
    out = md(fx.headers_and_footers(), remove_headers_footers=False)
    assert out.count(fx.RUNNING_HEADER) == 4
    assert "Page 3 of 4" in out


def test_a_heading_at_the_top_of_every_page_is_not_a_running_header():
    doc = fitz.open()
    for n in range(1, 5):
        page = doc.new_page()
        page.insert_text((72, 60), f"Section {n}", fontname="hebo", fontsize=16)
        page.insert_text((72, 120), f"Body text for section {n}, set in ordinary type.", fontsize=10)
    out = md(doc.tobytes(), page_markers=False)
    assert [line for line in out.splitlines() if line.startswith("#")] == [f"# Section {n}" for n in range(1, 5)]


def test_a_page_without_a_text_layer_is_named_not_invented():
    out = md(fx.text_then_scan())
    assert fx.MIXED_TEXT in out
    assert "<!-- page 2 has no text layer" in out
    assert fx.SCANNED_WORDS not in out
    assert "[Image" not in out
    assert report(fx.text_then_scan())["pagesWithoutText"] == [2]


@pytest.mark.parametrize("make, kind", [(fx.scanned, "scan"), (fx.blank_pages, "blank")])
def test_a_file_with_no_text_at_all_is_refused(make, kind):
    with pytest.raises(worker.Refusal) as refusal:
        md(make())
    assert refusal.value.kind == "no_text" and refusal.value.facts == {"kind": kind}


@pytest.mark.parametrize("make, kind", [(fx.encrypted, "password"), (fx.no_pages, "no_pages")])
def test_a_locked_or_empty_file_is_refused(make, kind):
    with pytest.raises(worker.Refusal) as refusal:
        md(make())
    assert refusal.value.kind == kind


def test_the_report_counts_what_was_found():
    facts = report(fx.sample_report())
    assert facts["pages"] == 2
    assert facts["tables"] == 1 and facts["codeBlocks"] == 1 and facts["links"] == 1
    assert facts["listItems"] == 3 and facts["headings"] == 6
    assert facts["pagesWithoutText"] == [] and facts["pagesNotRead"] == []


# ── Chunks ───────────────────────────────────────────────────────────────────

def chunks(data: bytes, tmp_path, **options) -> tuple[dict, list[tuple[str, str]]]:
    opts = worker.Options(**options)
    result = worker.convert(fitz.open(stream=data, filetype="pdf"), opts)
    target = tmp_path / "out.zip"
    facts = worker.write_output(result, opts, str(target))
    with zipfile.ZipFile(target) as z:
        return facts, [(name, z.read(name).decode()) for name in z.namelist()]


def test_chunks_by_heading_start_at_each_section(tmp_path):
    facts, parts = chunks(fx.headers_and_footers(), tmp_path, chunk="headings")
    assert facts["format"] == "zip" and facts["chunks"] == 4
    assert [name for name, _ in parts] == ["001-sales.md", "002-stock.md", "003-staff.md", "004-outlook.md"]
    assert parts[1][1] == "<!-- page 2 -->\n\n# Stock\n\nStock levels held steady, and the warehouse finished the quarter with no back orders.\n"


def test_chunks_by_size_stay_under_the_size_and_lose_nothing(tmp_path):
    whole = md(fx.narrow_gutter(), page_markers=False)
    facts, parts = chunks(fx.narrow_gutter(), tmp_path, chunk="size", chunk_size=800, page_markers=False)
    assert facts["chunks"] == len(parts) > 3
    assert all(len(text) <= 800 + 2 for _, text in parts)
    # Every sentence is in exactly one chunk, in order.
    joined = "\n".join(text for _, text in parts)
    numbers = [int(n) for n in re.findall(r"Sentence (\d{3})", joined)]
    assert numbers == list(range(1, fx.NARROW_GUTTER_SENTENCES + 1))
    assert re.sub(r"\s+", " ", joined).count("Sentence") == re.sub(r"\s+", " ", whole).count("Sentence")


def test_chunks_by_size_keep_each_paragraph_whole_when_it_fits(tmp_path):
    """A paragraph that fits in a chunk of its own is moved there whole, not cut to fill the last one."""
    whole = md(fx.narrow_gutter(), page_markers=False)
    paragraphs = [p.strip() for p in whole.split("\n\n") if p.startswith("Sentence")]
    _, parts = chunks(fx.narrow_gutter(), tmp_path, chunk="size", chunk_size=1200, page_markers=False)
    pieces = [p for _, text in parts for p in text.strip().split("\n\n") if p.startswith("Sentence")]
    for paragraph in paragraphs:
        if len(paragraph) <= 1200 - 60:
            assert paragraph in pieces, paragraph[:40]
    # A paragraph longer than a chunk is cut between sentences.
    assert all(piece.endswith(".") for piece in pieces)


def test_a_chunk_that_starts_mid_page_names_its_page(tmp_path):
    _, parts = chunks(fx.narrow_gutter(), tmp_path, chunk="size", chunk_size=800)
    assert all(text.startswith("<!-- page 1 -->") for _, text in parts)


def test_a_table_longer_than_a_chunk_repeats_its_header(tmp_path):
    doc = fitz.open()
    page = doc.new_page()
    top, rows = 60, 40
    for r in range(rows + 1):
        page.draw_line((50, top + r * 16), (550, top + r * 16))
    for x in (50, 300, 550):
        page.draw_line((x, top), (x, top + rows * 16))
    for r in range(rows):
        cells = ("Item", "Count") if r == 0 else (f"Item number {r}", str(r * 7))
        for c, text in enumerate(cells):
            page.insert_text((54 + c * 250, top + 12 + r * 16), text, fontname="hebo" if r == 0 else "helv", fontsize=9)
    _, parts = chunks(doc.tobytes(), tmp_path, chunk="size", chunk_size=500, page_markers=False)
    assert len(parts) > 2
    for _, text in parts:
        assert text.startswith("| Item | Count |\n| --- | --- |\n")
    joined = "".join(text for _, text in parts)
    assert all(f"| Item number {r} | {r * 7} |" in joined for r in range(1, rows))


def test_chunks_in_one_file_are_marked(tmp_path):
    opts = worker.Options(chunk="headings", chunk_output="single")
    result = worker.convert(fitz.open(stream=fx.headers_and_footers(), filetype="pdf"), opts)
    target = tmp_path / "out.md"
    facts = worker.write_output(result, opts, str(target))
    text = target.read_text()
    assert facts["format"] == "markdown" and facts["chunks"] == 4
    assert [int(n) for n in re.findall(r"<!-- chunk (\d+) of 4 -->", text)] == [1, 2, 3, 4]
    assert text.startswith("<!-- chunk 1 of 4 -->\n\n<!-- page 1 -->\n\n# Sales")


def test_a_document_without_headings_is_one_chunk(tmp_path):
    facts, parts = chunks(fx.indented_paragraphs(), tmp_path, chunk="headings")
    assert facts["chunks"] == 1 and [name for name, _ in parts] == ["001-part.md"]
    assert parts[0][1] == md(fx.indented_paragraphs())


def test_a_heading_at_the_foot_of_a_page_goes_with_what_follows_it(tmp_path):
    doc = fitz.open()
    first = doc.new_page()
    first.insert_text((72, 100), "Opening section", fontname="hebo", fontsize=16)
    first.insert_text((72, 130), "The opening text is short.", fontsize=10)
    first.insert_text((72, 770), "Closing section", fontname="hebo", fontsize=16)
    doc.new_page().insert_text((72, 100), "The closing text starts on the next page.", fontsize=10)
    facts, parts = chunks(doc.tobytes(), tmp_path, chunk="headings")
    assert facts["chunks"] == 2
    assert parts[1][1] == ("<!-- page 1 -->\n\n# Closing section\n\n<!-- page 2 -->\n\n"
                           "The closing text starts on the next page.\n")


# ── Round 1 of the review: each case is the review's, rebuilt with bundled fonts ──

def plain(data: bytes, **options) -> str:
    return md(data, page_markers=False, **options)


def test_header_and_footer_removal_keeps_every_row_of_a_long_borderless_table():
    """B2: rows whose numbers differ were taken for a running footer, and the
    column names repeated at the top of each page for a running header."""
    out = plain(fx.statement_table())
    for row in fx.statement_rows():
        assert row[1] in out, row[1]
    assert out.count("Description") == 4  # the column names, on each of the four pages
    facts = report(fx.statement_table())
    assert facts["headersFootersRemoved"] == 0 and facts["removedLines"] == []


def test_a_ruled_tables_header_row_is_kept_and_not_reported_as_removed():
    out = plain(fx.statement_table(ruled=True))
    assert out.count("| Date | Reference | Description | Amount |") == 4
    assert all(f"| {row[1]} |" in out for row in fx.statement_rows())
    assert report(fx.statement_table(ruled=True))["removedLines"] == []


@pytest.mark.parametrize("make", [fx.headers_and_footers, fx.sample_report, fx.slide_deck, fx.statement_table],
                         ids=["report", "sample", "slides", "statement"])
def test_lines_reported_as_removed_are_gone_from_the_markdown(make):
    result = worker.convert(fitz.open(stream=make(), filetype="pdf"), worker.Options(page_markers=False))
    out = worker._md(result.blocks)
    lines = {line.strip("| ") for line in out.splitlines()}
    for line in result.report["removedLines"]:
        # A slide number ("1") is gone as a line; words are gone everywhere.
        assert line not in (out if re.search(r"[A-Za-z]", line) else lines), line


def test_page_numbers_and_literal_running_lines_are_still_removed():
    facts = report(fx.headers_and_footers())
    assert set(facts["removedLines"]) == {fx.RUNNING_HEADER, "Page 1 of 4", fx.RUNNING_FOOTER}


def test_slides_with_a_background_rectangle_keep_titles_and_lists():
    """B3: a page-sized background made every slide one table."""
    out = plain(fx.slide_deck())
    assert sum(line.startswith("| ---") for line in out.splitlines()) == 1 and "| Team | Q2 | Q3 |" in out
    assert "# Board Update: Q3 2026" in out and "## Agenda" in out
    assert "- Results for the quarter\n- Customer growth\n  - New regions\n  - Retention\n- Risks and next steps" in out
    assert "[Image: Figure 2: Customers by region, end of Q3]" in out
    assert fx.DECK_FOOTER not in out
    # S8: the bullets are body text, not headings, though the footer is the most common small size.
    assert "#" not in "\n".join(line for line in out.splitlines() if "Revenue up" in line)


def test_two_lists_side_by_side_on_a_slide_are_read_one_after_the_other():
    out = plain(fx.slide_deck())
    assert in_order(out, "Option A: build", "Own the platform", "18 months to launch", "Option B: partner",
                    "Launch in 6 months", "Less control")


@pytest.mark.parametrize("sides", ["lines", "bars"])
def test_a_page_frame_drawn_as_four_sides_is_no_table(sides):
    """A frame drawn as four lines or four thin bars, not one rectangle: its
    top and bottom were taken for a table's rules, around the whole slide."""
    doc = fitz.open()
    for n in range(2):
        page = doc.new_page(width=960, height=540)
        x0, y0, x1, y1 = 20, 20, 940, 520
        if sides == "lines":
            for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
                page.draw_line(a, b, width=1)
        else:
            for r in ((x0, y0, x1, y0 + 1.5), (x0, y1 - 1.5, x1, y1), (x0, y0, x0 + 1.5, y1), (x1 - 1.5, y0, x1, y1)):
                page.draw_rect(fitz.Rect(r), color=None, fill=(0, 0, 0))
        page.insert_text((60, 90), f"Slide title {n}", fontsize=36, fontname="hebo")
        for i in range(3):
            page.insert_text((70, 170 + 38 * i), "-", fontsize=24)
            page.insert_text((100, 170 + 38 * i), f"Point {i} on slide {n}", fontsize=24)
        page.insert_text((890, 500), str(n + 1), fontsize=11)
    out = plain(doc.tobytes())
    assert "|" not in out
    assert "# Slide title 0\n\n- Point 0 on slide 0\n- Point 1 on slide 0\n- Point 2 on slide 0" in out


def test_columns_drawn_across_with_a_space_ending_each_line_read_down_each_column():
    """Lines drawn left column then right column, across the page, each
    ending with a space: the gutter was taken for stretched word spaces."""
    left = [f"[{n}] Left column paragraph {n} wraps over two lines " for n in (1, 2, 3)]
    right = [f"[{n}] Right column paragraph {n} wraps over two lines " for n in (4, 5, 6)]
    doc = fitz.open()
    page = doc.new_page()
    y = 80
    for a, b in zip(left, right):
        for first, second in ((a, b), ("so that it is one paragraph. ", "so that it is one paragraph. ")):
            page.insert_text((50, y), first, fontsize=9.5)
            page.insert_text((305, y), second, fontsize=9.5)
            y += 11.5
        y += 11.5
    out = plain(doc.tobytes())
    assert [int(n) for n in re.findall(r"\[(\d+)\]", out)] == [1, 2, 3, 4, 5, 6]


@pytest.mark.parametrize("uri", [
    'https://example.com/a"><img src=x onerror=alert(1)>',
    "https://example.com/a>b<script>alert(1)</script>",
    "https://example.com/x y(1)",
])
def test_a_link_address_cannot_carry_markup(uri):
    """B4: an address was wrapped in <...> as it was, so a > in it let raw HTML through."""
    import mistune

    out = plain(fx.link_to(uri))
    html = mistune.create_markdown(escape=False)(out)
    assert "<img" not in html and "<script" not in html
    assert html.count("<a ") <= 1 and "Read the guide here before you start." in html


def test_a_link_address_keeps_working_once_encoded():
    out = plain(fx.link_to("https://example.com/search?q=a b&lang=en"))
    assert out.strip() == "[Read the guide here before you start.](https://example.com/search?q=a%20b&lang=en)"


def test_justified_german_columns_read_down_each_column():
    """B5: wide word spaces split justified lines, and the columns were read across."""
    out = plain(fx.german_columns())
    assert [int(n) for n in re.findall(r"\[(\d+)\]", out)] == list(range(1, 16))
    assert len([p for p in out.split("\n\n") if p.strip()]) == 15


def test_three_narrow_justified_columns_read_down_each_column():
    out = plain(fx.three_narrow_columns())
    assert [int(n) for n in re.findall(r"\[(\d+)\]", out)] == list(range(1, 25))
    assert len([p for p in out.split("\n\n") if p.strip()]) == 24


def test_four_justified_columns_read_down_each_column():
    out = plain(fx.four_columns())
    assert [int(n) for n in re.findall(r"\[(\d+)\]", out)] == list(range(1, 49))


def test_numbered_section_headings_stay_headings():
    """S1: "1. Introduction" in heading type became an ordered-list item."""
    out = plain(fx.numbered_headings())
    for section, sub, text in fx.NUMBERED_SECTIONS:
        assert f"## {section}\n\n### {sub}\n\n{text}" in out


def test_superscripts_are_marked_not_glued_to_their_numbers():
    """S2: 2019 with a footnote mark 3 came out as 20193."""
    out = plain(fx.superscripts())
    assert "4.2×10<sup>7</sup> m<sup>3</sup> in 2019<sup>3</sup>" in out
    assert "12 km<sup>2</sup> of catchment" in out


def test_right_to_left_text_keeps_its_order():
    """S3: the pieces of a Hebrew line were put in left-to-right order."""
    assert plain(fx.hebrew()).strip() == fx.HEBREW_SENTENCE


def test_addresses_side_by_side_stay_apart_and_label_rows_stay_rows():
    """S4: the bill-to and ship-to addresses were read line by line across."""
    out = plain(fx.invoice())
    lines = [line for line in out.splitlines() if line.strip()]
    bill = [i for i, line in enumerate(lines) if any(part in line for part in fx.BILL_TO[2:])]
    ship = [i for i, line in enumerate(lines) if "Riverside" in line or "LS10" in line]
    assert max(bill) < min(ship)
    for label, value in fx.INVOICE_META:
        assert f"**{label}** {value}" in out
    assert "| Description | Qty | Unit price | Amount |" in out


def test_a_table_ruled_only_under_its_header_keeps_its_header():
    """S13: with no rule above the column names, the first item became the header."""
    out = plain(fx.invoice(lined=False))
    assert "| Description | Qty | Unit price | Amount |\n| --- | --- | --- | --- |\n| Annual support plan (Gold) |" in out


@pytest.mark.parametrize("leading", [1.5, 2.0])
def test_paragraphs_at_one_and_a_half_or_double_spacing_stay_whole(leading):
    """S5: every line of a loosely spaced paragraph became a paragraph of its own."""
    out = plain(fx.spaced_lines(leading))
    assert [p.strip() for p in out.split("\n\n") if p.strip()] == fx.SPACED_PARAGRAPHS


@pytest.mark.parametrize("line_height", [1.3, 1.6])
def test_chinese_lines_join_without_a_space(line_height):
    out = plain(fx.chinese(line_height))
    assert out.strip() == fx.CHINESE


def test_a_wrapped_line_starting_with_a_dash_or_a_number_is_not_a_list_item():
    """S6: a dash or "12." at the start of a wrapped line began a list."""
    out = plain(fx.dash_wraps())
    assert "\n- " not in out and "\n12. " not in out and "\n\\- " not in out
    assert len([p for p in out.split("\n\n") if p.strip()]) == 1


def test_more_bullet_marks_make_list_items():
    """S7: arrows, boxes, stars, guillemets, middle dots and Word's Courier "o" were not marks."""
    out = plain(fx.bullet_variety())
    for _, text in fx.BULLET_VARIETY:
        assert f"- {text}" in out
    assert "- Market Street\n  - North side\n  - South side\n- Harbour Road" in out
    assert "`o`" not in out


def test_short_notes_between_small_tables_are_not_headings():
    """S8: the body size came from the table cells, so the notes looked like headings."""
    out = plain(fx.tables_and_notes())
    for q in range(1, 4):
        assert f"\nThe table below lists sales for quarter {q}.\n" in out
    assert "#" not in "\n".join(line for line in out.splitlines() if "table below" in line)


def test_a_picture_is_kept_on_a_page_whose_text_is_all_in_a_table():
    """S11: the page counted as having no text once the table took it."""
    out = plain(fx.picture_and_table())
    assert "[Image]" in out and "| Region | Hives |" in out


def test_thematic_break_lookalikes_stay_text():
    out = plain(fx.thematic_breaks())
    assert "\\---" in out and "\\___" in out and "\\*\\*\\*" in out


def test_a_truncated_pdf_is_called_damaged():
    """N1: the first half of a file was refused as having no pages."""
    with pytest.raises(worker.Refusal) as refusal:
        md(fx.truncated())
    assert refusal.value.kind in ("corrupt", "unreadable")


def test_a_page_drawing_too_much_is_converted_without_its_drawings(monkeypatch):
    """S9: the drawings were all read before their number was checked."""
    monkeypatch.setattr(worker, "MAX_TABLE_DRAWINGS", 1000)
    monkeypatch.setattr(worker, "MAX_CONTENT_BYTES", 50_000)
    calls = []
    original = fitz.Page.get_cdrawings
    monkeypatch.setattr(fitz.Page, "get_cdrawings", lambda self, *a, **k: calls.append(1) or original(self, *a, **k))
    out = plain(fx.many_strokes(20_000))
    assert "A map with many strokes." in out
    assert calls == []


# ── Limits and the worker process ────────────────────────────────────────────

def test_the_service_states_the_workers_limits():
    assert service.MAX_PAGES == worker.MAX_PAGES
    assert (service.CPU_SECONDS_BASE, service.CPU_SECONDS_PER_PAGE, service.CPU_SECONDS_MAX) == \
        (worker.CPU_SECONDS_BASE, worker.CPU_SECONDS_PER_PAGE, worker.CPU_SECONDS_MAX)
    assert (service.CHUNK_MIN, service.CHUNK_MAX, service.CHUNK_DEFAULT) == \
        (worker.CHUNK_MIN, worker.CHUNK_MAX, worker.CHUNK_DEFAULT)
    assert service.cpu_budget(100) == worker.cpu_budget(100) == 22
    assert service.cpu_budget(10_000) == worker.CPU_SECONDS_MAX


def test_the_page_states_the_services_limit_and_knows_its_scan_refusal():
    """The page states the page limit and answers a scan's refusal with a
    link to OCR PDF, by the refusal's exact words (N9)."""
    from pathlib import Path

    source = (Path(__file__).resolve().parents[2] / "frontend/src/components/tool-ui/pdf-to-markdown-report.ts").read_text()
    assert f"export const MAX_PAGES = {service.MAX_PAGES};" in source
    declared = re.search(r"export const SCAN_MESSAGE = (.*?);\n", source, re.S).group(1)
    assert "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', declared)) == service.SCAN_MESSAGE


def test_too_many_pages_is_refused_before_any_page_is_read():
    doc = fitz.open(stream=fx.many_pages(worker.MAX_PAGES + 1), filetype="pdf")
    with pytest.raises(worker.Refusal) as refusal:
        worker.convert(doc, worker.Options())
    assert refusal.value.kind == "too_many_pages"
    assert refusal.value.facts == {"pages": worker.MAX_PAGES + 1, "limit": worker.MAX_PAGES}


CAPS = """
import resource, sys
sys.argv = ["worker"]
sys.path.insert(0, {root!r})
from backend.app.services import _pdf_markdown_worker as w
w._isolate(1_000_000)
print(resource.getrlimit(resource.RLIMIT_AS)[0], *resource.getrlimit(resource.RLIMIT_CPU))
w._cap_cpu(100)
print(*resource.getrlimit(resource.RLIMIT_CPU), resource.getrlimit(resource.RLIMIT_CORE)[1])
"""


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="the address-space cap is set on Linux only")
def test_the_worker_caps_its_memory_and_cpu_time():
    from pathlib import Path

    root = str(Path(__file__).resolve().parents[2])
    out = subprocess.run([sys.executable, "-c", CAPS.format(root=root)], capture_output=True, text=True, check=True)
    first, second = (list(map(int, line.split())) for line in out.stdout.split("\n")[:2])
    assert first == [worker.MEMORY_BASE_BYTES + worker.MEMORY_PER_FILE_BYTE * 1_000_000, worker.CPU_SECONDS_OPEN,
                     worker.CPU_SECONDS_MAX + worker.CPU_GRACE]
    soft, hard, core = second
    # 100 pages: 22 seconds from what the process has spent so far, SIGXCPU at
    # the soft limit and SIGKILL 5 seconds later; never a core file.
    assert 22 < soft <= 24 and hard == soft + worker.CPU_GRACE and core == 0


def test_a_file_that_runs_out_of_cpu_time_is_stopped_by_the_kernel(tmp_path):
    """The real limit, made tiny: the worker dies of SIGXCPU, which the service reads as too much work."""
    probe = tmp_path / "probe.py"
    probe.write_text(
        "import resource\n"
        "resource.setrlimit(resource.RLIMIT_CPU, (1, 6))\n"
        "while True:\n    pass\n")
    started = time.monotonic()
    done = subprocess.run([sys.executable, "-I", str(probe)], check=False)
    assert done.returncode == -24  # SIGXCPU: its default action ends the process
    assert time.monotonic() - started < 10


# ── The route ────────────────────────────────────────────────────────────────

def post(client, data: bytes, name: str = "report.pdf", **fields):
    return client.post("/api/pdf-to-markdown", files={"file": (name, data, "application/pdf")},
                       data={k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in fields.items()})


def test_the_route_answers_with_markdown_and_a_report(client):
    resp = post(client, fx.sample_report())
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/markdown; charset=utf-8"
    assert 'filename="report.md"' in resp.headers["content-disposition"]
    assert resp.headers["cache-control"] == "no-store"
    facts = json.loads(resp.headers["x-markdown-report"])
    assert facts["pages"] == 2 and facts["tables"] == 1 and facts["chunks"] == 1
    assert "| Name | Role | Started |" in resp.text
    # API callers get no page markers, and nothing left out, unless they ask.
    assert "<!--" not in resp.text and fx.RUNNING_HEADER in resp.text and facts["headersFootersRemoved"] == 0


def test_the_route_reads_its_options(client):
    resp = post(client, fx.sample_report(), page_markers=True, remove_headers_footers=True)
    assert resp.status_code == 200
    assert resp.text.startswith("<!-- page 1 -->\n\n# Quarterly Engineering Notes")
    assert fx.RUNNING_HEADER not in resp.text
    assert json.loads(resp.headers["x-markdown-report"])["headersFootersRemoved"] == 2


def test_the_route_sends_chunks_as_a_zip(client):
    resp = post(client, fx.headers_and_footers(), chunk="headings", remove_headers_footers=True)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert 'filename="report_chunks.zip"' in resp.headers["content-disposition"]
    names = zipfile.ZipFile(io.BytesIO(resp.content)).namelist()
    assert names == ["001-sales.md", "002-stock.md", "003-staff.md", "004-outlook.md"]
    assert json.loads(resp.headers["x-markdown-report"])["chunks"] == 4


def test_the_route_sends_chunks_in_one_file_when_asked(client):
    resp = post(client, fx.headers_and_footers(), chunk="headings", chunk_output="single", remove_headers_footers=True)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/markdown; charset=utf-8"
    assert resp.text.count("<!-- chunk ") == 4


@pytest.mark.parametrize("fields", [
    {"chunk": "pages"}, {"chunk_output": "tar"}, {"chunk_size": 100}, {"chunk_size": 60000}, {"page_markers": "maybe"},
])
def test_the_route_refuses_options_it_does_not_know(client, fields):
    resp = post(client, fx.headings(), **fields)
    assert resp.status_code == 422


@pytest.mark.parametrize("name, data, words", [
    ("notes.txt", b"%PDF-1.7 not really", "Please upload a PDF"),
    ("in.pdf", b"", "empty"),
    ("in.pdf", b"PK\x03\x04 a zip file", "does not appear to be a PDF"),
])
def test_the_route_refuses_what_is_not_a_pdf(client, name, data, words):
    resp = post(client, data, name)
    assert resp.status_code == 400
    assert words in resp.json()["detail"]


@pytest.mark.parametrize("make, words", [
    (fx.encrypted, "password-protected"),
    (fx.damaged, "corrupt or invalid"),
    (fx.no_pages, "no pages to convert"),
])
def test_the_route_says_why_a_pdf_cannot_be_read(client, make, words):
    resp = post(client, make())
    assert resp.status_code == 400
    assert words in resp.json()["detail"]


def test_a_scan_is_refused_with_a_pointer_to_ocr(client):
    resp = post(client, fx.scanned())
    assert resp.status_code == 422
    assert resp.json()["detail"] == service.SCAN_MESSAGE
    assert "OCR PDF" in service.SCAN_MESSAGE


def test_blank_pages_are_refused_as_blank(client):
    resp = post(client, fx.blank_pages())
    assert resp.status_code == 422
    assert resp.json()["detail"] == service.BLANK_MESSAGE


def test_too_many_pages_is_refused_with_the_count_and_the_limit(client):
    resp = post(client, fx.many_pages(service.MAX_PAGES + 1))
    assert resp.status_code == 413
    detail = resp.json()["detail"]
    assert f"{service.MAX_PAGES + 1:,} pages" in detail and f"at most {service.MAX_PAGES:,}" in detail
    assert "Split PDF" in detail


def test_the_route_keeps_no_copy_of_the_upload_or_the_markdown(client):
    def ours():
        if not cleanup.TEMP_DIR.exists():
            return set()
        return set(cleanup.TEMP_DIR.glob("pdf2md_*")) | set(cleanup.TEMP_DIR.glob("markdown*"))

    before = ours()
    assert post(client, fx.sample_report()).status_code == 200
    assert post(client, fx.scanned()).status_code == 422
    assert ours() <= before


def _stub_worker(tmp_path, monkeypatch, body: str) -> None:
    stub = tmp_path / "stub_markdown_worker.py"
    stub.write_text(body)
    monkeypatch.setattr(service, "_WORKER", stub)


def test_a_conversion_that_never_finishes_is_stopped(client, monkeypatch, tmp_path):
    _stub_worker(tmp_path, monkeypatch, "import time\ntime.sleep(600)\n")
    monkeypatch.setattr(service, "TIME_LIMIT_SECONDS", 1)
    started = time.monotonic()
    resp = post(client, fx.headings())
    assert resp.status_code == 504
    assert time.monotonic() - started < 15


def test_a_conversion_out_of_cpu_time_is_a_422_that_says_so(client, monkeypatch, tmp_path):
    _stub_worker(tmp_path, monkeypatch, "import os, signal\nos.kill(os.getpid(), signal.SIGXCPU)\n")
    resp = post(client, fx.headings())
    assert resp.status_code == 422
    assert resp.json()["detail"] == service.TOO_SLOW_MESSAGE


@pytest.mark.parametrize("body", [
    "print('{\"ok\": false, \"error\": \"too_large\"}')\n",
    "import os, signal\nos.kill(os.getpid(), signal.SIGSEGV)\n",
    "import os, signal\nos.kill(os.getpid(), signal.SIGKILL)\n",
], ids=["says-so", "crashed", "killed"])
def test_a_conversion_out_of_memory_is_a_413(client, monkeypatch, tmp_path, body):
    """S9: running out of memory under the limit can crash MuPDF rather than
    raise, so a worker killed without an answer is a 413 too."""
    _stub_worker(tmp_path, monkeypatch, body)
    resp = post(client, fx.headings())
    assert resp.status_code == 413
    assert "Split PDF" in resp.json()["detail"]


def test_a_page_drawing_a_great_deal_converts_without_its_drawings(client):
    """S9: a page drawing a million strokes crashed the worker while it listed
    them; a page past the content limit is now converted without them."""
    resp = post(client, fx.many_strokes(120_000))
    assert resp.status_code == 200
    assert resp.text.strip() == "A map with many strokes."


@pytest.mark.parametrize("body", [
    "print('not json')\n",
    "print('{\"ok\": true}')\n",
    "print('{\"ok\": false, \"error\": \"too_many_pages\"}')\n",
], ids=["garbage", "ok-without-output", "refusal-without-counts"])
def test_a_conversion_that_fails_gives_a_500(client, monkeypatch, tmp_path, body):
    _stub_worker(tmp_path, monkeypatch, body)
    resp = post(client, fx.headings())
    assert resp.status_code == 500


def test_the_report_header_stays_short(monkeypatch):
    big = {"pages": 1000, "pagesWithoutText": list(range(1, 1001)), "pagesNotRead": list(range(1, 400)),
           "removedLines": ["x" * 500] * 5, "chunks": 300, "characters": 10 ** 7}
    header = service.report_header(big)
    assert len(header) < 1024
    facts = json.loads(header)
    assert facts["pagesWithoutTextCount"] == 1000 and len(facts["pagesWithoutText"]) == 20
    assert len(facts["removedLines"]) == 3 and all(len(line) <= 80 for line in facts["removedLines"])


def test_the_page_can_read_the_report_across_origins():
    from backend.app.middleware.cors import SITE_EXPOSED_HEADERS

    assert "X-Markdown-Report" in SITE_EXPOSED_HEADERS


def test_the_v1_api_serves_the_same_conversion(client):
    from backend.app.api_v1 import catalog, quota
    from backend.app.main import app

    paths = {route.path for route in catalog.public_routes(app)}
    assert "/api/v1/pdf-to-markdown" in paths
    assert quota.cost_for("/api/v1/pdf-to-markdown") == quota.HEAVY_COST
    assert catalog.metadata("/api/v1/pdf-to-markdown")["response_media"] == ["application/zip", "text/markdown"]
    constraints = " ".join(catalog.CONSTRAINTS["/pdf-to-markdown"])
    assert f"more than {service.MAX_PAGES:,} pages" in constraints and "422" in constraints and "413" in constraints
