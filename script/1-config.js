// --- 1. CONFIGURACIÓN Y ESTADO GLOBAL ---
const CONFIG = {
    api: "https://script.google.com/macros/s/AKfycbzoQfFFkwSOoZlnX73FKn8lEtbcRSEe6CYXPeuZ6tZPG5OsBuXivvvGtBJhGJhPC7GU/exec",
    crossfadeDur: 3, pollInterval: 90,
    defaultLogo: "https://ia600602.us.archive.org/32/items/r-maitino-psd-1400.1400/r%20maitino%20psd%201400.1400.png"
};
const MASTER_ID = 'maitino-studio-host';
const SILENCE_MP3 = "data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABpRDIzIHYyLjMuMCBhbmQgaWQzIHYyLjQuMCB0YWdzAAAAAAAAAAAA//MkxAAKAAAABpAAAAWSAAAAASU1BTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

// Variables de Estado
let systemOn = false, userVolume = 0.9, faderLevel = 1.0, currentSourceUrl = "", currentMode = 'FILLER';
let deckA = document.getElementById('deck-a'), deckB = document.getElementById('deck-b');
let activeDeck = deckA, fadingDeck = null, fadeOutEndTime = 0, isTransitioning = false;
let isDataLoaded = false, visStartTime = Date.now();
let peerReceiver = null, externalLiveActive = false, dataConn = null;
let elLiveAudio = document.getElementById('external-live-audio'); elLiveAudio.muted = true;

// Variables de WebAudio (Stream Infinito)
let audioCtx, masterStreamDestination, virtualLiveStream;
let nodeA, nodeB, nodeLive;
deckA.crossOrigin = "anonymous";
deckB.crossOrigin = "anonymous";
elLiveAudio.crossOrigin = "anonymous";

// Librería y Control de Tiempo
let library = { news: null, news30: null, news30_strict: null, chimes: null, weather: null, hours: {}, breaking: null, ads: [], jingles: [], spaces: [], promos: [], osr: [], filler: [], schedule: {0:[],1:[],2:[],3:[],4:[],5:[],6:[], special:[]} };
let lastPipFired = -1, lastScheduleSec = -1, lastClockSec = -1;

// Elementos del DOM
const el = {
    clock: document.getElementById('clock'), title: document.getElementById('main-title'), sub: document.getElementById('sub-title'),
    img: document.getElementById('art-img'), badge: document.getElementById('status-badge'), tally: document.getElementById('tally'),
    btn: document.getElementById('pwr-btn'), sch: document.getElementById('schedule-list'), canvas: document.getElementById('visualizer-canvas'),
    bannerContainer: document.getElementById('news-banner-container'), bannerText: document.getElementById('news-banner-text')
};

// Utilidades Globales
function getSpainTime() {
    let now = new Date();
    let pts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(now);
    let v = {}; pts.forEach(p => v[p.type] = p.value);
    return new Date(v.year, v.month - 1, v.day, (v.hour === "24" ? 0 : v.hour), v.minute, v.second, now.getMilliseconds());
}

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
