async function check() {
    const liveReq = await fetch("https://rpc.ritualfoundation.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getCode",
            params: ["0x2F6F783EF360AbEE3d22FA4D94194728759F0b96", "0x257546A"]
        })
    }).then(r => r.text());

    console.log("Historical Code:", liveReq.substring(0, 100));
}
check();
