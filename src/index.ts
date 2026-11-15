import { Plugin } from "@opencode/plugin"
import { registerToolsRpc } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PLUGIN_ID } from "./meta.js"
import { setup } from "./setup.js"

export default Plugin.define({ id: PLUGIN_ID, setup: (ctx) => setup(ctx, (options) => registerToolsRpc(ctx as never, options)) })
