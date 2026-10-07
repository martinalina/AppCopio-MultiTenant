#!/usr/bin/env python3
"""
Genera docs/AppCopio_Guia_Multitenant_RLS.pdf a partir de las guías en Markdown.

Une, en este orden:
  Parte 1 -> docs/07_conceptos_multitenant_para_principiantes.md
  Parte 2 -> docs/00_guia_rls_desde_cero.md
con portada, instrucciones de uso e índice con números de página.

Requisitos:  pip install markdown pygments pypdf   (y Google Chrome o Edge instalado)
Uso:         python scripts/generar_guia_pdf.py [--paper letter|a4]
"""
import argparse
import datetime
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown
from pygments.formatters import HtmlFormatter
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = DOCS / "AppCopio_Guia_Multitenant_RLS.pdf"

PARTES = [
    ("Parte 1", "Conceptos desde cero", DOCS / "07_conceptos_multitenant_para_principiantes.md"),
    ("Parte 2", "Profundización técnica", DOCS / "00_guia_rls_desde_cero.md"),
]

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "chromium", "chromium-browser", "microsoft-edge",
]

CSS = r"""
@page { size: %(paper)s; margin: 20mm 17mm 22mm 17mm;
  @bottom-left   { content: "AppCopio multi-tenant · Guía de estudio"; font: 8pt 'Segoe UI', Calibri, sans-serif; color: #666; }
  @bottom-right  { content: counter(page); font: 9pt 'Segoe UI', Calibri, sans-serif; color: #333; } }
@page :first { @bottom-left { content: none; } @bottom-right { content: none; } }

* { box-sizing: border-box; }
html { font-family: 'Segoe UI', Calibri, Arial, sans-serif; font-size: 10.2pt; line-height: 1.5; color: #111; }
body { margin: 0; }
h1, h2, h3, h4 { color: #000; line-height: 1.25; break-after: avoid; }
h1 { font-size: 21pt; margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 2.2pt solid #000; }
h2 { font-size: 15pt; margin: 9mm 0 3mm; padding-bottom: 1.2mm; border-bottom: 0.8pt solid #888; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; }
h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; }
p { margin: 0 0 2.6mm; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1mm; }
hr { border: 0; border-top: 0.6pt solid #aaa; margin: 5mm 0; }
a { color: inherit; text-decoration: none; }
strong { font-weight: 700; }

code { font-family: 'Cascadia Mono', Consolas, 'Courier New', monospace; font-size: 8.8pt;
  background: #f0f0f0; border: 0.4pt solid #d0d0d0; border-radius: 2pt; padding: 0 1.2mm; overflow-wrap: break-word; }

.codehilite, pre.plain { margin: 0 0 3.5mm; background: #f7f7f7; border: 0.6pt solid #bdbdbd; border-left: 2.2pt solid #555;
  border-radius: 2pt; break-inside: avoid; }
.codehilite.long, pre.plain.long { break-inside: auto; }
.codehilite pre, pre.plain { margin: 0; padding: 2.4mm 3mm; font-family: 'Cascadia Mono', Consolas, 'Courier New', monospace;
  font-size: 7.9pt; line-height: 1.38; white-space: pre-wrap; overflow-wrap: anywhere; }
pre.plain { margin: 0 0 3.5mm; }
.codehilite pre code { background: none; border: 0; padding: 0; font-size: inherit; overflow-wrap: anywhere; }
.codehilite.diagram pre { white-space: pre; font-size: 7.3pt; line-height: 1.25; overflow-wrap: normal; }

blockquote { margin: 0 0 3.5mm; padding: 2.2mm 4mm; border-left: 2.6pt solid #000; background: #eeeeee; break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }

table { width: 100%%; border-collapse: collapse; margin: 1mm 0 4mm; font-size: 8.9pt; line-height: 1.38; }
th, td { border: 0.6pt solid #888; padding: 1.4mm 2mm; vertical-align: top; text-align: left; overflow-wrap: break-word; }
th { background: #dcdcdc; font-weight: 700; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
td code, th code { font-size: 8pt; }

/* portada */
.cover { height: 235mm; display: flex; flex-direction: column; justify-content: center; break-after: page; }
.cover .kicker { font-size: 11pt; letter-spacing: 2pt; text-transform: uppercase; color: #444; margin-bottom: 6mm; }
.cover h1 { font-size: 34pt; border: 0; padding: 0; margin: 0 0 5mm; line-height: 1.1; }
.cover .sub { font-size: 14pt; color: #222; margin-bottom: 14mm; max-width: 150mm; line-height: 1.4; }
.cover .rule { border-top: 3pt solid #000; width: 40mm; margin-bottom: 8mm; }
.cover table.meta { width: auto; font-size: 10pt; margin: 0; }
.cover table.meta td { border: 0; border-bottom: 0.5pt solid #bbb; padding: 1.6mm 6mm 1.6mm 0; }
.cover table.meta td:first-child { font-weight: 700; color: #333; }

.front { break-after: page; }
.front h1 { font-size: 19pt; }

/* índice */
.toc { break-after: page; }
.toc h1 { font-size: 19pt; }
.toc .part { font-weight: 700; font-size: 11.5pt; margin: 5mm 0 1.5mm; border-bottom: 1pt solid #000; padding-bottom: .8mm; display: flex; justify-content: space-between; }
.toc .e { display: flex; align-items: baseline; font-size: 9.4pt; line-height: 1.45; }
.toc .e .t { flex: 0 1 auto; overflow-wrap: anywhere; }
.toc .e .dots { flex: 1 1 auto; border-bottom: 0.7pt dotted #777; margin: 0 1.5mm; transform: translateY(-1.2pt); min-width: 6mm; }
.toc .e .n { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.toc .l2 { font-weight: 600; margin-top: 0.9mm; }
.toc .l3 { padding-left: 6mm; font-size: 9pt; }

/* inicio de cada parte */
.book-start { break-before: page; }
.book-start .banner { font-size: 10pt; letter-spacing: 1.6pt; text-transform: uppercase; color: #555; margin-bottom: 2mm; }
.book:first-of-type .book-start { break-before: auto; }
%(pygments)s
/* Pygments: en impresión se prefieren tonos oscuros y legibles en escala de grises */
.codehilite .c, .codehilite .c1, .codehilite .cm { color: #555; font-style: italic; }
.codehilite .k, .codehilite .kd, .codehilite .kn, .codehilite .kr, .codehilite .kt, .codehilite .kc { color: #000; font-weight: 700; }
.codehilite .s, .codehilite .s1, .codehilite .s2, .codehilite .sa { color: #222; }
.codehilite .err { border: 0; color: inherit; background: none; }
"""


def find_browser():
    for b in BROWSERS:
        p = shutil.which(b) or (b if os.path.exists(b) else None)
        if p:
            return p
    sys.exit("No encontré Chrome ni Edge. Instálalo o ajusta BROWSERS en el script.")


def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return ""


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def render_md(path, prefix):
    md = markdown.Markdown(
        extensions=["fenced_code", "tables", "sane_lists", "toc",
                    "codehilite"],
        extension_configs={"codehilite": {"guess_lang": False, "css_class": "codehilite"}},
    )
    body = md.convert(path.read_text(encoding="utf-8"))

    heads = []

    def reid(m):
        lvl, text = int(m.group(1)), m.group(3)
        hid = f"{prefix}-{len(heads)}"
        heads.append((lvl, hid, strip_tags(text)))
        return f'<h{lvl} id="{hid}">{text}</h{lvl}>'

    body = re.sub(r'<h([1-3])( id="[^"]*")?>(.*?)</h\1>', reid, body, flags=re.S)

    def mark(m):
        block = m.group(0)
        inner = strip_tags(block)
        cls = "codehilite"
        if re.search(r"[│┌└┐┘├┤▼▲]", inner):
            cls += " diagram"
        if inner.count("\n") > 34:
            cls += " long"
        return block.replace('<div class="codehilite">', f'<div class="{cls}">', 1)

    body = re.sub(r'<div class="codehilite">.*?</div>', mark, body, flags=re.S)
    # bloques sin lenguaje que codehilite deja como <pre><code>
    body = re.sub(r"<pre><code>", '<pre class="plain"><code>', body)
    return body, heads


def build_html(paper, page_numbers=None, front_only=False):
    from pygments.formatters import HtmlFormatter
    pyg = HtmlFormatter(style="default", cssclass="codehilite").get_style_defs(".codehilite")

    books, all_heads = [], []
    for i, (tag, nombre, path) in enumerate(PARTES):
        body, heads = render_md(path, f"p{i}")
        all_heads.append((tag, nombre, path, heads))
        # inserta el banner de "Parte N" antes del h1 de cada parte
        body = re.sub(r"(<h1 id=)", f'<div class="banner">{tag} · {nombre}</div>\\1', body, count=1)
        books.append(f'<section class="book"><div class="book-start">{body}</div></section>')

    # índice
    toc = ['<section class="toc"><h1>Índice</h1>']
    for tag, nombre, path, heads in all_heads:
        toc.append(f'<div class="part"><span>{tag} · {nombre}</span><span></span></div>')
        for lvl, hid, text in heads:
            if lvl == 1:
                continue
            n = "" if page_numbers is None else page_numbers.get(hid, "")
            n = n or "00"
            toc.append(
                f'<div class="e l{lvl}"><span class="t">{html.escape(text)}</span>'
                f'<span class="dots"></span><span class="n">{n}</span></div>')
    toc.append("</section>")

    commit = git("rev-parse", "--short", "HEAD")
    dirty = bool(git("status", "--porcelain", "--", "db", "backend", "frontend", "scripts"))
    estado = f"commit {commit}" + (" + cambios sin commitear" if dirty else "") if commit else "—"
    rama = git("rev-parse", "--abbrev-ref", "HEAD") or "—"
    hoy = datetime.date.today().strftime("%d-%m-%Y")

    cover = f"""
<section class="cover">
  <div class="kicker">AppCopio · Migración multi-tenant</div>
  <h1>Guía de estudio:<br>RLS, roles, middlewares<br>y todo lo que los rodea</h1>
  <div class="sub">Qué es cada concepto, por qué se usó y dónde está en el código.
    Escrita para quien parte de cero.</div>
  <div class="rule"></div>
  <table class="meta">
    <tr><td>Contenido</td><td>Parte 1 · Conceptos desde cero<br>Parte 2 · Profundización técnica</td></tr>
    <tr><td>Rama</td><td>{html.escape(rama)}</td></tr>
    <tr><td>Estado del código</td><td>{html.escape(estado)}</td></tr>
    <tr><td>Generado</td><td>{hoy}</td></tr>
  </table>
</section>

<section class="front">
  <h1>Cómo usar esta guía</h1>
  <p>Este PDF reúne dos documentos del repositorio, en el orden en que conviene estudiarlos:</p>
  <table>
    <tr><th>Parte</th><th>Archivo de origen</th><th>Para qué sirve</th></tr>
    <tr><td><strong>Parte 1</strong></td><td><code>docs/07_conceptos_multitenant_para_principiantes.md</code></td>
        <td>Los cimientos y cada concepto, uno por uno (qué es → por qué hace falta → dónde está), sin
            asumir ningún conocimiento previo. <strong>Empieza aquí.</strong></td></tr>
    <tr><td><strong>Parte 2</strong></td><td><code>docs/00_guia_rls_desde_cero.md</code></td>
        <td>La misma historia con más profundidad: código SQL y TypeScript completo, los tropiezos reales
            (P1, P2, P19, P38/P39…) y la validación paso a paso.</td></tr>
  </table>
  <h3>Ruta de estudio sugerida</h3>
  <ol>
    <li>Lee la <strong>Parte 1</strong> completa, en orden. Las secciones A a C son lo esencial; si solo
        tienes tiempo para una, que sea la C.</li>
    <li>Con <code>backend/src/auth/tenantContext.ts</code> y <code>backend/src/config/db.ts</code> abiertos,
        relee la sección C: son cortos y el código calza con el texto.</li>
    <li>Pasa a la <strong>Parte 2</strong> cuando quieras ver el detalle y por qué fallaron las primeras
        versiones.</li>
  </ol>
  <h3>Qué verás repetido (a propósito)</h3>
  <p>Ambas partes explican RLS, <code>appcopio_app</code>, <code>withTenant</code> y <code>SECURITY DEFINER</code>.
     La Parte 1 lo hace desde cero y con analogías; la Parte 2, con el código real y los errores que lo
     moldearon. Leerlo dos veces desde ángulos distintos ayuda a fijarlo.</p>
  <h3>Qué no está en este PDF</h3>
  <p>El catálogo completo de los 40 problemas numerados está en
     <code>docs/02_implementacion_tecnica.md</code>, y los guiones de validación en
     <code>docs/03_guion_de_validacion.md</code> y <code>scripts/validar_multitenant.sh</code>. Son material de
     consulta, no de estudio lineal. Las reglas duras del proyecto están en <code>CLAUDE.md</code>.</p>
  <blockquote><p><strong>Vigencia:</strong> el contenido describe el código en el estado indicado en la portada.
     Si el esquema o los middlewares cambian, edita los <code>.md</code> y vuelve a generar el PDF con
     <code>python scripts/generar_guia_pdf.py</code>.</p></blockquote>
</section>
"""
    parts = [cover] if front_only else []
    if front_only:
        parts.append("".join(toc))
    else:
        parts += [cover, "".join(toc), "".join(books)]
    css = CSS % {"paper": paper, "pygments": pyg}
    doc = f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>AppCopio · Guía multi-tenant</title><style>{css}</style></head><body>{"".join(parts)}</body></html>'
    return doc, all_heads


def to_pdf(browser, html_text, out_pdf, tmp):
    f = Path(tmp) / "guia.html"
    f.write_text(html_text, encoding="utf-8")
    profile = Path(tmp) / "profile"
    cmd = [browser, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}",
           "--no-pdf-header-footer", "--print-to-pdf-no-header-footer",
           f"--print-to-pdf={out_pdf}", f.as_uri()]
    subprocess.run(cmd, check=True, capture_output=True, timeout=240)
    if not Path(out_pdf).exists():
        sys.exit("Chrome no generó el PDF.")


def norm(s):
    return re.sub(r"[^a-z0-9áéíóúñ]", "", s.lower())


def locate_pages(pdf_path, heads_by_part, start_page):
    reader = PdfReader(str(pdf_path))
    pages = [norm(p.extract_text() or "") for p in reader.pages]
    found, cur = {}, start_page
    for _, _, _, heads in heads_by_part:
        for lvl, hid, text in heads:
            key = norm(text)[:28]
            for i in range(cur, len(pages)):
                if key and key in pages[i]:
                    found[hid] = i + 1
                    cur = i
                    break
    return found, len(pages)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper", default="letter", choices=["letter", "a4"])
    args = ap.parse_args()
    paper = {"letter": "Letter", "a4": "A4"}[args.paper]
    browser = find_browser()

    with tempfile.TemporaryDirectory() as tmp:
        # 1) cuántas páginas ocupa la parte frontal (portada + instrucciones + índice)
        front_html, _ = build_html(paper, front_only=True)
        front_pdf = Path(tmp) / "front.pdf"
        to_pdf(browser, front_html, front_pdf, tmp)
        n_front = len(PdfReader(str(front_pdf)).pages)

        # 2) pasada 1: documento completo con índice sin números
        full_html, heads = build_html(paper)
        pass1 = Path(tmp) / "pass1.pdf"
        to_pdf(browser, full_html, pass1, tmp)
        nums, total = locate_pages(pass1, heads, n_front)

        faltan = [t for _, _, _, hs in heads for l, h, t in hs if l > 1 and h not in nums]
        if faltan:
            print("Aviso: no ubiqué estos títulos en el PDF (sin número en el índice):", *faltan, sep="\n  - ")

        # 3) pasada 2: con los números de página en el índice
        final_html, _ = build_html(paper, page_numbers=nums)
        to_pdf(browser, final_html, OUT, tmp)

    n = len(PdfReader(str(OUT)).pages)
    print(f"OK: {OUT.relative_to(ROOT)}  ({n} páginas, papel {paper}, parte frontal {n_front} págs.)")


if __name__ == "__main__":
    main()
