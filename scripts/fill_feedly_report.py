# Fill the locked Feedly News Letter .doc the same way CyberGuardNews.exe does.
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

WD_FORMAT_PDF = 17
WD_EXPORT_FORMAT_PDF = 17

BODY_FONT = "Cambria"
HEADING_FONT = "MicrosoftYaHei"
FONT_SIZE = 13
NIL_TEXT = "Nil"
TITLE_COLOR = 79 + (79 << 8) + (79 << 16)
SOURCE_COLOR = 18 + (162 << 8) + (198 << 16)
LINK_COLOR = 0 + (0 << 8) + (255 << 16)
EN_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


@dataclass(frozen=True)
class ReportArticle:
    title: str
    source: str
    url: str


def _english_newsletter_date() -> str:
    now = __import__("datetime").datetime.now().astimezone()
    return f"{now.day} {EN_MONTHS[now.month - 1]} {now.year}"


def _is_nil(item: Optional[ReportArticle]) -> bool:
    if item is None:
        return True
    title = (item.title or "").strip()
    url = (item.url or "").strip()
    return (not title or title == NIL_TEXT) and (not url or url == NIL_TEXT)


def _word_one_line(text: str) -> str:
    return (text or "").replace("\r", " ").replace("\n", " ").replace("\v", " ").replace("\x07", "")


def _word_cell_content_range(cell: Any) -> Any:
    rng = cell.Range.Duplicate
    rng.MoveEnd(1, -1)
    text = rng.Text or ""
    while text.endswith("\x07") and int(rng.End) > int(rng.Start):
        rng.MoveEnd(1, -1)
        text = rng.Text or ""
    return rng


def _word_fix_hyperlink_addresses(doc: Any, urls: List[str]) -> None:
    known = sorted((u.strip() for u in urls if isinstance(u, str) and u.startswith("http")), key=len, reverse=True)
    if not known:
        return
    try:
        count = int(doc.Hyperlinks.Count)
    except Exception:
        return
    for i in range(1, count + 1):
        try:
            hl = doc.Hyperlinks(i)
            addr = (hl.Address or "").strip()
        except Exception:
            continue
        if not addr:
            continue
        stripped = addr.rstrip("/")
        for url in known:
            if url == addr:
                break
            if url.startswith(stripped) and len(url) > len(stripped):
                try:
                    hl.Address = url
                except Exception:
                    pass
                break


def _word_disable_auto_links(word: Any) -> None:
    try:
        word.Options.AutoFormatAsYouTypeReplaceHyperlinks = False
        word.Options.AutoFormatReplaceHyperlinks = False
    except Exception:
        pass
    try:
        word.Options.AutoFormatAsYouTypeReplaceInternetAndNetworkPaths = False
    except Exception:
        pass


def _word_delete_hyperlinks_in_range(doc: Any, start: int, end: int) -> None:
    try:
        count = int(doc.Hyperlinks.Count)
    except Exception:
        return
    for i in range(count, 0, -1):
        try:
            hl = doc.Hyperlinks(i)
            hl_start = int(hl.Range.Start)
            hl_end = int(hl.Range.End)
        except Exception:
            continue
        if hl_end <= start or hl_start >= end:
            continue
        try:
            hl.Delete()
        except Exception:
            pass


def _word_apply_cell_run_style(doc: Any, start: int, length: int, cell_end: int, color: int, href: Optional[str] = None) -> None:
    if length <= 0:
        return
    end = min(start + length, cell_end)
    if end <= start:
        return
    rng = doc.Range(start, end)
    rng.Font.Color = color
    if not href:
        return
    try:
        rng.NoProofing = True
    except Exception:
        pass
    _word_delete_hyperlinks_in_range(doc, start, end)
    try:
        hl = doc.Hyperlinks.Add(Anchor=rng, Address=href)
        try:
            hl.Address = href
        except Exception:
            pass
        rng.Font.Color = color
        rng.Font.Underline = 1
    except Exception:
        rng.Font.Underline = 1


def _word_write_article_in_one_cell(cell: Any, item: Optional[ReportArticle], *, section: bool) -> None:
    if _is_nil(item):
        content = _word_cell_content_range(cell)
        content.Text = NIL_TEXT
        try:
            content.Font.Italic = 1
            content.Font.Name = BODY_FONT
            content.Font.Size = FONT_SIZE
        except Exception:
            pass
        return
    assert item is not None
    title = _word_one_line(item.title or NIL_TEXT)
    source = _word_one_line(f"{item.source or NIL_TEXT} ")
    url = _word_one_line(item.url or NIL_TEXT)
    br = "\v"
    payload = f"{title}{br}{url}{br}" if section else f"{title}{br}{source}{br}{url}{br}"
    content = _word_cell_content_range(cell)
    content.Text = payload
    inner = _word_cell_content_range(cell)
    doc = cell.Range.Document
    cell_end = int(cell.Range.End) - 1
    start = int(inner.Start)
    _word_apply_cell_run_style(doc, start, len(title), cell_end, TITLE_COLOR)
    if section:
        _word_apply_cell_run_style(doc, start + len(title) + 1, len(url), cell_end, LINK_COLOR, url)
        return
    src_at = start + len(title) + 1
    _word_apply_cell_run_style(doc, src_at, len(source), cell_end, SOURCE_COLOR)
    _word_apply_cell_run_style(doc, src_at + len(source) + 1, len(url), cell_end, LINK_COLOR, url)


def _word_write_number_in_cell(cell: Any, text: str, proto_cell: Any = None) -> None:
    content = _word_cell_content_range(cell)
    content.Text = text
    try:
        if proto_cell is not None:
            proto = _word_cell_content_range(proto_cell)
            content.Font.Name = proto.Font.Name
            try:
                content.Font.NameFarEast = proto.Font.NameFarEast
            except Exception:
                pass
            content.Font.Size = proto.Font.Size
            content.Font.Bold = proto.Font.Bold
            content.Font.Italic = proto.Font.Italic
            return
        content.Font.Name = HEADING_FONT
        content.Font.Size = FONT_SIZE
        content.Font.Bold = 0
        content.Font.Italic = 0
    except Exception:
        pass


def _word_insert_row_after(table: Any, row_index: int) -> int:
    row = table.Rows(row_index)
    row.Select()
    table.Application.Selection.InsertRowsBelow(1)
    return row_index + 1


def _word_plain_cell_text(cell: Any) -> str:
    return (cell.Range.Text or "").replace("\r", "").replace("\x07", "").replace("\t", "").strip()


def _word_find_table_row(table: Any, needle: str) -> Optional[int]:
    want = (needle or "").strip().lower()
    for row in range(1, int(table.Rows.Count) + 1):
        try:
            text = _word_plain_cell_text(table.Cell(row, 1)).lower()
        except Exception:
            continue
        if want in text:
            return row
    return None


def _word_clear_table_borders(table: Any) -> None:
    try:
        table.Borders.Enable = False
    except Exception:
        pass
    try:
        table.Borders.InsideLineStyle = 0
        table.Borders.OutsideLineStyle = 0
    except Exception:
        pass


def _word_section_slot_rows(table: Any, heading_row: int) -> List[int]:
    slots: List[int] = []
    for row in range(heading_row + 1, int(table.Rows.Count) + 1):
        try:
            left = _word_plain_cell_text(table.Cell(row, 1))
        except Exception:
            break
        if "intelligence from" in left.lower():
            break
        right = ""
        try:
            right = _word_plain_cell_text(table.Cell(row, 2))
        except Exception:
            pass
        if not left and not right:
            break
        slots.append(row)
    return slots


def _word_fill_section_numbered_rows(table: Any, heading_row: int, items: List[ReportArticle]) -> None:
    real = [item for item in items if not _is_nil(item)]
    slots = _word_section_slot_rows(table, heading_row)
    if not slots:
        return
    want: List[Optional[ReportArticle]] = real if real else [None]
    proto = table.Cell(slots[0], 1)
    used = min(len(want), len(slots))
    for i in range(used):
        rows_before = int(table.Rows.Count)
        _word_write_number_in_cell(table.Cell(slots[i], 1), f"{i + 1}.", proto)
        _word_write_article_in_one_cell(table.Cell(slots[i], 2), want[i], section=True)
        if int(table.Rows.Count) != rows_before:
            raise RuntimeError("Word split a section table; refusing to save broken layout")
    for row in reversed(slots[used:]):
        rows_before = int(table.Rows.Count)
        table.Rows(row).Delete()
        if int(table.Rows.Count) != rows_before - 1:
            raise RuntimeError("Word split a section table; refusing to save broken layout")
    last_row = heading_row + used
    for n, item in enumerate(want[used:], start=used + 1):
        rows_before = int(table.Rows.Count)
        last_row = _word_insert_row_after(table, last_row)
        if int(table.Rows.Count) != rows_before + 1:
            raise RuntimeError("Word split a section table; refusing to save broken layout")
        _word_write_number_in_cell(table.Cell(last_row, 1), f"{n}.", proto)
        _word_write_article_in_one_cell(table.Cell(last_row, 2), item, section=True)
        if int(table.Rows.Count) != rows_before + 1:
            raise RuntimeError("Word split a section table; refusing to save broken layout")


def _word_refresh_header(doc: Any, stamp: str) -> None:
    header = doc.Sections(1).Headers(1)
    for shape in header.Shapes:
        try:
            rng = shape.TextFrame.TextRange
            current = rng.Text or ""
            match = re.search(r"\d{1,2}\s+[A-Za-z]+\s+\d{4}", current)
            if not match or match.group(0) == stamp:
                continue
            old = match.group(0)
            finder = rng.Find
            finder.ClearFormatting()
            finder.Replacement.ClearFormatting()
            replaced = finder.Execute(
                old,
                False,
                False,
                False,
                False,
                False,
                True,
                0,
                False,
                stamp,
                1,
            )
            if not replaced:
                start = int(rng.Start) + match.start()
                sub = rng.Duplicate
                sub.SetRange(start, start + len(old))
                sub.Text = stamp
        except Exception:
            continue


def _word_export_document_pdf(document: Any, pdf_path: str) -> None:
    dst = os.path.abspath(pdf_path)
    folder = os.path.dirname(dst)
    if folder:
        os.makedirs(folder, exist_ok=True)
    if os.path.isfile(dst):
        try:
            os.remove(dst)
        except OSError:
            pass
    try:
        document.ExportAsFixedFormat(dst, WD_EXPORT_FORMAT_PDF)
    except Exception:
        try:
            document.SaveAs2(dst, FileFormat=WD_FORMAT_PDF)
        except Exception:
            document.SaveAs(dst, FileFormat=WD_FORMAT_PDF)
    if not os.path.isfile(dst):
        raise RuntimeError("Word did not write the PDF file")


def _as_article(raw: Any) -> Optional[ReportArticle]:
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or "").strip()
    source = str(raw.get("source") or "").strip()
    url = str(raw.get("url") or "").strip()
    if (not title or title == NIL_TEXT) and (not url or url == NIL_TEXT):
        return None
    return ReportArticle(title=title or NIL_TEXT, source=source or NIL_TEXT, url=url or NIL_TEXT)


def _as_list(raw: Any) -> List[ReportArticle]:
    if not isinstance(raw, list):
        return []
    out: List[Optional[ReportArticle]] = [_as_article(x) for x in raw]
    return [x for x in out if x is not None]


def fill_template(template_path: str, out_path: str, payload: Dict[str, Any]) -> str:
    src = os.path.abspath(template_path)
    dst = os.path.abspath(out_path)
    if not os.path.isfile(src):
        raise FileNotFoundError(src)
    if os.path.normcase(src) == os.path.normcase(dst):
        raise ValueError("Refusing to overwrite the locked Feedly blank form")
    shutil.copy2(src, dst)

    import win32com.client  # type: ignore

    stamp = str(payload.get("dateStamp") or _english_newsletter_date())
    top_items_raw = payload.get("topItems") or []
    items: List[Optional[ReportArticle]] = []
    if isinstance(top_items_raw, list):
        items = [_as_article(x) for x in top_items_raw]
    while len(items) < 10:
        items.append(None)
    items = items[:10]

    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    try:
        word.DisplayAlerts = 0
    except Exception:
        pass
    _word_disable_auto_links(word)
    document = None
    try:
        document = word.Documents.Open(dst, False, False, False)
        try:
            document.AutoHyphenation = False
        except Exception:
            pass
        _word_refresh_header(document, stamp)

        if int(document.Tables.Count) >= 1:
            top_table = document.Tables(1)
            top_rows = int(top_table.Rows.Count)
            slots = min(10, max(0, top_rows - 1))
            for n in range(slots):
                _word_write_article_in_one_cell(top_table.Cell(n + 2, 2), items[n], section=False)
                if int(top_table.Rows.Count) != top_rows:
                    raise RuntimeError("Word split the TOP 10 table; refusing to save broken layout")
            _word_clear_table_borders(top_table)

        if int(document.Tables.Count) >= 2:
            sec_table = document.Tables(2)
            for heading, key in (
                ("Intelligence from HKCERT", "hkItems"),
                ("Intelligence from GovCERT.HK", "govItems"),
                ("Intelligence from Cybersechub", "cyberItems"),
            ):
                row = _word_find_table_row(sec_table, heading)
                if row is None or row >= int(sec_table.Rows.Count):
                    continue
                _word_fill_section_numbered_rows(sec_table, row, _as_list(payload.get(key)))
            _word_clear_table_borders(sec_table)

        try:
            document.BuiltInDocumentProperties("Title").Value = os.path.splitext(os.path.basename(dst))[0]
        except Exception:
            pass
        urls = [
            item.url
            for item in items + _as_list(payload.get("hkItems")) + _as_list(payload.get("govItems")) + _as_list(payload.get("cyberItems"))
            if item and item.url
        ]
        _word_fix_hyperlink_addresses(document, urls)
        document.Save()
        pdf_path = os.path.splitext(dst)[0] + ".pdf"
        _word_export_document_pdf(document, pdf_path)
        document.Close(False)
        document = None
        return pdf_path
    finally:
        if document is not None:
            try:
                document.Close(False)
            except Exception:
                pass
        try:
            word.Quit()
        except Exception:
            pass


def _with_lock(fn: Callable[[], None]) -> None:
    lock_path = os.path.join(tempfile.gettempdir(), "cyberguard_feedly_word.lock")
    deadline = time.time() + 90
    while True:
        try:
            handle = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            break
        except FileExistsError:
            if time.time() > deadline:
                raise RuntimeError("Timed out waiting for Word export lock")
            try:
                age = time.time() - os.path.getmtime(lock_path)
                if age > 180:
                    os.remove(lock_path)
                    continue
            except OSError:
                pass
            time.sleep(0.4)
    try:
        fn()
    finally:
        os.close(handle)
        try:
            os.remove(lock_path)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--payload", required=True)
    parser.add_argument("--out-doc", required=True)
    args = parser.parse_args()
    with open(args.payload, encoding="utf-8") as f:
        payload = json.load(f)

    def run() -> None:
        pdf_path = fill_template(args.template, args.out_doc, payload)
        print(json.dumps({"ok": True, "doc": os.path.abspath(args.out_doc), "pdf": os.path.abspath(pdf_path)}))

    try:
        _with_lock(run)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
