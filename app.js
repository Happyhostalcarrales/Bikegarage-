// app.js (Funcionalidad CRM y Paneles de Trabajo)

// ... (Se mantiene la CONFIGURACIÓN DE FIREBASE E INICIALIZACIÓN - Sección 1) ...

const REPAIR_STATUSES = {
    'ENTRADA': { name: '1. En Entrada', class: 'col-entrada' },
    'DIAGNOSTICO': { name: '2. En Taller / Diagnóstico', class: 'col-taller' },
    'FINALIZADO': { name: '3. Finalizado / Listo para Recoger', class: 'col-finalizado' }
};

// ... (Se mantienen las funciones de AUTENTICACIÓN - Sección 2) ...

// =========================================================================
// 3. LÓGICA DE LECTURA Y RENDERIZADO CRM (PANEL DE TRABAJO)
// =========================================================================

// La función principal de carga se llama ahora 'loadRepairBoard'
async function loadRepairBoard() {
    if (!CURRENT_USER_ID) return;
    logStatus("Cargando panel de reparaciones...");
    
    const boardContainer = document.getElementById('panel-board-container');
    boardContainer.innerHTML = ''; // Limpiar

    // Consultar todos los registros de mantenimiento (el historial) del usuario
    const maintenanceSnapshot = await db.collectionGroup('maintenance')
        .where('user_id', '==', CURRENT_USER_ID)
        .orderBy('date', 'desc')
        .get();

    // Estructura para organizar trabajos por estado
    const statusPanels = {
        'ENTRADA': [],
        'DIAGNOSTICO': [],
        'FINALIZADO': []
    };
    
    // Obtener todas las bicicletas para referenciar los nombres
    const bikesMap = new Map();
    const bikesSnapshot = await db.collection('bikes').where('user_id', '==', CURRENT_USER_ID).get();
    bikesSnapshot.forEach(doc => bikesMap.set(doc.id, doc.data().name));


    // 1. Organizar los trabajos por estado
    maintenanceSnapshot.forEach(doc => {
        const record = doc.data();
        const status = record.status || 'ENTRADA'; // Estado por defecto
        
        if (statusPanels[status]) {
            statusPanels[status].push({
                id: doc.id,
                bikeName: bikesMap.get(record.bike_id) || record.bike_id,
                ...record
            });
        }
    });

    // 2. Renderizar los Paneles (Columnas Kanban)
    for (const key in REPAIR_STATUSES) {
        const statusInfo = REPAIR_STATUSES[key];
        const trabajos = statusPanels[key];
        
        let cardsHTML = trabajos.map(job => `
            <div class="kanban-card" onclick="openMaintenanceDetail('${job.id}')">
                <div class="card-title">${job.bikeName}</div>
                <div class="card-detail">${job.description || 'Tarea de mantenimiento'}</div>
                <div class="card-detail" style="margin-top: 5px;">
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
                    ${cardsHTML || '<p style="font-size:0.9em;">No hay trabajos en este estado.</p>'}
                </div>
            </div>`;
    }
}

/**
 * Función para cambiar el estado de un registro de mantenimiento.
 * @param {string} bikeId - ID de la bicicleta
 * @param {string} maintenanceId - ID del registro de mantenimiento a actualizar
 * @param {string} newStatus - Nuevo estado (ENTRADA, DIAGNOSTICO, FINALIZADO)
 */
async function changeRepairStatus(bikeId, maintenanceId, newStatus) {
    if (!CURRENT_USER_ID) return logStatus("Debe iniciar sesión.", true);

    try {
        const recordRef = db.collection('bikes').doc(bikeId).collection('maintenance').doc(maintenanceId);
        
        await recordRef.update({
            status: newStatus,
            date_updated: new Date()
        });
        
        logStatus(`Estado del trabajo ${maintenanceId} actualizado a ${REPAIR_STATUSES[newStatus].name}.`);
        loadRepairBoard(); // Recargar el tablero
    } catch (e) {
        logStatus(`Error al cambiar estado: ${e.message}`, true);
    }
}


// La función loadBikesAndStock ahora solo carga el inventario y administra la UI de administración
async function loadBikesAndStock() {
    if (!CURRENT_USER_ID) return; 

    // Mantenemos la lógica de stock aquí
    // --- Cargar Inventario ---
    // ... (El código de carga de stock se mantiene aquí) ...
    // ...
    
    // Llamamos al panel para cargar la vista principal
    loadRepairBoard();
}

// LÓGICA CRM: Abrir detalle de trabajo (Necesitas definir la modal de detalle de Mantenimiento si quieres mostrarlo)
function openMaintenanceDetail(maintenanceId) {
    alert("Aquí se abriría la modal de detalle de la reparación: " + maintenanceId);
}

// LÓGICA ADMIN: Añadir componente inicial
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


// ... (El resto de las funciones de Firebase - handleReplacement, handleKmUpdate, addBike, etc. - 
// se mantienen igual que en la versión anterior para mantener la funcionalidad atómica y solo usan CURRENT_USER_ID)
// --------------------------------------------------------------------------------------------------
// Llama a la función de inicio SÓLO después de que todas las funciones estén definidas
initApp();