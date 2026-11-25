import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ============================================================================
// VIDEO PLAYER
// ============================================================================
const videos = [
    { name: 'la nuit', src: 'vid/la nuit.webm' },
    { name: 'smoke_and_mirrors', src: 'vid/smoke_and_mirrors.webm' },
];

const videoEl = document.getElementById('main-video');
const listEl = document.getElementById('video-list');

let currentIndex = 0;

/* Costruisce l'elenco dei video cliccabili */
function buildList() {
    listEl.innerHTML = '';
    videos.forEach((v, i) => {
        const li = document.createElement('li');
        li.className = 'video-item' + (i === currentIndex ? ' active' : '');
        li.dataset.index = i;

        const name = document.createElement('span');
        name.textContent = v.name;

        /* Link esterno: apre il file video direttamente in una nuova scheda */
        const extLink = document.createElement('a');
        extLink.href = v.src;
        extLink.target = '_blank';
        extLink.rel = 'noopener noreferrer';
        extLink.className = 'external-link';
        extLink.textContent = 'Apri esternamente';
        extLink.addEventListener('click', (event) => event.stopPropagation());

        li.addEventListener('click', () => selectVideo(i));

        li.appendChild(name);
        li.appendChild(extLink);
        listEl.appendChild(li);
    });
}

/* Carica e avvia un video nel player */
function selectVideo(index) {
    currentIndex = index;
    const v = videos[currentIndex];

    videoEl.src = v.src;
    videoEl.load();
    videoEl.play().catch((err) => {
        console.warn('Impossibile avviare la riproduzione automatica:', err);
    });

    buildList();
}

/* Inizializzazione */
buildList();
selectVideo(0);


// ============================================================================
// THREE.JS - NUVOLA REATTIVA AL MOUSE (Edge Glare / Fresnel)
// ============================================================================
const canvas = document.getElementById('bg-canvas');

// 1. SETUP
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.008);

const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// 2. LUCI
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3); // Abbassata leggermente per far risaltare i bordi
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0xffffff, 400);
pointLight.position.set(0, 0, 0);
scene.add(pointLight);

// 3. BLOOM (GLARE) - Modificato per colpire solo i picchi di luce estremi
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);

// IL SEGRETO È QUI: Alzando il threshold a 0.85, solo le parti "sparate" dallo shader (i bordi) brilleranno.
bloomPass.threshold = 0.85;
bloomPass.strength = 2.5; // Glare molto forte
bloomPass.radius = 0.8;   // Raggio di sfocatura più ampio per l'effetto alone

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// 4. CREAZIONE NUVOLA E MATERIALE
const numInstances = 1500;
const geometry = new THREE.IcosahedronGeometry(1.5, 0);

const material = new THREE.MeshPhysicalMaterial({
    color: 0xaaaaaa, // Base grigio/bianca
    metalness: 0.1,
    roughness: 0.2,
    transmission: 0.6, // Leggera traslucenza per dare corpo al solido senza sovrastare il bordo
    ior: 1.5,
    thickness: 0.5,
    emissive: 0x000000, // SPENTO di base. L'illuminazione la calcola lo shader custom.
});

// HACK DELLO SHADER: Effetto Fresnel con predominanza bianca e leggero tint prismatico
material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        
        vec3 viewDir = normalize(vViewPosition);
        float dotProduct = max(dot(viewDir, normal), 0.0);
        
        float rim = 1.0 - dotProduct;
        rim = smoothstep(0.6, 1.0, rim);
        
        // 1. Calcoliamo la tinta prismatica in base all'angolo di vista
        float t = dotProduct * 1.5 - (viewDir.x + viewDir.y) * 0.6;
        vec3 a = vec3(0.5, 0.5, 0.5);
        vec3 b = vec3(0.5, 0.5, 0.5);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.00, 0.33, 0.67);
        vec3 prismTint = a + b * cos(6.28318 * (c * t + d));
        
        // 2. IL SEGRETO DELLA DESATURAZIONE: mix(coloreA, coloreB, percentuale)
        // Usiamo vec3(1.0) che è il bianco puro, e ci aggiungiamo solo il 20% (0.2) del colore prismatico.
        vec3 edgeGlowColor = mix(vec3(1.0), prismTint, 0.4);
        
        // 3. Applichiamo al bordo. Moltiplicatore 6.0 per far scattare il Bloom
        totalEmissiveRadiance += edgeGlowColor * rim * 6.0;
        `
    );
};

const instancedMesh = new THREE.InstancedMesh(geometry, material, numInstances);
const dummy = new THREE.Object3D();

// NUOVO: Array per memorizzare lo stato iniziale di ogni solido
const instanceData = [];

// Volumi di spawn (Tunnel frontale)
const spreadX = 200;
const spreadY = 150;
const depthZ = 300;
const minDistance = 15;

for (let i = 0; i < numInstances; i++) {
    const posX = (Math.random() - 0.5) * spreadX;
    const posY = (Math.random() - 0.5) * spreadY;

    // Z Forzato in negativo
    const posZ = - (Math.random() * depthZ) - minDistance;

    const rotX = Math.random() * Math.PI;
    const rotY = Math.random() * Math.PI;
    const rotZ = Math.random() * Math.PI;

    const scaleVal = Math.random() * 2 + 0.4;

    // Salviamo i dati per calcolare la rotazione fluida dopo
    instanceData.push({
        position: new THREE.Vector3(posX, posY, posZ),
        baseRotation: new THREE.Vector3(rotX, rotY, rotZ),
        currentRotation: new THREE.Vector3(rotX, rotY, rotZ),
        scale: scaleVal
    });

    dummy.position.set(posX, posY, posZ);
    dummy.rotation.set(rotX, rotY, rotZ);
    dummy.scale.set(scaleVal, scaleVal, scaleVal);

    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
}

scene.add(instancedMesh);

// 5. INTERAZIONE MOUSE
let mouseX = 0;
let mouseY = 0;
const target = new THREE.Vector2();

document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = - (event.clientY / window.innerHeight) * 2 + 1;
});

const clock = new THREE.Clock();
const lookSensitivity = 0.1; // Appena sensibile

// 6. ANIMAZIONE
function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();

    target.x = -(mouseX * lookSensitivity);
    target.y = mouseY * lookSensitivity;

    // Interpolazione ultra-fluida della telecamera
    camera.rotation.y += 0.03 * (target.x - camera.rotation.y);
    camera.rotation.x += 0.03 * (target.y - camera.rotation.x);

    // Effetto galleggiamento (Floating) dell'intera nuvola
    instancedMesh.position.y = Math.sin(elapsedTime * 0.5) * 2;
    instancedMesh.position.x = Math.cos(elapsedTime * 0.3) * 1.5;

    // --- NUOVO: Rotazione dinamica individuale dei solidi ---
    // Usiamo un moltiplicatore più alto (es. 1.5) per rendere la rotazione
    // locale più evidente rispetto al movimento della telecamera.
    const instanceTargetRotX = mouseY * 1.5;
    const instanceTargetRotY = mouseX * 1.5;

    for (let i = 0; i < numInstances; i++) {
        const data = instanceData[i];

        // Lerp per ruotare in modo morbido verso la direzione del mouse
        data.currentRotation.x += (data.baseRotation.x + instanceTargetRotX - data.currentRotation.x) * 0.05;
        data.currentRotation.y += (data.baseRotation.y + instanceTargetRotY - data.currentRotation.y) * 0.05;

        // Aggiorniamo il "dummy" con i nuovi valori
        dummy.position.copy(data.position);
        dummy.rotation.set(data.currentRotation.x, data.currentRotation.y, data.baseRotation.z);
        dummy.scale.set(data.scale, data.scale, data.scale);

        // Calcoliamo e applichiamo la nuova matrice
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
    }

    // Essenziale: diciamo a WebGL di caricare i nuovi dati della matrice sulla GPU
    instancedMesh.instanceMatrix.needsUpdate = true;

    composer.render();
}

animate();

// 7. RESPONSIVE
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});
