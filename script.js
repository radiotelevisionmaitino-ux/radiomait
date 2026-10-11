// 1. URL DE TU GOOGLE SHEETS (Formato CSV)
// Reemplaza esto con el enlace CSV de tu hoja de cálculo
const SHEET_CSV_URL = "AQUI_IRA_TU_ENLACE_DE_GOOGLE_SHEETS_EN_FORMATO_CSV";

// Elementos del DOM
const audioPlayer = document.getElementById('audio-player');
const playBtn = document.getElementById('play-btn');
const currentTrackLabel = document.getElementById('current-track');
const newsText = document.getElementById('news-text');

let isPlaying = false;
let playlist = []; // Aquí se guardarán las canciones del Excel
let currentTrackIndex = 0;

// 2. FUNCIÓN PARA LEER GOOGLE SHEETS
async function cargarDatosDesdeSheets() {
    try {
        // En una situación real, aquí hariamos el fetch:
        // const response = await fetch(SHEET_CSV_URL);
        // const data = await response.text();
        
        // DATOS DE PRUEBA (Para que te funcione a la primera antes de conectar tu Excel)
        // Imagina que tu Excel tiene 2 columnas: "Tipo" y "Contenido"
        const datosSimulados = [
            { tipo: "noticia", contenido: "ÚLTIMA HORA: Radio Maitino inicia sus emisiones de prueba. | El tiempo para mañana será soleado." },
            { tipo: "cancion", contenido: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", titulo: "Programa de Mañana - Pista 1" },
            { tipo: "cancion", contenido: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", titulo: "Música sin interrupciones - Pista 2" }
        ];

        procesarDatos(datosSimulados);
    } catch (error) {
        console.error("Error al cargar Google Sheets:", error);
        currentTrackLabel.textContent = "Error de conexión";
    }
}

// 3. PROCESAR DATOS (Separar noticias de canciones)
function procesarDatos(datos) {
    datos.forEach(fila => {
        if (fila.tipo === "noticia") {
            newsText.textContent = fila.contenido;
        } else if (fila.tipo === "cancion") {
            playlist.push({ url: fila.contenido, titulo: fila.titulo });
        }
    });

    // Si hay canciones, preparamos la primera
    if (playlist.length > 0) {
        prepararCancion(0);
    }
}

// 4. LÓGICA DEL REPRODUCTOR (Falso Directo Básico)
function prepararCancion(index) {
    audioPlayer.src = playlist[index].url;
    currentTrackLabel.textContent = playlist[index].titulo;
    
    // Cuando acabe una pista, pasa a la siguiente automáticamente sin que el usuario haga nada
    audioPlayer.onended = function() {
        currentTrackIndex++;
        if (currentTrackIndex >= playlist.length) {
            currentTrackIndex = 0; // Vuelve a empezar si se acaba la lista (Loop 24/7)
        }
        prepararCancion(currentTrackIndex);
        audioPlayer.play();
    };
}

// Control del botón Play/Pause
playBtn.addEventListener('click', () => {
    if (isPlaying) {
        audioPlayer.pause();
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
    } else {
        audioPlayer.play();
        playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    }
    isPlaying = !isPlaying;
});

// Iniciar la carga al abrir la página
cargarDatosDesdeSheets();
