const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 4663;
const TUNNEL_TOKEN = "RDXZ-9f82Kx7LmP4Qz81-TUNNEL";

const TYPE_BINARY = 0x00;
const TYPE_TEXT = 0x01;

const server = http.createServer((req, res) => {
    if (req.url === "/") {
        res.writeHead(200, {
            "Content-Type": "text/plain"
        });

        res.end("Eagler WSS Tunnel online\n");
        return;
    }

    res.writeHead(404);
    res.end();
});

const wss = new WebSocket.Server({
    server,
    maxPayload: 16 * 1024 * 1024
});

let tunnel = null;

const clients = new Map();

function sendToTunnel(id, data, isBinary) {
    if (!tunnel || tunnel.readyState !== WebSocket.OPEN) {
        return;
    }

    const idBuffer = Buffer.from(id, "hex");
    const payload = Buffer.from(data);

    // 16 bytes ID + 1 byte tipo + payload
    const packet = Buffer.concat([
        idBuffer,
        Buffer.from([isBinary ? TYPE_BINARY : TYPE_TEXT]),
        payload
    ]);

    tunnel.send(packet);
}

wss.on("connection", (ws, req) => {

    const url = new URL(
        req.url,
        `http://${req.headers.host}`
    );

    const token = url.searchParams.get("token");

    /*
     * ================================
     * TÚNEL DEL CLIENTE
     * ================================
     */

    if (url.pathname === "/tunnel") {

        if (token !== TUNNEL_TOKEN) {
            console.log("Túnel rechazado: token incorrecto");

            ws.close(1008, "Invalid token");
            return;
        }

        if (tunnel && tunnel.readyState === WebSocket.OPEN) {
            console.log("Ya existe un túnel activo.");

            ws.close(1008, "Tunnel already connected");
            return;
        }

        tunnel = ws;

        tunnel.binaryType = "nodebuffer";

        console.log("=================================");
        console.log(" TÚNEL WSS CONECTADO");
        console.log("=================================");

        tunnel.on("message", (data, isBinary) => {

            /*
             * Control del túnel:
             * open / close
             */
            if (!isBinary) {

                let message;

                try {
                    message = JSON.parse(data.toString());
                } catch {
                    return;
                }

                if (message.type === "close") {

                    const client = clients.get(message.id);

                    if (client) {
                        try {
                            client.close();
                        } catch {}

                        clients.delete(message.id);
                    }
                }

                return;
            }

            /*
             * Datos Eagler:
             *
             * [16 bytes ID]
             * [1 byte tipo]
             * [payload]
             */

            const packet = Buffer.from(data);

            if (packet.length < 17) {
                return;
            }

            const id = packet.subarray(0, 16).toString("hex");
            const type = packet[16];
            const payload = packet.subarray(17);

            const client = clients.get(id);

            if (!client || client.readyState !== WebSocket.OPEN) {
                return;
            }

            if (type === TYPE_BINARY) {
                client.send(payload, {
                    binary: true
                });
            }

            else if (type === TYPE_TEXT) {
                client.send(payload.toString("utf8"), {
                    binary: false
                });
            }
        });

        tunnel.on("close", () => {
            console.log("Túnel desconectado.");

            if (tunnel === ws) {
                tunnel = null;
            }

            for (const client of clients.values()) {
                try {
                    client.close();
                } catch {}
            }

            clients.clear();
        });

        tunnel.on("error", (err) => {
            console.error("Error del túnel:", err.message);
        });

        return;
    }

    /*
     * ================================
     * EAGLER PÚBLICO
     * ================================
     */

    if (url.pathname !== "/") {
        ws.close(1008, "Invalid path");
        return;
    }

    if (!tunnel || tunnel.readyState !== WebSocket.OPEN) {
        console.log("Cliente rechazado: túnel offline");

        ws.close(1013, "Tunnel offline");
        return;
    }

    const id = crypto.randomBytes(16).toString("hex");

    clients.set(id, ws);

    console.log(
        `[OPEN] ${id} | clientes: ${clients.size}`
    );

    /*
     * Avisar al cliente local
     */
    tunnel.send(JSON.stringify({
        type: "open",
        id
    }));

    /*
     * ================================
     * EAGLER → PC
     * ================================
     */

    ws.on("message", (data, isBinary) => {

        // IMPORTANTE:
        // ya no descartamos los TEXT frames
        sendToTunnel(id, data, isBinary);
    });

    /*
     * ================================
     * CIERRE
     * ================================
     */

    ws.on("close", () => {

        console.log(`[CLOSE] ${id}`);

        clients.delete(id);

        if (tunnel && tunnel.readyState === WebSocket.OPEN) {
            tunnel.send(JSON.stringify({
                type: "close",
                id
            }));
        }
    });

    ws.on("error", (err) => {
        console.error(
            `[CLIENT ERROR] ${id}:`,
            err.message
        );
    });
});

/*
 * ================================
 * HEARTBEAT
 * ================================
 */

setInterval(() => {

    if (!tunnel) {
        return;
    }

    if (tunnel.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        tunnel.ping();
    } catch {}

}, 25000);

server.listen(PORT, () => {

    console.log("=================================");
    console.log(" EAGLER WSS TUNNEL");
    console.log("=================================");
    console.log(`Puerto: ${PORT}`);
    console.log("Tunnel: /tunnel");
    console.log("=================================");
});
