export function panelClientCode(): string {
  return `
  const panel = document.getElementById("panel");
  const STATUS_BADGE = {
    added: { color: "#22c55e", label: "added" },
    removed: { color: "#ef4444", label: "removed" },
    renamed: { color: "#06b6d4", label: "renamed" },
    unchanged: { color: "#5a6573", label: "unchanged" }
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function renderRow(k, v, cls) {
    const vClass = cls ? ' class="v ' + cls + '"' : ' class="v"';
    return '<div class="row"><div class="k">' + k + '</div><div' + vClass + '>' + v + '</div></div>';
  }
  function showEmpty() {
    panel.innerHTML = '<h2>Selection</h2><div class="empty">Click a node to see details.</div>';
  }
  function neighborsOf(nodeId) {
    const inbound = [];
    const outbound = [];
    cy.edges().forEach(function (e) {
      if (e.data("target") === nodeId) inbound.push(e.data("source"));
      if (e.data("source") === nodeId) outbound.push(e.data("target"));
    });
    return { inbound: inbound, outbound: outbound };
  }
  function neighborListHtml(ids, dataAttr) {
    if (!ids.length) return '';
    const top = ids.slice(0, 5);
    return '<ul class="neighbors">' + top.map(function (id) {
      return '<li ' + dataAttr + '="' + escapeHtml(id) + '">' + escapeHtml(id) + '</li>';
    }).join('') + '</ul>';
  }
  function attrsBlock(attrs) {
    if (!attrs || !Object.keys(attrs).length) return '';
    return '<h2 style="margin-top:14px">Attributes</h2><pre>' +
      escapeHtml(JSON.stringify(attrs, null, 2)) + '</pre>';
  }
  function statusBadge(status) {
    if (!status || status === "unchanged") return "";
    const meta = STATUS_BADGE[status] || STATUS_BADGE.unchanged;
    return '<span class="badge" style="background:' + meta.color + '22;color:' + meta.color + ';border-color:' + meta.color + '55">' +
      escapeHtml(meta.label) + '</span>';
  }
  function fmtNum(v) {
    if (v === null || v === undefined) return '—';
    if (Number.isInteger(v)) return String(v);
    return Number(v).toFixed(3).replace(/\\.?0+$/, '');
  }
  function fmtDelta(after, before) {
    if (before === undefined || before === null) return '';
    if (after === undefined || after === null) return '';
    const d = after - before;
    if (d === 0) return '';
    const cls = d > 0 ? 'delta-up' : 'delta-down';
    const sign = d > 0 ? '+' : '';
    return ' <span class="' + cls + '">(' + sign + fmtNum(d) + ')</span>';
  }
  function metricsBlock(metrics, before) {
    if (!metrics || Object.keys(metrics).length === 0) return '';
    const order = ['loc','function_count','cyclomatic_max','cyclomatic_sum','max_nesting_depth','fan_in','fan_out','instability'];
    const seen = new Set();
    const rows = [];
    function pushRow(name) {
      if (seen.has(name)) return;
      seen.add(name);
      const v = metrics[name];
      if (v === undefined) return;
      const b = before ? before[name] : undefined;
      rows.push('<div class="row"><div class="k">' + escapeHtml(name) + '</div>' +
        '<div class="v num">' + fmtNum(v) + fmtDelta(v, b) + '</div></div>');
    }
    for (const n of order) pushRow(n);
    for (const k of Object.keys(metrics)) pushRow(k);
    if (rows.length === 0) return '';
    return '<h2 style="margin-top:14px">Metrics</h2>' + rows.join('');
  }
  function violationsBlock(violations) {
    if (!violations || violations.length === 0) return '';
    const rows = violations.map(function (v) {
      const sev = v.severity === 'error' ? '#fca5a5' : '#fcd34d';
      const carry = v.isCarryover ? ' <span class="dim">(carryover)</span>' : '';
      return '<div class="row"><div class="k" style="color:' + sev + '">' +
        escapeHtml(v.severity.toUpperCase()) + '</div>' +
        '<div class="v">' + escapeHtml(v.ruleId) + carry +
        '<div class="dim" style="font-size:11px">' + escapeHtml(v.message) + '</div></div></div>';
    }).join('');
    return '<h2 style="margin-top:14px;color:#fca5a5">Violations (' + violations.length + ')</h2>' + rows;
  }
  function resolvedBlock(resolved) {
    if (!resolved || resolved.length === 0) return '';
    const rows = resolved.map(function (v) {
      return '<div class="row"><div class="k" style="color:#86efac">FIXED</div>' +
        '<div class="v">' + escapeHtml(v.ruleId) +
        '<div class="dim" style="font-size:11px">was: ' + escapeHtml(v.message) + '</div></div></div>';
    }).join('');
    return '<h2 style="margin-top:14px;color:#86efac">Resolved (' + resolved.length + ')</h2>' + rows;
  }
  function trendsBlock(trends) {
    if (!trends || trends.length === 0) return '';
    const rows = trends.map(function (t) {
      const cls = t.delta > 0 ? 'delta-up' : 'delta-down';
      const sign = t.delta > 0 ? '+' : '';
      return '<div class="row"><div class="k">' + escapeHtml(t.ruleId) + '</div>' +
        '<div class="v num">' + fmtNum(t.before) + ' → ' + fmtNum(t.after) +
        ' <span class="' + cls + '">(' + sign + fmtNum(t.delta) + ')</span></div></div>';
    }).join('');
    return '<h2 style="margin-top:14px">Trend</h2>' + rows;
  }
  function showNode(raw) {
    const nb = neighborsOf(raw.id);
    panel.innerHTML =
      '<h2>Node ' + statusBadge(raw.status) + '</h2>' +
      '<div class="node-id">' + escapeHtml(raw.id) + '</div>' +
      (raw.oldId ? renderRow("was", escapeHtml(raw.oldId)) : "") +
      renderRow("kind", escapeHtml(raw.kind)) +
      (raw.role ? renderRow("role", escapeHtml(raw.role)) : "") +
      (raw.language ? renderRow("language", escapeHtml(raw.language)) : "") +
      (raw.name ? renderRow("name", escapeHtml(raw.name)) : "") +
      (raw.parentId ? renderRow("parent", escapeHtml(raw.parentId)) : "") +
      renderRow("Fan-in", String(nb.inbound.length), "num") +
      renderRow("Fan-out", String(nb.outbound.length), "num") +
      '<div class="actions"><a data-action="show-neighbors">Show neighbors</a></div>' +
      violationsBlock(raw.violations) +
      trendsBlock(raw.violationTrends) +
      resolvedBlock(raw.resolvedViolations) +
      (nb.inbound.length ? '<h2 style="margin-top:14px">Top inbound</h2>' +
        neighborListHtml(nb.inbound, 'data-neighbor') : '') +
      (nb.outbound.length ? '<h2 style="margin-top:14px">Top outbound</h2>' +
        neighborListHtml(nb.outbound, 'data-neighbor') : '') +
      metricsBlock(raw.metrics, raw.metricsBefore) +
      attrsBlock(raw.attrs);
  }
`;
}
