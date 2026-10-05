"""Form Creator: a radio field in the payload becomes a working radio group.

The UI sends one entry per radio field: one box and a list of options
(`buildPayload` in FormCreatorUI.tsx). The route made a single widget per entry
and switched it on through PyMuPDF, whose `Page.add_widget` reads the new
widget's `Parent/Kids` before the widget has an xref, so every radio field
returned 500. A radio group is one field whose kids are its buttons, one per
option, each button naming its option as its "on" appearance state.
"""

from __future__ import annotations

import io
import json

import fitz  # PyMuPDF
import pikepdf
import pytest

# What FormCreatorUI's buildPayload() sends for a new field switched to Radio.
UI_RADIO = {
    "name": "field_1", "type": "radio", "page": 1,
    "x": 72, "y": 102, "width": 220, "height": 24,
    "required": False, "options": ["Option 1", "Option 2"], "value": "Option 1",
}


def _blank_pdf() -> bytes:
    doc = fitz.open()
    doc.new_page()
    return doc.tobytes()


def _post(client, route: str, pdf: bytes, data: dict | None = None):
    return client.post(
        f"/api/{route}",
        files={"file": ("form.pdf", pdf, "application/pdf")},
        data=data or {},
    )


def _create(client, fields: list[dict]):
    return _post(client, "form-creator", _blank_pdf(), {"form_fields": json.dumps(fields)})


def _on_state(widget) -> str:
    (state,) = [key for key in widget.AP.N.keys() if key != "/Off"]
    return state


def _ink(page, rect: fitz.Rect) -> int:
    """Dark pixels drawn inside `rect` (top-left page coordinates)."""
    pix = page.get_pixmap(dpi=144, clip=rect)
    return sum(1 for i in range(0, len(pix.samples), pix.n) if pix.samples[i] < 110)


def test_ui_radio_payload_creates_one_field_with_a_button_per_option(client):
    resp = _create(client, [UI_RADIO])
    assert resp.status_code == 200, resp.text

    pdf = pikepdf.open(io.BytesIO(resp.content))
    (group,) = pdf.Root.AcroForm.Fields
    assert str(group.T) == "field_1"
    assert str(group.FT) == "/Btn"
    assert int(group.Ff) & (1 << 15), "not flagged as a radio field"
    assert str(group.V) == "/Option 1"

    kids = list(group.Kids)
    assert [_on_state(kid) for kid in kids] == ["/Option 1", "/Option 2"]
    assert [str(kid.AS) for kid in kids] == ["/Option 1", "/Off"]
    assert all(kid.Parent.objgen == group.objgen for kid in kids)
    on_page = {annot.objgen for annot in pdf.pages[0].Annots}
    assert {kid.objgen for kid in kids} <= on_page

    # The buttons inherit the field's keys. They must not carry their own, not
    # even as null: pikepdf reads a null entry as absent, but PDFium (Chrome's
    # viewer) stops at a null /FT and does not see a radio button.
    doc = fitz.open(stream=resp.content, filetype="pdf")
    for kid in kids:
        assert not {"FT", "Ff", "T", "TU", "V"} & set(doc.xref_get_keys(kid.objgen[0]))


def test_required_radio_group_is_flagged_required(client):
    resp = _create(client, [{**UI_RADIO, "required": True}])
    assert resp.status_code == 200, resp.text
    pdf = pikepdf.open(io.BytesIO(resp.content))
    (group,) = pdf.Root.AcroForm.Fields
    assert int(group.Ff) & (1 << 1)


def test_fields_are_added_in_reading_order_whatever_order_they_come_in(client):
    """Viewers move between fields in the order they were added, and the page
    sends them in the order they were placed or accepted ("full_name, phone,
    riverside, date_of_birth" after accepting one, then the rest). They are
    added page by page, in rows from the top of the page as it is shown, and
    left to right within a row."""
    doc = fitz.open()
    doc.new_page()
    doc.new_page().set_rotation(90)
    text = {"type": "text", "width": 120, "height": 18, "required": False, "value": "", "multiline": False}
    fields = [
        {"name": "lower_as_shown", "page": 2, "x": 300, "y": 200, **text},  # turned a quarter: a larger x is lower
        {"name": "phone", "page": 1, "x": 72, "y": 300, **text},
        {"name": "full_name", "page": 1, "x": 72, "y": 100, **text},
        {"name": "agree", "type": "checkbox", "page": 1, "x": 300, "y": 103, "width": 12, "height": 12, "required": False},
        {"name": "upper_as_shown", "page": 2, "x": 100, "y": 200, **text},
    ]
    resp = _post(client, "form-creator", doc.tobytes(), {"form_fields": json.dumps(fields), "reading_order": "true"})
    assert resp.status_code == 200, resp.text
    with fitz.open(stream=resp.content, filetype="pdf") as out:
        assert [[w.field_name for w in page.widgets()] for page in out] == [
            ["full_name", "agree", "phone"], ["upper_as_shown", "lower_as_shown"],
        ]


def test_an_api_caller_keeps_the_order_it_sent_unless_it_asks_for_reading_order(client):
    """The page asks for reading order; an API caller who sends a deliberate
    tab order keeps it, as before reading order existed."""
    doc = fitz.open()
    doc.new_page()
    text = {"type": "text", "width": 120, "height": 18, "required": False, "value": "", "multiline": False}
    fields = [
        {"name": "second_line", "page": 1, "x": 72, "y": 300, **text},
        {"name": "first_line", "page": 1, "x": 72, "y": 100, **text},
    ]
    resp = _post(client, "form-creator", doc.tobytes(), {"form_fields": json.dumps(fields)})
    assert resp.status_code == 200, resp.text
    with fitz.open(stream=resp.content, filetype="pdf") as out:
        assert [w.field_name for w in out[0].widgets()] == ["second_line", "first_line"]


def test_a_bad_field_is_still_named_by_its_place_in_the_request(client):
    fields = [{"name": "a", "type": "text", "page": 1, "x": 72, "y": 300, "width": 100, "height": 18},
              {"name": "b", "type": "text", "page": 3, "x": 72, "y": 100, "width": 100, "height": 18}]
    resp = _create(client, fields)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Field #2 references page 3 but PDF has 1 pages"


def test_every_field_type_the_ui_offers_is_created(client):
    def field(n: int, kind: str, **extra) -> dict:
        return {"name": f"field_{n}", "type": kind, "page": 1, "x": 72, "y": 72 + n * 40,
                "width": 220, "height": 24, "required": False, **extra}

    resp = _create(client, [
        field(1, "text", value="", multiline=False),
        field(2, "checkbox", checked=True),
        field(3, "radio", options=["Option 1", "Option 2"], value="Option 1"),
        field(4, "combobox", options=["Option 1", "Option 2"], value="Option 1"),
        field(5, "listbox", options=["Option 1", "Option 2"], value="Option 1"),
        field(6, "signature"),
    ])
    assert resp.status_code == 200, resp.text

    doc = fitz.open(stream=resp.content, filetype="pdf")
    widgets = [(w.field_name, w.field_type_string) for w in doc[0].widgets()]
    assert widgets == [
        ("field_1", "Text"),
        ("field_2", "CheckBox"),
        ("field_3", "RadioButton"),
        ("field_3", "RadioButton"),
        ("field_4", "ComboBox"),
        ("field_5", "ListBox"),
        ("field_6", "Signature"),
    ]


@pytest.mark.parametrize("box", [(72, 100, 300, 24), (72, 100, 120, 90)], ids=["wide", "tall"])
def test_buttons_and_labels_stay_inside_the_drawn_box(client, box):
    x, y, width, height = box
    options = ["Yes", "No", "Not applicable at this time"]
    resp = _create(client, [{**UI_RADIO, "x": x, "y": y, "width": width, "height": height,
                             "options": options, "value": "Yes"}])
    assert resp.status_code == 200, resp.text

    page = fitz.open(stream=resp.content, filetype="pdf")[0]
    drawn = fitz.Rect(x, y, x + width, y + height)
    inside = drawn + (-0.01, -0.01, 0.01, 0.01)
    buttons = [w.rect for w in page.widgets()]
    assert len(buttons) == 3
    assert all(inside.contains(button) for button in buttons)
    for i, first in enumerate(buttons):
        for second in buttons[i + 1:]:
            assert (first & second).is_empty, "buttons overlap"

    # Every option is labelled on the page, inside the box.
    assert page.get_text().split() == " ".join(options).split()
    assert all(inside.contains(fitz.Rect(word[:4])) for word in page.get_text("words"))


def test_each_label_sits_beside_its_own_button(client):
    # "Search engine" has to shrink to fit its third of the box.
    options = ["Friend", "Search engine", "Not applicable at this time"]
    resp = _create(client, [{**UI_RADIO, "width": 230, "height": 60, "options": options, "value": "Friend"}])
    assert resp.status_code == 200, resp.text
    page = fitz.open(stream=resp.content, filetype="pdf")[0]
    buttons = [w.rect for w in page.widgets()]
    labels = [page.search_for(option)[0] for option in options]
    for button, label in zip(buttons, labels):
        assert label.x0 >= button.x1
        assert label.y0 < button.y1 and label.y1 > button.y0
    for label, next_button in zip(labels, buttons[1:]):
        assert next_button.x0 - label.x1 >= 3, "a label runs into the next option's button"


def test_default_option_is_drawn_selected(client):
    resp = _create(client, [{**UI_RADIO, "value": "Option 2"}])
    assert resp.status_code == 200, resp.text
    page = fitz.open(stream=resp.content, filetype="pdf")[0]
    first, second = (w.rect for w in page.widgets())
    assert _ink(page, second) > _ink(page, first) + 40


def test_option_names_with_spaces_and_accents_round_trip(client):
    options = ["Oui", "Très bien", "Non merci"]
    created = _create(client, [{**UI_RADIO, "options": options, "value": "Très bien"}])
    assert created.status_code == 200, created.text

    fields = _post(client, "fill-form/fields", created.content).json()["fields"]
    assert fields == [{"name": "field_1", "type": "radio", "value": "Très bien", "options": options}]


def test_radio_group_can_be_filled_and_flattened(client):
    created = _create(client, [UI_RADIO])
    assert created.status_code == 200, created.text
    first, second = (w.rect for w in fitz.open(stream=created.content, filetype="pdf")[0].widgets())

    filled = _post(client, "fill-form", created.content, {"field_values": json.dumps({"field_1": "Option 2"})})
    assert filled.status_code == 200, filled.text
    flat = _post(client, "flatten", filled.content)
    assert flat.status_code == 200, flat.text

    doc = fitz.open(stream=flat.content, filetype="pdf")
    assert list(doc[0].widgets()) == []
    assert _ink(doc[0], second) > _ink(doc[0], first) + 40, "the chosen option is not the one drawn selected"


def _pdf_with_a_form(indirect_fields: bool) -> bytes:
    """A PDF that already has a text field, its AcroForm stored as an object of
    its own, as most producers write it, and optionally its /Fields array too."""
    doc = fitz.open()
    widget = fitz.Widget()
    widget.field_name, widget.field_type = "existing", fitz.PDF_WIDGET_TYPE_TEXT
    widget.rect = fitz.Rect(72, 400, 300, 424)
    widget.field_value = "Keep me"
    doc.new_page().add_widget(widget)
    pdf = pikepdf.open(io.BytesIO(doc.tobytes()))
    acroform = pdf.make_indirect(pikepdf.Dictionary(pdf.Root.AcroForm))
    if indirect_fields:
        acroform.Fields = pdf.make_indirect(pikepdf.Array(list(acroform.Fields)))
    pdf.Root.AcroForm = acroform
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


@pytest.mark.parametrize("indirect_fields", [False, True], ids=["fields-in-acroform", "fields-own-object"])
def test_radio_group_joins_a_pdfs_existing_form(client, indirect_fields):
    resp = _post(client, "form-creator", _pdf_with_a_form(indirect_fields), {"form_fields": json.dumps([UI_RADIO])})
    assert resp.status_code == 200, resp.text

    pdf = pikepdf.open(io.BytesIO(resp.content))
    fields = {str(f.T): f for f in pdf.Root.AcroForm.Fields}
    assert sorted(fields) == ["existing", "field_1"]
    assert str(fields["existing"].V) == "Keep me"
    assert len(fields["field_1"].Kids) == 2


@pytest.mark.parametrize(
    "fields",
    [
        [{**UI_RADIO, "value": "Option 3"}],
        [{**UI_RADIO, "options": ["Yes", "Yes"], "value": "Yes"}],
        [{**UI_RADIO, "options": ["On", "Off"], "value": "On"}],
        [{**UI_RADIO}, {**UI_RADIO, "y": 200}],
        [{**UI_RADIO}, {**UI_RADIO, "type": "text", "y": 200, "value": ""}],
        [{**UI_RADIO, "y": 20 + 30 * i, "name": f"q{i}", "options": [f"o{n}" for n in range(50)], "value": "o0"}
         for i in range(7)],
    ],
    ids=["value-not-an-option", "repeated-option", "option-named-off", "repeated-radio-name",
         "radio-name-used-by-text-field", "more-than-300-buttons"],
)
def test_rejects_radio_fields_that_cannot_form_a_group(client, fields):
    assert _create(client, fields).status_code == 400
