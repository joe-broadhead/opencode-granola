import { Plugin } from "@opencode/plugin"
import { PLUGIN_ID } from "./meta.js"
import { setup } from "./setup.js"

export default Plugin.define({ id: PLUGIN_ID, setup })
