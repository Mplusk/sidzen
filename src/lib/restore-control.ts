import { createConnection } from "node:net";

type RestoreCommand = { action: "list" } | { action: "start"; id: string; name: string };

/** The socket accepts fixed commands only and is owned by the host restore service. */
export async function restoreControl(command: RestoreCommand): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection("/run/sidzen-restore/control.sock");
    let received = "";
    const timeout = setTimeout(() => socket.destroy(new Error("restore-timeout")), 45_000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on("data", chunk => {
      received += chunk;
      if (received.length > 256_000) socket.destroy(new Error("restore-response"));
      else if (received.includes("\n")) socket.end();
    });
    socket.on("error", error => { clearTimeout(timeout); reject(error); });
    socket.on("end", () => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(received)); } catch { reject(new Error("restore-response")); }
    });
  });
}
