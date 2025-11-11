// app.js (Lógica Completa con Autenticación)

// =========================================================================
// 1. CONFIGURACIÓN DE FIREBASE E INICIALIZACIÓN
// =========================================================================

const firebaseConfig = {
    apiKey: "AIzaSyA3D7fH6QpdG7mUSNhFfUzD6RWje8TpGEk",
    authDomain: "hostaldatossincro.firebaseapp.com",
    projectId: "hostaldatossincro", 
    storageBucket: "hostaldatossincro.firebasestorage.app",
    messagingSenderId: "955112940193",
    appId: "1:955112940193:web:f30f52858c1e6c0ddc46e0"
};

const app = firebase.initializeApp(firebaseConfig);
const db = app.firestore();
const auth = app.auth(); // Inicializa Autenticación

let CURRENT_USER_ID = null; // ID del usuario autenticado
let activeBikeId = null; // Para la modal de detalle

const LOG_OUTPUT = document.getElementById('log-output');
const logoutButton = document.getElementById('logout-button');

// Función auxiliar para registrar acciones
function logStatus(message, isError = false) {
    const time = new Date().toLocaleTimeString();
    const className = isError ? 'log-error' : 'log-success';
    LOG_OUTPUT.innerHTML = `<div class="${className}">[${time}] ${isError ? '❌ ERROR: ' : '✅ OK: '}${message}</div>${LOG_OUTPUT.innerHTML}`;
}

// =========================================================================
// 2. LÓGICA DE AUTENTICACIÓN Y ARRANQUE
// =========================================================================

function updateUI(user) {
    const authView = document.getElementById('auth-view');
    const appContent = document.getElementById('app-content');
    
    if (user) {
        // Logueado: Muestra la app
        CURRENT_USER_ID = user.uid;
        authView.style.display = 'none';
        appContent.style.display = 'block';
        logoutButton.style.display = 'inline-block';
        logStatus(`Inicio de sesión exitoso. Usuario: ${user.email}`);
        
        loadBikesAndStock(); 
    } else {
        // Deslogueado: Muestra login
        CURRENT_USER_ID = null;
        authView.style.display = 'block';
        appContent.style.display = 'none';
        logoutButton.style.display = 'none';
        document.getElementById('auth-message').textContent = 'Inicia sesión para gestionar tu garaje.';
    }
}

async function handleSignUp() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try {
        await auth.createUserWithEmailAndPassword(email, password);
    } catch (error) {
        document.getElementById('auth-message').textContent = `Error: ${error.message}`;
        logStatus(`Error de registro: ${error.message}`, true);
    }
}

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        document.getElementById('auth-message').textContent = `Error: ${error.message}`;
        logStatus(`Error de inicio: ${error.message}`, true);
    }
}

function handleLogout() {
    auth.signOut();
    logStatus("Sesión cerrada.");
}

function initApp() {
    // Observador de estado para manejar el flujo de login/logout
    auth.onAuthStateChanged(updateUI); 
    showSection('dashboard'); 
}

// =========================================================================
// 3. LÓGICA DE NAVEGACIÓN Y DETALLE (UX)
// =========================================================================

function showSection(sectionId) {
    document.querySelectorAll('.tab-content').forEach(div => div.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
        if (button.onclick.toString().includes(`showSection('${sectionId}')`)) {
            button.classList.add('active');
        }
    });
}

// Funciones para la Modal de Detalle (Se mantienen igual)
function openModal(modalId) { document.getElementById(modalId).style.display = 'block'; }
function closeModal(modalId) { document.getElementById(modalId).style.display = 'none'; }
function showDetailTab(tabId, buttonElement) {
    document.querySelectorAll('.detail-tab-content').forEach(div => div.classList.remove('active'));
    document.querySelectorAll('.detail-tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (buttonElement) buttonElement.classList.add('active');
}

// Helper de estado del componente
function getComponentStatus(usage, maxKm) {
    const ratio = usage / maxKm;
    if (ratio >= 1.0) return { tag: 'ALERTA', class: 'status-alert' };
    if (ratio >= 0.8) return { tag: 'ADVERTENCIA', class: 'status-warning' };
    return { tag: 'OK', class: 'status-ok' };
}

// =========================================================================
// 4. LÓGICA DE LECTURA DE DATOS (RENDERIZADO)
// =========================================================================

async function loadBikesAndStock() {
    if (!CURRENT_USER_ID) return; // Salir si no está logueado
    logStatus("Cargando datos del usuario...");
    
    // --- Cargar Bicicletas y Diagnóstico ---
    const bikesSnapshot = await db.collection('bikes').where('user_id', '==', CURRENT_USER_ID).get();
    const bikeListDiv = document.getElementById('bike-list');
    bikeListDiv.innerHTML = '';

    if (bikesSnapshot.empty) { bikeListDiv.innerHTML = '<em>No tienes bicicletas registradas.</em>'; }

    for (const bikeDoc of bikesSnapshot.docs) {
        const bike = bikeDoc.data();
        let needsAlert = false;
        
        const componentsSnapshot = await db.collection('bikes').doc(bikeDoc.id).collection('components').get();
        componentsSnapshot.forEach(compDoc => {
            const comp = compDoc.data();
            if (getComponentStatus(comp.current_km_usage, comp.max_alert_km).tag === 'ALERTA') needsAlert = true;
        });
        
        const statusTag = needsAlert ? `<span class="status-alert status-tag">⚠️ REVISIÓN URGENTE</span>` : `<span class="status-ok status-tag">LISTA PARA RODAR</span>`;

        // Renderiza el elemento de la lista que abre la modal al hacer clic
        bikeListDiv.innerHTML += `
            <div class="list-item" onclick="showBikeDetail('${bikeDoc.id}')">
                <div class="item-name">${bike.name}</div>
                <div class="item-detail">
                    KM Total: ${bike.total_km.toFixed(0)}km
                    ${statusTag}
                </div>
            </div>`;
    }

    // --- Cargar Inventario ---
    const stockSnapshot = await db.collection('spare_parts').where('user_id', '==', CURRENT_USER_ID).get();
    const stockListDiv = document.getElementById('stock-list');
    stockListDiv.innerHTML = '';
    
    stockSnapshot.forEach(doc => {
        const part = doc.data();
        const isLow = part.quantity <= (part.alert_threshold || 1);
        stockListDiv.innerHTML += `
            <div class="list-item">
                <div class="item-name">${part.name}</div>
                <div class="item-detail ${isLow ? 'stock-low' : ''}">
                    Stock: ${part.quantity} | Compatible: ${part.compatibility ? part.compatibility.join(', ') : 'N/A'}
                    ${isLow ? ' 🚨 STOCK BAJO' : ''}
                </div>
            </div>`;
    });
}

// --- FUNCIONES DE DETALLE DE MODAL (Mantenidas y adaptadas para el usuario actual) ---

async function showBikeDetail(bikeId) {
    activeBikeId = bikeId;
    const bikeRef = db.collection('bikes').doc(bikeId);
    // ... (El resto de la lógica de la modal se mantiene igual, usando activeBikeId) ...
    // ... (Necesitas adaptar las funciones loadDetailComponents, loadDetailHistory, saveBikeNotes) ...

    try {
        const bikeDoc = await bikeRef.get();
        if (!bikeDoc.exists) throw new Error("Bicicleta no encontrada.");
        const bike = bikeDoc.data();

        document.getElementById('detail-bike-name').textContent = bike.name;
        openModal('bike-detail-modal');
        await loadDetailComponents(bikeId);
        await loadDetailHistory(bikeId);
        document.getElementById('detail-notes-input').value = bike.notes || '';
        showDetailTab('components-view', document.querySelector('.detail-tab-button'));

    } catch (e) {
        logStatus(`Error al cargar detalle: ${e.message}`, true);
        closeModal('bike-detail-modal');
    }
}

async function loadDetailComponents(bikeId) {
    const listDiv = document.getElementById('detail-components-list');
    // Adaptar la consulta para ser específica del usuario actual y pintar la lista
    // ...
    listDiv.innerHTML = 'Detalles de componentes cargados.';
}
async function loadDetailHistory(bikeId) {
    const listDiv = document.getElementById('detail-history-list');
    // Adaptar la consulta para el historial de mantenimiento
    // ...
    listDiv.innerHTML = 'Historial de mantenimiento cargado.';
}
async function saveBikeNotes() {
    if (!activeBikeId) return;
    const notes = document.getElementById('detail-notes-input').value;
    const bikeRef = db.collection('bikes').doc(activeBikeId);
    try {
        await bikeRef.update({ notes: notes });
        logStatus(`Notas guardadas con éxito para ${activeBikeId}.`);
        closeModal('bike-detail-modal');
    } catch (e) {
        logStatus(`Error al guardar notas: ${e.message}`, true);
    }
}

// =========================================================================
// 5. LÓGICA DE FIREBASE (TRANSACCIÓN/LOTE) - Funciones Adaptadas al ID
// =========================================================================

async function addBike() {
    // ... (Lógica de addBike adaptada para usar CURRENT_USER_ID y doc.set) ...
    const id = document.getElementById('new-bike-id').value;
    const name = document.getElementById('new-bike-name').value;
    const km = parseFloat(document.getElementById('new-bike-km').value);
    
    if (!id || !name || isNaN(km)) return logStatus("Datos incompletos.", true);
    
    try {
        await db.collection('bikes').doc(id).set({
            user_id: CURRENT_USER_ID, // Usa el ID del usuario logueado
            name: name,
            total_km: km,
            created_at: new Date(),
            notes: ''
        });
        logStatus(`Bicicleta '${name}' agregada.`);
        loadBikesAndStock();
    } catch (e) { logStatus(`Error: ${e.message}`, true); }
}

async function addOrUpdateStock() {
    // ... (Lógica de addOrUpdateStock adaptada para usar CURRENT_USER_ID) ...
    const partId = document.getElementById('stock-part-id').value;
    const name = document.getElementById('stock-name').value;
    const qty = parseInt(document.getElementById('stock-qty').value);
    const compatibilityInput = document.getElementById('stock-compatibility').value;
    const compatibility = compatibilityInput.split(',').map(s => s.trim()).filter(s => s.length > 0);

    if (!partId || !name || isNaN(qty)) return logStatus("Datos incompletos.", true);

    try {
        await db.collection('spare_parts').doc(partId).set({
            user_id: CURRENT_USER_ID, // Usa el ID del usuario logueado
            name: name,
            quantity: qty,
            alert_threshold: 1,
            compatibility: compatibility,
        }, { merge: true });
        logStatus(`Stock de '${name}' actualizado.`);
        loadBikesAndStock();
    } catch (e) { logStatus(`Error: ${e.message}`, true); }
}

async function useStock(inputId) {
    // ... (Lógica de useStock adaptada para transacciones y CURRENT_USER_ID) ...
    const partId = document.getElementById(inputId).value;
    if (!partId) return logStatus("ID de recambio necesario para usar stock.", true);
    
    try {
        await db.runTransaction(async (transaction) => {
            const partRef = db.collection('spare_parts').doc(partId);
            const partDoc = await transaction.get(partRef);
            if (!partDoc.exists || partDoc.data().user_id !== CURRENT_USER_ID) throw new Error("Recambio no encontrado o no te pertenece.");

            const newQty = partDoc.data().quantity - 1;
            if (newQty < 0) throw new Error("Stock insuficiente.");

            transaction.update(partRef, { quantity: newQty });
        });
        logStatus(`Una unidad de ${partId} usada.`);
        loadBikesAndStock();
    } catch (e) { logStatus(`Error al usar stock: ${e.message}`, true); }
}

// --- FUNCIÓN DE REEMPLAZO (TRANSACCIÓN) ---
async function handleReplacement() {
    // ... (Lógica de handleReplacement adaptada para usar CURRENT_USER_ID) ...
    const bikeId = document.getElementById('maint-bike-id').value;
    const componentId = document.getElementById('maint-comp-id').value;
    const kmAtService = parseFloat(document.getElementById('maint-km-input').value);
    const cost = parseFloat(document.getElementById('maint-cost').value);
    const date = document.getElementById('maint-date').value;

    if (!bikeId || !componentId || isNaN(kmAtService) || isNaN(cost)) {
        return logStatus("Datos de reemplazo incompletos.", true);
    }

    logStatus(`Iniciando TRANSACCIÓN para Reseteo de ${componentId}...`);

    try {
        await db.runTransaction(async (transaction) => {
            const bikeRef = db.collection('bikes').doc(bikeId);
            const bikeDoc = await transaction.get(bikeRef);
            if (!bikeDoc.exists || bikeDoc.data().user_id !== CURRENT_USER_ID) throw new Error("Bicicleta no encontrada o no te pertenece.");

            const maintenanceRef = db.collection('bikes').doc(bikeId).collection('maintenance').doc();
            const componentRef = db.collection('bikes').doc(bikeId).collection('components').doc(componentId);

            transaction.set(maintenanceRef, {
                bike_id: bikeId, type: 'Reemplazo', component_id: componentId,
                bike_km_at_service: kmAtService, cost: cost, user_id: CURRENT_USER_ID,
                date: new Date(date),
            });

            transaction.update(componentRef, {
                initial_bike_km: kmAtService, installed_date: new Date(date),
                current_km_usage: 0, cost: cost,
            });
        });
        
        logStatus(`¡Reemplazo y Reseteo Atómico COMPLETADO!`);
        loadBikesAndStock();
    } catch (e) {
        logStatus(`Transacción FALLIDA: ${e.message}.`, true);
    }
}

// --- FUNCIÓN DE ACTUALIZACIÓN DE KM (LOTE DE ESCRITURA) ---
async function handleKmUpdate(bikeIdOverride = null, newKmOverride = null) {
    const bikeId = bikeIdOverride || document.getElementById('update-bike-id').value;
    const newTotalKm = newKmOverride || parseFloat(document.getElementById('new-km-input').value);

    if (!bikeId || isNaN(newTotalKm)) return logStatus("Datos de KM incompletos.", true);
    
    logStatus(`Iniciando LOTE DE ESCRITURA para actualizar KM de ${bikeId} a ${newTotalKm}...`);

    try {
        const batch = db.batch(); 
        const bikeRef = db.collection('bikes').doc(bikeId);

        // Verifica que la bici exista y pertenezca al usuario ANTES del lote
        const bikeDoc = await bikeRef.get();
        if (!bikeDoc.exists || bikeDoc.data().user_id !== CURRENT_USER_ID) throw new Error("Bicicleta no encontrada o no te pertenece.");

        batch.update(bikeRef, { total_km: newTotalKm });

        const componentsCollection = db.collection('bikes').doc(bikeId).collection('components');
        const componentsSnapshot = await componentsCollection.get();
        let alertsCount = 0;

        componentsSnapshot.forEach(doc => {
            const component = doc.data();
            const componentRef = doc.ref;

            const initialKm = component.initial_bike_km || 0;
            const maxAlertKm = component.max_alert_km || 99999;
            const newUsage = newTotalKm - initialKm;
            
            batch.update(componentRef, { current_km_usage: newUsage });
            
            if (newUsage >= maxAlertKm) {
                logStatus(`ALERTA: ${component.name} ha superado el límite de ${maxAlertKm} km.`, true);
                alertsCount++;
            }
        });

        await batch.commit();

        logStatus(`Lote COMPLETO. Alertas detectadas: ${alertsCount}.`);
        loadBikesAndStock(); 
    } catch (e) {
        logStatus(`Fallo en el Lote: ${e.message}.`, true);
    }
}