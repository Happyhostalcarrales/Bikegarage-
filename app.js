// app.js (La lógica es la misma, solo se mejoró el log)

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

const LOG_OUTPUT = document.getElementById('log-output');

// Función auxiliar para registrar acciones (AHORA CON CLASES CSS)
function logStatus(message, isError = false) {
    const time = new Date().toLocaleTimeString();
    const className = isError ? 'log-error' : 'log-success';
    LOG_OUTPUT.innerHTML = `<div class="${className}">[${time}] ${isError ? '❌ ERROR: ' : '✅ OK: '}${message}</div>${LOG_OUTPUT.innerHTML}`;
}

// =========================================================================
// 2. FUNCIÓN DE REEMPLAZO (TRANSACCIÓN)
// =========================================================================

async function handleReplacement() {
    const bikeId = document.getElementById('bike-id-input').value;
    const componentId = document.getElementById('component-id-input').value;
    const kmAtService = parseFloat(document.getElementById('km-at-service-input').value);

    if (!bikeId || !componentId || isNaN(kmAtService)) {
        return logStatus("Datos incompletos para el reemplazo.", true);
    }

    logStatus(`Iniciando TRANSACCIÓN (Reseteo) para ${componentId}...`);

    try {
        await db.runTransaction(async (transaction) => {
            
            const maintenanceRef = db.collection('bikes').doc(bikeId).collection('maintenance').doc();
            const componentRef = db.collection('bikes').doc(bikeId).collection('components').doc(componentId);

            // 1. CREACIÓN: Registrar la tarea de mantenimiento
            transaction.set(maintenanceRef, {
                bike_id: bikeId, type: 'Reemplazo', component_id: componentId,
                bike_km_at_service: kmAtService, date: new Date(),
            });

            // 2. ACTUALIZACIÓN: Resetear el componente
            transaction.update(componentRef, {
                initial_bike_km: kmAtService, installed_date: new Date(), current_km_usage: 0 
            });
        });
        
        logStatus(`¡Reemplazo y Reseteo Atómico COMPLETADO! Revisar ${componentId} en Firestore.`);
    } catch (e) {
        logStatus(`Transacción FALLIDA: ${e.message}. Nada fue guardado, datos consistentes.`, true);
    }
}


// =========================================================================
// 3. FUNCIÓN DE ACTUALIZACIÓN DE KM (LOTE DE ESCRITURA)
// =========================================================================

async function handleKmUpdate() {
    const bikeId = document.getElementById('update-bike-id').value;
    const newTotalKm = parseFloat(document.getElementById('new-km-input').value);

    if (!bikeId || isNaN(newTotalKm)) {
        return logStatus("Datos incompletos para la actualización de KM.", true);
    }
    
    logStatus(`Iniciando LOTE DE ESCRITURA para actualizar KM de ${bikeId} a ${newTotalKm}...`);

    try {
        const batch = db.batch(); 
        const bikeRef = db.collection('bikes').doc(bikeId);
        const componentsCollection = db.collection('bikes').doc(bikeId).collection('components');

        // 1. ACTUALIZACIÓN DE BICI
        batch.update(bikeRef, { total_km: newTotalKm });

        // 2. RECORRER Y ACTUALIZAR COMPONENTES
        const componentsSnapshot = await componentsCollection.get();
        let alertsCount = 0;

        componentsSnapshot.forEach(doc => {
            const component = doc.data();
            const componentRef = doc.ref;

            const initialKm = component.initial_bike_km || 0;
            const maxAlertKm = component.max_alert_km || 99999;
            const newUsage = newTotalKm - initialKm;
            
            batch.update(componentRef, { current_km_usage: newUsage });
            
            // Lógica de Alerta de KM Vencido (Local)
            if (newUsage >= maxAlertKm) {
                logStatus(`ALERTA: ${component.name} ha superado el límite de ${maxAlertKm} km.`, true);
                alertsCount++;
            }
        });

        // 3. Ejecutar todas las escrituras a la vez
        await batch.commit();

        logStatus(`Lote de Escritura COMPLETO. ${componentsSnapshot.size} componentes actualizados. Alertas detectadas: ${alertsCount}.`);
    } catch (e) {
        logStatus(`Fallo en el Lote: ${e.message}.`, true);
    }
}