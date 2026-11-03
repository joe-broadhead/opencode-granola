import { Plugin } from "@opencode/plugin"
import { registerToolsRpc } from "./host/tools-rpc.js"
import { PLUGIN_ID } from "./meta.js"
import { setup } from "./setup.js"

export default Plugin.define({ id: PLUGIN_ID, setup: (ctx) => setup(ctx, (options) => registerToolsRpc(ctx, options)) })
