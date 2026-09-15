import { playwrightProcessSocketRoot, playwrightProcessTempRoot } from "../hostpath.js";

const stringField = (description) => ({
  type: "string",
  description,
});

function objectSchema(properties = {}, required = []) {
  const schema = {
    type: "object",
    additionalProperties: true,
  };
  if (Object.keys(properties).length > 0) schema.properties = properties;
  if (required.length > 0) schema.required = required;
  return schema;
}

function tool(name, description, properties, required) {
  return {
    name,
    description,
    inputSchema: objectSchema(properties, required),
  };
}

export const advertisedPlaywrightTools = Object.freeze([
  tool("browser_navigate", "Open a URL in the focused isolated browser tab.", {
    url: stringField("Absolute URL to open, including http://127.0.0.1 pages."),
  }, ["url"]),
  tool("browser_navigate_back", "Go back one history entry."),
  tool("browser_snapshot", "Read the accessibility tree of the focused tab."),
  tool("browser_click", "Click an element from the latest snapshot.", {
    ref: stringField("Element ref from browser_snapshot."),
    element: stringField("Human-readable element description."),
  }),
  tool("browser_type", "Type into an element from the latest snapshot.", {
    ref: stringField("Element ref from browser_snapshot."),
    text: stringField("Text to type."),
    element: stringField("Human-readable element description."),
  }),
  tool("browser_fill_form", "Fill a form from the latest snapshot."),
  tool("browser_press_key", "Press a keyboard key in the focused tab.", {
    key: stringField("Key name, such as Enter or Escape."),
  }),
  tool("browser_take_screenshot", "Capture the focused tab."),
  tool("browser_tabs", "List or select isolated browser tabs.", {
    action: {
      type: "string",
      enum: ["list", "new", "close", "select"],
      description: "Tab action.",
    },
    index: { type: "integer", description: "Tab index for select or close." },
  }),
  tool("browser_wait_for", "Wait for text or a short delay.", {
    time: { type: "number", description: "Seconds to wait." },
    text: stringField("Text that should appear."),
    textGone: stringField("Text that should disappear."),
  }),
  tool("browser_select_option", "Choose an option from the latest snapshot.", {
    ref: stringField("Element ref from browser_snapshot."),
    element: stringField("Human-readable element description."),
  }),
  tool("browser_hover", "Hover an element from the latest snapshot.", {
    ref: stringField("Element ref from browser_snapshot."),
    element: stringField("Human-readable element description."),
  }),
  tool("browser_console_messages", "Read recent console messages."),
  tool("browser_network_requests", "Read recent network requests."),
  tool("browser_close", "Close the focused isolated browser tab."),
]);

export function playwrightMcpChildEnv(baseEnv = process.env, platform = process.platform) {
  const childEnv = { ...baseEnv };
  const socketRoot = playwrightProcessSocketRoot(baseEnv, platform);
  const tempRoot = playwrightProcessTempRoot(baseEnv, platform);
  if (socketRoot) childEnv.PWTEST_SOCKETS_DIR = socketRoot;
  if (tempRoot) {
    childEnv.TMPDIR = tempRoot;
    childEnv.TEMP = tempRoot;
    childEnv.TMP = tempRoot;
  }
  return { childEnv, socketRoot, tempRoot };
}
