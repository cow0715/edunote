"""Read native PDF glyphs from stdin. Output positions and marks, without field assignments."""
import json
import math
import struct
import sys
from ctypes import byref, cast, c_double, c_float, c_int, c_size_t, c_ubyte, c_uint, c_void_p

import pypdfium2 as pdfium
import pypdfium2.raw as api


def font_marks(font):
    size = c_size_t()
    if not font or not api.FPDFFont_GetIsEmbedded(font):
        return None
    if not api.FPDFFont_GetFontData(font, None, 0, byref(size)) or size.value < 12:
        return None
    buffer = (c_ubyte * size.value)()
    if not api.FPDFFont_GetFontData(font, buffer, size.value, byref(size)):
        return None
    data = bytes(buffer)
    if data[:4] not in (b"\0\1\0\0", b"OTTO", b"true"):
        return None
    count = min(struct.unpack_from(">H", data, 4)[0], (len(data) - 12) // 16)
    tables = {tag: data[offset:offset + length] for tag, _, offset, length in
              struct.iter_unpack(">4sIII", data[12:12 + 16 * count])}
    head = tables.get(b"head", b"")
    os2 = tables.get(b"OS/2", b"")
    post = tables.get(b"post", b"")
    if len(head) < 46 and len(os2) < 64:
        return None
    mac = struct.unpack_from(">H", head, 44)[0] if len(head) >= 46 else 0
    selection = struct.unpack_from(">H", os2, 62)[0] if len(os2) >= 64 else 0
    weight = struct.unpack_from(">H", os2, 4)[0] if len(os2) >= 6 else 0
    angle = struct.unpack_from(">i", post, 4)[0] if len(post) >= 8 else 0
    return bool(mac & 1 or selection & 32 or 650 <= weight <= 1000), bool(mac & 2 or selection & 1 or angle)


def underline_strokes(page):
    for obj in page.get_objects(filter=[api.FPDF_PAGEOBJ_PATH], max_depth=1):
        fill, stroke, width = c_int(), c_int(), c_float()
        if api.FPDFPath_CountSegments(obj) != 2:
            continue
        if not api.FPDFPath_GetDrawMode(obj, byref(fill), byref(stroke)) or not stroke.value:
            continue
        rgba = [c_uint() for _ in range(4)]
        if not api.FPDFPageObj_GetStrokeColor(obj, *map(byref, rgba)) or any(v.value for v in rgba[:3]) or not rgba[3].value:
            continue
        matrix = obj.get_matrix()
        if not api.FPDFPageObj_GetStrokeWidth(obj, byref(width)) or not 0 < width.value * math.hypot(matrix.a, matrix.b) <= 1.5:
            continue
        points = []
        for index in range(2):
            segment = api.FPDFPath_GetPathSegment(obj, index)
            x, y = c_float(), c_float()
            if not api.FPDFPathSegment_GetPoint(segment, byref(x), byref(y)):
                break
            points.append((matrix.a*x.value + matrix.c*y.value + matrix.e,
                           matrix.b*x.value + matrix.d*y.value + matrix.f))
        if len(points) == 2:
            (left, y), (right, y2) = sorted(points)
            if right - left >= 2 and abs(y - y2) < .4:
                yield left, right, (y + y2) / 2


def read_page(page):
    width, height = page.get_size()
    strokes = list(underline_strokes(page))
    text = page.get_textpage()
    fonts, glyphs, issues = {}, [], set()
    seen = set()
    if any(page.get_objects(filter=[api.FPDF_PAGEOBJ_FORM], max_depth=1)):
        issues.add("nested_graphics_requires_visual_check")
    try:
        codes = [api.FPDFText_GetUnicode(text, index) for index in range(text.count_chars())]
        skip_low = False
        for index, code in enumerate(codes):
            if skip_low:
                skip_low = False
                continue
            # PDFium can expose one UTF-16 code unit per index for a printed glyph.
            if 0xD800 <= code <= 0xDFFF:
                low = codes[index + 1] if index + 1 < len(codes) else 0
                if 0xD800 <= code <= 0xDBFF and 0xDC00 <= low <= 0xDFFF:
                    code = 0x10000 + ((code - 0xD800) << 10) + low - 0xDC00
                    skip_low = True
                else:
                    code = 0xFFFD
            if not code or code > 0x10FFFF:
                continue
            char = chr(code)
            if char.isspace() and (char not in (" ", "\u00a0") or api.FPDFText_IsGenerated(text, index)):
                continue
            x, y = c_double(), c_double()
            if not api.FPDFText_GetCharOrigin(text, index, byref(x), byref(y)):
                issues.add("missing_glyph_position")
                continue
            if abs(api.FPDFText_GetCharAngle(text, index)) > .01:
                issues.add("rotated_text_requires_visual_check")
            if code == 0xFFFD:
                issues.add("unreadable_native_characters")
            left, bottom, right, top = text.get_charbox(index, loose=True)
            identity = (char, x.value, y.value)
            if identity in seen:
                continue
            seen.add(identity)
            obj = api.FPDFText_GetTextObject(text, index)
            font = api.FPDFTextObj_GetFont(obj) if obj else None
            key = cast(font, c_void_p).value if font else None
            if key not in fonts:
                fonts[key] = font_marks(font)
            if fonts[key] is None:
                issues.add("font_style_requires_visual_check")
            bold, italic = fonts[key] or (False, False)
            center = (left + right) / 2
            underline = any(.3 <= y.value - sy <= 4.5 and sx - .12 <= center <= ex + .12 for sx, ex, sy in strokes)
            glyphs.append(dict(str=char, x=x.value, y=y.value, width=max(0, right - x.value),
                               height=max(0, top - bottom), bold=bold, italic=italic, underline=underline))
    finally:
        text.close()
    if sum(not glyph["str"].isspace() for glyph in glyphs) < 20:
        issues.add("insufficient_native_text_requires_ocr")
    return dict(width=width, height=height, glyphs=glyphs, issues=sorted(issues))


if __name__ == "__main__":
    document = pdfium.PdfDocument(sys.stdin.buffer.read())
    try:
        if not 1 <= len(document) <= 4:
            raise ValueError("PDFium expects a 1–4 page slice")
        pages = []
        for index in range(len(document)):
            page = document[index]
            try:
                pages.append(read_page(page))
            finally:
                page.close()
        json.dump(pages, sys.stdout, separators=(",", ":"), allow_nan=False)
    finally:
        document.close()
