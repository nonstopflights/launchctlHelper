let websocket = null;
let actionUuid = "";
let context = "";

const albumUrlField = document.getElementById("album-url");
const showTitleCheckbox = document.getElementById("show-title");
const saveButton = document.getElementById("save-button");
const statusMessage = document.getElementById("status-message");

window.connectElgatoStreamDeckSocket = function connectElgatoStreamDeckSocket(
  port,
  inContext,
  registerEvent,
  _info,
  actionInfo
) {
  context = inContext;

  try {
    const parsedActionInfo = JSON.parse(actionInfo);
    actionUuid = parsedActionInfo.action ?? "";
    const settings = parsedActionInfo.payload?.settings ?? {};
    albumUrlField.value = settings.albumUrl ?? "";
    showTitleCheckbox.checked = settings.showTitle === true;
  } catch {
    actionUuid = "";
  }

  websocket = new WebSocket(`ws://127.0.0.1:${port}`);

  websocket.addEventListener("open", () => {
    send({
      event: registerEvent,
      uuid: context
    });
  });

  websocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.event === "didReceiveSettings") {
      const settings = message.payload?.settings ?? {};
      albumUrlField.value = settings.albumUrl ?? "";
      showTitleCheckbox.checked = settings.showTitle === true;
      return;
    }

    if (
      message.event === "sendToPropertyInspector" &&
      message.payload?.type === "set-album-result"
    ) {
      showStatus(message.payload.message, message.payload.status);
    }
  });
};

showTitleCheckbox.addEventListener("change", () => {
  send({
    action: actionUuid,
    context,
    event: "sendToPlugin",
    payload: {
      type: "toggle-show-title",
      showTitle: showTitleCheckbox.checked
    }
  });
});

saveButton.addEventListener("click", () => {
  const url = albumUrlField.value.trim();

  if (!url) {
    showStatus("Enter an Apple Music album URL.", "error");
    return;
  }

  send({
    action: actionUuid,
    context,
    event: "sendToPlugin",
    payload: {
      type: "set-album-url",
      url
    }
  });
});

function showStatus(text, tone) {
  statusMessage.textContent = text;
  statusMessage.className = "status status-" + (tone || "info");
}

function send(payload) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    return;
  }

  websocket.send(JSON.stringify(payload));
}
