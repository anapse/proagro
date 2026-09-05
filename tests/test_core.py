# Tests de núcleo — sin red (offline). Para ejecutar:
#   .venv/Scripts/python -m unittest discover -s tests -v
import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from forensics.engine import js_scanner, html_analyzer, silent, signalr
from forensics.engine.endpoints import build_endpoint_rows
from forensics.engine.network_probe import parse_ranking, diff_ranking_bodies
from forensics import patterns as P


class TestScanner(unittest.TestCase):
    def test_ajax_and_fetch_discovery(self):
        js = """
        function carga(){
          $.ajax({ url: '/QrKgAra/ObtenerRankingVista', method: 'GET', data: { top: 5000 }});
        }
        var u = '/QrKgAra/ObtenerLotes';
        fetch('/api/consultar', {method:'POST'});
        $.getJSON('/QrKgAra/ObtenerVariedades');
        axios.post('/QrKgAra/GuardarKg', {kilos: 12});
        var ws = new WebSocket('wss://digital.proagro.pe/hub');
        """
        s = js_scanner.scan_js(js, "test.js")
        vals = [c["value"] for c in s.url_candidates]
        self.assertIn("/QrKgAra/ObtenerRankingVista", vals)
        self.assertIn("/QrKgAra/ObtenerLotes", vals)
        self.assertIn("/api/consultar", vals)
        methods = {c["url"]: c["method"] for c in s.ajax_calls}
        self.assertEqual(methods.get("/api/consultar"), "POST")
        self.assertEqual(methods.get("/QrKgAra/GuardarKg"), "POST")
        self.assertTrue(s.api_usage)
        self.assertTrue(s.signalr_hits or s.websockets)

    def test_keywords_kg(self):
        js = "var kgTotal = peso + kgDescarte; // cosechador registra kg del lote"
        s = js_scanner.scan_js(js, "k.js")
        self.assertGreater(s.keyword_counts.get("kg", 0), 0)
        self.assertGreater(s.keyword_counts.get("peso", 0), 0)
        self.assertGreater(s.keyword_counts.get("cosecha", 0), 0)

    def test_websocket_capture(self):
        js = "var c = new WebSocket('wss://x.proagro.pe/socket');"
        s = js_scanner.scan_js(js, "ws.js")
        self.assertEqual(s.websockets, ["wss://x.proagro.pe/socket"])


class TestSilent(unittest.TestCase):
    def test_empty_catch(self):
        js = """try { enviar(); } catch (e) {}"""
        f = silent.scan_silent_patterns(js, "a.js")
        types = [x["pattern"] for x in f]
        self.assertIn("catch-vacio", types)

    def test_fetch_without_ok(self):
        js = "fetch('/api/x').then(r => r.json()).then(d => pintar(d));"
        f = silent.scan_silent_patterns(js, "b.js")
        self.assertTrue(any(x["pattern"] == "fetch-sin-ok" for x in f))

    def test_clean_code_no_catch_finding(self):
        js = ("fetch('/api/x').then(r=>{ if(!r.ok) throw 1; }).catch(e=>{ mostrar(e); });"
              "try { a(); } catch (e) { console.error(e); }")
        f = silent.scan_silent_patterns(js, "c.js")
        self.assertEqual([x for x in f if x["pattern"] == "catch-vacio"], [])


class TestEndpoints(unittest.TestCase):
    def test_classification_and_write_note(self):
        cands = [
            {"value": "/QrKgAra/ObtenerRankingVista", "kind": "root-path",
             "method": "", "file": "a.js", "line": 3, "snippet": "url: '/QrKgAra/ObtenerRankingVista'"},
            {"value": "/QrKgAra/GuardarKg", "kind": "ajax-obj", "method": "POST",
             "file": "a.js", "line": 9, "snippet": "url:'/QrKgAra/GuardarKg'"},
            {"value": "https://digital.proagro.pe/Content/file/LogoCompleto.png",
             "kind": "full-url", "method": "", "file": "a.js", "line": 1, "snippet": ""},
            {"value": "/QrKgAra/ObtenerLotes?x=1", "kind": "qr-path", "method": "",
             "file": "b.js", "line": 1, "snippet": ""},
        ]
        rows = build_endpoint_rows(cands, {})
        paths = {r["path"] for r in rows}
        self.assertIn("/QrKgAra/ObtenerRankingVista", paths)
        self.assertIn("/QrKgAra/GuardarKg", paths)
        self.assertNotIn("LogoCompleto.png", str(paths))
        g = next(r for r in rows if r["path"] == "/QrKgAra/GuardarKg")
        self.assertIn("escritura", g["notes"])
        self.assertEqual(g["method"], "POST")
        rk = next(r for r in rows if r["path"] == "/QrKgAra/ObtenerRankingVista")
        self.assertIn("lectura", rk["notes"])

    def test_observed_overrides(self):
        cands = [{"value": "/QrKgAra/ObtenerRankingVista", "kind": "ajax-literal",
                  "method": "GET", "file": "a.js", "line": 1, "snippet": ""}]
        rows = build_endpoint_rows(cands, {"/QrKgAra/ObtenerRankingVista":
                                           {"status": 200, "method": "GET"}})
        self.assertEqual(rows[0]["classification"], "OBSERVADO")
        self.assertEqual(rows[0]["status"], "200")

    def test_action_helpers(self):
        self.assertTrue(P.is_read_action("ObtenerRankingVista"))
        self.assertTrue(P.is_write_action("GuardarKg"))
        self.assertFalse(P.is_read_action("GuardarKg"))


class TestRanking(unittest.TestCase):
    SAMPLE = {"ranking": [
        {"posicion": 1, "nombre": "C", "kgExportable": 12.0, "kgDescarte": 0, "kgTotal": 12.0},
        {"posicion": 2, "nombre": "A", "kgExportable": 10.5, "kgDescarte": 0, "kgTotal": 10.5},
        {"posicion": 3, "nombre": "B", "kgExportable": 0, "kgDescarte": 3.2, "kgTotal": 3.2},
    ], "lotes": [{"cod": "1", "desc": "X"}], "variedades": []}

    def test_parse(self):
        st = parse_ranking(json.dumps(self.SAMPLE).encode())
        self.assertTrue(st["json_ok"])
        self.assertEqual(st["records"], 3)
        self.assertEqual(st["sum_kgExportable"], 22.5)
        self.assertEqual(st["sum_kgDescarte"], 3.2)
        self.assertEqual(st["sum_kgTotal"], 25.7)
        self.assertEqual(st["ordering_violations"], 0)

    def test_parse_invalid(self):
        st = parse_ranking(b"no json")
        self.assertFalse(st["json_ok"])

    def test_ordering_violation(self):
        bad = {"ranking": [
            {"posicion": 1, "nombre": "A", "kgTotal": 10},
            {"posicion": 2, "nombre": "B", "kgTotal": 20},
        ]}
        st = parse_ranking(json.dumps(bad).encode())
        self.assertEqual(st["ordering_violations"], 1)

    def test_diff(self):
        b = copy.deepcopy(self.SAMPLE)
        b["ranking"][0]["kgTotal"] = 99
        d = diff_ranking_bodies(json.dumps(self.SAMPLE).encode(),
                                json.dumps(b).encode())
        self.assertEqual(len(d["changed"]), 1)
        self.assertEqual(d["changed"][0]["posicion"], 1)


class TestHtml(unittest.TestCase):
    def test_analyze(self):
        html = """
        <html><head><script src="/Scripts/app.js"></script>
        <link rel="stylesheet" href="/Content/site.css">
        </head><body>
        <script>var x = 1;</script>
        <form action="/QrKgAra/BuscarKg" method="post">
          <input name="dni" type="text"><button>Buscar</button>
        </form>
        <iframe src="/otra/pagina"></iframe>
        <img src="/Content/file/LogoCompleto.png">
        </body></html>"""
        a = html_analyzer.analyze_html(html, "https://digital.proagro.pe/QrKgAra/QrKgAra")
        self.assertEqual(len(a.scripts_external), 1)
        self.assertEqual(len(a.inline_scripts), 1)
        self.assertEqual(len(a.css), 1)
        self.assertEqual(len(a.forms), 1)
        self.assertEqual(a.forms[0]["abs_action"],
                         "https://digital.proagro.pe/QrKgAra/BuscarKg")
        self.assertEqual(a.forms[0]["method"], "POST")
        self.assertEqual(len(a.iframes), 1)


class TestSignalr(unittest.TestCase):
    def test_old_hub(self):
        js = """
        var hub = $.connection.cosechaHub;
        hub.client.actualizarRanking = function (d) {};
        $.connection.hub.start();
        """
        r = signalr.analyze(js, "hub.js")
        self.assertTrue(r["present"])
        self.assertEqual(r["client_methods"], ["actualizarRanking"])
        self.assertIn("cosechaHub", js)

    def test_absent(self):
        r = signalr.analyze("var a = 1;", "x.js")
        self.assertFalse(r["present"])


class TestDb(unittest.TestCase):
    def test_roundtrip(self):
        import forensics.db as dbm
        with tempfile.TemporaryDirectory() as td:
            old = dbm.DB_PATH
            dbm.DB_PATH = Path(td) / "t.db"
            try:
                dbm.init_db()
                pid = dbm.insert("projects", {"name": "P", "url": "http://x",
                                              "created_at": "now"})
                self.assertGreater(pid, 0)
                row = dbm.q1("SELECT * FROM projects WHERE id=?", (pid,))
                self.assertEqual(row["name"], "P")
                dbm.update("projects", pid, {"url": "http://y"})
                self.assertEqual(dbm.q1("SELECT url FROM projects WHERE id=?", (pid,))["url"],
                                 "http://y")
            finally:
                dbm.DB_PATH = old


if __name__ == "__main__":
    unittest.main()
