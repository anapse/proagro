# Análisis de referencias SignalR / WebSocket en el frontend.
# Solo observación estática + lo que el navegador muestre en ejecución.
import re

HUB_NAME_RE = re.compile(r"createHubProxy\s*\(\s*['\"]([^'\"]+)['\"]|hubProxy\s*=\s*['\"]([^'\"]+)['\"]")
HUB_URL_RE = re.compile(r"['\"`]([^'\"`]*signalr[^'\"`]*)['\"`]")
CLIENT_METHOD_RE = re.compile(r"\.client\.\s*([A-Za-z0-9_]+)")
SERVER_CALL_RE = re.compile(r"\.server\.\s*([A-Za-z0-9_]+)")
NEW_ON_RE = re.compile(r"\.on\s*\(\s*['\"]([^'\"]+)['\"]")
NEW_INVOKE_RE = re.compile(r"\.invoke\s*\(\s*['\"]([^'\"]+)['\"]")


def analyze(text: str, source: str = ""):
    out = {
        "present": False, "style": None, "hub_urls": [], "hub_names": [],
        "client_methods": [], "server_calls": [], "events": [], "snippets": [],
    }
    if not text:
        return out
    has_old = bool(re.search(r"signalR|\.connection\.|hubProxy", text))
    has_new = bool(re.search(r"HubConnectionBuilder|signalR\.", text))
    if not (has_old or has_new):
        return out
    out["present"] = True
    out["style"] = "clásico (jQuery signalR)" if has_old and not has_new else (
        "moderno (@microsoft/signalr)" if has_new else "indefinido")

    for u in HUB_URL_RE.findall(text):
        if u not in out["hub_urls"]:
            out["hub_urls"].append(u)
    for m in HUB_NAME_RE.finditer(text):
        name = m.group(1) or m.group(2)
        if name and name not in out["hub_names"]:
            out["hub_names"].append(name)
    for m in CLIENT_METHOD_RE.finditer(text):
        if m.group(1) not in out["client_methods"]:
            out["client_methods"].append(m.group(1))
    for m in SERVER_CALL_RE.finditer(text):
        if m.group(1) not in out["server_calls"]:
            out["server_calls"].append(m.group(1))
    if has_new:
        for m in NEW_ON_RE.finditer(text):
            if m.group(1) not in out["events"]:
                out["events"].append(m.group(1))
        for m in NEW_INVOKE_RE.finditer(text):
            if m.group(1) not in out["server_calls"]:
                out["server_calls"].append(m.group(1))

    for m in re.finditer(r".{0,80}(signalR|HubConnection|hubProxy|\.server\.|\.client\.).{0,110}", text):
        out["snippets"].append(m.group(0).strip())
        if len(out["snippets"]) >= 12:
            break
    return out
