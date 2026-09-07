const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const TUNNEL_TOKEN = "RDXZ-9f82Kx7LmP4Qz81-TUNNEL";

const TYPE_BINARY = 0x00;
const TYPE_TEXT   = 0x01;
const TYPE_OPEN   = 0x02;
const TYPE_CLOSE  = 0x03;

const HEADER_SIZE = 17;

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

function makePacket(type, id, payload = Buffer.alloc(0)) {
    const idBuffer = Buffer.from(id, "hex");

    if (idBuffer.length !== 16) {
        throw new Error("ID inválido");
    }

    return Buffer.concat([
        Buffer.from([type]),
        idBuffer,
        payload
    ]);
}

function sendToTunnel(type, id, payload = Buffer.alloc(0)) {
    if (!tunnel || tunnel.readyState !== WebSocket.OPEN) {
        return false;
    }

    try {
        tunnel.send(makePacket(type, id, payload));
        return true;
    } catch (err) {
        console.error("Error enviando al túnel:", err.message);
        return false;
    }
}

function closeAllClients() {
    for (const [id, ws] of clients) {
        try {
            ws.close(1011, "Tunnel disconnected");
        } catch {}

        clients.delete(id);
    }
}

function handleTunnelPacket(packet) {
    if (!Buffer.isBuffer(packet) || packet.length < HEADER_SIZE) {
        return;
    }

    const type = packet[0];
    const id = packet.subarray(1, 17).toString("hex");
    const payload = packet.subarray(17);

    const client = clients.get(id);

    if (!client) {
        return;
    }

    if (client.readyState !== WebSocket.OPEN) {
        return;
    }

    switch (type) {

        case TYPE_BINARY:
            client.send(payload, {
                binary: true
            });
            break;

        case TYPE_TEXT:
            client.send(payload.toString("utf8"), {
                binary: false
            });
            break;

        case TYPE_CLOSE:
            client.close();
            clients.delete(id);
            break;

        default:
            console.warn(
                `[TUNNEL] Tipo desconocido ${type} para ${id}`
            );
    }
}

wss.on("connection", (ws, req) => {

    const url = new URL(
        req.url,
        `http://${req.headers.host}`
    );

    const token = url.searchParams.get("token");

    /*
     * =========================================
     * CONEXIÓN DEL TÚNEL PRIVADO
     * =========================================
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

            if (!isBinary) {
                // El protocolo interno usa SOLO frames binarios.
                return;
            }

            handleTunnelPacket(Buffer.from(data));
        });

        tunnel.on("close", () => {
            console.log("Túnel desconectado.");

            if (tunnel === ws) {
                tunnel = null;
            }

            closeAllClients();
        });

        tunnel.on("error", (err) => {
            console.error(
                "Error del túnel:",
                err.message
            );
        });

        return;
    }

    /*
     * =========================================
     * CONEXIONES EAGLER PÚBLICAS
     * =========================================
     */

    if (url.pathname !== "/") {
        ws.close(1008, "Invalid path");
        return;
    }

    if (!tunnel || tunnel.readyState !== WebSocket.OPEN) {

        console.log(
            "Cliente rechazado: túnel offline"
        );

        ws.close(1013, "Tunnel offline");
        return;
    }

    const id = crypto.randomBytes(16).toString("hex");

    clients.set(id, ws);

    console.log(
        `[OPEN] ${id} | clientes: ${clients.size}`
    );

    // Avisar al cliente del túnel
    sendToTunnel(TYPE_OPEN, id);

    /*
     * =========================================
     * EAGLER → TÚNEL
     * =========================================
     */

    ws.on("message", (data, isBinary) => {

        const payload = Buffer.from(data);

        if (isBinary) {
            sendToTunnel(
                TYPE_BINARY,
                id,
                payload
            );
        } else {
            sendToTunnel(
                TYPE_TEXT,
                id,
                payload
            );
        }
    });

    /*
     * =========================================
     * CIERRE
     * =========================================
     */

    ws.on("close", () => {

        console.log(
            `[CLOSE] ${id}`
        );

        clients.delete(id);

        sendToTunnel(
            TYPE_CLOSE,
            id
        );
    });

    ws.on("error", (err) => {
        console.error(
            `[CLIENT ERROR] ${id}:`,
            err.message
        );
    });
});

/*
 * =========================================
 * HEARTBEAT DEL TÚNEL
 * =========================================
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
