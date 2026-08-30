const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;

const TUNNEL_TOKEN =
    "RDXZ-9f82Kx7LmP4Qz81-TUNNEL";


// ======================================================
// HTTP
// ======================================================

const server = http.createServer((req, res) => {

    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end("EaglerNeo Tunnel Online\n");
});


// ======================================================
// WEBSOCKET SERVER
// ======================================================

const wss = new WebSocket.Server({
    server: server,

    maxPayload:
        16 * 1024 * 1024
});


// Conexión persistente del PC
let tunnel = null;


// Clientes Eagler conectados
//
// ID -> WebSocket
//
const clients = new Map();


// ======================================================
// UTILIDADES
// ======================================================

function tunnelConnected() {

    return (
        tunnel !== null &&
        tunnel.readyState === WebSocket.OPEN
    );
}


function sendToTunnel(data) {

    if (!tunnelConnected()) {
        return false;
    }

    try {

        tunnel.send(data);

        return true;

    } catch (error) {

        console.log(
            "[TUNNEL] Error enviando:",
            error.message
        );

        return false;
    }
}


// ======================================================
// NUEVA CONEXIÓN
// ======================================================

wss.on("connection", (ws, req) => {

    const url = new URL(
        req.url || "/",
        `http://${req.headers.host}`
    );


    const pathname = url.pathname;


    // ==================================================
    // CONEXIÓN DEL TÚNEL DEL PC
    // ==================================================

    if (pathname === "/tunnel") {

        const token =
            url.searchParams.get("token");


        console.log(
            "[TUNNEL] Nueva conexión"
        );


        // ----------------------------------------------
        // AUTENTICACIÓN
        // ----------------------------------------------

        if (token !== TUNNEL_TOKEN) {

            console.log(
                "[TUNNEL] Token incorrecto"
            );

            ws.close(
                1008,
                "Invalid tunnel token"
            );

            return;
        }


        // ----------------------------------------------
        // REEMPLAZAR TÚNEL ANTERIOR
        // ----------------------------------------------

        if (tunnelConnected()) {

            console.log(
                "[TUNNEL] Cerrando túnel anterior"
            );

            tunnel.close(
                1000,
                "New tunnel connected"
            );
        }


        tunnel = ws;


        console.log(
            "[TUNNEL] PC CONECTADO"
        );


        // ----------------------------------------------
        // MENSAJES DEL PC
        // ----------------------------------------------

        ws.on(
            "message",
            (data, isBinary) => {


                // ======================================
                // CONTROL
                // ======================================

                if (!isBinary) {

                    let message;


                    try {

                        message =
                            JSON.parse(
                                data.toString()
                            );

                    } catch {

                        console.log(
                            "[TUNNEL] JSON inválido"
                        );

                        return;
                    }


                    // ----------------------------------
                    // CIERRE DE CANAL
                    // ----------------------------------

                    if (
                        message.type ===
                        "close"
                    ) {

                        const client =
                            clients.get(
                                message.id
                            );


                        if (client) {

                            try {

                                client.close(
                                    1000,
                                    "Local connection closed"
                                );

                            } catch {}

                            clients.delete(
                                message.id
                            );
                        }

                    }


                    return;
                }


                // ======================================
                // DATOS BINARIOS
                //
                // Primeros 16 bytes:
                // ID del jugador
                //
                // Resto:
                // datos Eagler
                // ======================================

                const packet =
                    Buffer.from(data);


                if (packet.length < 16) {

                    return;
                }


                const id =
                    packet
                        .subarray(0, 16)
                        .toString("hex");


                const payload =
                    packet.subarray(16);


                const client =
                    clients.get(id);


                if (!client) {

                    return;
                }


                if (
                    client.readyState ===
                    WebSocket.OPEN
                ) {

                    try {

                        client.send(
                            payload
                        );

                    } catch {

                        try {
                            client.close();
                        } catch {}

                        clients.delete(id);
                    }
                }
            }
        );


        // ----------------------------------------------
        // DESCONEXIÓN DEL TÚNEL
        // ----------------------------------------------

        ws.on("close", () => {

            console.log(
                "[TUNNEL] PC desconectado"
            );


            if (tunnel === ws) {

                tunnel = null;
            }


            // Cerrar jugadores
            for (
                const [
                    id,
                    client
                ]
                of clients
            ) {

                try {

                    client.close(
                        1011,
                        "Tunnel disconnected"
                    );

                } catch {}
            }


            clients.clear();
        });


        ws.on("error", error => {

            console.log(
                "[TUNNEL] Error:",
                error.message
            );
        });


        return;
    }


    // ==================================================
    // CLIENTE EAGLER
    // ==================================================

    console.log(
        "[EAGLER] Nueva conexión"
    );


    // ----------------------------------------------
    // COMPROBAR TÚNEL
    // ----------------------------------------------

    if (!tunnelConnected()) {

        console.log(
            "[EAGLER] No hay PC conectado"
        );

        ws.close(
            1013,
            "Tunnel unavailable"
        );

        return;
    }


    // ----------------------------------------------
    // CREAR ID
    // ----------------------------------------------

    const idBuffer =
        crypto.randomBytes(16);


    const id =
        idBuffer.toString("hex");


    clients.set(
        id,
        ws
    );


    console.log(
        `[EAGLER] Canal ${id}`
    );


    // ----------------------------------------------
    // PEDIR AL PC ABRIR CONEXIÓN
    // ----------------------------------------------

    const openMessage =
        JSON.stringify({
            type: "open",
            id: id
        });


    if (
        !sendToTunnel(
            openMessage
        )
    ) {

        clients.delete(id);

        ws.close(
            1011,
            "Tunnel unavailable"
        );

        return;
    }


    // ==================================================
    // EAGLER → PC
    // ==================================================

    ws.on(
        "message",
        (data, isBinary) => {

            if (!isBinary) {

                return;
            }


            const payload =
                Buffer.from(data);


            // ID + datos
            const packet =
                Buffer.concat([
                    idBuffer,
                    payload
                ]);


            if (
                !sendToTunnel(
                    packet
                )
            ) {

                try {

                    ws.close(
                        1011,
                        "Tunnel disconnected"
                    );

                } catch {}


                clients.delete(id);
            }
        }
    );


    // ==================================================
    // CERRAR CLIENTE
    // ==================================================

    ws.on("close", () => {

        console.log(
            `[EAGLER] ${id} desconectado`
        );


        clients.delete(id);


        sendToTunnel(
            JSON.stringify({
                type: "close",
                id: id
            })
        );
    });


    ws.on("error", error => {

        console.log(
            `[EAGLER] ${id} error:`,
            error.message
        );
    });
});


// ======================================================
// KEEP ALIVE
// ======================================================

setInterval(() => {

    if (tunnelConnected()) {

        try {

            tunnel.ping();

        } catch {}
    }

}, 25000);


// ======================================================
// START
// ======================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "===================================="
        );

        console.log(
            "       EAGLERNEO WSS TUNNEL"
        );

        console.log(
            "===================================="
        );

        console.log(
            `PORT: ${PORT}`
        );

        console.log(
            "PUBLIC: /"
        );

        console.log(
            "TUNNEL: /tunnel"
        );

        console.log(
            "===================================="
        );
    }
);
