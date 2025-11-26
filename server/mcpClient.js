import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Minimal MCP stdio client that only supports calling tools on mcp-server.js

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Start MCP server once when this module is loaded
const serverPath = path.join(__dirname, "mcp-server.js");
const child = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "inherit"],
});

let stdoutBuffer = "";
let pending = null; // { resolve, reject }

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  processStdoutBuffer();
});

child.on("error", (err) => {
  if (pending) {
    pending.reject(err);
    pending = null;
  }
});

child.on("exit", (code, signal) => {
  const err = new Error(
    `MCP server exited with code ${code ?? "null"} signal ${signal ?? "null"}`
  );
  if (pending) {
    pending.reject(err);
    pending = null;
  }
});

function processStdoutBuffer() {
  // MCP over stdio uses HTTP-style framing:
  // Content-Length: <len>\r\n
  // \r\n
  // <JSON>
  while (true) {
    const headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = stdoutBuffer.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      stdoutBuffer = "";
      return;
    }

    const length = parseInt(match[1], 10);
    const totalLength = headerEnd + 4 + length;
    if (stdoutBuffer.length < totalLength) {
      return;
    }

    const jsonPayload = stdoutBuffer.slice(headerEnd + 4, totalLength);
    stdoutBuffer = stdoutBuffer.slice(totalLength);

    try {
      const message = JSON.parse(jsonPayload);
      handleMessage(message);
    } catch {
      // Ignore malformed JSON and keep going
    }
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || !pending) return;

  const { resolve, reject } = pending;
  pending = null;

  if ("error" in msg && msg.error) {
    reject(new Error(msg.error.message || "MCP error"));
  } else if ("result" in msg) {
    resolve(msg.result);
  } else {
    resolve(msg);
  }
}

function sendRequest(method, params) {
  if (pending) {
    return Promise.reject(
      new Error("Only one MCP request at a time is supported in this client")
    );
  }

  const msg = {
    jsonrpc: "2.0",
    id: "1",
    method,
    params,
  };

  const json = JSON.stringify(msg);
  const payload = `Content-Length: ${Buffer.byteLength(
    json,
    "utf8"
  )}\r\n\r\n${json}`;

  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    child.stdin.write(payload, "utf8", (err) => {
      if (err) {
        pending = null;
        reject(err);
      }
    });
  });
}

export async function callMcpTool(toolName, args) {
  const result = await sendRequest("tools/call", {
    name: toolName,
    arguments: args,
  });

  // mcp-server.js returns { content: [{ type: "text", text: ... }], isError? }
  if (!result || !Array.isArray(result.content)) {
    return JSON.stringify(result);
  }

  const textItem = result.content.find((c) => c.type === "text");
  return textItem?.text ?? JSON.stringify(result);
}
