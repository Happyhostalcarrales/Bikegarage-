// app.js (Finalizado y Mejorado para CRM)

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
const auth = app.auth(); 

let CURRENT_USER_ID = null;
let activeBikeId = null; 

const LOG_OUTPUT = document.getElementById('log-output');

function logStatus(message, isError = false) {
    const time = new Date().toLocaleTimeString();
    const className = isError ? 'log-error' : 'log-success';
    LOG_OUTPUT.innerHTML = `<div class="${className}">[${time}] ${isError ? '❌ ERROR: ' : '✅ OK: '}${message}</div>${LOG_OUTPUT.innerHTML}`;
}

const REPAIR_STATUSES = {
    'ENTRADA': { name: 'En Entrada', class: 'col-entrada' },
    'DIAGNOSTICO': { name: 'En Taller', class: 'col-taller' },
    'FINALIZADO': { name: 'Finalizado', class: 'col-finalizado' }
};

// =========================================================================
// 2. LÓGICA DE AUTENTICACIÓN Y ARRANQUE
// =========================================================================

function updateUI(user) {
    const authView = document.getElementById('auth-view');
    const appContent = document.getElementById('app-content');
    
    if (user) {
        CURRENT_USER_ID = user.uid;
        authView.style.display = 'none';
        appContent.style.display = 'block';
        document.getElementById('logout-button').style.display = 'inline-block';
        logStatus(`Inicio de sesión exitoso. Usuario: ${user.email}`);
        
        loadBikesAndStock(); // Llama a la función que inicia la carga del Panel y Stock
    } else {
        CURRENT_USER_ID = null;
        authView.style.display = 'block';
        appContent.style.display = 'none';
        document.getElementById('logout-button').style.display = 'none';
        document.getElementById('auth-message').textContent = 'Inicia sesión para gestionar tu garaje.';
    }
}

async function handleSignUp() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const authMessage = document.getElementById('auth-message');

    try {
        await auth.createUserWithEmailAndPassword(email, password);
        authMessage.textContent = 'Registro exitoso. ¡Iniciando sesión!';
    } catch (error) {
        authMessage.textContent = `Error de registro: ${error.message}`;
        logStatus(`Error de registro: ${error.message}`, true);
    }
}

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const authMessage = document.getElementById('auth-message');

    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        authMessage.textContent = `Error de inicio de sesión: ${error.message}`;
        logStatus(`Error de inicio: ${error.message}`, true);
    }
}

function handleLogout() {
    auth.signOut();
    logStatus("Sesión cerrada.");
}

function initApp() {
    auth.onAuthStateChanged(updateUI); 
    showSection('dashboard'); 
}

// =========================================================================
// 3. LÓGICA DE GESTIÓN DE TALLER (CRM KANBAN)
// =========================================================================

async function loadRepairBoard() {
    if (!CURRENT_USER_ID) return;
    
    const boardContainer = document.getElementById('panel-board-container');
    boardContainer.innerHTML = ''; 

    // Obtener todas las bicicletas para referenciar los nombres
    const bikesMap = new Map();
    const bikesSnapshot = await db.collection('bikes').where('user_id', '==', CURRENT_USER_ID).get();
    bikesSnapshot.forEach(doc => bikesMap.set(doc.id, doc.data().name));

    // Consultar todos los registros de mantenimiento (historial) del usuario
    const maintenanceSnapshot = await db.collectionGroup('maintenance')
        .where('user_id', '==', CURRENT_USER_ID)
        .orderBy('date', 'desc')
        .get();

    const statusPanels = { 'ENTRADA': [], 'DIAGNOSTICO': [], 'FINALIZADO': [] };
    
    // Organizar los trabajos por estado
    maintenanceSnapshot.forEach(doc => {
        const record = doc.data();
        const status = record.status || 'FINALIZADO'; // Si no tiene estado, asumimos finalizado (historial)
        
        // Solo mostramos en el panel trabajos no finalizados, o los finalizados más recientes
        if (status !== 'FINALIZADO' || statusPanels['FINALIZADO'].length < 5) {
             if (statusPanels[status]) {
                statusPanels[status].push({
                    id: doc.id,
                    bikeName: bikesMap.get(record.bike_id) || record.bike_id,
                    ...record
                });
            }
        }
    });

    // Renderizar los Paneles (Columnas Kanban)
    for (const key in REPAIR_STATUSES) {
        const statusInfo = REPAIR_STATUSES[key];
        const trabajos = statusPanels[key];
        
        let cardsHTML = trabajos.map(job => `
            <div class="kanban-card" onclick="openMaintenanceDetail('${job.id}')">
                <div class="card-title">${job.bikeName}</div>
                <div class="card-detail">Tarea: ${job.type} - ${job.component_id || 'Servicio General'}</div>
                <div class="status-changer">
                    <select onchange="changeRepairStatus('${job.bike_id}', '${job.id}', this.value)">
                        ${Object.keys(REPAIR_STATUSES).map(statusKey => `
                            <option value="${statusKey}" ${statusKey === key ? 'selected' : ''}>${REPAIR_STATUSES[statusKey].name}</option>
                        `).join('')}
                    </select>
                </div>
            </div>
        `).join('');

        boardContainer.innerHTML += `
            <div class="kanban-column ${statusInfo.class}">
                <div class="column-header ${statusInfo.class}">${statusInfo.name} (${trabajos.length})</div>
                <div class="column-body">
                    ${cardsHTML || '<p style="font-size:0.9em; color:#bdc3c7;">No hay trabajos aquí.</p>'}
                </div>
            </div>`;
    }
}

async function changeRepairStatus(bikeId, maintenanceId, newStatus) {
    if (!CURRENT_USER_ID) return logStatus("Debe iniciar sesión.", true);

    try {
        const recordRef = db.collection('bikes').doc(bikeId).collection('maintenance').doc(maintenanceId);
        
        await recordRef.update({
            status: newStatus,
            date_updated: new Date()
        });
        
        logStatus(`Estado de ${maintenanceId} actualizado a ${REPAIR_STATUSES[newStatus].name}.`);
        loadRepairBoard(); // Recargar el tablero
    } catch (e) {
        logStatus(`Error al cambiar estado: ${e.message}`, true);
    }
}

// =========================================================================
// 4. LÓGICA DE ADMINISTRACIÓN (Herramientas del Módulo Admin)
// =========================================================================

async function addBikeFromAdmin() {
    const id = document.getElementById('admin-new-bike-id').value;
    const name = document.getElementById('admin-new-bike-name').value;
    const km = parseFloat(document.getElementById('admin-new-bike-km').value);
    
    if (!id || !name || isNaN(km)) return logStatus("Datos incompletos.", true);
    
    try {
        await db.collection('bikes').doc(id).set({
            user_id: CURRENT_USER_ID, 
            name: name,
            total_km: km,
            created_at: new Date(),
            notes: ''
        });
        logStatus(`Bicicleta '${name}' agregada.`);
        loadBikesAndStock();
    } catch (e) { logStatus(`Error: ${e.message}`, true); }
}

async function addInitialComponent() {
    const bikeId = document.getElementById('admin-comp-bike-id').value;
    const compId = document.getElementById('admin-comp-id').value;
    const maxKm = parseFloat(document.getElementById('admin-comp-max-km').value);

    if (!bikeId || !compId || isNaN(maxKm)) {
        return logStatus("Datos de componente incompletos.", true);
    }

    try {
        const componentRef = db.collection('bikes').doc(bikeId).collection('components').doc(compId);
        await componentRef.set({
            name: compId.toUpperCase(),
            initial_bike_km: 0,
            max_alert_km: maxKm,
            current_km_usage: 0,
            cost: 0,
            installed_date: new Date(),
        });
        logStatus(`Componente inicial ${compId} creado para ${bikeId}.`);
    } catch (e) {
        logStatus(`Error al crear componente: ${e.message}`, true);
    }
}

async function handleKmUpdateFromAdmin() {
    const bikeId = document.getElementById('admin-update-bike-id').value;
    const newTotalKm = parseFloat(document.getElementById('admin-new-km-input').value);
    
    // Llama a la función principal de KM Update
    await handleKmUpdate(bikeId, newTotalKm);
}

// La función principal de carga se llama ahora 'loadBikesAndStock'
async function loadBikesAndStock() {
    if (!CURRENT_USER_ID) return; 
    logStatus("Cargando datos del usuario...");

    // Cargar el panel CRM como vista principal del dashboard
    if (document.getElementById('dashboard').classList.contains('active')) {
        loadRepairBoard();
    }
    
    // --- Cargar Inventario para la pestaña Stock ---
    // (Mantenida la lógica anterior)
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


// --- Lógica CRUD/Transaccional (Mantenida de la versión anterior) ---
// (Estas funciones usan el patrón atómico y se mantienen igual, solo se adaptan las referencias de los botones)

async function handleKmUpdate(bikeIdOverride = null, newKmOverride = null) {
    const bikeId = bikeIdOverride || document.getElementById('update-bike-id').value;
    const newTotalKm = newKmOverride || parseFloat(document.getElementById('new-km-input').value);

    if (!bikeId || isNaN(newTotalKm)) return logStatus("Datos de KM incompletos.", true);
    
    logStatus(`Iniciando LOTE DE ESCRITURA para actualizar KM de ${bikeId} a ${newTotalKm}...`);

    try {
        const batch = db.batch(); 
        const bikeRef = db.collection('bikes').doc(bikeId);

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

async function handleReplacement() {
    const bikeId = document.getElementById('maint-bike-id').value;
    const componentId = document.getElementById('maint-comp-id').value;
    const kmAtService = parseFloat(document.getElementById('maint-km-input').value);
    const cost = parseFloat(document.getElementById('maint-cost').value);
    const date = document.getElementById('maint-date').value;

    if (!bikeId || !componentId || isNaN(kmAtService) || isNaN(cost) || !date) {
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
                status: 'FINALIZADO' // El reemplazo es un trabajo terminado
            });

            transaction.update(componentRef, {
                initial_bike_km: kmAtService, installed_date: new Date(date),
                current_km_usage: 0, cost: cost,
            });
        });
        
        logStatus(`¡Reemplazo y Reseteo Atómico COMPLETADO!`);
        loadRepairBoard(); // Recargar el panel para ver si se afectó
    } catch (e) {
        logStatus(`Transacción FALLIDA: ${e.message}.`, true);
    }
}

async function addBike() {
    // Nota: Esta función es solo para añadir una bici con los campos mínimos. 
    // Usamos el módulo Admin para esta tarea.
    logStatus("Por favor, use la pestaña '⚙️ Admin' para añadir nuevos datos iniciales.", true);
}
async function addOrUpdateStock() {
    // (Lógica mantenida de la versión anterior)
    const partId = document.getElementById('stock-part-id').value;
    const name = document.getElementById('stock-name').value;
    const qty = parseInt(document.getElementById('stock-qty').value);
    const compatibilityInput = document.getElementById('stock-compatibility').value;
    const compatibility = compatibilityInput.split(',').map(s => s.trim()).filter(s => s.length > 0);

    if (!partId || !name || isNaN(qty)) return logStatus("Datos incompletos.", true);

    try {
        await db.collection('spare_parts').doc(partId).set({
            user_id: CURRENT_USER_ID, 
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

// ... (Funciones de Modal Detalle - Se mantienen adaptadas) ...

// =========================================================================
// 6. LLAMADA DE ARRANQUE FINAL
// =========================================================================

initApp();