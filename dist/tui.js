// src/tui/index.tsx
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { createSignal } from "solid-js";

// src/rpc/contract.ts
import { Rpc } from "@opencode/plugin/rpc";
var STATES = ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"];
var STATUS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "host", "state", "access", "tools", "unguardedAgents", "shadowedSkills", "exportDirectory", "nextStep"],
  properties: {
    version: { type: "string" },
    host: {
      type: "object",
      additionalProperties: false,
      required: ["version", "range", "tested"],
      properties: { version: { type: ["string", "null"] }, range: { type: "string" }, tested: { type: "boolean" } }
    },
    state: { type: "string", enum: STATES },
    title: { type: "string" },
    problem: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } }
    },
    conflict: { type: "string" },
    tools: {
      type: "object",
      additionalProperties: false,
      required: ["visible", "hidden", "unknown", "unknownNames"],
      properties: {
        visible: { type: "integer", minimum: 0 },
        hidden: { type: "integer", minimum: 0 },
        unknown: { type: "integer", minimum: 0 },
        unknownNames: { type: "array", items: { type: "string" } }
      }
    },
    workspace: { type: "string" },
    access: { type: "string", enum: ["all", "ask-changes", "read-only"] },
    unguardedAgents: { type: "array", items: { type: "string" } },
    permissionsBlock: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "resource", "effect"],
        properties: {
          action: { type: "string" },
          resource: { type: "string" },
          effect: { type: "string", enum: ["allow", "deny", "ask"] }
        }
      }
    },
    shadowedSkills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "path"],
        properties: { name: { type: "string" }, path: { type: "string" } }
      }
    },
    exportDirectory: { type: "string" },
    hostWarning: { type: "string" },
    nextStep: { type: "string" }
  }
};
var STATUS_ERROR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["code", "next"],
  properties: { code: { type: "string" }, next: { type: "string" } }
};
var STATE_LABELS = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict"
};
var TONES = {
  connected: "ok",
  connecting: "info",
  sign_in_required: "warning",
  failed: "error",
  disabled: "info",
  not_configured: "warning",
  conflict: "warning"
};
function hostRow(status) {
  const { version, range, tested } = status.host;
  const found = version ?? "unknown";
  if (status.hostWarning) return { label: "OpenCode", text: `${found} (host untested: ${status.hostWarning}), plugin ${status.version}`, tone: "warning" };
  return { label: "OpenCode", text: `${found} (${tested ? "tested" : "untested"}; supported range ${range}), plugin ${status.version}`, ...tested ? {} : { tone: "info" } };
}
function accessText(access) {
  if (access === "all") return "every tool runs without asking, reads, changes, new tools and exports included";
  if (access === "read-only") return "reads run without asking; every other tool is denied";
  return "reads run without asking; changes, new tools and exports ask first";
}
function statusRows(status) {
  const connected = status.state === "connected";
  const connection = status.state === "conflict" && status.conflict ? `conflict: ${status.conflict}` : `${STATE_LABELS[status.state]}${status.title ? ` (${status.title})` : ""}${status.problem ? `: ${status.problem.message} (${status.problem.code})` : ""}`;
  const tools = [`${status.tools.visible} available`];
  if (status.tools.hidden) tools.push(`${status.tools.hidden} hidden`);
  if (status.tools.unknown) {
    const named = status.tools.unknownNames.length ? `: ${status.tools.unknownNames.join(", ")}` : "";
    const posture = status.access === "all" ? "running too" : status.access === "read-only" ? "denied" : "asking before they run";
    tools.push(`${status.tools.unknown} unknown, ${posture}${named}`);
  }
  const agents = status.unguardedAgents;
  return [
    { label: "Connection", text: connection, tone: TONES[status.state] },
    { label: "Account", text: !connected ? "unknown until Granola connects" : status.workspace ? `workspace ${status.workspace}` : "workspace unknown until the agent reads your Granola account" },
    { label: "Access", text: accessText(status.access) },
    { label: "Export folder", text: status.exportDirectory },
    status.shadowedSkills.length ? { label: "Skills", text: status.shadowedSkills.map((skill) => `${skill.name} is replaced by ${skill.path}`).join("; "), tone: "warning" } : { label: "Skills", text: "the plugin's own" },
    { label: "Tools", text: connected ? tools.join(", ") : "none until Granola connects" },
    agents.length ? {
      label: "Agents without default rules",
      text: agents.join(", "),
      tone: "warning",
      block: permissionsSnippet(agents, status.permissionsBlock ?? [])
    } : { label: "Agents without default rules", text: "none" },
    hostRow(status)
  ];
}
function permissionsSnippet(agents, block) {
  const [first, ...rest] = agents;
  return [
    `"agents": {`,
    `  ${JSON.stringify(first)}: {`,
    `    "permissions": [`,
    ...block.map((rule) => `      ${JSON.stringify(rule)},`),
    `      ...then your top-level rules for Granola tools, then the agent's other rules`,
    `    ]`,
    `  }${rest.length ? "," : ""}`,
    ...rest.length ? [`  ...the same for ${rest.map((agent) => JSON.stringify(agent)).join(", ")}`] : [],
    `}`
  ];
}
var Granola = Rpc.define({
  id: "granola.meetings",
  methods: {
    status: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: STATUS_SCHEMA,
      errors: { unavailable: STATUS_ERROR_SCHEMA }
    }
  },
  events: {}
});

// src/tui/model.ts
var SERVER = "granola";
var STATUS_SLASH = "granola";
function view(details) {
  if (details.type === "loading") {
    return { rows: [{ label: "Connection", text: "checking", tone: "info" }], next: "Wait a moment." };
  }
  if (details.type === "unavailable") {
    return {
      rows: [{ label: "Connection", text: `unknown: ${details.reason}`, tone: "warning" }],
      next: details.next ?? "Check that granola.meetings is active in /plugins, then press r to refresh."
    };
  }
  return { rows: statusRows(details.status), next: details.status.nextStep };
}

// src/tui/view.tsx
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { For, Show } from "solid-js";
function color(theme, tone) {
  switch (tone) {
    case "ok":
      return theme.text.feedback.success.base;
    case "warning":
      return theme.text.feedback.warning.base;
    case "error":
      return theme.text.feedback.error.base;
    case "info":
      return theme.text.muted;
    case void 0:
      return theme.text.base;
  }
}
function StatusDialog(props) {
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [{
      title: "Refresh Granola status",
      group: "Granola",
      bind: "r",
      run: () => props.refresh()
    }, {
      title: "Close Granola status",
      group: "Granola",
      bind: "escape",
      run: () => props.context.ui.dialog.clear()
    }]
  }));
  const theme = () => props.context.theme.surface("dialog");
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$5 = _$createElement("box"), _el$6 = _$createElement("box"), _el$7 = _$createElement("text"), _el$9 = _$createElement("text"), _el$0 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$5);
    _$insertNode(_el$, _el$6);
    _$insertNode(_el$, _el$0);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "gap", 1);
    _$setProp(_el$, "paddingLeft", 2);
    _$setProp(_el$, "paddingRight", 2);
    _$setProp(_el$, "paddingBottom", 1);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$3, _$createTextNode(`Granola status`));
    _$setProp(_el$5, "flexDirection", "column");
    _$insert(_el$5, _$createComponent(For, {
      get each() {
        return props.view.rows;
      },
      children: (row) => (() => {
        var _el$10 = _$createElement("box"), _el$11 = _$createElement("box"), _el$12 = _$createElement("text"), _el$13 = _$createElement("text");
        _$insertNode(_el$10, _el$11);
        _$setProp(_el$10, "flexDirection", "column");
        _$insertNode(_el$11, _el$12);
        _$insertNode(_el$11, _el$13);
        _$setProp(_el$11, "flexDirection", "row");
        _$setProp(_el$11, "gap", 1);
        _$setProp(_el$12, "width", 14);
        _$setProp(_el$12, "flexShrink", 0);
        _$insert(_el$12, () => row.label);
        _$setProp(_el$13, "flexGrow", 1);
        _$setProp(_el$13, "wrapMode", "word");
        _$insert(_el$13, () => row.text);
        _$insert(_el$10, _$createComponent(Show, {
          get when() {
            return row.block;
          },
          children: (block) => (() => {
            var _el$14 = _$createElement("box");
            _$setProp(_el$14, "flexDirection", "column");
            _$setProp(_el$14, "paddingLeft", 15);
            _$insert(_el$14, _$createComponent(For, {
              get each() {
                return block();
              },
              children: (line) => (() => {
                var _el$15 = _$createElement("text");
                _$insert(_el$15, line);
                _$effect((_$p) => _$setProp(_el$15, "fg", theme().text.muted, _$p));
                return _el$15;
              })()
            }));
            return _el$14;
          })()
        }), null);
        _$effect((_p$) => {
          var _v$5 = theme().text.muted, _v$6 = color(theme(), row.tone);
          _v$5 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$5, _p$.e));
          _v$6 !== _p$.t && (_p$.t = _$setProp(_el$13, "fg", _v$6, _p$.t));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$10;
      })()
    }));
    _$insertNode(_el$6, _el$7);
    _$insertNode(_el$6, _el$9);
    _$setProp(_el$6, "flexDirection", "row");
    _$setProp(_el$6, "gap", 1);
    _$insertNode(_el$7, _$createTextNode(`Next step`));
    _$setProp(_el$7, "width", 14);
    _$setProp(_el$7, "flexShrink", 0);
    _$setProp(_el$9, "flexGrow", 1);
    _$setProp(_el$9, "wrapMode", "word");
    _$insert(_el$9, () => props.view.next);
    _$insertNode(_el$0, _$createTextNode(`r refresh \xB7 esc close`));
    _$effect((_p$) => {
      var _v$ = theme().text.base, _v$2 = theme().text.muted, _v$3 = theme().text.base, _v$4 = theme().text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$7, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$9, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$0, "fg", _v$4, _p$.o));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    return _el$;
  })();
}

// src/tui/index.tsx
function failure(error) {
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") return {
    type: "unavailable",
    reason: "Granola status could not be read (STATUS_UNAVAILABLE)",
    next: "Press r to refresh in a few seconds."
  };
  return {
    type: "unavailable",
    reason: type === "rpc.unavailable" || type === "rpc.method_not_found" ? "the Granola plugin is not running on this OpenCode server" : "the status request failed"
  };
}
var plugin = {
  id: "granola.meetings.tui",
  setup(context) {
    const [details, setDetails] = createSignal({
      type: "loading"
    });
    let generation = 0;
    let open;
    let disposed = false;
    let stops = [];
    const refresh = () => {
      if (!open) return;
      const request = ++generation;
      void context.client.rpc(Granola).status({}, context.location ? {
        location: context.location
      } : {}).then((status) => ({
        type: "ready",
        status
      }), failure).then((next) => {
        if (request === generation) setDetails(next);
      });
    };
    const close = () => {
      open = void 0;
      generation++;
      for (const stop of stops) stop();
      stops = [];
    };
    const show = () => {
      if (disposed) return;
      close();
      const token = {};
      setDetails({
        type: "loading"
      });
      context.ui.dialog.show(() => _$createComponent2(StatusDialog, {
        context,
        get view() {
          return view(details());
        },
        refresh
      }), () => {
        if (open === token) close();
      });
      context.ui.dialog.set({
        size: "large"
      });
      open = token;
      stops = [
        context.data.on("server.connected", refresh),
        context.data.on("mcp.status.changed", (event) => {
          if (event.data.server === SERVER) refresh();
        }),
        // Agents defined only in user config change which agents miss the permission defaults.
        context.data.on("agent.updated", refresh),
        context.data.on("integration.updated", refresh),
        context.data.on("credential.updated", refresh),
        context.data.on("credential.switched", refresh),
        // An account read during a turn names the workspace; the dialog picks it up when the turn ends.
        context.data.on("session.idle", refresh)
      ];
      refresh();
    };
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "granola.status",
        title: "Granola: Status",
        group: "Granola",
        palette: true,
        slash: {
          name: STATUS_SLASH
        },
        run: show
      }]
    }));
    return () => {
      disposed = true;
      close();
    };
  }
};
var tui_default = plugin;
export {
  tui_default as default
};
