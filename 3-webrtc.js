// --- 3. COMUNICACIONES WEBRTC Y PEERJS ---

function initPeerReceiver() {
    if (peerReceiver && !peerReceiver.destroyed) return;
    peerReceiver = new Peer({ config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } });
    peerReceiver.on('open', () => { if (systemOn) maintainPersistentConnection(); });
    peerReceiver.on('call', call => {
        externalLiveActive = true; call.answer();
        call.on('stream', stream => { elLiveAudio.srcObject = stream; elLiveAudio.muted = true; safePlay(elLiveAudio); });
        call.on('close', () => { externalLiveActive = false; elLiveAudio.srcObject = null; if(systemOn) broadcastLogic(); });
    });
    peerReceiver.on('disconnected', () => peerReceiver.reconnect());
}

function maintainPersistentConnection() {
    if (!systemOn || (dataConn && dataConn.open)) return;
    dataConn = peerReceiver.connect(MASTER_ID, { reliable: true });
    dataConn.on('open', () => dataConn.send({ command: 'check_live' }));
    dataConn.on('close', () => { dataConn = null; }); dataConn.on('error', () => { dataConn = null; });
}
