// --- 4. MOTOR WEBAUDIO, STREAM INFINITO Y VISUALIZADOR ---

function initAudio() {
    if (!audioCtx) { 
        audioCtx = new(window.AudioContext || window.webkitAudioContext)(); 
        masterStreamDestination = audioCtx.createMediaStreamDestination();
        
        nodeA = audioCtx.createMediaElementSource(deckA);
        nodeB = audioCtx.createMediaElementSource(deckB);
        nodeLive = audioCtx.createMediaElementSource(elLiveAudio);
        
        nodeA.connect(masterStreamDestination);
        nodeB.connect(masterStreamDestination);
        nodeLive.connect(masterStreamDestination);
        
        nodeA.connect(audioCtx.destination);
        nodeB.connect(audioCtx.destination);
        nodeLive.connect(audioCtx.destination);

        virtualLiveStream = masterStreamDestination.stream;
        console.log("📻 Stream Infinito Generado. Puedes acceder a él mediante la variable: virtualLiveStream");

        requestAnimationFrame(drawVisualizer); 
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function drawVisualizer() {
    if (!systemOn) return; requestAnimationFrame(drawVisualizer);
    if (document.hidden || userVolume <= 0.01) return;
    let ctx = el.canvas.getContext('2d'); ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    let isAudioPlaying = (currentMode === 'ESTUDIO_LIVE' && !elLiveAudio.paused) || (activeDeck && !activeDeck.paused && activeDeck.readyState >= 3);
    let time = (Date.now() - visStartTime) / 150;
    for(let i = 0; i < 32; i++) {
        let bh = 2;
        if (isAudioPlaying) {
            let wave = Math.sin(time + i * 0.2) * Math.cos(time * 0.8 + i * 0.5);
            bh = Math.max(2, (wave * 0.5 + 0.5) * (Math.random() * 0.5 + 0.5) * 50 * userVolume * faderLevel);
        }
        ctx.fillStyle = document.body.classList.contains('theme-dark') ? 'rgba(255, 255, 255, 0.85)' : 'rgba(208, 2, 27, 0.85)';
        ctx.fillRect(i * (140/32), 60 - bh, (140/32)*0.8, bh);
    }
}

function playPip(dur) {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    let t = audioCtx.currentTime;
    let osc = audioCtx.createOscillator(), pGain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = 1000; osc.connect(pGain); pGain.connect(audioCtx.destination);
    
    if(masterStreamDestination) pGain.connect(masterStreamDestination);

    pGain.gain.setValueAtTime(0, t);
    pGain.gain.setValueAtTime(userVolume, t + 0.001);
    pGain.gain.setValueAtTime(userVolume, t + dur - 0.005);
    pGain.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t); osc.stop(t + dur + 0.05);
}

function gestionarPips(m, s) {
    if (['LIVE', 'ESTUDIO_LIVE', 'SPORTS', 'BREAKINGLIVE'].includes(currentMode)) return;
    if (lastPipFired === s) return;

    let schedulePip = (dur) => { lastPipFired = s; playPip(dur); };

    if (m === 59 && s >= 55 && s <= 59) schedulePip(s === 59 ? 0.6 : 0.1);
    else if (m === 29 && s >= 57 && s <= 59) schedulePip(0.1);
    else if (m === 30 && s === 0) schedulePip(0.6);
    else if (m === 0 && s === 0) schedulePip(0.6);
    else if (s !== 0 && s < 55) lastPipFired = -1;
}
