# Analizador del HTML principal: recursos, formularios, iframes, enlaces.
import re
from urllib.parse import urljoin

from ..patterns import URL_RE, is_static_path

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None


def _abs(base, ref):
    try:
        return urljoin(base, ref)
    except Exception:
        return ref


class HtmlAnalysis:
    def __init__(self):
        self.scripts_external = []      # [{src, abs}]
        self.inline_scripts = []        # [text,...]
        self.css = []                   # [{href, abs}]
        self.images = []
        self.iframes = []
        self.forms = []                 # [{action, method, inputs:[..]}]
        self.links = []                 # [{href, rel}]
        self.all_urls = []              # cualquier URL vista en atributos/texto
        self.meta = {}

    def to_dict(self):
        return {
            "scripts_external": self.scripts_external,
            "inline_scripts_count": len(self.inline_scripts),
            "inline_scripts_chars": sum(len(s) for s in self.inline_scripts),
            "css": self.css,
            "images": self.images[:50],
            "iframes": self.iframes,
            "forms": self.forms,
            "links_count": len(self.links),
            "meta": self.meta,
        }


def analyze_html(html_text: str, base_url: str) -> HtmlAnalysis:
    a = HtmlAnalysis()
    if BeautifulSoup is None:  # pragma: no cover
        return a
    soup = BeautifulSoup(html_text, "html.parser")

    for sc in soup.find_all("script"):
        src = sc.get("src")
        if src:
            absu = _abs(base_url, src)
            a.scripts_external.append({"src": src, "abs": absu})
        else:
            txt = sc.get_text()
            if txt.strip():
                a.inline_scripts.append(txt)

    for ln in soup.find_all("link"):
        href = ln.get("href")
        rel = ln.get("rel") or []
        if href:
            absu = _abs(base_url, href)
            a.links.append({"href": href, "abs": absu, "rel": list(rel)})
            if "stylesheet" in rel:
                a.css.append({"href": href, "abs": absu})

    for im in soup.find_all("img"):
        src = im.get("src") or im.get("data-src")
        if src:
            a.images.append(_abs(base_url, src))

    for fr in soup.find_all("iframe"):
        src = fr.get("src")
        if src:
            a.iframes.append({"src": src, "abs": _abs(base_url, src)})

    for form in soup.find_all("form"):
        f = {
            "action": form.get("action") or "",
            "abs_action": _abs(base_url, form.get("action")) if form.get("action") else "",
            "method": (form.get("method") or "get").upper(),
            "inputs": [],
        }
        for inp in form.find_all(["input", "select", "textarea", "button"]):
            f["inputs"].append({
                "name": inp.get("name"),
                "type": inp.get("type") or inp.name,
                "id": inp.get("id"),
                "value": (inp.get("value") or "")[:200] if inp.get("value") else None,
            })
        a.forms.append(f)

    m = soup.find("meta", attrs={"http-equiv": True})
    if m:
        a.meta["http-equiv"] = m.get("content")
    title = soup.find("title")
    a.meta["title"] = title.get_text().strip() if title else ""
    for attr in ("action", "href", "src", "data-url", "data-href"):
        for tag in soup.find_all(attrs={attr: True}):
            v = tag.get(attr)
            if v and re.match(r"^(https?:)?//|\w+:", v) is None and v.startswith(("/", "./", "../", "?")):
                a.all_urls.append(_abs(base_url, v))

    a.all_urls = list(dict.fromkeys(a.all_urls))
    return a


def collect_html_endpoints(a: HtmlAnalysis, origin: str):
    """Candidatos endpoint desde el HTML (form actions + urls de atributos)."""
    eps = []
    for f in a.forms:
        if f["abs_action"]:
            eps.append({"path": f["abs_action"], "method": f["method"], "ctx": "form action"})
    for u in a.all_urls:
        if is_static_path(u):
            continue
        if u.startswith(origin):
            eps.append({"path": u, "method": "", "ctx": "html attr"})
    out = {}
    for e in eps:
        key = e["path"]
        if key not in out:
            out[key] = e
    return list(out.values())
