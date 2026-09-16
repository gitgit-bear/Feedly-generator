import os
import sys

WD_EXPORT_FORMAT_PDF = 17
WD_FORMAT_PDF = 17


def export_pdf(src: str, dst: str) -> None:
    src = os.path.abspath(src)
    dst = os.path.abspath(dst)
    if not os.path.isfile(src):
        raise FileNotFoundError(src)
    folder = os.path.dirname(dst)
    if folder:
        os.makedirs(folder, exist_ok=True)
    if os.path.isfile(dst):
        try:
            os.remove(dst)
        except OSError:
            pass

    import win32com.client  # type: ignore

    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    try:
        word.DisplayAlerts = 0
    except Exception:
        pass
    document = None
    try:
        document = word.Documents.Open(src, False, True, False)
        try:
            document.ExportAsFixedFormat(dst, WD_EXPORT_FORMAT_PDF)
        except Exception:
            try:
                document.SaveAs2(dst, FileFormat=WD_FORMAT_PDF)
            except Exception:
                document.SaveAs(dst, FileFormat=WD_FORMAT_PDF)
        if not os.path.isfile(dst):
            raise RuntimeError("Word did not write the PDF file")
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


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: word_export_pdf.py <input.doc(x)> <output.pdf>", file=sys.stderr)
        return 2
    export_pdf(sys.argv[1], sys.argv[2])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
