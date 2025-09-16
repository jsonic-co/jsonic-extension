import hookContent from "bundle-text:./hookContent.js"
import hookContentInvalidOrigin from "bundle-text:./hookContentInvalidOrigin.js"

declare global {
  interface Window {
    JSONIC_CONTENT_SCRIPT_EXECUTED: boolean
  }
}

export type HOOK_MESSAGE = {
  type: "execute_hook"
  origin_type: "VALID_ORIGIN" | "UNKNOWN_ORIGIN"
}

function getOriginList(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get((items) => {
      let originList: string[] = JSON.parse(items["originList"])

      resolve(originList)
    })
  })
}

async function injectJsonicExtensionHook() {
  let originList = await getOriginList()

  let url = new URL(window.location.href)

  const originType = originList.includes(url.origin)
    ? "VALID_ORIGIN"
    : "UNKNOWN_ORIGIN"

  if (process.env.JSONIC_EXTENSION_TARGET === "FIREFOX") {
    const script = document.createElement("script")
    script.textContent = originList.includes(url.origin)
      ? hookContent
      : hookContentInvalidOrigin
    document.documentElement.appendChild(script)
    script.parentNode.removeChild(script)
  } else {
    chrome.runtime.sendMessage(<HOOK_MESSAGE>{
      type: "execute_hook",
      origin_type: originType,
    })
  }
}

function main() {
  // check if the content script is already injected to avoid  multiple injections side effects
  if (window.JSONIC_CONTENT_SCRIPT_EXECUTED) {
    return
  }

  window.JSONIC_CONTENT_SCRIPT_EXECUTED = true

  /**
   * when an origin is added or removed,reevaluate the hook
   */
  chrome.storage.onChanged.addListener((changes, _areaName) => {
    if (changes.originList && changes.originList.newValue) {
      injectJsonicExtensionHook()
    }
  })

  window.addEventListener("message", async (ev) => {
    const originList = await getOriginList()
    let url = new URL(window.location.href)

    const originType = originList.includes(url.origin)
      ? "VALID_ORIGIN"
      : "UNKNOWN_ORIGIN"

    if (ev.source !== window || !ev.data || originType != "VALID_ORIGIN") {
      return
    }

    if (ev.data.type === "__JSONIC_EXTENSION_REQUEST__") {
      chrome.runtime.sendMessage(
        {
          messageType: "send-req",
          data: ev.data.config,
        },
        (message) => {
          if (message.data.error) {
            window.postMessage(
              {
                type: "__JSONIC_EXTENSION_ERROR__",
                error: message.data.error,
              },
              "*"
            )
          } else {
            window.postMessage(
              {
                type: "__JSONIC_EXTENSION_RESPONSE__",
                response: message.data.response,
                isBinary: message.data.isBinary,
              },
              "*"
            )
          }
        }
      )
    } else if (ev.data.type === "__JSONIC_EXTENSION_CANCEL__") {
      chrome.runtime.sendMessage({
        messageType: "cancel-req",
      })
    }
  })

  injectJsonicExtensionHook()

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "__JSONIC_EXTENSION_PING__") {
      sendResponse(true)
    } else if (msg.action === "__JSONIC_EXTENSION_REVOKE_OBJECT_URLS__") {
      msg.objectURLsToRevoke.forEach((objectURL: string) => {
        URL.revokeObjectURL(objectURL)
      })
    }
  })
}

main()
