plugin = {}

function plugin.initialize(_context_json)
  return "null"
end

function plugin.call_ui(action, input_json)
  if action == "get" then
    return '{"capability":"ui.surface.get"}'
  end
  if action == "update" then
    return '{"capability":"ui.surface.update","input":' .. input_json .. '}'
  end
  if action == "reset" then
    return '{"capability":"ui.surface.reset","input":' .. input_json .. '}'
  end
  if action == "reset_all" then
    return '{"capability":"ui.surface.reset_all"}'
  end
  error("unsupported background skin action")
end

function plugin.call_tool(_name, _input_json)
  error("background skin does not contribute agent tools")
end

function plugin.dispose()
  return "null"
end
