local message = require("message")

function on_load(nota)
  nota.ui.notify(message.hello())
end
