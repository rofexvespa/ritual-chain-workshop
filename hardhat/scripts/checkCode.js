async function check() {
    const liveReq = await fetch("https://rpc.ritualfoundation.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getCode",
            params: ["0x2F6F783EF360AbEE3d22FA4D94194728759F0b96", "latest"]
        })
    }).then(r => r.json());

    const localReq = await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "eth_getCode",
            params: ["0x2F6F783EF360AbEE3d22FA4D94194728759F0b96", "latest"]
        })
    }).then(r => r.json());

    console.log("Live Code Length:", liveReq.result?.length);
    console.log("Local Code Length:", localReq.result?.length);
}
check();
