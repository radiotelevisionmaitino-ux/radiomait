// --- 5. LÓGICA CORE, JERARQUÍAS Y UI ---

let broadcastLoopTimer = null;

function toggleBroadcast() {
    if (!systemOn) {
        initAudio(); visStartTime = Date.now();
        deckA.src = SILENCE_MP3; safePlay(deckA); deckB.src = SILENCE_MP3; safePlay(deckB); elLiveAudio.src = SILENCE_MP3; safePlay(elLiveAudio);
        systemOn = true; el.btn.classList.add('active'); el.tally.classList.add('live'); updateBtnState(); requestAnimationFrame(visualLoop);
        function loop() { if (systemOn) { broadcastLogic(); broadcastLoopTimer = setTimeout(loop, 50); } }
        loop();
    } else {
        systemOn = false; el.btn.classList.remove('active'); el.tally.classList.remove('live'); updateBtnState();
        clearTimeout(broadcastLoopTimer);
        activeDeck.pause(); activeDeck.removeAttribute('src'); activeDeck.load();
        if (fadingDeck) { fadingDeck.pause(); fadingDeck.removeAttribute('src'); fadingDeck.load(); fadingDeck = null; }
        currentSourceUrl = ""; elLiveAudio.muted = true;
        if(dataConn) { dataConn.close(); dataConn = null; }
        updateDisplay({ title: "Emisión Detenida", artist: "Off Air", img: "" }, '<i class="fas fa-power-off"></i> OFF', "status-badge off");
        el.canvas.getContext('2d').clearRect(0, 0, el.canvas.width, el.canvas.height);
    }
}

function updateBtnState() {
    if (!systemOn) el.btn.innerHTML = '<i class="fas fa-power-off"></i>';
    else if (activeDeck.src && (activeDeck.readyState < 3 && !activeDeck.paused) && !['ESTUDIO_LIVE', 'LIVE', 'BREAKINGLIVE', 'SPORTS'].includes(currentMode)) el.btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    else el.btn.innerHTML = '<i class="fas fa-stop"></i>';
}
[deckA, deckB].forEach(d => { ['waiting','playing','canplay','stalled'].forEach(e => d.addEventListener(e, updateBtnState)); });

function getGlobalFiller(secInDay) {
    let seq = [];
    library.filler.forEach((f, idx) => {
        seq.push(f);
        if (library.jingles.length > 0 && idx % 2 === 0) seq.push(library.jingles[idx % library.jingles.length]);
        if (library.spaces.length > 0 && idx % 4 === 0) seq.push(library.spaces[idx % library.spaces.length]);
    });
    if(seq.length === 0) return { item: { src: SILENCE_MP3, type: 'filler', dur: 300, title: 'Radio Maitino', artist: 'Emisión' }, seek: 0 };
    
    let total = seq.reduce((a, b) => a + Math.max(1, b.dur), 0);
    let c = secInDay % (total || 1);
    for (let itm of seq) {
        let idur = Math.max(1, itm.dur);
        if (c < idur) return { item: itm, seek: c };
        c -= idur;
    }
    return { item: seq[0], seek: 0 };
}

function broadcastLogic() {
    if (!systemOn) return;
    const now = getSpainTime(), d = now.getDay(), h = now.getHours(), m = now.getMinutes(), s = now.getSeconds(), ms = now.getMilliseconds();
    const secInDay = h * 3600 + m * 60 + s, secInHour = m * 60 + s;
    const todayDateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth()+1).padStart(2, '0')}/${now.getFullYear()}`;
    
    gestionarFaders(m, s, ms); gestionarPips(m, s);

    if (s === lastScheduleSec) return; lastScheduleSec = s;

    let curH = (h === 0) ? library.chimes : (library.hours[h] || library.hours['default']);
    let tohSeq = [];
    if (curH) tohSeq.push({...curH, computedMode: 'HOUR'});
    if (library.news) tohSeq.push({...library.news, computedMode: 'NEWS'});
    if (library.weather) tohSeq.push({...library.weather, computedMode: 'WEATHER'});

    let rawTrans = [];
    let seed = h + (d * 24); function sRand() { let x = Math.sin(seed++) * 10000; return x - Math.floor(x); }
    if (library.ads.length > 0) {
        let adOfTheHour = [...library.ads].sort(() => sRand() - 0.5)[0];
        tohSeq.push({...adOfTheHour, computedMode: 'AD'});
    }
    library.spaces.forEach(x => rawTrans.push(x)); library.promos.forEach(x => rawTrans.push(x));
    rawTrans.sort(() => sRand() - 0.5);
    for (let i = 0; i < rawTrans.length; i++) tohSeq.push({...rawTrans[i], computedMode: rawTrans[i].type.toUpperCase()});
    
    let blockDur00 = tohSeq.reduce((a, b) => a + Math.max(1, b.dur), 0);

    let toh30Seq = [];
    if (library.news30) toh30Seq.push({...library.news30, computedMode: 'NEWS30'});
    if (library.weather) toh30Seq.push({...library.weather, computedMode: 'WEATHER'});
    let blockDur30 = toh30Seq.reduce((a, b) => a + Math.max(1, b.dur), 0);

    let showsToday = library.schedule[d] || [];
    let specialShowsToday = library.schedule.special.filter(sh => sh.dateRaw === todayDateStr);
    let activeShows = [...specialShowsToday, ...showsToday].filter(sh => secInDay >= sh.startSecs && secInDay < sh.startSecs + sh.dur);
    
    activeShows.sort((a, b) => {
        if (a.dateRaw && !b.dateRaw) return -1; if (!a.dateRaw && b.dateRaw) return 1;
        return b.startSecs - a.startSecs;
    });
    let scheduledShow = activeShows[0];

    let nextItem = null, seekPos = 0, mode = 'FILLER';
    let isLiveShow = scheduledShow && ['estudio_live_scheduled', 'live', 'sports', 'estudiolive', 'breakinglive'].includes(scheduledShow.type);
    let isDirectSchedule = scheduledShow && scheduledShow.type === 'schedule_direct';

    if (library.breaking) {
        if (library.breaking.type === 'estudio_live_breaking' && externalLiveActive) { nextItem = library.breaking; mode = 'ESTUDIO_LIVE'; }
        else if (library.breaking.type === 'breakinglive') { nextItem = library.breaking; mode = 'BREAKINGLIVE'; seekPos = 0; }
        else { nextItem = library.breaking; seekPos = (Math.floor(Date.now() / 1000)) % Math.max(1, library.breaking.dur); mode = 'BREAKING'; }
    }
    else if (isLiveShow || isDirectSchedule) {
        nextItem = scheduledShow; seekPos = secInDay - scheduledShow.startSecs;
        mode = isDirectSchedule ? 'SHOW' : (scheduledShow.type === 'sports' ? 'SPORTS' : (scheduledShow.type.includes('estudio') ? 'ESTUDIO_LIVE' : 'LIVE'));
    }
    else if (library.news30_strict && secInHour >= 1800 && secInHour < 1800 + library.news30_strict.dur) {
        nextItem = library.news30_strict; seekPos = secInHour - 1800; mode = 'NEWS30_STRICT';
    }
    else if (secInHour < blockDur00 && (!scheduledShow || scheduledShow.startSecs % 3600 === 0)) {
        let c = secInHour;
        for (let itm of tohSeq) { let idur = Math.max(1, itm.dur); if (c < idur) { nextItem = itm; seekPos = c; mode = itm.computedMode; break; } c -= idur; }
    }
    else if (secInHour >= 1800 && secInHour < 1800 + blockDur30 && (!scheduledShow || scheduledShow.startSecs % 3600 === 1800)) {
        let c = secInHour - 1800;
        for (let itm of toh30Seq) { let idur = Math.max(1, itm.dur); if (c < idur) { nextItem = itm; seekPos = c; mode = itm.computedMode; break; } c -= idur; }
    }
    else if (scheduledShow) {
        let delay = 0;
        if (scheduledShow.startSecs % 3600 === 0) delay = blockDur00;
        else if (scheduledShow.startSecs % 3600 === 1800) delay = blockDur30;
        nextItem = scheduledShow; seekPos = Math.max(0, (secInDay - scheduledShow.startSecs) - delay); mode = 'SHOW';
    }
    else {
        let fillData = getGlobalFiller(secInDay);
        let activeOSR = library.osr.find(o => {
            if(!o.hourRaw) return false;
            let m = o.hourRaw.match(/^(\d{1,2}):(\d{2})/); if(!m) return false;
            let oSec = parseInt(m[1])*3600 + parseInt(m[2])*60;
            return secInDay >= oSec && secInDay < oSec + Math.max(5, o.dur);
        });
        if (activeOSR) { nextItem = activeOSR; seekPos = secInDay - (parseInt(activeOSR.hourRaw.split(':')[0])*3600 + parseInt(activeOSR.hourRaw.split(':')[1])*60); mode = 'OSR'; }
        else { nextItem = fillData.item; seekPos = fillData.seek; mode = nextItem.computedMode || 'FILLER'; }
    }

    if (!isDataLoaded) { nextItem = { src: SILENCE_MP3, title: "Conectando...", artist: "Sintonizando...", img: CONFIG.defaultLogo, type: "loading", dur: 300 }; mode = 'LOADING'; }
    else if (!nextItem) { nextItem = { src: SILENCE_MP3, title: "Emisión", artist: "Silencio", img: CONFIG.defaultLogo, type: "off", dur: 300 }; mode = 'OFF'; }

    currentMode = mode; if (nextItem) ejecutarAudio(nextItem, seekPos, mode);
}

function gestionarFaders(m, s, ms) {
    let e = s + (ms / 1000);
    if (m === 59) { if (e >= 54 && e < 59) faderLevel = 1.0 - ((e - 54) / 5); else if (e >= 59) { faderLevel = 0.0; if (!activeDeck.paused && !['LIVE','ESTUDIO_LIVE','NEWS','SPORTS','BREAKINGLIVE','SCHEDULE_DIRECT'].includes(currentMode)) activeDeck.pause(); } else faderLevel = 1.0; }
    else if (m === 0) faderLevel = 1.0; else if (m === 29 && e >= 55 && !['NEWS30_STRICT'].includes(currentMode)) faderLevel = 1.0 - (0.4 * ((e - 55) / 5)); else if (m === 30 && e < 3 && !['NEWS30_STRICT'].includes(currentMode)) faderLevel = 0.6 + (0.4 * (e / 3)); else faderLevel = 1.0;

    let bv = userVolume * faderLevel;
    if (currentMode === 'ESTUDIO_LIVE') {
        elLiveAudio.muted = false; elLiveAudio.volume = userVolume; deckA.volume = 0; deckB.volume = 0;
        if(!activeDeck.paused) activeDeck.pause(); if(elLiveAudio.paused && externalLiveActive) safePlay(elLiveAudio);
    } else {
        elLiveAudio.muted = true;
        let ns = Date.now() / 1000, ad = (activeDeck === deckA) ? deckA : deckB, fd = (fadingDeck === deckA) ? deckA : deckB;
        if (fadingDeck) {
            let fr = fadeOutEndTime - ns;
            if (fr <= 0 || faderLevel === 0.0) { fadingDeck.pause(); fadingDeck.removeAttribute('src'); fadingDeck = null; fd.volume = 0; ad.volume = Math.max(0, Math.min(1, bv)); }
            else { let r = fr / CONFIG.crossfadeDur; fd.volume = Math.max(0, Math.min(1, bv * r)); ad.volume = Math.max(0, Math.min(1, bv * (1 - r))); }
        } else { ad.volume = Math.max(0, Math.min(1, bv)); }
    }
}

function updateDisplay(item, badgeHtml, badgeClass) {
    let html = '<i class="fas fa-music"></i> RADIO MAITINO';
    if (badgeHtml === 'ESTUDIO_LIVE') html = '<i class="fas fa-microphone"></i> ESTUDIO EN DIRECTO';
    else if (badgeHtml === 'SPORTS') html = '<i class="fas fa-trophy"></i> DEPORTES';
    else if (badgeHtml === 'BREAKING') html = '<i class="fas fa-bolt"></i> ÚLTIMA HORA';
    else if (badgeHtml === 'BREAKINGLIVE') html = '<i class="fas fa-satellite-dish"></i> ÚLTIMA HORA DIRECTO';
    else if (badgeHtml === 'CHIMES') html = '<i class="fas fa-bell"></i> MEDIANOCHE';
    else if (badgeHtml === 'HOUR') html = '<i class="fas fa-clock"></i> SEÑAL HORARIA';
    else if (badgeHtml === 'NEWS') html = '<i class="fas fa-globe-europe"></i> BOLETÍN HORARIO';
    else if (badgeHtml === 'NEWS30' || badgeHtml === 'NEWS30_STRICT') html = '<i class="fas fa-bolt"></i> TITULARES 30';
    else if (badgeHtml === 'WEATHER') html = '<i class="fas fa-cloud-sun"></i> EL TIEMPO';
    else if (badgeHtml === 'LIVE') html = '<i class="fas fa-satellite-dish"></i> CONEXIÓN EXTERNA';
    else if (badgeHtml === 'AD') html = '<i class="fas fa-bullhorn"></i> PUBLICIDAD';
    else if (badgeHtml === 'JINGLE') html = '<i class="fas fa-wave-square"></i> RADIO MAITINO';
    else if (badgeHtml === 'SPACE') html = '<i class="fas fa-comments"></i> ESPACIO DE SERVICIO';
    else if (badgeHtml === 'PROMO') html = '<i class="fas fa-star"></i> PROMOCIÓN';
    else if (badgeHtml === 'PODCAST') html = '<i class="fas fa-history"></i> DIFERIDO';
    else if (badgeHtml === 'INTERVIEW') html = '<i class="fas fa-microphone-lines"></i> ENTREVISTA';
    else if (badgeHtml === 'EMERGENCY') html = '<i class="fas fa-triangle-exclamation"></i> ALERTA TÉCNICA';
    else if (badgeHtml === 'SHOW') html = '<i class="fas fa-broadcast-tower"></i> EN DIRECTO';
    else if (badgeHtml === 'OSR') html = '<i class="fas fa-stopwatch"></i> IDENTIFICADOR';
    else if (badgeHtml === 'LOADING') html = '<i class="fas fa-spinner fa-spin"></i> CONECTANDO...';
    else if (badgeHtml === 'OFF') html = 'FUERA DE ANTENA';

    if (badgeHtml === 'SPORTS' || item.type === 'sports') {
        let parts = item.title.split('|'); let main = parts[0].trim(); let score = parts[1] ? `<br><span class="score-box">${parts[1].trim()}</span>` : '';
        el.title.innerHTML = main + score;
    } else { el.title.innerText = item.title; }

    el.sub.innerText = item.artist; el.badge.innerHTML = html; el.badge.className = badgeClass;
    if (item.img && el.img.src !== item.img) { el.img.src = item.img; }
}

function ejecutarAudio(item, seek, mode) {
    let safeMode = mode.toUpperCase();
    if (currentSourceUrl !== item.src) {
        currentSourceUrl = item.src; fadingDeck = activeDeck; activeDeck = (activeDeck === deckA) ? deckB : deckA;
        activeDeck.src = item.src; let rt = Date.now() / 1000;
        let isStream = ['LIVE','ESTUDIO_LIVE','SPORTS','BREAKINGLIVE'].includes(safeMode);
        
        activeDeck.onloadedmetadata = () => {
            let adj = seek + ((Date.now() / 1000) - rt);
            if (!isStream && adj > 2 && (!activeDeck.duration || adj < activeDeck.duration - 1)) { try { activeDeck.currentTime = adj; } catch(e) {} }
        };
        activeDeck.oncanplay = () => {
            isTransitioning = false;
            if (['NEWS', 'HOUR', 'BREAKING', 'BREAKINGLIVE'].includes(safeMode)) { fadeOutEndTime = Date.now() / 1000; }
            else if (['NEWS30', 'NEWS30_STRICT', 'OSR'].includes(safeMode)) { fadeOutEndTime = (Date.now() / 1000) + 1.0; }
            else { fadeOutEndTime = (Date.now() / 1000) + CONFIG.crossfadeDur; }
            safePlay(activeDeck);
        };
        activeDeck.load();
        updateDisplay(item, safeMode, `status-badge ${item.type || safeMode.toLowerCase()}`);
    } else {
        let isStream = ['LIVE','ESTUDIO_LIVE','SPORTS','BREAKINGLIVE'].includes(safeMode);
        if (activeDeck.readyState >= 3 && !isStream) {
            if (Math.abs(activeDeck.currentTime - seek) > 15 && seek < activeDeck.duration - 1) { try { activeDeck.currentTime = seek; } catch(e) {} }
        }
        if (activeDeck.paused && systemOn && !isTransitioning) safePlay(activeDeck);
    }
}

function updateScheduleUI() {
    let spainNow = getSpainTime();
    let d = spainNow.getDay(), curSecs = spainNow.getHours() * 3600 + spainNow.getMinutes() * 60 + spainNow.getSeconds();
    let todayDateStr = `${String(spainNow.getDate()).padStart(2, '0')}/${String(spainNow.getMonth()+1).padStart(2, '0')}/${spainNow.getFullYear()}`;

    let showsToday = (library.schedule[d] || []).slice();
    let specialToday = library.schedule.special.filter(s => s.dateRaw === todayDateStr);
    showsToday = [...specialToday, ...showsToday].sort((a, b) => a.startSecs - b.startSecs);
    let showsTomorrow = (library.schedule[(d + 1) % 7] || []).slice().sort((a, b) => a.startSecs - b.startSecs);
    
    let upcoming = showsToday.filter(s => (s.startSecs + s.dur) > curSecs);
    let combined = upcoming.concat(showsTomorrow);
    let displayShows = combined.slice(0, 3);
    
    let html = '';
    if (displayShows.length === 0) { html = `<div class="schedule-item active"><span>Emisión Continuada</span><span class="time">--:--</span></div>`; }
    else {
        displayShows.forEach((s, i) => {
            let title = s.title.split('|')[0].trim();
            let hh = Math.floor(s.startSecs / 3600), mm = Math.floor((s.startSecs % 3600) / 60);
            let timeStr = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
            let isActive = (i === 0 && curSecs >= s.startSecs);
            html += `<div class="schedule-item ${isActive ? 'active' : ''}"><span>${title}</span><span class="time">${timeStr}</span></div>`;
        });
    }
    el.sch.innerHTML = html;
}

function visualLoop() {
    if (systemOn) {
        let t = getSpainTime(), ssNum = t.getSeconds();
        if (ssNum !== lastClockSec) {
            let hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0'), ss = String(ssNum).padStart(2, '0');
            el.clock.innerHTML = `${hh}:${mm}:${ss}`;
            if (ssNum === 0) updateScheduleUI();
            lastClockSec = ssNum;
        }
        requestAnimationFrame(visualLoop);
    }
}

async function initSystem() {
    await fetchData();
    setInterval(fetchData, CONFIG.pollInterval * 1000);
    initPeerReceiver();
    setInterval(() => { if (systemOn && (!dataConn || !dataConn.open)) maintainPersistentConnection(); else if (systemOn && !externalLiveActive) dataConn.send({ command: 'check_live' }); }, 4000);
}

// INICIALIZACIÓN DEL SISTEMA GLOBAL
initSystem();
