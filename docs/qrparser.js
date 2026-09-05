/* qrparser.js — parser FLEXIBLE de contenido QR de PROAGRO.
   No asume un formato único: detecta DNI, fecha, lote, variedad, registro,
   cuadrilla, grupo, jefe, kg… cuando existan (texto plano o JSON). */
(function (root) {
  "use strict";

  var CLAVES_CONOCIDAS = [
    "dni", "documento", "doc", "fecha", "date", "dia", "lote", "variedad",
    "registro", "cosecha", "cuadrilla", "grupo", "jefe", "kg", "peso", "turno",
    "hora", "nombre", "trabajador", "codigo", "cod", "nro", "numero", "zona",
    "fundo", "linea", "linea2", "tarjeta", "paquete", "nave", "tipo", "jaba",
    "unidad", "celda", "sector", "cosechador", "apellidos", "trabajadores",
  ];

  function parseFechaTexto(txt) {
    // devuelve {display, iso} o null. Acepta yyyy-mm-dd, dd/mm/yyyy, dd-mm-yy…
    txt = String(txt || "").trim();
    var m;
    var iso = null;
    m = txt.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);   // yyyy-…
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) iso = y + "-" + pad(mo) + "-" + pad(d);
    }
    if (!iso) {
      m = txt.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); // dd/…
      if (m) {
        var dd = +m[1], mm = +m[2], yy = +m[3];
        if (yy < 100) yy += 2000;
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) iso = yy + "-" + pad(mm) + "-" + pad(dd);
      }
    }
    return iso ? { display: iso.replace(/-/g, "/").split("/").reverse().join("/"), iso: iso } : null;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function parseQrContent(texto) {
    var res = { dni: null, fecha: null, fechaIso: null, campos: [], texto: String(texto || "").trim() };
    if (!res.texto) return res;
    var t = res.texto;
    var ya = function (k) { return res.campos.some(function (c) { return c.clave === k; }); };
    var push = function (k, v) {
      k = String(k || "").toLowerCase().trim();
      v = String(v == null ? "" : v).trim();
      if (!k || !v) return;
      var alias = { documento: "dni", doc: "dni", date: "fecha", dia: "fecha",
                    apellidos: "nombre", trabajadores: "trabajador" };
      k = alias[k] || k;
      if (ya(k)) return;
      res.campos.push({ clave: k, valor: v });
      if (k === "dni" && /^\d{8}$/.test(v)) res.dni = v;
      if (k === "fecha") {
        var f = parseFechaTexto(v);
        if (f) { res.fecha = f.display; res.fechaIso = f.iso; }
      }
    };

    // 1) Si el QR es JSON
    if (t.charAt(0) === "{") {
      try {
        var j = JSON.parse(t);
        if (j && typeof j === "object") {
          for (var key in j) {
            if (Object.prototype.hasOwnProperty.call(j, key)) {
              var v = j[key];
              if (typeof v === "string" || typeof v === "number") push(key, String(v));
            }
          }
        }
      } catch (e) { /* no era JSON válido: seguir como texto */ }
    }

    // 2) DNI: con etiqueta preferida; si no, primer número de 8 dígitos aislado
    if (!res.dni) {
      var m8 = t.match(/(?:dni|documento|doc)\s*[:=#]?\s*(\d{8})/i)
        || t.match(/(^|[^0-9])(\d{8})([^0-9]|$)/);
      if (m8) res.dni = (m8[2] || m8[1] || "").trim();
      if (res.dni && !ya("dni")) res.campos.unshift({ clave: "dni", valor: res.dni });
    }

    // 3) Fecha suelta (si aún no hay)
    if (!res.fechaIso) {
      var mf = t.match(/(?:fecha|date)\s*[:=#]?\s*([0-9\/.\-]{6,12})/i)
        || t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/)
        || t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
      if (mf) {
        var f = parseFechaTexto(mf[0]);
        if (f) {
          res.fecha = f.display;
          res.fechaIso = f.iso;
          if (!ya("fecha")) res.campos.unshift({ clave: "fecha", valor: f.display });
        }
      }
    }

    // 4) pares clave:valor / clave=valor, SOLO con claves conocidas y valor
    //    perezoso que se detiene ante la siguiente etiqueta conocida.
    //    Soporta varias parejas en la misma línea y valores con espacios.
    var keysPat = CLAVES_CONOCIDAS.slice().sort(function (a, b) { return b.length - a.length; })
      .map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|");
    var parRe = new RegExp(
      "(^|[\\s|;\\n])(?:" + keysPat + ")\\s*[:=]\\s*([^:=|\\n;]+?)" +
      "(?=\\s+(?:" + keysPat + ")\\s*[:=]|\\s*$)", "gi");
    var mm2;
    while ((mm2 = parRe.exec(t)) !== null) {
      var clave = mm2[0].replace(mm2[1] || "", "").split(/[:=]/)[0].toLowerCase().trim();
      var valor = mm2[2].trim();
      var esConocida = CLAVES_CONOCIDAS.indexOf(clave) >= 0 || /^\d{8}$/.test(valor);
      if (esConocida && valor.length <= 200) push(clave, valor);
    }

    res.campos = res.campos.slice(0, 30);
    return res;
  }

  root.parseQrContent = parseQrContent;
  if (typeof module !== "undefined" && module.exports) module.exports = parseQrContent;
})(typeof window !== "undefined" ? window : globalThis);
