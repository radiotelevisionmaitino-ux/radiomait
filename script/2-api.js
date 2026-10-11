// --- 2. CONEXIÓN API Y LIBRERÍA DE GOOGLE SHEETS ---

async function fetchData() {
    try { 
        let res = await fetch(CONFIG.api, { redirect: 'follow' }); 
        let data = await res.json(); 
        processData(data); 
        isDataLoaded = true; 
        updateScheduleUI(); 
    } catch (e) { 
        console.log("API Sync Error"); 
    }
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
