const CONFIG = {
    api: "https://script.google.com/macros/s/AKfycbzoQfFFkwSOoZlnX73FKn8lEtbcRSEe6CYXPeuZ6tZPG5OsBuXivvvGtBJhGJhPC7GU/exec",
    crossfadeDur: 3, pollInterval: 90,
    defaultLogo: "https://ia600602.us.archive.org/32/items/r-maitino-psd-1400.1400/r%20maitino%20psd%201400.1400.png"
};
const MASTER_ID = 'maitino-studio-host';
const SILENCE_MP3 = "data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABpRDIzIHYyLjMuMCBhbmQgaWQzIHYyLjQuMCB0YWdzAAAAAAAAAAAA//MkxAAKAAAABpAAAAWSAAAAASU1BTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

let systemOn = false, userVolume = 0.9, faderLevel = 1.0, currentSourceUrl = "", currentMode = 'FILLER';
let deckA = document.getElementById('deck-a'), deckB = document.getElementById('deck-b');
let activeDeck = deckA, fadingDeck = null, fadeOutEndTime = 0, isTransitioning = false;
let isDataLoaded = false, visStartTime = Date.now();
let peerReceiver = null, externalLiveActive = false, dataConn = null;
let elLiveAudio = document.getElementById('external-live-audio'); elLiveAudio.muted = true;

let library = { news: null, news30: null, news30_strict: null, chimes: null, weather: null, hours: {}, breaking: null, ads: [], jingles: [], spaces: [], promos: [], osr: [], filler: [], schedule: {0:[],1:[],2:[],3:[],4:[],5:[],6:[], special:[]} };
let audioCtx, lastPipFired = -1, lastScheduleSec = -1, lastClockSec = -1;

const el = {
    clock: document.getElementById('clock'), title: document.getElementById('main-title'), sub: document.getElementById('sub-title'),
    img: document.getElementById('art-img'), badge: document.getElementById('status-badge'), tally: document.getElementById('tally'),
    btn: document.getElementById('pwr-btn'), sch: document.getElementById('schedule-list'), canvas: document.getElementById('visualizer-canvas'),
    bannerContainer: document.getElementById('news-banner-container'), bannerText: document.getElementById('news-banner-text')
};

function safePlay(audioElem) {
    if (!audioElem || !audioElem.src || audioElem.src === window.location.href) return;
    let playPromise = audioElem.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => {
            setTimeout(() => {
                if (systemOn && audioElem.paused) {
                    audioElem.load();
                    audioElem.play().catch(e=>console.error("Fallo de auto-play"));
                }
            }, 1000);
        });
    }
}

function updateBtnState() {
    if (!systemOn) el.btn.innerHTML = '<i class="fas fa-power-off"></i>';
    else if (activeDeck.src && (activeDeck.readyState < 3 && !activeDeck.paused) && !['ESTUDIO_LIVE', 'LIVE', 'BREAKINGLIVE', 'SPORTS'].includes(currentMode)) el.btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    else el.btn.innerHTML = '<i class="fas fa-stop"></i>';
}
[deckA, deckB].forEach(d => { ['waiting','playing','canplay','stalled'].forEach(e => d.addEventListener(e, updateBtnState)); });

function getSpainTime() {
    let now = new Date();
    let pts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(now);
    let v = {}; pts.forEach(p => v[p.type] = p.value);
    return new Date(v.year, v.month - 1, v.day, (v.hour === "24" ? 0 : v.hour), v.minute, v.second, now.getMilliseconds());
}

async function initSystem() {
    await fetchData();
    setInterval(fetchData, CONFIG.pollInterval * 1000);
    initPeerReceiver();
    setInterval(() => { if (systemOn && (!dataConn || !dataConn.open)) maintainPersistentConnection(); else if (systemOn && !externalLiveActive) dataConn.send({ command: 'check_live' }); }, 4000);
}

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

async function fetchData() {
    try { let res = await fetch(CONFIG.api, { redirect: 'follow' }); let data = await res.json(); processData(data); isDataLoaded = true; updateScheduleUI(); } catch (e) { console.log("API Sync Error"); }
}

function addToSchedule(item) {
    let s2 = String(item.hourRaw||"").trim(); let startSecs = -1;
    let m = s2.match(/^(\d{1,2}):(\d{2})/);
    if (m) startSecs = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
    if(startSecs === -1) return;

    if (item.dateRaw) {
        library.schedule.special.push({ ...item, startSecs: startSecs });
        return;
    }

    let days = []; let s1 = String(item.dayRaw || "").trim();
    if (s1 && s1.toLowerCase() !== "null") {
        s1.split(/[,|]/).forEach(p => {
            p = p.trim();
            if (p.includes('-')) { let l = p.split('-'); for (let i = parseInt(l[0]); i <= parseInt(l[1]); i++) days.push(i); }
            else if (p !== "") { days.push(parseInt(p)); }
        });
    }
    if (days.length === 0) days = [0, 1, 2, 3, 4, 5, 6];
    [...new Set(days)].forEach(d => { if(library.schedule[d]) library.schedule[d].push({ ...item, startSecs: startSecs, exactDay: true }); });
}

function processData(data) {
    library = { news: null, news30: null, news30_strict: null, chimes: null, weather: null, hours: {}, breaking: null, ads: [], jingles: [], spaces: [], promos: [], osr: [], filler: [], schedule: {0:[],1:[],2:[],3:[],4:[],5:[],6:[], special:[]} };
    let now = getSpainTime();
    let dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    let bannerContent = "";

    data.forEach(row => {
        if (!row.type || String(row.type).trim() === "") return;
        let t = row.type.toLowerCase().replace(/\s+/g, '');

        if (t === 'banner') { bannerContent += (bannerContent ? " &nbsp;&nbsp;&bull;&nbsp;&nbsp; " : "") + row.title; return; }
        if (t === 'theme') {
            if(String(row.title).toLowerCase() === 'dark') document.body.classList.add('theme-dark');
            else document.body.classList.remove('theme-dark');
            return;
        }

        let rawSrc = row.src ? row.src.trim() : "";
        let finalSrc = rawSrc;
        let finalDur = parseInt(row.duration) || 300;

        if (rawSrc.includes('|')) {
            let audioList = rawSrc.split('|').map(u => u.trim());
            let durList = String(row.duration || "").split('|').map(d => parseInt(d.trim()));
            if (audioList.length > 0) {
                let chosenIndex = dayOfYear % audioList.length;
                finalSrc = audioList[chosenIndex];
                finalDur = durList[chosenIndex] || durList[0] || 300;
            }
        }

        let item = {
            src: finalSrc, title: row.title || "Emisión", artist: row.artist || "Radio Maitino",
            img: row.image || "", dur: finalDur, type: t, dayRaw: row.day, hourRaw: row.hour, dateRaw: row.date
        };

        if (t === 'news') library.news = item;
        else if (t === 'news30') library.news30 = item;
        else if (t === 'news30_strict') library.news30_strict = item;
        else if (t === 'weather') library.weather = item;
        else if (t === 'chimes') library.chimes = item;
        else if (t === 'hour') { let m = String(item.hourRaw||"").trim().match(/^(\d{1,2}):(\d{2})/); if(m) library.hours[parseInt(m[1], 10)] = item; else library.hours['default'] = item; }
        else if (['breaking', 'breakinglive', 'estudiolive', 'emergency'].includes(t)) {
            if (item.dayRaw || item.hourRaw || item.dateRaw) { item.type = t === 'emergency' ? 'emergency' : 'estudio_live_scheduled'; addToSchedule(item); }
            else { item.type = t === 'emergency' ? 'emergency' : (t.includes('estudio') ? 'estudio_live_breaking' : (t === 'breakinglive' ? 'breakinglive' : 'breaking')); library.breaking = item; }
        }
        else if (t === 'jingle') library.jingles.push(item);
        else if (t === 'ad') library.ads.push(item);
        else if (t === 'promo') library.promos.push(item);
        else if (t === 'osr') library.osr.push(item);
        else if (['schedule', 'schedule_direct', 'live', 'podcast', 'interview', 'off', 'sports'].includes(t)) {
            if (item.dayRaw || item.hourRaw || item.dateRaw) addToSchedule(item); else library.filler.push(item);
        } else { library.filler.push(item); }
    });

    if (bannerContent) {
        el.bannerContainer.style.display = 'block';
        el.bannerText.innerHTML = bannerContent;
    } else {
        el.bannerContainer.style.display = 'none';
    }
}

function initAudio() {
    if (!audioCtx) { audioCtx = new(window.AudioContext || window.webkitAudioContext)(); requestAnimationFrame(drawVisualizer); }
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
initSystem();
